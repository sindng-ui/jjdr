# jjdr 12대 이슈 통합 수정 및 기능 개선 계획서

> **작성일**: 2026-11-24  
> **대상 워크스페이스**: `k:\Antigravity_Projects\gitbase\jjdr`

## 0. 이슈 전체 정렬 요약 (실행 순서)

| Phase | 순서 | 원번호 | 핵심 주제 | 성격 |
| :--- | :---: | :---: | :--- | :--- |
| **Phase 1** | 1 | #1 | `failed` / `C:\Windows\System32` 고아 카드 제거 & '지금 확인' 개수 일치화 | 버그 |
| **Phase 1** | 2 | #3 | Worktree 카드 '승인' 오탐 표시 수정 (앱 로직 버그 확정 + `herdr-core` 경계 보강) | 버그 |
| **Phase 1** | 3 | #10 | `Ctrl+N` 점프 헛돌기 / 특정 카드 고착 버그 수정 | 버그 |
| **Phase 1** | 4 | #2 | 좌측 보드 & 우측 터미널 패인 하단 잘림 수정 | 레이아웃 버그 |
| **Phase 2** | 5 | #7 | `Ctrl+방향키` 카드 이동 후 우측 AI CLI 프롬프트 자동 포커스 | 키보드 UX |
| **Phase 2** | 6 | #8 | 우측 패인 드래그 → 우클릭 즉시 클립보드 복사 | 터미널 UX |
| **Phase 3** | 7 | #6 | `Ctrl+P` 파일 검색 Regex + `*.cpp` Glob 패턴 지원 | 검색 기능 |
| **Phase 3** | 8 | #5 | 내장 MD 뷰어 폭 확장 + 마우스 리사이즈 + 로컬 저장 | 뷰어 개선 |
| **Phase 3** | 9 | #9 | 초경량 내장 코드뷰어 신설 (`Enter` 내장 뷰어 / `Shift+Enter` 기본 앱) | 신규 기능 |
| **Phase 4** | 10 | #4 | `ROOT` 카드 공간 점유 개선 (프로젝트 헤더 컴팩트 칩 전환) | 보드 UX |
| **Phase 4** | 11 | #11 | 마우스 드래그 카드 순서 변경 → 1:1 자리 교환(`swap`) | 보드 UX |
| **Phase 4** | 12 | #12 | 키보드 카드 자리 교환 (`Ctrl+Shift+Alt+방향키` 그랩 → 키 떼면 1:1 교환) | 키보드 UX |

---

## Phase 1. 핵심 버그 및 상태·레이아웃 정확도 수정 (#1, #3, #10, #2)

### 1-1. [#1] 상단 '지금 확인' 개수 불일치 & 빨간색 `Failed` (`C:\Windows\System32` 등) 카드 제거
- **원인**:
  1. `dashboardLogic.ts`에서 `state === "finished" && exit_code === 0`만 제외하고 비정상 종료(`exit_code !== 0`) 세션은 남겨두어 `needs_you`(`Failed`)로 노출됨.
  2. 프로젝트에 매칭되지 않고 `cwd`가 `C:\Windows\System32` 등 OS 시스템 디렉터리인 외부/고아 세션이 그대로 유입됨.
  3. `RadarBoardView.tsx`의 '지금 확인' 리본이 보드 Worktree 카드가 아닌 `allSessions` 전체를 집계해 보드 카드 수와 불일치.
- **수정**:
  - `dashboardLogic.ts`: `state !== "live"` 종료 세션 및 미소속 OS 시스템 경로 고아 세션 원천 제외.
  - `RadarBoardView.tsx`: '지금 확인' 리본을 보드에 실제 표시되는 Worktree 카드(`topBucket === "needs_you" | "ready"`) 및 live `unassigned` 카드 기준으로 1:1 일치화.

### 1-2. [#3] Worktree 카드 '승인' 표시 오탐 수정
- **원인 (앱 로직 버그 확정)**:
  - `RadarTile.tsx`와 `SessionCard.tsx`가 `bucket === "needs_you"`이면 무조건 `승인` 버튼을 렌더링함.
  - 실제로는 `isStuck`(5분 초과 `working`), `error`, `blocked (kind=question/auth/null)`까지 모두 `needs_you`로 들어가 있어, AI가 승인을 묻지 않았는데도 `승인` 버튼이 표시됨.
- **수정**:
  - `승인` 버튼은 오직 `terminal.state === "live" && status.state === "blocked" && status.kind === "permission"`일 때만 표시.
  - `isStuck`은 `승인` 버튼 없이 `Stuck Nm` 경고 배지만 표시.
  - `StatusBadge.tsx` 툴팁에 `herdr-core` 원본 `status.state / kind / msg` 노출로 오탐 여부 즉시 식별 가능하게 보강.

### 1-3. [#10] `Ctrl+N` 점프 헛돌기 및 고착 버그 수정
- **원인**:
  - `jumpToNextActionable`이 카드 단위가 아니라 개별 세션(`allSessions`) 단위로 순환하여 같은 Worktree 내 다중 세션이나 보이지 않는 `projectId === null` 세션 사이를 헛돌거나, `selectedAddress` 불일치로 `curIdx === -1` → 매번 0번으로 고착.
- **수정**:
  - 화면의 카드 단위(`cardKey`) + 안정적 정렬(버킷 → 보드 순서 → `cardKey`)로 1회 1카드씩 정확히 순환하도록 전면 개편.

