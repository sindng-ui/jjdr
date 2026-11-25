import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppSettings,
  AttachResult,
  BgOverlayPayload,
  BootstrapConfig,
  DiffDetail,
  HerdrHealth,
  OverlayOpenCardEvent,
  PersistedBundle,
  PersistedUiState,
  ProjectConfig,
  RepoInspectInfo,
  StateBatchPayload,
  TemplateInfo,
  TermClosedEvent,
  TermDataEvent,
  WorktreeInfo,
} from "../types/domain";

export const isTauriRuntime = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function getInitialState(): Promise<StateBatchPayload> {
  return invoke<StateBatchPayload>("get_initial_state");
}

export async function getHerdrHealth(): Promise<HerdrHealth> {
  return invoke<HerdrHealth>("get_herdr_health");
}

export async function reconnectHerdr(): Promise<HerdrHealth> {
  return invoke<HerdrHealth>("reconnect_herdr");
}

export async function listTemplates(): Promise<TemplateInfo[]> {
  return invoke<TemplateInfo[]>("list_templates");
}

export async function loadPersistedBundle(): Promise<PersistedBundle> {
  return invoke<PersistedBundle>("load_persisted_bundle");
}

export async function saveUiState(uiState: PersistedUiState): Promise<void> {
  return invoke<void>("save_ui_state", { uiState });
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  return invoke<void>("save_settings", { settings });
}

export async function updateTraySummary(
  needsYou: number,
  ready: number,
  running: number
): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke<void>("update_tray_summary", { needsYou, ready, running });
}

export async function requestPreviewRefresh(address: string): Promise<void> {
  return invoke<void>("request_preview_refresh", { address });
}

export async function windowMinimize(): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke<void>("window_minimize");
}

export async function windowToggleMaximize(): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke<void>("window_toggle_maximize");
}

export async function windowClose(): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke<void>("window_close");
}

export async function windowStartDragging(): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke<void>("window_start_dragging");
}

export async function openInExplorer(path: string): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke<void>("open_in_explorer", { path });
}

export interface TextFileContent {
  path: string;
  content: string;
  size_bytes: number;
  truncated: boolean;
  is_binary?: boolean;
}

export interface FileMatchItem {
  path: string;
  score: number;
}

export interface FileSearchResult {
  root_path: string;
  total_indexed: number;
  matches: FileMatchItem[];
  from_cache: boolean;
  match_mode?: "fuzzy" | "glob" | "regex" | string;
  regex_error?: string | null;
}

export async function warmProjectFileIndex(
  projectId: string,
  worktreePath?: string | null
): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke<void>("warm_project_file_index", {
    projectId,
    worktreePath: worktreePath ?? null,
  });
}

export async function searchProjectFiles(
  projectId: string,
  worktreePath: string | null,
  query: string,
  limit = 80,
  useRegex = false
): Promise<FileSearchResult> {
  return invoke<FileSearchResult>("search_project_files", {
    projectId,
    worktreePath,
    query,
    limit,
    useRegex,
  });
}

export async function readTextFile(path: string): Promise<TextFileContent> {
  return invoke<TextFileContent>("read_text_file", { path });
}

export async function openWithDefaultApp(path: string): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke<void>("open_with_default_app", { path });
}

export async function openInVsCode(path: string): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke<void>("open_in_vscode", { path });
}

export interface UpsertProjectPayload {
  id?: string;
  name: string;
  repo_path: string;
  color: string;
  default_branch?: string;
  default_agent?: string;
  verify_command?: string;
  bootstrap?: BootstrapConfig;
  group?: string;
}

export async function inspectGitRepo(
  repoPath: string
): Promise<RepoInspectInfo> {
  return invoke<RepoInspectInfo>("inspect_git_repo", { repoPath });
}

export async function upsertProject(
  input: UpsertProjectPayload
): Promise<ProjectConfig[]> {
  return invoke<ProjectConfig[]>("upsert_project", { input });
}

export async function deleteProject(
  projectId: string
): Promise<ProjectConfig[]> {
  return invoke<ProjectConfig[]>("delete_project", { projectId });
}

export async function reorderProjects(
  orderedIds: string[]
): Promise<ProjectConfig[]> {
  return invoke<ProjectConfig[]>("reorder_projects", { orderedIds });
}

export async function listAllWorktrees(): Promise<
  Record<string, WorktreeInfo[]>
> {
  return invoke<Record<string, WorktreeInfo[]>>("list_all_worktrees");
}

export async function listProjectWorktrees(
  projectId: string
): Promise<WorktreeInfo[]> {
  return invoke<WorktreeInfo[]>("list_project_worktrees", { projectId });
}

export interface CreateWorktreePayload {
  project_id: string;
  branch_name: string;
  base_branch?: string;
  custom_dir?: string;
  launch_argv?: string[];
  initial_prompt?: string;
  session_name?: string;
  autonomous?: boolean;
}

export interface CreateWorktreeOutput {
  worktree_path: string;
  branch_name: string;
  bootstrap: {
    copied: string[];
    command_output?: string | null;
    warnings: string[];
  };
  terminal_address?: string | null;
}

export async function createWorktreeAndLaunch(
  input: CreateWorktreePayload
): Promise<CreateWorktreeOutput> {
  return invoke<CreateWorktreeOutput>("create_worktree_and_launch", { input });
}

export interface RemoveWorktreePayload {
  project_id: string;
  worktree_path: string;
  branch_name?: string;
  force: boolean;
  delete_branch: boolean;
  terminal_addresses: string[];
}

