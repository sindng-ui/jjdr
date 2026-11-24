# APP_MAP.md — jjdr Architecture & Interface Map

> **jjdr** (`jj + herdr`): Tauri v2 (Rust) + React + Vite + 외부 `herdr-core` / `hc` 기반 초경량 멀티 프로젝트·Worktree AI CLI 관제탑

---

## 1. 아키텍처 핵심 원칙 & 스크립트
- **실행/빌드 스크립트 (`package.json`)**: `npm run tauri:dev` (개발 실행), `npm run tauri:build` (프로덕션 릴리스 + MSI/NSIS 인스톨러 번들 빌드), `npm run test` (Vitest), `npm run build` (TypeScript + Vite 빌드).
- **자동 릴리즈 CI/CD (`.github/workflows/release.yml`)**: `master`/`main` 푸시 시 `package.json` 버전 변경을 감지(또는 수동 `workflow_dispatch`)해 `tauri.conf.json` 버전 동기화 → 테스트/빌드 → Windows 인스톨러(`.exe`/`.msi`)를 GitHub Release(`v<version>`)로 자동 배포.
- **외부 `herdr-core` / `hc` 연동**: `hc connect` 프로세스의 `stdin/stdout` 위에서 공식 바이너리 Framed 프로토콜(`[channel u32 LE][kind u8][len u32 LE][payload]`)로 통신.
- **세션 영속성**: 모든 AI CLI는 `outlive_parent: true`, `no_parent: true`, `keep: true`로 기동하며, 앱 종료 시 `hc connect`만 Detach하여 백그라운드 세션을 유지. 재실행 시 `events.subscribe` 스냅샷 + `labels` + `cwd` 경로 매칭 + `doc.get("jjdr.*")`로 자동 복원.
- **방식 C+ (재사용 하이브리드 터미널)**: 평소 관제는 DOM에 `xterm.js` 0개 + 경량 상태 카드/프리뷰로 유지하고, 드로어가 열리면 `React.lazy` 단일 `xterm.js` + WebGL 인스턴스를 유지하며 세션 전환 시 `term.reset()` + 110ms 디바운스 + 세대 토큰으로 GPU 재생성 지연(0ms 전환)과 Gemini CLI 고속 출력 프리징을 원천 차단.
- **논블로킹 워커 구조**: Rust Tokio 워커(프로토콜 I/O, Git 병렬 워커, 16~30ms 이벤트 배치) + Frontend Web Worker(`dashboardWorker.ts`: 정렬/그룹핑/검색/Stuck 감지/커스텀 순서) + Zustand Atomic Boolean Selector + `React.memo` + Pointer Events 기반 WebView2 호환 드래그 순서 변경 + **4-Theme Floating Canvas & Squircle Zero-Blur 디자인 시스템**.

---

## 2. Backend (`src-tauri/src/`)

