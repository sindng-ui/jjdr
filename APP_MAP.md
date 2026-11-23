# APP_MAP.md — jjdr Architecture & Interface Map

> **jjdr** (`jj + herdr`): Tauri v2 (Rust) + React + Vite + 외부 `herdr-core` / `hc` 기반 초경량 멀티 프로젝트·Worktree AI CLI 관제탑

---

## 1. 아키텍처 핵심 원칙 & 스크립트
- **실행/빌드 스크립트 (`package.json`)**: `npm run tauri:dev` (개발 실행), `npm run tauri:build` (프로덕션 릴리스 + MSI/NSIS 인스톨러 번들 빌드), `npm run test` (Vitest), `npm run build` (TypeScript + Vite 빌드).
- **자동 릴리즈 CI/CD (`.github/workflows/release.yml`)**: `master`/`main` 푸시 시 `package.json` 버전 변경을 감지(또는 수동 `workflow_dispatch`)해 `tauri.conf.json` 버전 동기화 → 테스트/빌드 → Windows 인스톨러(`.exe`/`.msi`)를 GitHub Release(`v<version>`)로 자동 배포.
- **외부 `herdr-core` / `hc` 연동**: `hc connect` 프로세스의 `stdin/stdout` 위에서 공식 바이너리 Framed 프로토콜(`[channel u32 LE][kind u8][len u32 LE][payload]`)로 통신.
- **세션 영속성**: 모든 AI CLI는 `outlive_parent: true`, `no_parent: true`, `keep: true`로 기동하며, 앱 종료 시 `hc connect`만 Detach하여 백그라운드 세션을 유지. 재실행 시 `events.subscribe` 스냅샷 + `labels` + `cwd` 경로 매칭 + `doc.get("jjdr.*")`로 자동 복원.
- **방식 C (하이브리드 터미널)**: 평소 관제는 DOM에 `xterm.js` 0개 + 경량 상태 카드/프리뷰로 유지하고, 선택한 단일 세션에만 `React.lazy`로 `xterm.js`(WebGL/Fit)를 즉석 Attach, 전환/Esc 시 즉시 `CLOSE` 및 `dispose()`로 메모리 회수.
- **논블로킹 워커 구조**: Rust Tokio 워커(프로토콜 I/O, Git 병렬 워커, 16~30ms 이벤트 배치) + Frontend Web Worker(`dashboardWorker.ts`: 정렬/그룹핑/검색/Stuck 감지) + Zustand Atomic Selector + `React.memo` + **Obsidian "Calm Precision" Zero-Blur 디자인 시스템**(보더리스 섹션, 95% 모노크롬 그라파이트 서피스 `#0b0c0e`/`#13161b` + 좌측 3px 시맨틱 액센트 바 & 마이크로 도트, `tabular-nums` 정렬).

---

## 2. Backend (`src-tauri/src/`)

