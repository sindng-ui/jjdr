# Zen 모드 「일 시키기 (Worker Dispatch)」 연계 구현 계획서

> **작성일**: 2026-11-25  
> **대상 워크스페이스**: `k:\Antigravity_Projects\gitbase\jjdr`  
> **목표**: Radar 모드로 나가 흩어진 Idle 카드를 눈으로 탐색하는 정신력 소모를 제거하고, Zen 모드 안에서 **프로젝트 선택 → 일꾼 고용 vs 기존 일꾼에게 일 시키기 → 1명씩 얼굴 보고 맞으면 바로 지시(우측 터미널 자동 연결) / 아니면 다음 → 출동 시 결재함 자동 복귀**의 매끄러운 순환 루프를 완성한다.

---

## 1. 확정된 핵심 UX 플로우

```text
[Zen 모드 상단 바 / All Clear 화면]
  · 결재함 (N)  ↔  일 시키기 (대기 M)   [Ctrl+Shift+D]
        │
        ▼ (Step 1: 프로젝트 선택 — 1클릭 or 숫자 1~9)
  [프로젝트 카드 선택]
  (프로젝트 컬러·이름 + AI 대기 N명 · 빈 Worktree M개 · 작업중 K명)
        │
        ▼ (Step 2: 2지선다 갈림길)
  ┌──────────────────────────┬──────────────────────────┐
  │ 🆕 일꾼 고용하기          │ 🎯 일꾼에게 일 시키기      │
  │ (새 Worktree + AI 실행)   │ (기존 일꾼 1명씩 얼굴 보기) │
  └────────────┬─────────────┴────────────┬─────────────┘
               │                          ▼ (Step 3: 일꾼 얼굴 덱)
               │              [좌측: 일꾼 얼굴 히어로 카드 1장]
               │              [우측: 해당 일꾼 터미널 자동 Attach & 포커스]
               │               - 정렬: ① AI 켜진 Idle 일꾼 (최근 활동/결재 MRU순)
               │                       ② 세션 꺼진 빈 Worktree (작업 흔적 우선, ROOT 후순위)
               │               - "얘 맞네!":
               │                   · AI 켜짐 → 그냥 우측 터미널에 바로 타이핑 + Enter
               │                   · 빈 Worktree → [기본 AI 깨우기 (Ctrl+Enter)] 1클릭
               │               - "아니, 다음!": 레버 / 가챠 다이얼 / Ctrl+N / Ctrl+→
               │               - "이전 일꾼": Ctrl+← (하단 ●○○ 도트 스트립 점프 지원)
               ▼                          ▼ (AI가 Idle → Running 전환 감지!)
  [Step 4: "🚀 출동 완료!" 피드백 → 항상 결재함 복귀 (결재 0건이면 All Clear 휴식)]
```

---

## 2. 세부 설계 & 정신력 절감 장치

### 2.1. 0.5초 일꾼 식별 카드 (`ZenWorkerCard`)
- 기존 [ZenHeroCard.tsx](../src/components/zen/ZenHeroCard.tsx)와 동일한 **3D 홀로그램 + Zero-Blur 60fps `rAF` 틸트** 감성 유지.
- **준비도 상태 배지 (3종)**:
  - `🟢 새 일 대기`: AI 켜져 있고 `git clean` 또는 `is_merged`
  - `🟡 이전 작업 이어하기`: AI 켜져 있고 `dirty_count > 0` 또는 메모/커스텀 이름 존재
  - `⚪ 휴면 (AI 꺼짐)`: Live AI 세션이 없는 빈 Worktree (Plain Shell만 있는 경우 포함)
  - `MERGED` 보조 배지 (`worktree.is_merged === true`일 때 강조 + 원클릭 `[퇴근(정리)]` 버튼)
- **Context 즉시 식별 요소**:
  - 초대형 작업명(`worktreeMeta.display_name || branch`) + 브랜치 칩 + **인라인 별칭/메모 편집 버튼**(`setEditWorktreeTarget`)
  - **수정된 주요 파일 칩 (최대 3개, `worktree.changed_files`)** + `+added / -deleted` Git Diff 버튼
  - **마지막 대화/출력 요약 (최대 4줄, `status.msg` 또는 `previewLines`)**
  - **원클릭 프롬프트 프리셋 칩** (AI 켜진 일꾼에게 원클릭 지시)
  - **하단 미니 도트 스트립 (`● ○ ○ · 1 / 4`)**: 덱의 위치·남은 인원 1초 인지 + 호버 툴팁/클릭 점프

