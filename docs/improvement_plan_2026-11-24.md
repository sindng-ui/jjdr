# jjdr 회사 PC 테스트 피드백 14종 순차 개선 계획서

> 작성일: 2026-11-24  
> 목표: 회사 PC 실전 테스트에서 발견된 14가지 버그·성능·UX 이슈를 연관성 높은 그룹끼리 묶어 **4개 Phase**로 순차 개선하고, 500줄을 초과한 6개 파일의 모듈 분리 리팩토링을 병행합니다.

---

## 0. 전체 로드맵 요약 (4개 Phase)

| Phase | 테마 | 포함 이슈 | 핵심 목표 |
| :--- | :--- | :--- | :--- |
| **Phase 1** | **치명적 버그 수정 & 핵심 성능/안정성 개선** | `#6`, `#11`, `#13`, `#14` | PowerShell RPC 에러 근절, 이중 포커스 제거, Gemini CLI 전환 1초 프리징 해소(0ms 목표), Worktree 삭제 레이스 컨디션 해결 |
| **Phase 2** | **보드 레이아웃 정리 & 조작성 개선** | `#5`, `#7`, `#8`, `#9`, `#12` | 프로젝트별 수직 행 분리, `ROOT` 카드 배지 표시, 눈 아픈 diff 숫자 제거, `Esc`로 프로젝트 필터 해제, 우측 터미널 드래그 리사이즈 + 영속화 |
| **Phase 3** | **세션 추가·프로젝트 생성·카드 편집 UX 강화** | `#1`, `#2`, `#10` | `+` 모달에 AI/터미널 구분 선택 + 이름 개편, 프로젝트 모달 Git 브랜치 드랍다운, Worktree 카드 편집(표시 이름/메모/브랜치명) |
| **Phase 4** | **마우스 드래그 앤 드롭 순서 변경 & 영속화** | `#3`, `#4` | Tauri WebView2 호환 Pointer 기반 드래그 훅 구현, 좌측 프로젝트 순서 변경, 보드 내 Worktree 카드 순서 변경 + 영속화 |

---

## 1. 500줄 초과 파일 현황 및 병행 리팩토링 계획

코드베이스 점검 결과 현재 **500줄을 초과한 파일이 6개** 있으며, 이번 개선 작업 대상 파일과 정확히 일치합니다. 각 Phase 진행 시 아래처럼 책임을 분리하여 모든 파일을 **350줄 이하**로 슬림화합니다.

| 현재 파일 (라인 수) | 리팩토링 시점 | 분리 계획 |
| :--- | :---: | :--- |
| `src/components/modals/ProjectModal.tsx` (628줄) | Phase 3 | 고급 옵션(`ProjectAdvancedSection.tsx`) 및 브랜치/기본정보 섹션 분리 |
| `src-tauri/src/git/worktree.rs` (612줄) | Phase 1 | 레포 검사·브랜치·diff 파싱을 `src-tauri/src/git/inspect.rs`로 분리 |
| `src/hooks/useGlobalShortcuts.ts` (597줄) | Phase 2 | DOM 카드 조회·내비게이션·실행 액션을 `src/utils/shortcutActions.ts`로 분리 |
| `src/components/board/RadarBoardView.tsx` (538줄) | Phase 2 | 프로젝트 트레이(`ProjectTray.tsx`)와 외부 쉘 트레이(`ExternalShellTray.tsx`) 분리 |
| `src/components/terminal/AttachedTerminalDrawer.tsx` (522줄) | Phase 1 | XTerm 생명주기·인스턴스 재사용 훅(`useXtermSession.ts`) 및 헤더(`TerminalDrawerHeader.tsx`) 분리 |
| `src-tauri/src/herdr/events.rs` (509줄) | Phase 1 | 프리뷰 수집 워커를 `src-tauri/src/herdr/preview.rs`로 분리 |

---

## 2. Phase별 상세 설계