### 1-4. [#2] 좌측 Worktree 보드 & 우측 AI 터미널 패인 하단 잘림 수정
- **원인**:
  - `AttachedTerminalDrawer.tsx`의 `flex-col` 자식 컨테이너에 `flex-1`과 `h-full`이 동시 선언되고 `min-h-0`가 빠져 헤더/프리셋/탭 높이만큼 넘쳐 하단이 잘림.
  - `containerRef`에 `p-2.5` 패딩이 직접 걸려 `FitAddon.fit()`이 맨 아랫줄 높이를 오계산함.
  - `attachTerminal` 전/후 `fitNow()` 재동기화 누락.
- **수정**:
  - `html, body, #root` `overflow: hidden` + `App.tsx` / `RadarBoardView` / `AttentionBoard` / `AttachedTerminalDrawer` 전체 `min-h-0` 체인 완결 및 보드 하단 패딩(`pb-10`) 확보.
  - `containerRef` 바깥 wrapper로 패딩 분리 + `attachTerminal` 직전/직후 강제 `fitNow()`.

---

## Phase 2. 터미널 패인 키보드 & 복사 UX (#7, #8)

### 2-1. [#7] `Ctrl+방향키` 이동 후 우측 AI CLI 프롬프트 자동 포커스
- `useXtermSession`에 `focusNow()` 및 `useUiStore`의 `terminalFocusNonce` 연동.
- `Ctrl+방향키` / `Ctrl+N` 이동 시 우측 패인 live 세션에 즉시 `term.focus()` + `focusTerminal(ch, true)` 동기화.

### 2-2. [#8] 우측 패인 드래그 → 우클릭 즉시 클립보드 복사
- `useXtermSession`에 `contextmenu` 핸들러 추가: `term.hasSelection()` 시 클립보드 복사 → `clearSelection()` → 짧은 토스트 → `term.focus()` 유지.
- 스마트 `Ctrl+C`(선택 있으면 복사, 없으면 `^C`) 및 `Ctrl+Shift+C/V` 함께 지원.

---

## Phase 3. 검색 고도화(Regex/Glob) & 내장 뷰어 (#6, #5, #9)

### 3-1. [#6] `Ctrl+P` 파일 검색 Regex + `*.cpp` Glob 지원
- `src-tauri/Cargo.toml`에 `regex = "1"` 추가.
- `file_matcher.rs`에 자동 Glob(`*`, `?`, `**`), `/regex/`·메타문자 자동 감지 및 명시적 `use_regex` 토글(`Alt+R`, `.*` 버튼), 다중 토큰 혼합(`*.cpp render`) 지원.

### 3-2. [#5] 자체 MD 뷰어 폭 확장 + 마우스 리사이즈 + 로컬 저장
- 공용 `src/hooks/useResizableModalWidth.ts` 신설(기본 84vw / 최대 1240px, 좌/우 드래그 리사이즈, 더블클릭 리셋, `localStorage` 저장).
- `MarkdownViewerModal.tsx`의 `max-w-4xl` 및 내부 `max-w-3xl` 제한 제거.

### 3-3. [#9] 자체 초경량 내장 코드뷰어 신설 (`Enter` 자체 뷰어 / `Shift+Enter` 기본 앱)
- `files.rs`에 `is_binary` 감지 추가.
- 0-dependency 경량 하이라이터(`src/utils/codeHighlighter.ts`) + `@tanstack/react-virtual` 기반 가상 스크롤 `CodeViewerModal.tsx` (`React.lazy`) 신설(줄번호, 줄번호 클릭 시 `경로:줄번호` 복사, Word Wrap, 모달 내 `Ctrl+F` 검색, 폭 리사이즈/로컬 저장 공유).
- `QuickFileModal.tsx`: `Enter` → 내장 MD/코드 뷰어, `Shift+Enter` → 기본 앱.

---

## Phase 4. 보드 공간 효율화 & 1:1 자리 교환 (#4, #11, #12)

### 4-1. [#4] `ROOT` 카드 공간 점유 개선
- `AppSettings.root_card_mode`: `"header_chip"`(기본) | `"card"` | `"hidden"`.
- 추가 Worktree가 1개 이상일 때 `ROOT`를 그리드에서 분리해 프로젝트 헤더 우측의 컴팩트 `🏠 main` 칩으로 표시(상태 점, 클릭 Attach, 더블클릭 실행, 우클릭 컨텍스트 메뉴 전부 유지).

### 4-2. [#11] 마우스 드래그 1:1 자리 교환(`swap`)
- `usePointerReorder.ts`에 `swapIds` 및 `mode: "swap"` 추가, `ProjectTray.tsx`에 적용 및 `⇄` 교환 대상 시각 강조.

### 4-3. [#12] 키보드 카드 자리 교환 (`Ctrl+Shift+Alt+방향키`)
- `Ctrl+Shift+Alt+방향키` 첫 입력 시 현재 카드 그랩 + 방향 이동, 추가 방향키로 대상 선택, 수정자 키 `keyup` 시 `swapIds`로 1:1 교환 및 영속 저장 (`Esc`/blur 취소, xterm 단축키 차단 등록).

---

## 검증 및 문서화
- Frontend Vitest 단위 테스트 + Rust `cargo test` + `npm run build` + `cargo check`
- 테스트 결과: `docs/test_results_2026-11-24_v4.txt`
- 아키텍처 문서: `APP_MAP.md` 전면 업데이트