### 2.2. 스마트 일꾼 정렬 (`src/utils/zenDispatch.ts`)
- **대상 필터**: 선택된 프로젝트의 `matrixLanes` 셀 중 현재 `topBucket === "idle"`인 Worktree (이미 `needs_you`/`ready`인 카드는 결재함에 있고, `running`은 작업 중이므로 배차 대상에서 제외). `settings.root_card_mode === "hidden"`이면 `ROOT` 제외.
- **정렬 순서**:
  1. **Tier 0 — AI 켜진 Idle 일꾼** (`!isPlainShellTerminal(s.terminal)`):
     - 최근 활동순(MRU) 내림차순: `Math.max(zenRecentAckedAt[cardKey] ?? 0, session.terminal.status_ms ?? session.terminal.created_ms ?? 0)`
     - 방금 Zen에서 결재한 일꾼이 리뷰 수정 시 1번 타자로 바로 등장.
  2. **Tier 1 — 빈/휴면 Worktree** (AI 미실행 또는 Plain Shell만 존재):
     - `is_main(ROOT)`을 후순위로 배치 → `dirty_count > 0` 또는 `display_name`/`note` 있는 Worktree 우선 → 기존 커스텀 순서 유지.

### 2.3. 우측 터미널 실시간 자동 연동 & 안전장치
- **AI 켜진 일꾼 카드 표시 시**: 즉시 `setSelectedCardKey` + `setSelectedAddress` + `setAttachedAddress(aiSession.address)` + `requestTerminalFocus()` → 얼굴 보고 맞으면 클릭 한 번 없이 바로 타이핑.
- **빈 Worktree 카드 표시 시**: `setSelectedCardKey(cardKey)` + `detachToEmptyDrawer()` → 우측 `TerminalEmptyState` 자동 표시 + 좌측 카드 `[기본 AI 깨우기 (Ctrl+Enter)]` 원클릭 기동 → 세션 생성 완료 즉시 자동 Attach & 포커스.
- **단축키 안전 설계**:
  - `Ctrl+D`는 xterm 터미널에서 `EOF(세션 종료)` 시그널이므로 **xterm 내부에서는 절대 가로채지 않음**.
  - 전역 토글 단축키는 **`Ctrl+Shift+D`** (어디서든 Zen 일 시키기 진입/토글, xterm 내부 포함 동작), xterm 외부에서 보조로 지원.
  - Step 3에서 `Ctrl+N` / `Ctrl+→` = 다음 일꾼, `Ctrl+←` = 이전 일꾼, `Ctrl+Enter` = 빈 Worktree일 때 기본 AI 깨우기, `Esc` = Step 3 → Step 2 → Step 1 → 결재함 순차 복귀.

### 2.4. 「일꾼 고용하기」 연계 (`CreateWorktreeModal`)
- Step 2에서 `[🆕 일꾼 고용하기]` 클릭 시 기존 `CreateWorktreeModal`을 해당 프로젝트로 오픈 (모달 0ms 닫기 + 백그라운드 생성 구조 재사용).
- **분기 처리**:
  - `First Task(initial_prompt)`를 입력하고 생성한 경우 → 생성 즉시 작업이 시작되므로 Zen은 **결재함(또는 All Clear)으로 자동 복귀**.
  - `First Task`를 비워두고 생성한 경우 → 생성 완료 시 새로 생성된 Worktree/세션(`terminal_address`)으로 우측 터미널을 자동 연결해 바로 지시 가능하도록 지원, 지시 후 `Running`이 되면 **결재함 복귀**.

### 2.5. 출동 감지 및 자동 복귀 (항상 결재함 복귀)
- Step 3에서 현재 보고 있는 일꾼의 `worktree`가 `idle → running`(또는 `needs_you`)으로 전이되는 순간 감지:
  - **"🚀 출동 완료!"** 도장/플로트 알림 표시 (짧은 450ms 연출)
  - **`setZenModeTab("inbox")`로 자동 복귀** (결재 대기 카드가 있으면 최상단 결재 카드 표시, 0건이면 All Clear 휴식 브리핑 + 우측 터미널 자동 닫힘).