### Phase 1: 치명적 버그 수정 & 핵심 성능/안정성 개선 (`#6`, `#11`, `#13`, `#14`)

#### 1-1. `#6` PowerShell 추가 시 RPC error `-32602` (`starting with a letter or...`) 해결
- **원인 분석**:
  - `RadarTile.tsx`, `AttachedTerminalDrawer.tsx`, `useGlobalShortcuts.ts`, `commands/worktrees.rs`에서 세션 `name`을 `${project.name}-${branch}-sh` 형태로 생성해 `herdr-core`의 `terminal.run`에 전달합니다.
  - 프로젝트명이나 브랜치명에 한글·공백·특수문자·선두 `-` 또는 숫자가 포함되면 `herdr-core`의 세션 이름 유효성 검증(영문 시작, 허용 문자 제한)에 걸려 `-32602` 에러가 발생합니다.
- **개선 설계**:
  - 백엔드 `src-tauri/src/commands/terminals.rs`에 공용 정규화 함수 `sanitize_herdr_name(raw: &str) -> Option<String>` 추가:
    - ASCII 영문/숫자/`-`/`_` 외 문자를 `-`로 치환 → 연속 `-` 축약 및 양끝 `-`/`_` 제거 → 첫 글자가 ASCII 영문이 아니면 `"s-"` 접두사 부여 → 최대 48자 제한 → 비어 있으면 `None` 반환.
  - `launch_session` 및 `create_worktree_and_launch`에서 모든 `name`을 반드시 `sanitize_herdr_name` 통과 후 전달.
  - `terminal.run` 호출 시 이름 충돌이나 `-32602` 이름 오류가 발생하면 `name` 필드를 제거하여 1회 자동 재시도하는 안전망 추가 (같은 Worktree에서 PowerShell 탭을 여러 개 열 때의 이름 중복 에러까지 함께 차단).
  - Rust 단위 테스트로 한글/숫자 시작/`-` 시작/특수문자/빈 문자열 케이스 검증.

#### 1-2. `#11` AI 카드 → 빈 카드 포커스 이동 시 카드 2개 포커스 색상 버그 해결
- **원인 분석**:
  - `RadarTile.tsx`에서 포커스 테두리/그림자(`--card-selected-shadow`) 조건이 `isSelected || isAttached`로 되어 있습니다.
  - AI 세션이 실행 중이고 우측 터미널이 열려 있는 카드 A에서 세션이 없는 빈 카드 B로 이동하면, `selectedCardKey`는 B로 바뀌지만 `attachedAddress`는 A에 남아 **A(`isAttached`)와 B(`isSelected`) 두 카드가 동시에 포커스 색상**을 띱니다.
- **개선 설계**:
  - 포커스 링(`--card-selected-shadow`)은 오직 현재 포커스된 단일 카드(`isSelected`)에만 적용합니다.
  - `isAttached && !isSelected`인 카드는 포커스 링을 끄고, 우측 상단의 `<Terminal />` 아이콘과 은은한 점 표시로만 "터미널 열림" 상태를 구분합니다.
  - **추가 개선 제안 (확인 요청)**: 우측 터미널이 열린 상태에서 빈 카드로 포커스를 옮길 때, 기존처럼 PowerShell을 자동 강제 실행하지 않고(불필요한 쉘 난립 + 프리징 원인), 우측 터미널 영역을 **"세션 없음 — 빠른 실행(AI / Shell)" 대기 화면**으로 즉시 전환하거나 Detach하도록 바꾸는 것을 권장합니다.

