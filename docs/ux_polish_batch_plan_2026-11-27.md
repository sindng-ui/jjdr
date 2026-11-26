# jjdr 6대 UX · 포커스 · 테마/레이아웃 개선 구현 계획 (2026-11-27)

## 추천 구현 순서 (의존성 · 체감 효과 · 리스크 기준)
1. **앱 포커스 복귀 시 우측 Terminal 자동 포커스** (`#5`) — 가장 독립적이고 즉각적인 키보드 UX 개선
2. **Claude CLI 드래그 후 우클릭 복사 안정화** (`#2`) — `useXtermSession` 마우스 리포팅 충돌 해결
3. **Zen Dispatch Hire/Assign 중 타 카드 결재 난입 차단** (`#4`) — Dispatch 흐름 안정화
4. **Zen `Time to chill`에서 `Ctrl+N` 진행 중 작업 순환 스위칭** (`#1`) + **경과 시간 기반 프로그레스 바 & 색상 단계** (`#6`) — `ZenModeView` + `ZenEmptyBriefing` 일괄 개선
5. **Radar `Columns` 모드 사용자 컬럼 너비 커스터마이징 범위 확대 (`210px ~ 560px`)** (`#3`) — 보드·스토어·설정 UI 연동

---

## 단계별 상세 설계

### 1. [항목 #5] 앱 포커스 복귀 시 우측 Terminal 자동 포커스
- **파일**: `src/hooks/useHerdrSync.ts`, `src/hooks/useXtermSession.ts`
- **설계**:
  - `useHerdrSync.ts`의 `onWindowFocus`에서 앱 창이 다시 포커스를 얻을 때 `ui.terminalDrawerOpen && ui.attachedAddress`이면 `requestAnimationFrame` 1프레임 뒤(마우스 클릭 대상이 `<input>`/`<textarea>`/`<select>`/모달인지 확정된 후) `ui.requestTerminalFocus()`를 호출.
  - `useXtermSession.ts`의 `focusNow()`는 이미 모달 열림/검색 input 포커스 보호가 있으므로, 검색창 클릭 시에는 포커스를 빼앗지 않고 스테이지/빈 영역/터미널 클릭 복귀 시에만 즉시 타이핑 가능한 상태로 복원.

### 2. [항목 #2] Claude CLI 출력 마우스 드래그 후 우클릭 복사 수정
- **파일**: `src/hooks/useXtermSession.ts`
- **원인**: Claude CLI 같은 TUI 앱이 xterm 마우스 리포팅(`?1000h`/`?1002h`/`?1006h`)을 켜면, 우클릭 `mousedown(button === 2)` 시 xterm이 선택을 해제하거나 PTY로 마우스 시퀀스를 보내 `contextmenu` 시점에 `term.hasSelection()`이 사라짐.
- **설계**:
  - `term.onSelectionChange`로 비어 있지 않은 최신 선택 문자열 스냅샷(`lastSelectionRef`)을 안전하게 유지(선택 해제 직전 우클릭 타이밍 보호).
  - `hostEl`에 `mousedown` capture 리스너를 등록해 `e.button === 2`(우클릭) 시 `term.hasSelection()`(또는 `mousedown` 직전 스냅샷)이 있으면 `e.preventDefault()` & `e.stopPropagation()`으로 PTY 마우스 리포팅 전달/선택 해제를 선제 차단하고 `pendingRightClickCopyRef`에 텍스트를 보존.
  - `onContextMenu`에서 `term.getSelection() || pendingRightClickCopyRef`를 복사하고 성공 시 선택 해제 + 토스트 + `term.focus()`.

### 3. [항목 #4] Zen Dispatch Hire/Assign 중 타 카드 결재 난입 차단
- **파일**: `src/hooks/useZenDispatchMonitor.ts`, `src/components/zen/ZenDispatchView.tsx`, `src/hooks/useXtermSession.ts`, `src/store/useUiStore.ts`
- **원인**: 신규 일꾼 고용(`Hire`) 후 첫 작업을 입력하려고 우측 pane을 보는 동안, 새 CLI 부팅 과정의 `turn` 증가 또는 일시적 `working` 상태(650ms+)를 `useZenDispatchMonitor`가 "작업 출동 완료"로 오판해 `triggerDispatched()` → `returnToZenInbox()`를 실행시켜 Inbox의 다른 승인 카드가 뙇 올라옴.
- **설계**:
  - `useUiStore`에 `zenDispatchInputTimestamp: number` (또는 `recordZenTerminalSubmit(address)` 액션)를 추가해, `useXtermSession`에서 사용자가 우측 터미널에 실제로 입력/엔터(`Enter` 키 또는 텍스트 전송)를 한 시점을 기록.
  - `useZenDispatchMonitor`에서 `hiredSolo` 또는 신규/대기 일꾼이 우측 pane에 붙은 직후, **사용자가 해당 터미널에 실제로 프롬프트를 입력·전송하기 전까지는** CLI 초기 부팅 턴 증가/초기 `working` 상태로 절대 `DISPATCHED!` → `returnToZenInbox()`가 발동하지 않도록 가드 강화!
  - 또한 `zenModeTab === "dispatch"` 상태에서는 외부 백그라운드 배치 이벤트가 `Inbox`로 강제 전환하지 못하도록 보장.