| 파일 | 역할 | 주요 인터페이스 / Export |
| :--- | :--- | :--- |
| `src-tauri/src/main.rs` | 데스크톱 엔트리 포인트 | `jjdr_lib::run()` |
| `src-tauri/src/lib.rs` | Tauri v2 앱 초기화, 시스템 트레이(`jjdr-tray`), 커맨드 등록, Exit 시 무손실 Disconnect | `AppState`, `run()` |
| `src-tauri/src/herdr/types.rs` | `herdr-core` OpenRPC 1.3.2 도메인 타입 | `Terminal`, `Status`, `HelloResult`, `SubscribeResult`, `AttachResult`, `StateBatchPayload`, `HerdrHealth` |
| `src-tauri/src/herdr/protocol.rs` | 바이너리 Framed 코덱, ANSI 제거, AI TUI 크롬 필터링 스마트 프리뷰 추출 | `Frame`, `FrameKind`, `read_frame`, `write_frame`, `strip_ansi`, `extract_smart_preview_lines` |
| `src-tauri/src/herdr/client.rs` | `hc connect` 브리지, JSON-RPC 호출, 다중 채널 라우터, `early_frames` 버퍼 | `HerdrClient::{ensure_daemon, connect, call, send_frame, register_channel, disconnect}` |
| `src-tauri/src/herdr/events.rs` | `events.subscribe` 구독, `terminal.run` 직후 즉시 동기화(`sync_terminals_now`), 3초 경량 라이브 프리뷰 수집, 30ms 배치 emitter | `TerminalStateHub::{new, start_preview_worker, sync_terminals_now}`, `spawn_herdr_supervisor`, Tauri events: `jjdr:state-batch`, `jjdr:doc-changed` |
| `src-tauri/src/git/worktree.rs` | 병렬 Git worktree/diff/merged 조회, 현재 브랜치(`HEAD`) 베이스 생성, 레포 자동 분석(`inspect_git_repo`), Merge Overlap Radar 계산 | `WorktreeInfo`, `DiffDetail`, `RepoInspectInfo`, `detect_current_branch`, `inspect_git_repo`, `list_worktrees_with_status`, `create_worktree`, `remove_worktree`, `get_worktree_diff`, `compute_merge_overlaps` |
| `src-tauri/src/git/bootstrap.rs` | Worktree 생성 후 `.env` 등 파일 복사 및 초기 명령 실행 | `BootstrapConfig`, `BootstrapResult`, `run_bootstrap` |
| `src-tauri/src/store/projects.rs` | `herdr-core` `doc.get/set` (`jjdr.projects.v1`, `jjdr.ui_state.v1`, `jjdr.settings.v1`) + 로컬 `%APPDATA%/jjdr` 이중 저장 | `ProjectConfig`, `PersistedUiState`, `AppSettings`, `PersistenceStore` |
| `src-tauri/src/commands/system.rs` | 시스템/상태/템플릿/트레이 및 프레임리스 윈도우 제어 Tauri 커맨드 | `get_initial_state`, `get_herdr_health`, `reconnect_herdr`, `list_templates`, `load_persisted_bundle`, `save_ui_state`, `save_settings`, `update_tray_summary`, `request_preview_refresh`, `window_minimize`, `window_toggle_maximize`, `window_close`, `window_start_dragging` |
| `src-tauri/src/commands/projects.rs` | 레포 자동 분석 및 프로젝트 CRUD 커맨드 | `inspect_git_repo`, `list_projects`, `upsert_project`, `delete_project` |
| `src-tauri/src/commands/worktrees.rs` | Worktree 조회/생성+AI기동/안전정리/Diff 커맨드 | `list_all_worktrees`, `list_project_worktrees`, `create_worktree_and_launch`, `teardown_worktree`, `fetch_worktree_diff` |
| `src-tauri/src/commands/terminals.rs` | 세션 제어 + 기본 자율성(YOLO) 플래그 정규화(`normalize_agent_argv`) + 방식 C `AttachManager`(16ms 배치, CREDIT 반환) + 외부 터미널 팝아웃 | `AttachManager`, `normalize_agent_argv`, `launch_session`, `send_terminal_text`, `send_terminal_keys`, `interrupt_terminal`, `kill_terminal`, `attach_terminal`, `detach_terminal`, `write_terminal_input`, `resize_terminal`, `focus_terminal`, `popout_external_terminal` |

---

## 3. Frontend (`src/`)