#### 1-3. `#13` Gemini CLI 실행 중 빠른 카드 포커스 이동 시 1초 프리징 해결
- **원인 분석 (4중 병목)**:
  1. `AttachedTerminalDrawer.tsx`가 `attachedAddress` 변경마다 동기적으로 `term.dispose()` → `new XTerm()` → `new WebglAddon()` → `term.open()`을 반복 실행. Windows WebView2에서 WebGL GPU 컨텍스트 생성/파괴가 매번 150~600ms 메인 스레드를 블로킹.
  2. 빠른 이동 시 중간 카드에 대한 `attach_terminal` IPC와 `history: 400` 대량 ANSI 수신이 취소 없이 전부 실행됨.
  3. `RadarTile`이 `useUiStore((s) => s.selectedCardKey)` 문자열 전체를 구독해 포커스 1회 이동 시 **보드 내 모든 카드가 리렌더링**됨.
  4. `herdr/events.rs`의 2.5초 주기 `sync_terminals_now`와 `preview_worker`가 Gemini CLI처럼 출력이 많은 세션에 `terminal.read`를 순차 호출하며 단일 `hc connect` 파이프를 점유.
- **개선 설계**:
  - **Zustand Atomic Boolean Selector**: `RadarTile`에서 `useUiStore((s) => s.selectedCardKey === cardKey)` 및 `useUiStore((s) => Boolean(s.attachedAddress && ...))`로 변경해 포커스 이동 시 이전/새 카드 2개만 리렌더.
  - **포커스-Attach 디커플링 + 120ms 디바운스 + 세대 토큰**: 카드 포커스(`selectedCardKey`)는 0ms 즉시 반영하고, 실제 `attach_terminal` IPC는 120ms 디바운스 및 `attachGen` 토큰으로 중간 카드는 스킵.
  - **단일 XTerm + WebGL 인스턴스 재사용 (`useXtermSession.ts`)**: 드로어가 열려 있는 동안 XTerm/WebGL 인스턴스를 파괴하지 않고 1개 유지하며, 세션 전환 시 `term.reset()` + 채널 교체만 수행해 GPU 컨텍스트 재생성 비용 0ms 달성.
  - **rAF 청크 쓰기**: Base64 디코딩/출력을 `requestAnimationFrame` 큐로 배치 처리해 Gemini CLI 폭주 출력 중에도 키보드 이동 입력이 밀리지 않도록 보호.
  - **백엔드 비동기 Detach + 최신 세대 취소 + 프리뷰 보호**:
    - `AttachManager`에 `AtomicU64` generation을 두어 구세대 attach 결과는 즉시 폐기.
    - 이전 채널 `detach`는 `tokio::spawn`으로 백그라운드 처리.
    - `preview.rs` 분리 후 `terminal.read`에 3초 타임아웃 적용 및 현재 attached 중인 세션은 불필요한 중복 프리뷰 폴링 간격 완화.

#### 1-4. `#14` Worktree 삭제 시 UI 에러 발생 후 실제 삭제되는 현상 해결
- **원인 분석**:
  - `teardown_worktree`가 `terminal.kill` 직후 **0ms 대기 없이** 즉시 `git worktree remove`를 호출합니다.
  - Windows 회사 PC(보안 백신/EDR + Node.js 기반 Gemini CLI 자식 프로세스)에서는 프로세스가 CWD 파일 핸들을 완전히 놓는 데 0.3~2초가 걸려 `git worktree remove`가 일시적 `Permission denied` / `Directory not empty` 에러를 반환하지만, 부분 삭제 또는 뒤늦은 해제로 실제 워크트리는 사라진 상태가 됩니다.
- **개선 설계**:
  - `teardown_worktree`에서 `input.terminal_addresses`뿐 아니라 `hub.terminals` 중 해당 `worktree_path`를 `cwd`로 갖는 모든 세션을 함께 탐지해 `terminal.kill` + `terminal.rm` 수행.
  - 종료 대상 세션이 있었다면 초기 300ms 대기 후 `remove_worktree` 호출.
  - `remove_worktree`에 **지수 백오프 재시도(최대 5회: 300ms → 600ms → 1000ms → 1500ms → 2000ms)** 도입:
    - 매 시도 전/실패 시 폴더 존재 여부 및 `git worktree list` 재확인 → 이미 제거되었으면 `git worktree prune` 후 `Ok(())` 반환.
    - `.git/worktrees` 메타데이터는 지워졌으나 Windows 락으로 빈 잔여 폴더만 남은 경우 `tokio::fs::remove_dir_all` + `git worktree prune` fallback 수행.
  - `TeardownModal.tsx`에서 에러 발생 시에도 `listProjectWorktrees`를 재조회해 목록에서 이미 사라졌다면 에러 대신 성공 토스트 + 모달 닫기로 동기화.