export async function teardownWorktree(
  input: RemoveWorktreePayload
): Promise<void> {
  return invoke<void>("teardown_worktree", { input });
}

export interface RenameBranchPayload {
  project_id: string;
  old_branch: string;
  new_branch: string;
}

export async function renameWorktreeBranch(
  input: RenameBranchPayload
): Promise<void> {
  return invoke<void>("rename_worktree_branch", { input });
}

export async function fetchWorktreeDiff(
  projectId: string,
  worktreePath: string
): Promise<DiffDetail> {
  return invoke<DiffDetail>("fetch_worktree_diff", { projectId, worktreePath });
}

export interface LaunchSessionPayload {
  project_id?: string;
  cwd: string;
  branch?: string;
  argv: string[];
  initial_prompt?: string;
  name?: string;
  autonomous?: boolean;
}

export async function launchSession(
  input: LaunchSessionPayload
): Promise<string> {
  return invoke<string>("launch_session", { input });
}

export async function sendTerminalText(
  address: string,
  text: string,
  force = false
): Promise<void> {
  return invoke<void>("send_terminal_text", { address, text, force });
}

export async function sendTerminalKeys(
  address: string,
  keys: string[]
): Promise<void> {
  return invoke<void>("send_terminal_keys", { address, keys });
}

export async function interruptTerminal(address: string): Promise<void> {
  return invoke<void>("interrupt_terminal", { address });
}

export async function killTerminal(
  address: string,
  remove = true
): Promise<void> {
  return invoke<void>("kill_terminal", { address, remove });
}

export async function attachTerminal(
  address: string,
  cols: number,
  rows: number,
  keepExisting = false
): Promise<AttachResult> {
  return invoke<AttachResult>("attach_terminal", {
    address,
    cols,
    rows,
    keepExisting,
  });
}

export async function detachTerminal(channel: number): Promise<void> {
  return invoke<void>("detach_terminal", { channel });
}

export async function writeTerminalInput(
  channel: number,
  data: string
): Promise<void> {
  return invoke<void>("write_terminal_input", { channel, data });
}

export async function resizeTerminal(
  channel: number,
  cols: number,
  rows: number
): Promise<void> {
  return invoke<void>("resize_terminal", { channel, cols, rows });
}

export async function focusTerminal(
  channel: number,
  focused: boolean
): Promise<void> {
  return invoke<void>("focus_terminal", { channel, focused });
}

export async function popoutExternalTerminal(address: string): Promise<void> {
  return invoke<void>("popout_external_terminal", { address });
}

export async function listenStateBatch(
  cb: (payload: StateBatchPayload) => void
): Promise<UnlistenFn> {
  return listen<StateBatchPayload>("jjdr:state-batch", (e) => cb(e.payload));
}

export async function listenTermData(
  cb: (payload: TermDataEvent) => void
): Promise<UnlistenFn> {
  return listen<TermDataEvent>("jjdr:term-data", (e) => cb(e.payload));
}

export async function listenTermClosed(
  cb: (payload: TermClosedEvent) => void
): Promise<UnlistenFn> {
  return listen<TermClosedEvent>("jjdr:term-closed", (e) => cb(e.payload));
}

export async function showBgOverlay(
  payload: BgOverlayPayload,
  forcePreview = false
): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  return invoke<boolean>("show_bg_overlay", { payload, forcePreview });
}

export async function hideBgOverlay(): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke<void>("hide_bg_overlay");
}

export async function dismissBgOverlay(stamp: string): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke<void>("dismiss_bg_overlay", { stamp });
}

export async function getBgOverlayPayload(): Promise<BgOverlayPayload | null> {
  if (!isTauriRuntime()) return null;
  return invoke<BgOverlayPayload | null>("get_bg_overlay_payload");
}

export async function focusMainFromOverlay(
  cardKey: string,
  address: string
): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke<void>("focus_main_from_overlay", { cardKey, address });
}

export async function listenBgOverlayUpdate(
  cb: (payload: BgOverlayPayload) => void
): Promise<UnlistenFn> {
  return listen<BgOverlayPayload>("jjdr:bg-overlay-update", (e) =>
    cb(e.payload)
  );
}

export async function listenOverlayOpenCard(
  cb: (payload: OverlayOpenCardEvent) => void
): Promise<UnlistenFn> {
  return listen<OverlayOpenCardEvent>("jjdr:overlay-open-card", (e) =>
    cb(e.payload)
  );
}

export async function listenOverlayDismissed(
  cb: (stamp: string) => void
): Promise<UnlistenFn> {
  return listen<string>("jjdr:overlay-dismissed", (e) => cb(e.payload));
}

export interface WorktreeTeardownResultEvent {
  project_id: string;
  worktree_path: string;
  branch_name: string;
  ok: boolean;
  error?: string | null;
  worktrees?: WorktreeInfo[] | null;
}

export async function listenMainBgChanged(
  cb: (isBackground: boolean) => void
): Promise<UnlistenFn> {
  return listen<boolean>("jjdr:main-bg-changed", (e) => cb(e.payload));
}

export async function listenWorktreeTeardownResult(
  cb: (payload: WorktreeTeardownResultEvent) => void
): Promise<UnlistenFn> {
  return listen<WorktreeTeardownResultEvent>(
    "jjdr:worktree-teardown-result",
    (e) => cb(e.payload)
  );
}
