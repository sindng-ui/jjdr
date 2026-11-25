# Radar Columns Focus Mode + ROOT Chip 키보드 포커스 구현 계획 (2026-11-26)

## 1. 목표
1. **ROOT 칩 키보드 포커스 (`Ctrl+방향키` / 방향키)**
   - 현행 ROOT 표시 정책(`nonRootCells.length > 0`이면 헤더 `ROOT main` 칩, 0개면 큰 카드)은 그대로 유지.
   - 축약된 작은 `ROOT main` 헤더 칩에도 `Ctrl+Up/Down/Left/Right` 및 일반 방향키로 자연스럽게 포커스 이동·터미널 연결(`Ctrl+\``/Enter)·컨텍스트 메뉴(`Alt+Enter`)가 동작하도록 지원.
2. **Radar Columns 포커스 모드 (단일 프로젝트 + 가속 확장 + 넓은 터미널 + 초슬림 전환 바)**
   - `Radar`의 `Columns` 모드에서 우측 터미널 Pane이 열리면, 불필요한 타 프로젝트 컬럼을 숨기고 **현재 포커스된 프로젝트(또는 External Shells) 1개만 표시**.
   - 포커스된 프로젝트 컬럼 폭을 가속감 있는 easing(`cubic-bezier(0.22, 1, 0.36, 1)`)으로 적당히 확장하고, 우측 터미널 Pane이 남는 가로 공간 전체(`flex-1`)를 쓰도록 자동 확장.
   - 포커스 모드 상단에 **초슬림 1줄 프로젝트 전환 바**(`[← All]` + 프로젝트 알약 탭 + `Needs You`/`Ready` 알림 점)를 배치하고, `Ctrl+Left/Right`로도 터미널을 닫지 않고 인접 프로젝트로 즉시 전환 가능하게 구현.

---

## 2. 상세 설계