---

### Phase 2: 보드 레이아웃 정리 & 조작성 개선 (`#5`, `#7`, `#8`, `#9`, `#12`)

#### 2-1. `#8` 프로젝트별 수직(위/아래) 행 구분 레이아웃
- `RadarBoardView.tsx`의 바깥 프로젝트 그리드(가로 페어링 로직 `traySpan` / `gridColumn`)를 제거하고, `flex flex-col gap-4` 수직 스택으로 변경하여 **한 라인에 항상 1개 프로젝트만** 표시되도록 구분합니다.
- 각 프로젝트 트레이(`ProjectTray.tsx`) 내부의 카드 그리드는 `repeat(${activeCols}, minmax(0, 1fr))`로 통일해 프로젝트 간 카드 크기와 정렬을 일관되게 맞춥니다.
- 하단 `Shells & External` 트레이(`ExternalShellTray.tsx`)도 독립 행으로 분리합니다.

#### 2-2. `#5` 프로젝트 내 `ROOT` 카드 명확 표시
- `RadarTile.tsx` 및 `SessionCard.tsx`에서 `worktree.is_main === true`인 카드에 깔끔한 **`ROOT` 배지**(홈/저장소 아이콘 + `ROOT`, 테마 토큰 기반 은은한 강조)를 브랜치명 옆에 표시합니다.
- `dashboardLogic.ts`에서 프로젝트에 worktree 목록이 비어 있거나 메인 경로 매칭이 누락되는 엣지 케이스가 없도록 `is_main` 판별을 보강합니다.

#### 2-3. `#7` Worktree 카드 수정된 Diff 숫자(`+N -M`) 제거
- `RadarTile.tsx` 및 `SessionCard.tsx`에서 상시 노출되는 초록/빨강 `+added -deleted` 숫자 블록을 제거해 시각적 피로도를 낮춥니다.
- Hover 시 나타나는 `<FileDiff />` 아이콘 버튼은 유지하여 원할 때 Diff 모달은 그대로 열 수 있게 합니다.

#### 2-4. `#9` `Esc` 키로 선택된 프로젝트 필터 해제
- `useGlobalShortcuts.ts` 리팩토링(`shortcutActions.ts` 분리)과 함께 `Escape` 처리 체인에 `!inXterm && ui.selectedProjectId !== null` 조건을 추가하여, `Esc`를 누르면 프로젝트 필터가 해제되고 모든 프로젝트가 다시 표시되도록 구현합니다.

#### 2-5. `#12` 우측 터미널 Pane 사용자 Width 조절 + 영속화
- `useUiStore.ts`에 `terminalWidthPx: number | null` 추가 (기본값 `null` = 50%, 리사이즈 범위: 최소 `360px` ~ 최대 스테이지 폭의 `78%`).
- `AttachedTerminalDrawer.tsx` 좌측 경계에 드래그 리사이즈 핸들(width `6px`, `cursor-col-resize`, hover 시 accent 라인) 추가:
  - 드래그 중 `requestAnimationFrame`으로 부드럽게 폭 반영 + `user-select: none` 적용.
  - 드래그 종료 시 `fitAddon.fit()` 및 `resizeTerminal` 전송.
  - 핸들 더블클릭 시 기본 폭(50%)으로 즉시 복원.