| 파일 | 역할 | 주요 인터페이스 / Export |
| :--- | :--- | :--- |
| `src-tauri/src/main.rs` | 데스크톱 엔트리 포인트 | `jjdr_lib::run()` |
| `src-tauri/src/lib.rs` | Tauri v2 앱 초기화, 시스템 트레이(`jjdr-tray`), 커맨드 등록, Exit 시 무손실 Disconnect | `AppState`, `run()` |
| `src-tauri/src/herdr/types.rs` | `herdr-core` OpenRPC 1.3.2 도메인 타입 | `Terminal`, `Status`, `HelloResult`, `SubscribeResult`, `AttachResult`, `StateBatchPayload`, `HerdrHealth` |
| `src-tauri/src/herdr/naming.rs` | `herdr-core` 세션 이름 정규화(영문 시작/허용 문자 보정) 및 `-32602`/중복 이름 오류 판별 | `sanitize_herdr_name`, `is_recoverable_name_error` |
| `src-tauri/src/herdr/protocol.rs` | 바이너리 Framed 코덱, ANSI 제거, AI TUI 크롬 필터링 스마트 프리뷰 추출 | `Frame`, `FrameKind`, `read_frame`, `write_frame`, `strip_ansi`, `extract_smart_preview_lines` |
| `src-tauri/src/herdr/client.rs` | `hc connect` 브리지, JSON-RPC 호출, 다중 채널 라우터, `early_frames` 버퍼 | `HerdrClient::{ensure_daemon, connect, call, send_frame, register_channel, disconnect}` |
| `src-tauri/src/herdr/preview.rs` | 3초 타임아웃 + 1.5초 쿨다운 보호 라이브 프리뷰 수집 워커 | `spawn_preview_worker`, `extract_preview_lines` |
| `src-tauri/src/herdr/events.rs` | `events.subscribe` 구독, `sync_terminals_now`, 30ms 배치 emitter, 재연결 supervisor | `TerminalStateHub::{new, start_preview_worker, sync_terminals_now}`, `spawn_herdr_supervisor`, Tauri events: `jjdr:state-batch`, `jjdr:doc-changed` |
| `src-tauri/src/git/inspect.rs` | Git 저장소 검사·로컬 브랜치 목록·변경 파일/Diff 조회 유틸 | `WorktreeInfo`, `DiffDetail`, `RepoInspectInfo`, `build_git_command`, `run_git`, `normalize_path`, `validate_git_repo`, `detect_current_branch`, `detect_default_branch`, `list_local_branches`, `inspect_git_repo`, `inspect_worktree_changes`, `get_worktree_diff` |
| `src-tauri/src/git/worktree.rs` | 병렬 Git worktree 조회, Merge Overlap Radar, 생성, Windows 락 지수 백오프 재시도 삭제, 로컬 브랜치 개명 | `parse_worktree_porcelain`, `list_worktrees_with_status`, `compute_merge_overlaps`, `create_worktree`, `remove_worktree`, `rename_worktree_branch` |
| `src-tauri/src/git/bootstrap.rs` | Worktree 생성 후 `.env` 등 파일 복사 및 초기 명령 실행 | `BootstrapConfig`, `BootstrapResult`, `run_bootstrap` |
| `src-tauri/src/store/file_index.rs` | 포커스된 프로젝트만 백그라운드 캐시하는 LRU(최대 6개) Shared Base + Worktree Delta 파일 인덱스 저장소 (Regex/Glob/Fuzzy 모드 위임) | `FileIndexStore::{new, warm_background, search}`, `WorktreeDelta`, `compute_worktree_delta` |
| `src-tauri/src/store/file_matcher.rs` | `git ls-files` 고속 스캔 및 네이티브 Rust Fuzzy + Glob(`*.cpp`, `src/**/*.ts`) + Regex(`/pat/`, `use_regex`) 파일 검색·점수화 엔진 | `scan_directory_files`, `score_and_collect`, `fuzzy_score_path`, `MatchCollection`, `FileSearchResult`, `FileMatchItem` |
| `src-tauri/src/store/projects.rs` | `herdr-core` `doc.get/set` (`jjdr.projects.v1`, `jjdr.ui_state.v1`, `jjdr.settings.v1`) + 로컬 `%APPDATA%/jjdr` 이중 저장, 프로젝트 순서·`root_card_mode`·터미널 너비·Worktree 메타/순서 영속화 | `ProjectConfig`, `WorktreeCardMeta`, `PersistedUiState`, `AppSettings`, `PersistenceStore::{load_bundle, upsert_project, delete_project, reorder_projects, save_ui_state, save_settings}`, `apply_project_order` |
| `src-tauri/src/commands/files.rs` | 프로젝트 파일 백그라운드 캐시 워밍·Fuzzy/Glob/Regex 검색·바이너리 감지 텍스트 읽기·기본 앱/VS Code 실행 커맨드 | `warm_project_file_index`, `search_project_files`, `read_text_file`, `open_with_default_app`, `open_in_vscode`, `TextFileContent` |
| `src-tauri/src/commands/system.rs` | 시스템/상태/템플릿/트레이, 프레임리스 윈도우 제어 및 탐색기 폴더 열기 커맨드 | `get_initial_state`, `get_herdr_health`, `reconnect_herdr`, `list_templates`, `load_persisted_bundle`, `save_ui_state`, `save_settings`, `update_tray_summary`, `request_preview_refresh`, `window_minimize`, `window_toggle_maximize`, `window_close`, `window_start_dragging`, `open_in_explorer` |
| `src-tauri/src/commands/projects.rs` | 레포 자동 분석 및 프로젝트 CRUD·순서 변경 커맨드 | `inspect_git_repo`, `list_projects`, `upsert_project`, `delete_project`, `reorder_projects` |
| `src-tauri/src/commands/worktrees.rs` | Worktree 조회/생성+AI기동/동일 CWD 전 세션 정리+안정 삭제/브랜치 개명/Diff 커맨드 | `list_all_worktrees`, `list_project_worktrees`, `create_worktree_and_launch`, `teardown_worktree`, `rename_worktree_branch`, `fetch_worktree_diff` |
| `src-tauri/src/commands/attach.rs` | 방식 C+ `AttachManager`(세대 취소·비동기 Detach·16ms 배치·CREDIT 반환) 및 스트림 제어 커맨드 | `AttachManager`, `attach_terminal`, `detach_terminal`, `write_terminal_input`, `resize_terminal`, `focus_terminal` |
| `src-tauri/src/commands/terminals.rs` | 세션 실행/제어 + 안전 이름 정규화/재시도(`call_terminal_run_safe`) + 자율성(YOLO) 플래그 정규화(`normalize_agent_argv`) + 외부 터미널 팝아웃 | `normalize_agent_argv`, `call_terminal_run_safe`, `launch_session`, `send_terminal_text`, `send_terminal_keys`, `interrupt_terminal`, `kill_terminal`, `popout_external_terminal` |