---

## 3. 모듈 변경 계획 (900줄 제한 & Zero-Blur 준수)

### 신규 파일
1. `src/utils/zenDispatch.ts`: 순수 함수 (프로젝트별 대기 요약, 일꾼 덱 생성/정렬, 준비도 판별, 인덱스 순환).
2. `src/utils/zenDispatch.test.ts`: Vitest 단위 테스트 (MRU 정렬, AI Idle 우선 + 빈 Worktree 후순위, ROOT 처리, `is_merged`/dirty 준비도 분류, 순환/이전 이동).
3. `src/components/zen/ZenWorkerCard.tsx`: 일꾼 1명 얼굴 히어로 카드 UI (`React.memo`, Zero-Blur, 3D `rAF` 틸트, 수정 파일/요약/프리셋/도트 스트립/퇴근 버튼).
4. `src/components/zen/ZenDispatchView.tsx`: Zen 일 시키기 3-Step 뷰 (Step 1 프로젝트 선택 → Step 2 고용 vs 시키기 → Step 3 일꾼 얼굴 덱 + 레버/가챠 다이얼 + 출동 감지 자동 복귀).

### 수정 파일
1. `src/store/useUiStore.ts`: `zenModeTab` (`"inbox" | "dispatch"`), `zenDispatchProjectId`, `zenPrevNonce`, `zenRecentAckedAt`, `zenHiredReturnFocus` 상태 및 액션 추가.
2. `src/components/zen/ZenModeView.tsx`: 상단 `[결재함 | 일 시키기]` 2단 스위처 추가, `zenModeTab === "dispatch"` 시 `ZenDispatchView` 렌더링, 결재 완료 시 `recordZenAcked` 기록.
3. `src/components/zen/ZenEmptyBriefing.tsx`: All Clear 화면에 **[🎯 일 시키기]** CTA 및 프로젝트별 원클릭 대기 칩(클릭 시 해당 프로젝트 Step 2로 직행) 추가.
4. `src/components/zen/ZenTactileControl.tsx`: `label`, `titleOverride` optional props 추가로 결재함/배차함 공용 재사용.
5. `src/hooks/useGlobalShortcuts.ts`: `Ctrl+Shift+D`(Zen 일 시키기 토글), `Ctrl+←`(Zen 이전 일꾼), `Esc` 단계 복귀 연동 (xterm `Ctrl+D` EOF 미충돌 보장).
6. `src/components/modals/CreateWorktreeModal.tsx`: Zen 고용하기 흐름과 완료 시 자동 연결/복귀 연동.
7. `APP_MAP.md`: 신규 모듈 및 변경 인터페이스 반영.

---

## 4. 성능 & 리그레션 체크리스트
- [ ] **Zero-Blur 원칙**: `backdrop-filter` / `filter: blur()` 일체 미사용.
- [ ] **단일 XTerm 재사용**: 일꾼 얼굴 넘길 때 기존 단일 WebGL XTerm 인스턴스를 그대로 `setAttachedAddress`로 전환 (0ms GPU 재사용).
- [ ] **메모이제이션**: 프로젝트 요약 및 일꾼 덱 계산을 `useMemo`로 캐싱하고, `ZenWorkerCard` / `ZenDispatchView`를 `React.memo`로 감싸 불필요한 리렌더링 차단.
- [ ] **파일 크기 제한**: 모든 신규·수정 파일 900줄 미만 유지 (`ZenModeView.tsx` 비대화 방지).
- [ ] **기존 동작 리그레션 방지**: 기존 Zen 결재함(`needs_you` / `ready`, Sticky Lock, 도장 쾅, 자동 넘김) 및 Radar/Queue 단축키 동작 무손상 검증.

---

## 5. 검증 계획
- `npm run test` (`zenDispatch.test.ts` 포함 전체 Vitest 스위트 통과)
- `npm run build` (`tsc && vite build` 타입/번들 오류 0건)
- 성능/Zero-Blur/줄 수 최종 점검 후 `docs/test_results_2026-11-25_v9.txt` 저장