| 파일 | 역할 | 주요 인터페이스 / Export |
| :--- | :--- | :--- |
| `src/types/domain.ts` | 프론트엔드 전체 도메인 및 Worker 결과 타입 | `TerminalInfo`, `ProjectConfig`, `WorktreeInfo`, `EnrichedSession`, `DashboardWorkerResult` |
| `src/services/tauriBridge.ts` | Tauri `invoke` / `listen` 타입 안전 래퍼 | 모든 백엔드 커맨드 호출 함수 및 `listenStateBatch`, `listenTermData`, `listenTermClosed` |
| `src/workers/dashboardLogic.ts` | 순수 함수: 버킷 분류(`needs_you`/`ready`/`running`/`idle`), Stuck 판별, 라벨+CWD 자동 재매핑, Fuzzy 검색, 매트릭스 생성 | `classifyBucket`, `computeDashboard`, `normalizePath` |
| `src/workers/dashboardWorker.ts` | 전용 Web Worker 엔트리 | `onmessage` → `computeDashboard` → `postMessage` |
| `src/store/useAppStore.ts` | 도메인 상태 Atomic Zustand 스토어 | `terminals`, `previews`, `projects`, `worktreesByProject`, `computed`, `ackTurns`, `queuedPrompts`, `lastAgentByWorktree`, `setHealth` |
| `src/store/useUiStore.ts` | UI/모달/선택/Attach/사이드바·프로젝트 접기 상태 스토어 | `viewMode` (`radar`/`queue`), `selectedProjectId`, `selectedCardKey`, `selectedAddress`, `attachedAddress`, `sidebarOpen`, `collapsedProjects`, `toggleProjectCollapsed` |
| `src/hooks/useHerdrSync.ts` | Worker 라이프사이클, 초기 Hydration, 재실행 Attach 복원, Calm 알림, 트레이 동기화, UI 상태 자동 저장 | `useHerdrSync` |
| `src/hooks/useGlobalShortcuts.ts` | 키보드 퍼스트 제어(`↑↓←→` 2D 이동, 우측 터미널 오픈/포커스 및 한/영 무관하게 동작하는 `Ctrl+↑↓←→`, `Ctrl+\``, `Ctrl+K`, `Ctrl+M`, `Ctrl+N`, `Ctrl+1/2`, `Ctrl+B`, `Enter` 터미널 열기/AI 자동 시작, `Esc`) | `useGlobalShortcuts`, `jumpToNextActionable` |
| `src/utils/format.ts` | 경과 시간/경로 포맷터, 프로젝트 컬러 팔레트 | `formatElapsed`, `shortPath`, `PROJECT_COLORS` |
| `src/utils/spatialNav.ts` | Board 뷰 2D 화면 좌표 기반 상/하/좌/우 카드 탐색 로직 | `findNextCardInDirection`, `CardRect`, `NavDirection` |
| `src/utils/agents.ts` | AI CLI 객관식 프리셋(`Antigravity (agy)`, `Claude`, `Gemini`, `Codex`), 자율성(YOLO) 플래그 프리뷰(`formatEffectiveCommand`), 재개 옵션, 기본 그룹, 브랜치 prefix | `AGENT_OPTIONS`, `RESUME_AGENT_OPTIONS`, `formatEffectiveCommand`, `DEFAULT_PROJECT_GROUPS`, `BRANCH_PREFIXES` |
| `src/components/shared/StatusBadge.tsx` | 상태 알약 뱃지 (`React.memo`) | `StatusBadge` |
| `src/components/shared/HerdrHealthBanner.tsx` | `herdr-core` 연결 장애 안내 & 재연결 배너 | `HerdrHealthBanner` |
| `src/components/layout/TopStatusBar.tsx` | 프레임리스 통합 타이틀바(창 드래그·더블클릭 최대화·우측 최소화/최대화/닫기 버튼) + 글로벌 카운터 캡슐, Next Action, 그룹 필터, 검색, 뷰 토글, Palette/Settings | `TopStatusBar` |
| `src/components/layout/SidebarProjects.tsx` | 프로젝트 CRUD 사이드바, 프로젝트별 Worktree 생성 단축 버튼 | `SidebarProjects` |
| `src/components/board/RadarBoardView.tsx` | 풀스크린 초슬림 레이더 뷰 (`Ctrl+1`): 프로젝트별 접기/펼치기, `[+ WT]`, 2~4열 상태 타일 그리드 + 2D 키보드 지원 외부 `hc`/쉘 터미널(`[+ Shell]`) | `RadarBoardView` |
| `src/components/board/RadarTile.tsx` | 초슬림 2줄 상태 타일(상태색·브랜치·diff·경과·핵심 1줄 요약 + 원클릭 승인 + 호버 퀵 액션) | `RadarTile` |
| `src/components/attention/SessionCard.tsx` | Queue 뷰 전용 초슬림 상태 카드(프롬프트 입력창 제거, 핵심 1줄 요약 + 원클릭 승인/중단/터미널/정리) | `SessionCard` |
| `src/components/attention/AttentionBoard.tsx` | 4-Tier 우선순위 할 일 인박스 (`Ctrl+2`) | `AttentionBoard` |
| `src/components/terminal/AttachedTerminalDrawer.tsx` | `React.lazy` 단일 `xterm.js` (WebGL/Fit) 즉석 Attach/Detach 드로어 + 상단 유저 프리셋 바 + `Ctrl+\`` / `Ctrl+↑↓←→` 전역 키 패스스루 | `AttachedTerminalDrawer` |
| `src/components/modals/CommandPalette.tsx` | `Ctrl+K` 통합 커맨드 팔레트 | `CommandPalette` |
| `src/components/modals/ProjectModal.tsx` | 최소입력·객관식 프로젝트 등록/수정 모달 (폴더 선택 시 이름·브랜치·`.env`·검증명령 자동 감지) | `ProjectModal` |
| `src/components/modals/CreateWorktreeModal.tsx` | 현재 브랜치 자동 베이스 Worktree 생성 + 객관식 AI CLI(`agy`/`claude`/`gemini`/`codex`) 기동 모달 | `CreateWorktreeModal` |
| `src/components/modals/LaunchSessionModal.tsx` | 기존 Worktree에 객관식 AI CLI(`agy`/`agy --continue` 등) 실행 / 빠른 재개 모달 | `LaunchSessionModal` |
| `src/components/modals/TeardownModal.tsx` | 안전 가드 포함 Worktree + 세션 일괄 정리 모달 | `TeardownModal` |
| `src/components/modals/DiffPreviewModal.tsx` | 경량 Git Diff 뷰어 모달 | `DiffPreviewModal` |
| `src/components/modals/SettingsModal.tsx` | Stuck 시간, Calm 알림, Merge Overlap 옵션, 프롬프트 프리셋 편집 모달 | `SettingsModal` |
| `src/App.tsx` | 루트 레이아웃, `Suspense` 지연 로드 터미널 드로어, 토스트 | `App` |