---

## 3. Frontend (`src/`)

| 파일 | 역할 | 주요 인터페이스 / Export |
| :--- | :--- | :--- |
| `src/types/domain.ts` | 프론트엔드 전체 도메인, `RootCardMode`, Worktree 카드 메타, UI 영속화 및 Worker 결과 타입 (`worktreeSessionCount` 포함) | `TerminalInfo`, `ProjectConfig`, `WorktreeInfo`, `WorktreeCardMeta`, `RootCardMode`, `PersistedUiState`, `EnrichedSession`, `DashboardWorkerResult` |
| `src/services/tauriBridge.ts` | Tauri `invoke` / `listen` 타입 안전 래퍼 | 모든 백엔드 커맨드(`searchProjectFiles(useRegex)`, `readTextFile(is_binary)`, `reorderProjects`, `renameWorktreeBranch` 포함) 및 `listenStateBatch`, `listenTermData`, `listenTermClosed` |
| `src/workers/dashboardLogic.ts` | 순수 함수: live 세션 전용 필터링, OS 시스템 경로 고아 차단, 일반 Shell `Ready` 오분류 방지(`isPlainShellTerminal`), Queue Worktree 카드 단위 중복 제거(`byBucket`/`sessions`/`counts`), `permission` 전용 승인 판별, Stuck 판별, 라벨+CWD 재매핑, 커스텀 순서 정렬 | `classifyBucket`, `computeDashboard`, `normalizePath`, `isSystemPath`, `isPlainShellTerminal`, `isPermissionApprovalPending` |
| `src/workers/dashboardWorker.ts` | 전용 Web Worker 엔트리 | `onmessage` → `computeDashboard` → `postMessage` |
| `src/store/useAppStore.ts` | 도메인 상태 Atomic Zustand 스토어 (Worktree 카드 메타, 프로젝트별 카드 순서, `root_card_mode` 포함) | `terminals`, `previews`, `projects`, `worktreesByProject`, `worktreeMeta`, `worktreeOrderByProject`, `computed`, `setWorktreeMeta`, `setProjectWorktreeOrder` |
| `src/store/useUiStore.ts` | UI/모달/선택/드로어 열림(`terminalDrawerOpen`)/터미널 폭/자동 포커스 트리거(`terminalFocusNonce`)/내장 MD·코드 뷰어 대상(`markdownViewerTarget`, `codeViewerTarget`)/키보드 카드 그랩 상태(`cardGrabState`) 스토어 | `viewMode`, `selectedCardKey`, `attachedAddress`, `terminalDrawerOpen`, `terminalWidthPx`, `terminalFocusNonce`, `requestTerminalFocus`, `codeViewerTarget`, `cardGrabState`, `detachToEmptyDrawer`, `closeTerminalDrawer` |
| `src/hooks/useHerdrSync.ts` | Worker 라이프사이클, 초기 Hydration(터미널 폭·카드 메타·순서 포함), 재실행 Attach 복원, Calm 알림, 트레이 동기화, UI 상태 자동 저장 | `useHerdrSync` |
| `src/utils/shortcutActions.ts` | DOM 카드 조회, 2D 공간 이동 + 자동 터미널 포커스, 카드 단위 안정 `Ctrl+N` 점프(`buildActionableCardList`), 키보드 그랩-교환(`stepKeyboardCardGrab`/`commitKeyboardCardGrab`), 세션 탭 순환, Shell/AI 단축 실행 | `readBoardCards`, `openOrLaunchCard`, `toggleSelectedTerminal`, `moveRadarSpatial`, `buildActionableCardList`, `jumpToNextActionable`, `moveQueueSelection`, `stepKeyboardCardGrab`, `commitKeyboardCardGrab`, `cancelKeyboardCardGrab`, `cycleCurrentWorktreeTab`, `spawnShellTabInAttachedWorktree`, `openAiLauncherForAttachedWorktree` |
| `src/hooks/useGlobalShortcuts.ts` | 키보드 퍼스트 전역 단축키 바인딩(`Ctrl+N/F/K/P/M/1/2/B`, `Ctrl+↑↓←→` 이동+포커스, `Ctrl+Shift+Alt+↑↓←→` 카드 1:1 교환, `Ctrl+\``, `Ctrl+Tab`, `Ctrl+Shift+T/A`, `Alt+Enter`, `Enter`, `Esc` 순차 해제) | `useGlobalShortcuts`, `jumpToNextActionable` |
| `src/hooks/useXtermSession.ts` | 단일 `xterm.js` + WebGL 인스턴스 재사용, attach 전후 강제 `fitNow` + `focusNow` 자동 포커스, 드래그→우클릭 클립보드 복사 & 스마트 `Ctrl+C`/`Ctrl+Shift+C/V`, DEC-2026 무깜빡임 스트림 교체 | `useXtermSession` |
| `src/hooks/usePointerReorder.ts` | Tauri v2 Windows WebView2 호환 Pointer Events 기반 드래그 순서 변경 공용 훅 (`insert` 및 1:1 `swap` 모드 지원, 6px 임계값) | `usePointerReorder`, `reorderIds`, `swapIds` |
| `src/hooks/useResizableModalWidth.ts` | 내장 Markdown/Code 뷰어 공용 좌·우 드래그 폭 리사이즈 + `localStorage`(`jjdr.viewer_width_px`) 영속화 + 더블클릭 기본 폭 복원 훅 | `useResizableModalWidth` |
| `src/hooks/useFileIndexWarmup.ts` | 포커스된 카드의 프로젝트만 450ms 디바운스 후 백그라운드 파일 인덱스 워밍 트리거 (미포커스 프로젝트 스캔 0) | `useFileIndexWarmup` |
| `src/utils/markdownRenderer.ts` | 초경량 Zero-dependency GitHub Flavored Markdown(GFM) 파서 (헤딩/테이블/코드복사/Alerts/체크리스트/XSS 방어) | `renderMarkdownToHtml`, `isMarkdownFile`, `escapeHtml` |
| `src/utils/codeHighlighter.ts` | 0-dependency 초경량 단일 패스 행 단위 코드 구문 강조기 (C/C++, Rust, TS/JS, Python, Go, Java/C#, JSON, TOML, YAML, CSS/HTML, Shell, SQL, Diff 지원, XSS 방어) | `detectCodeLanguage`, `getLanguageLabel`, `highlightCodeLine`, `CodeLanguage` |
| `src/styles/githubMarkdown.css` | 4종 테마 CSS 토큰 연동 GitHub 스타일 Markdown 뷰어 전용 스타일시트 | `.jjdr-md-body` |
| `src/styles/codeViewer.css` | 4종 테마(다크/라이트) 연동 내장 코드뷰어 구문 강조·검색 매치 스타일시트 | `.jjdr-code-viewer`, `.jjdr-code-row` |
| `src/utils/format.ts` | 경과 시간/경로 포맷터, 프로젝트 컬러 팔레트 | `formatElapsed`, `shortPath`, `PROJECT_COLORS` |
| `src/utils/themes.ts` | 4종 내장 테마(`aurora`/`lounge`/`nordic`/`botanical`) 및 레이더 한 줄 카드 밀도 프리셋, xterm 팔레트 동기화 | `THEME_PRESETS`, `RADAR_DENSITY_PRESETS`, `getThemePreset`, `getRadarDensityPreset`, `applyThemeToDom`, `readStoredTheme` |
| `src/utils/spatialNav.ts` | Board 뷰 2D 화면 좌표 기반 상/하/좌/우 카드 탐색 로직 | `findNextCardInDirection`, `CardRect`, `NavDirection` |
| `src/utils/worktreeSessions.ts` | 같은 Worktree 내 다중 live 세션 안정 정렬(`created_ms`), Worktree당 PowerShell 최대 2개 카운트(`countWorktreeLiveShells`), 탭 순환, AI/마지막 탭 우선 선택 헬퍼 | `MAX_SHELLS_PER_WORKTREE`, `isPlainShellSession`, `countWorktreeLiveShells`, `cardKeyForSession`, `getWorktreeLiveSessions`, `pickPreferredWorktreeSession`, `getCycledSession` |
| `src/utils/agents.ts` | AI CLI 객관식 프리셋, 자율성(YOLO) 플래그 프리뷰, 재개 옵션, 기본 그룹, 브랜치 prefix | `AGENT_OPTIONS`, `RESUME_AGENT_OPTIONS`, `formatEffectiveCommand`, `DEFAULT_PROJECT_GROUPS`, `BRANCH_PREFIXES` |
| `src/components/shared/StatusBadge.tsx` | 상태 알약 뱃지 (`React.memo`) | `StatusBadge` |
| `src/components/shared/HerdrHealthBanner.tsx` | `herdr-core` 연결 장애 안내 & 재연결 배너 | `HerdrHealthBanner` |
| `src/components/layout/TopStatusBar.tsx` | 프레임리스 통합 타이틀바 + 글로벌 카운터 캡슐, Next Action, 그룹 필터, `Ctrl+F` 검색창, 뷰 토글, Palette/Settings | `TopStatusBar` |
| `src/components/layout/SidebarProjects.tsx` | 프로젝트 CRUD 사이드바 + 마우스 드래그 프로젝트 순서 변경(`usePointerReorder` + `reorderProjects` 영속화) | `SidebarProjects` |
| `src/components/board/RadarBoardView.tsx` | 풀스크린 레이더 뷰 (`Ctrl+1`): 프로젝트별 100% 풀폭 수직 스택(`flex-col`) 배치 + 보드 카드 1:1 일치 상단 '지금 확인' 리본 + 필터 배너(`Esc` 해제 안내) | `RadarBoardView` |
| `src/components/board/ProjectTray.tsx` | 단일 프로젝트 독립 행 트레이 + `ROOT` 헤더 컴팩트 칩(`root_card_mode`) + 내부 Worktree 카드 그리드 마우스 1:1 자리 교환(`usePointerReorder` swap 모드) | `ProjectTray` |
| `src/components/board/ExternalShellTray.tsx` | 외부 `hc` / 독립 PowerShell 세션 트레이 | `ExternalShellTray` |
| `src/components/board/RadarTile.tsx` | 초슬림 2줄 상태 타일: Atomic Boolean Selector 단일 포커스/그랩 링, `permission` 전용 '승인' 버튼, `ROOT` 배지, 커스텀 표시 이름/메모, `⇄ 1:1 교환` 피드백, 호버 액션 및 우클릭 컨텍스트 메뉴 | `RadarTile` |
| `src/components/board/WorktreeContextMenu.tsx` | Worktree 카드 우클릭 및 `Alt+Enter` 키보드 풀 제어 컨텍스트 메뉴 (`↑↓/j/k/Home/End/Enter/Esc` 지원, 터미널/AI 시작, 새 세션 추가, PowerShell 열기, 카드 편집, Diff, 탐색기 폴더 열기, 경로 복사, 삭제/세션 종료) | `WorktreeContextMenu` |
| `src/components/attention/SessionCard.tsx` | Queue 뷰 전용 Worktree 단위 상태 카드 (`ROOT` 배지, 커스텀 이름, 다중 탭 `+N` 배지, `permission` 전용 '승인' 버튼, 다중 세션 안전 Teardown) | `SessionCard` |
| `src/components/attention/AttentionBoard.tsx` | 4-Tier 우선순위 할 일 인박스 (`Ctrl+2`, Worktree 카드 단위 중복 제거·`cardKey` 기반 선택/Attach 연동) | `AttentionBoard` |
| `src/components/terminal/TerminalSessionTabs.tsx` | 현재 Worktree 다중 세션(AI + Shell) 탭 바 + 원클릭 `+ Shell` / `+ AI` / 개별 종료(`×`) UI | `TerminalSessionTabs` |
| `src/components/terminal/TerminalDrawerHeader.tsx` | 우측 터미널 드로어 헤더(상태·프로젝트/브랜치·Diff·Stop·Popout·Close) + 프롬프트 프리셋 바 | `TerminalDrawerHeader` |
| `src/components/terminal/TerminalEmptyState.tsx` | 빈 Worktree 카드 포커스 시 0ms로 표시되는 경량 대기 화면 (원클릭 기본 AI / PowerShell / 세션 선택) | `TerminalEmptyState` |
| `src/components/terminal/AttachedTerminalDrawer.tsx` | `React.lazy` 우측 터미널 드로어: 좌측 드래그 리사이즈 핸들(더블클릭 50% 복원), 단일 XTerm/WebGL 인스턴스 재사용(`useXtermSession`), 빈 상태 패널 통합 | `AttachedTerminalDrawer` |
| `src/components/modals/CommandPalette.tsx` | `Ctrl+K` 통합 커맨드 팔레트 | `CommandPalette` |
| `src/components/modals/QuickFileModal.tsx` | `Ctrl+P` 빠른 파일 검색 모달 (Rust Shared Base+Delta + Fuzzy/Glob(`*.cpp`)/Regex(`.*`, `Alt+R`), `Enter`: 내장 MD/코드 뷰어 / `Shift+Enter`: 기본 앱) | `QuickFileModal` |
| `src/components/modals/MarkdownViewerModal.tsx` | `React.lazy` 넓은 폭·좌우 드래그 리사이즈(`localStorage` 저장) 지원 GitHub 스타일 내장 Markdown 뷰어 모달 | `MarkdownViewerModal` |
| `src/components/modals/CodeViewerModal.tsx` | `React.lazy` `@tanstack/react-virtual` 가상 스크롤·경량 구문 강조·줄번호 참조 복사·파일 내 `Ctrl+F` 검색·Word Wrap·드래그 리사이즈(`localStorage` 저장)·바이너리 감지 내장 코드뷰어 모달 | `CodeViewerModal` |
| `src/components/modals/ProjectDefaultsSection.tsx` | 프로젝트 모달 기본 AI CLI·그룹 선택 섹션 | `ProjectDefaultsSection` |
| `src/components/modals/ProjectAdvancedSection.tsx` | 프로젝트 모달 고급 옵션(부트스트랩 파일 복사·Setup/Verify 커맨드) 섹션 | `ProjectAdvancedSection` |
| `src/components/modals/ProjectModal.tsx` | Git 프로젝트 등록/수정 모달 (폴더 자동 분석 + **Git 브랜치 드랍다운 선택** + 기본 AI + 그룹) | `ProjectModal` |
| `src/components/modals/CreateWorktreeModal.tsx` | 현재 브랜치 자동 베이스 Worktree 생성 + 객관식 AI CLI 기동 모달 | `CreateWorktreeModal` |
| `src/components/modals/EditWorktreeModal.tsx` | Worktree 카드 편집 모달 (표시 이름/별칭, 간단 메모, 일반 Worktree 로컬 Git 브랜치 개명 `git branch -m`) | `EditWorktreeModal` |
| `src/components/modals/LaunchSessionModal.tsx` | **새 세션 추가 모달**: **AI CLI** 그룹과 **터미널(PowerShell / cmd)** 그룹을 명확히 구분하여 실행 | `LaunchSessionModal` |
| `src/components/modals/TeardownModal.tsx` | 안전 가드 포함 Worktree 정리 모달 + 에러 시 실제 목록 재조회 자동 동기화 | `TeardownModal` |
| `src/components/modals/DiffPreviewModal.tsx` | 경량 Git Diff 뷰어 모달 | `DiffPreviewModal` |
| `src/components/modals/SettingsModal.tsx` | 4종 테마, 레이더 한 줄 카드 밀도, `ROOT` 카드 표시 방식(`헤더 칩`/`그리드 카드`/`숨기기`), Stuck 시간, Calm 알림, Merge Overlap, 프롬프트 프리셋 편집 모달 | `SettingsModal` |
| `src/App.tsx` | 외곽 쉘(`h-full overflow-hidden`) + 22px 플로팅 라운드 캔버스 레이아웃, `Suspense` 지연 로드 터미널 드로어·MD 뷰어·코드 뷰어 및 전체 모달 & 토스트 | `App` |