### 4. [항목 #1 & #6] Zen `Time to chill` `Ctrl+N` 진행 중 순환 + 경과 시간 프로그레스 바/색상
- **파일**: `src/components/zen/ZenModeView.tsx`, `src/components/zen/ZenEmptyBriefing.tsx`
- **설계 (#1)**:
  - `ZenModeView.tsx`의 `handleManualNext` (`Ctrl+N` / `zenSkipNonce`)에서 `!activeCard` (즉 `Time to chill` 상태)이고 `byBucket.running.length > 0`이면, `peekingAddr` 기준으로 `byBucket.running`을 원형 순환하며 다음 세션을 선택해 `handlePeekRunning(next)` 실행 → 우측 pane 자동 오픈 및 즉시 터미널 스위칭 + 포커스.
  - `ZenEmptyBriefing.tsx`에 `peekingAddress` prop을 전달해 현재 우측 pane에 열린 Active Mission 카드에 선택 포커스 링 + `Viewing` 뱃지 표시, 상단 힌트에 `Ctrl+N` 순환 안내 추가.
- **설계 (#6)**:
  - `ZenEmptyBriefing.tsx`에 **15초 간격**의 경량 `tick` 타이머만 둬서 CPU/렌더 부하 없이 시간 경과를 반영.
  - `progress` 값이 명시되지 않은 세션은 `elapsedMs` 기반 점근 곡선(`18%` → 2분 `42%` → 5분 `64%` → 10분 `82%` → 20분+ `92%`)으로 서서히 차오르게 계산.
  - 경과 시간별 직관적 색상 4단계 적용:
    - `< 2분`: `#38bdf8` (스카이 블루 — 방금 시작)
    - `2 ~ 5분`: `#2dd4bf` (틸 민트 — 순조롭게 진행 중)
    - `5 ~ 12분`: `#f59e0b` (앰버 골드 — 장기 작업 진입)
    - `12분+`: `#fb7185` (코랄 오렌지 — 오래 일함 / 확인 권장)

### 5. [항목 #3] Radar `Columns` 모드 컬럼 너비 조절 범위 확대 (`210px ~ 560px`)
- **파일**: `src/utils/radarLayout.ts`, `src/store/useUiStore.ts`, `src/components/board/RadarBoardView.tsx`, `src/components/modals/SettingsModal.tsx`
- **설계**:
  - `radarLayout.ts`: `MIN_RADAR_COL_WIDTH = 210`, `MAX_RADAR_COL_WIDTH = 560` 범위의 커스텀 너비 저장/조회(`jjdr.radar_col_width_px`, `null`이면 기존 밀도 프리셋 `244/276/308px` 자동 사용) 및 Focus 모드 자동 보정 폭(`min(580, colWidth + 80)`) 계산 함수 추가.
  - `useUiStore.ts`: `radarColumnWidthPx: number | null`, `setRadarColumnWidthPx(px: number | null)` 상태 추가.
  - `RadarBoardView.tsx`: `Columns` 모드일 때 상단 우측 `Columns | Rows` 스위처 옆에 컴팩트 폭 조절 바(`210 ~ 560px` 슬라이더 + `px` 수치 표시 + 더블클릭 Auto 초기화)를 배치해 해상도에 맞춰 보드를 보며 즉시 넓이 조절 가능.
  - `SettingsModal.tsx`: Radar 설정 영역에도 동일한 `Columns 모드 컬럼 너비` 슬라이더 및 `기본값 복원` 버튼 연동.

---

## 검증 계획
- `npm run test` (신규 유틸 테스트 포함: `radarLayout.test.ts` 커스텀 폭 clamp/focus 계산, `zenQueue`/`progress` 헬퍼 등)
- `npm run build` (`tsc && vite build` 에러 0건)
- Zero-Blur 검사 및 모든 파일 900줄 미만 확인
- `APP_MAP.md` 업데이트 및 `docs/test_results_2026-11-27.txt` 결과 저장