### 2.1 ROOT 칩 키보드 내비게이션 (`ProjectTray.tsx`, `shortcutActions.ts`, `spatialNav.ts`)
- **[ProjectTray.tsx](file:///k:/Antigravity_Projects/gitbase/jjdr/src/components/board/ProjectTray.tsx)**:
  - `rootChipEl` 버튼에 기존 `RadarTile`과 동일한 DOM 데이터 속성 부여:
    - `data-jjdr-card={rootCardKey}`
    - `data-jjdr-session-addr={rootAttachTarget?.address ?? ""}`
    - `data-jjdr-project-id={project.id}`
    - `data-jjdr-worktree-path={rootCell.worktree.path}`
    - `data-jjdr-branch={rootCell.worktree.branch || ""}`
    - `data-jjdr-unreorderable="true"` (헤더 고정 칩이므로 카드 위치 스왑 대상에서 제외)
  - 선택 상태(`isRootSelected`)일 때 시각적 포커스 링(`var(--card-selected-shadow)` + `var(--accent-border)`)을 명확히 표시.
- **[shortcutActions.ts](file:///k:/Antigravity_Projects/gitbase/jjdr/src/utils/shortcutActions.ts)**:
  - `DomBoardCard`에 `unreorderable: boolean` 필드 추가 (`el.dataset.jjdrUnreorderable === "true"`).
  - `stepKeyboardCardGrab()`에서 `unreorderable` 카드는 그랩/스왑 대상에서 제외해 기존 드래그/키보드 스왑 리그레션 방지.
  - `openOrLaunchCard`, `toggleSelectedTerminal`, `openContextMenuForSelectedCard`, `moveRadarSpatial`은 `[data-jjdr-card]` 기반이므로 `ROOT main` 칩에서도 즉시 연동됨.

### 2.2 상태 및 순수 레이아웃 유틸 (`useUiStore.ts`, `radarLayout.ts`)
- **[useUiStore.ts](file:///k:/Antigravity_Projects/gitbase/jjdr/src/store/useUiStore.ts)**:
  - `radarLayoutMode: RadarLayoutMode` 상태 추가 (초기값 `readStoredRadarLayout()`), `setRadarLayoutMode(mode)` 액션에서 `writeStoredRadarLayout(mode)` 동시 반영.
  - `RadarBoardView`, `App`, `AttachedTerminalDrawer`, `shortcutActions`가 단일 스토어 값을 atomic selector로 공유.
- **[radarLayout.ts](file:///k:/Antigravity_Projects/gitbase/jjdr/src/utils/radarLayout.ts)**:
  - `getRadarFocusedColumnWidthPx(density)` 추가:
    - `compact`: `244px → 320px`
    - `balanced`: `276px → 356px`
    - `comfortable`: `308px → 388px`
  - `resolveFocusedRadarColumn({ lanes, unassigned, allSessions, attachedAddress, selectedCardKey, selectedProjectId })` 순수 함수 추가:
    - 우선순위: `attachedAddress` → `selectedCardKey` (`wt::` / `ext::`) → `selectedProjectId` → 첫 번째 프로젝트 → `external`.
  - `pickPreferredCellForLane(lane)` 순수 함수 추가:
    - 프로젝트 전환 바 클릭 또는 `Ctrl+Left/Right` 프로젝트 이동 시 선택할 대표 카드 결정 (`needs_you` → `ready` → `running` → 첫 non-root → root).

### 2.3 포커스 1프로젝트 + 가속 폭 확장 + 넓은 우측 터미널 (`App.tsx`, `RadarBoardView.tsx`, `ProjectTray.tsx`, `ExternalShellTray.tsx`, `AttachedTerminalDrawer.tsx`)
- **레이아웃 분할 규칙 (`isColumnsFocusMode = viewMode === "radar" && radarLayoutMode === "columns" && showDrawer`)**:
  - **Overview 상태 (터미널 닫힘)**: 기존과 100% 동일 (모든 프로젝트 세로 컬럼 + 가로 스크롤).
  - **Focus 상태 + 자동 폭 (`terminalWidthPx === null`)**:
    - 좌측 `RadarBoardView`: `width: min(${focusedColumnWidthPx + 32}px, 42%)`, `shrink-0`, `transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]`으로 가속감 있게 부드럽게 정착.
    - 우측 `AttachedTerminalDrawer`: `flex-1 min-w-[360px]`로 전환되어 남는 영역 전체(~65~74%)를 자동 점유 (기존 50% 고정 해제).
  - **Focus 상태 + 사용자 수동 리사이즈 (`terminalWidthPx !== null`)**:
    - 우측 `AttachedTerminalDrawer`: 기존처럼 `{ width: "${terminalWidthPx}px" }` (`max-w-[78%]`, `shrink-0`) 유지.
    - 좌측 `RadarBoardView`: `flex-1 min-w-[260px]`로 남은 폭 채우고, 포커스 컬럼이 `w-full`로 맞춤.
    - 리사이즈 핸들 더블클릭 시 `terminalWidthPx = null`로 복원되어 다시 자동 Focus 비율로 복귀.
  - **컬럼 내부 가속 확장 애니메이션**:
    - `ProjectTray` / `ExternalShellTray`에 `focusedMode?: boolean` prop 추가.
    - `focusedMode === true`일 때는 `collapsed` 상태를 무시하고 항상 펼쳐진 카드 리스트로 표시하며, `w-full` + `transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]` 적용 (Zero-Blur 유지).
- **성능 및 xterm 리사이즈 보호 (`AttachedTerminalDrawer.tsx`)**:
  - `isColumnsFocusMode` 토글 직후 `230ms`(트랜지션 완료 직후)에 `fitNow()`를 1회 호출해 xterm cols/rows가 확장된 폭에 정확히 맞도록 보정 (기존 `useXtermSession` 60ms ResizeObserver debounce와 조화).

### 2.4 상단 초슬림 프로젝트 전환 바 (`src/components/board/RadarFocusSwitcherBar.tsx` 신규)
- **컴포넌트 분리**: 파일 비대화 방지(<900줄 규칙)를 위해 독립 컴포넌트로 작성하고 `React.memo` 적용.
- **UI 구성 (영문 UI 규칙 준수, Zero-Blur)**:
  - 좌측: `[← All]` 버튼 (클릭 시 `closeTerminalDrawer()`로 즉시 전체 컬럼 Overview 복귀).
  - 우측 스크롤 트랙: 등록된 각 프로젝트 알약 탭 (`project.color` 6px dot + 이름 + 카드 수 + `needs_you`/`ready` 상태 알림 점) + 외부 셸이 있을 경우 `Shells` 알약 탭.
  - 탭 클릭 시 해당 프로젝트의 대표 worktree를 선택하고, live 세션이 있으면 즉시 우측 터미널 attach, standby면 빈 터미널 drawer로 전환.
- **키보드 연계 (`shortcutActions.ts`)**:
  - `Radar Columns Focus Mode`에서 `Ctrl+Left` / `Ctrl+Right`(또는 일반 `Left`/`Right`) 입력 시 현재 DOM에 옆 컬럼이 없으므로, 프로젝트 목록(및 External Shells)에서 이전/다음 항목으로 순환 전환 + 우측 터미널 자동 동기화!
  - `Ctrl+Up` / `Ctrl+Down`은 포커스된 프로젝트 내부 worktree 카드들과 상단 `ROOT main` 칩 사이를 오르내림.

---

## 3. 변경 파일 목록
1. `src/store/useUiStore.ts` — `radarLayoutMode`, `setRadarLayoutMode` 추가.
2. `src/utils/radarLayout.ts` — `getRadarFocusedColumnWidthPx`, `resolveFocusedRadarColumn`, `pickPreferredCellForLane` 추가.
3. `src/utils/radarLayout.test.ts` — 포커스 컬럼 해석 및 대표 셀 선택 단위 테스트 추가.
4. `src/utils/spatialNav.test.ts` — `ROOT main` 헤더 칩 상/하/우측 공간 탐색 단위 테스트 추가.
5. `src/components/board/RadarFocusSwitcherBar.tsx` — (신규) 포커스 모드 전용 초슬림 프로젝트 전환 바.
6. `src/components/board/RadarBoardView.tsx` — 포커스 모드 단일 컬럼 렌더링, `RadarFocusSwitcherBar` 연결, 자동 폭 클래스 적용.
7. `src/components/board/ProjectTray.tsx` — `rootChipEl`에 `data-jjdr-*` 속성 및 포커스 링 추가, `focusedMode` prop 지원.
8. `src/components/board/ExternalShellTray.tsx` — `focusedMode` prop 지원.
9. `src/components/terminal/AttachedTerminalDrawer.tsx` — `Columns Focus Mode`에서 `terminalWidthPx === null`일 때 `flex-1` 자동 확장 + 트랜지션 완료 `fitNow()` 1회 보정.
10. `src/App.tsx` — Suspense fallback 폭 동기화.
11. `src/utils/shortcutActions.ts` — `unreorderable` 보호 + `Columns Focus Mode`에서 `Ctrl+Left/Right` 프로젝트 전환 연동.
12. `APP_MAP.md` — 신규/수정 파일 인터페이스 문서 업데이트.

---

## 4. 검증 계획
1. **단위 테스트 (`npm run test`)**:
   - `radarLayout.test.ts`: `getRadarFocusedColumnWidthPx`, `resolveFocusedRadarColumn` (attached/selected/external/fallback), `pickPreferredCellForLane` 우선순위 검증.
   - `spatialNav.test.ts`: 1번 worktree 카드에서 `up` → `ROOT main` 칩, `ROOT main`에서 `down` → 1번 worktree 카드, `right` → 우측 인접 컬럼 카드 이동 검증.
2. **타입체크 & 빌드 (`npm run build`)**: `tsc && vite build` 에러 0건 확인.
3. **성능 & 규칙 점검**:
   - Zero-Blur 검사 (`backdrop-filter` / `blur(` 0건).
   - 전체 수정 파일 900줄 이하 확인.
   - `Rows` 모드 및 `Zen` 모드, `Queue` 모드, 수동 리사이즈 핸들 드래그/더블클릭 초기화, `Ctrl+Shift+Alt+Arrow` 카드 스왑 리그레션 없음 확인.
   - 테스트 결과를 `docs/test_results_2026-11-26_v2.txt`로 저장.