- `PersistedUiState` (`store/projects.rs`, `types/domain.ts`, `useHerdrSync.ts`)에 `terminal_width_px` 필드를 추가해 재실행 후에도 유지.
- `App.tsx`의 `Suspense fallback`에도 동일 폭을 적용해 로딩 레이아웃 점프 방지.

---

### Phase 3: 세션 추가·프로젝트 생성·카드 편집 UX 강화 (`#1`, `#2`, `#10`)

#### 3-1. `#1` 워크트리 카드 `+` 모달에 터미널 선택 추가 & AI/터미널 구분 + 이름 변경
- `LaunchSessionModal.tsx` 개편:
  - 모달 타이틀: `Launch AI CLI · {branch}` → **`새 세션 추가 · {branch}`** (툴팁: `"세션 추가 (AI / 터미널)"`).
  - 선택 영역을 명확히 2개 그룹으로 분리:
    - **AI CLI**: `Antigravity (agy)`, `agy --continue`, `Claude Code`, `claude --continue`, `Gemini CLI`, `Codex`, `tpl:*`, `Custom…`
    - **터미널 (Terminal)**: `PowerShell (기본 쉘)`, `Command Prompt (cmd)`
  - 터미널 선택 시 AI 전용 옵션(`Autonomous Mode (YOLO)`, `First Prompt`)을 숨겨 UI를 간결하게 유지하고, `PowerShell`은 `argv: []`, `cmd`는 `argv: ["cmd.exe"]`로 실행합니다.

#### 3-2. `#2` 프로젝트 생성/수정 시 Git 브랜치 드랍다운 선택
- `ProjectModal.tsx` 리팩토링(`ProjectAdvancedSection.tsx` 분리)과 함께 Step 1(폴더 선택) 하단에 **Default Git Branch 드랍다운(`<select>`)** 추가.
- `inspectGitRepo`가 이미 반환하는 `branches` 목록(로컬 브랜치)을 드랍다운 옵션으로 렌더링하고, 폴더 선택 시 `current_branch` / `default_branch`를 자동 선택합니다.
- 저장 시 사용자가 선택한 `defaultBranch`를 `upsertProject`로 전달하고, 기존 프로젝트 수정 시에도 브랜치 목록을 불러와 변경 가능하게 합니다.

#### 3-3. `#10` Worktree 카드 편집 기능 (`EditWorktreeModal` 신규)
- `RadarTile.tsx` Hover 액션 영역에 편집(`Pencil`) 아이콘 버튼 추가.
- 신규 모달 `src/components/modals/EditWorktreeModal.tsx` 생성:
  1. **카드 표시 이름 (Display Name / Alias)**: Git 브랜치와 무관하게 원하는 작업명(예: `결제 API 리팩토링`) 설정 가능. 비우면 Git 브랜치명으로 복귀.
  2. **작업 메모 (Note, 선택)**: 카드 툴팁 및 대기 문구에 표시.
  3. **Git 브랜치명 변경 (선택, `!worktree.is_main` 전용)**: 사용자가 원할 때 백엔드 `rename_worktree_branch` 커맨드(`git branch -m <old> <new>`)로 실제 브랜치명도 안전하게 변경 가능.
- **영속화**: `PersistedUiState`에 `worktree_meta: Record<string, { display_name?: string; note?: string }>` 추가 (`normalizePath(worktree.path)` 키 기준, `herdr-core doc` + 로컬 JSON 이중 저장).
- **표시 & 검색 연동**: 표시 이름이 있으면 카드 메인 제목에 표시하고 실제 Git 브랜치명은 작은 보조 뱃지로 병기하며, `dashboardLogic.ts`의 검색 대상에도 `display_name`과 `note`를 포함합니다.

---

### Phase 4: 마우스 드래그 앤 드롭 순서 변경 & 영속화 (`#3`, `#4`)

#### 4-1. Tauri v2 WebView2 호환 공용 드래그 훅 (`src/hooks/usePointerReorder.ts`)
- Windows Tauri v2에서는 `dragDropEnabled` 기본값 때문에 HTML5 native DnD가 충돌하는 경우가 많습니다.
- **Pointer Events 기반** 경량 훅(외부 라이브러리 0개)을 구현해:
  - `pointerdown` 후 `6px` 이상 이동 시에만 드래그 활성화 (기존 클릭/더블클릭 100% 보존).
  - 드래그 중에는 로컬 인디케이터/고스트 스타일만 갱신하고, **Drop 확정 시점에만 1회** 스토어 및 백엔드 영속화를 호출해 성능 저하 없음.

#### 4-2. `#3` 좌측 프로젝트 Pane 마우스 드래그 순서 변경
- `SidebarProjects.tsx`의 프로젝트 목록에 `usePointerReorder` 적용 (hover 시 미세한 드래그 핸들 힌트 + 삽입 위치 강조선).
- 백엔드 `commands/projects.rs`에 `reorder_projects(ordered_ids: Vec<String>)` 커맨드 추가 및 `PersistenceStore::reorder_projects` 구현 (`projects.json` + `herdr-core doc` 저장).
- 사이드바 순서를 바꾸면 우측 `RadarBoardView`의 프로젝트 순서도 즉시 동일하게 반영됩니다.

#### 4-3. `#4` Worktree 카드 마우스 드래그 순서 변경
- `ProjectTray.tsx` 내부의 `RadarTile` 그리드에 2D 좌표 기반 `usePointerReorder` 적용 (같은 프로젝트 내 카드 순서 자유 변경).
- `PersistedUiState`에 `worktree_order_by_project: Record<string, string[]>` 추가 (`normalizePath(wt.path)` 배열).
- `dashboardLogic.ts`에서 프로젝트별 저장된 순서에 따라 `cells`를 정렬하고, 새로 추가된 Worktree는 목록 끝에 자연스럽게 배치합니다.

---

## 3. 추가로 제안드리는 아이디어 (선택 적용)

1. **빈 카드 포커스 시 우측 터미널 대기 패널 (Phase 1 연계 추천)**:
   - 우측 터미널이 열린 상태에서 빈 카드로 이동할 때 PowerShell을 강제 자동 실행하는 대신, 우측 패널에 `"이 Worktree에 실행 중인 세션이 없습니다 · [AI 시작] [PowerShell 시작]"` 경량 패널을 띄우면 포커스 전환 속도가 0ms가 되고 원치 않는 쉘 누적도 사라집니다.
2. **Worktree 편집 모달에 빠른 색상 라벨/핀(Pin) 추가 (Phase 3 선택)**:
   - 이름/메모 외에 중요 Worktree를 표시할 수 있는 간단한 강조 태그를 선택할 수 있으면 다수 작업 시 가독성이 더 좋아집니다.
3. **터미널 리사이즈 핸들 더블클릭 기본값 복원 (Phase 2 기본 포함)**:
   - 핸들을 더블클릭하면 즉시 기본 50% 너비로 리셋.

---

## 4. 검증 계획 (각 Phase 완료 시)

- **단위 테스트**:
  - Rust: `cargo test` (`sanitize_herdr_name`, `parse_worktree_porcelain`, `remove_worktree` 재시도/경계 케이스, `reorder_projects`)
  - Frontend: `npm run test` (`dashboardLogic.test.ts` 정렬/메타/검색, `worktreeSessions.test.ts`, 포인터 순서 변경 유틸 테스트)
- **타입 및 빌드 검증**:
  - `npm run build` (`tsc && vite build`)
  - `cargo check` (src-tauri)
- **문서 동기화**:
  - 각 Phase 완료 시 변경/추가된 파일과 인터페이스를 `APP_MAP.md`에 최신화하고, 테스트 결과를 `docs/test_results_2026-11-24_v2.txt`에 기록합니다.
