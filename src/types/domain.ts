export interface StatusInfo {
  state: "idle" | "working" | "done" | "blocked" | "error" | string;
  app?: string | null;
  kind?: "permission" | "question" | "auth" | string | null;
  msg?: string | null;
  progress?: number | null;
  title?: string | null;
}

export interface ForegroundInfo {
  pid: number;
  name: string;
  argv: string[];
  cwd: string;
}

export interface TerminalInfo {
  address: string;
  name?: string | null;
  labels: Record<string, string>;
  argv: string[];
  cwd: string;
  state: "live" | "finished" | string;
  created_ms: number;
  finished_ms?: number | null;
  exit_code?: number | null;
  signal?: number | null;
  screen: string;
  cols: number;
  rows: number;
  status?: StatusInfo | null;
  status_ms?: number | null;
  turn: number;
  title: string;
  template?: string | null;
  keep: boolean;
  pid?: number | null;
  parent?: string | null;
  reason?: string | null;
  foreground?: ForegroundInfo | null;
}

export interface TerminalPreview {
  address: string;
  lines: string[];
  updated_ms: number;
}

export interface HerdrHealth {
  connected: boolean;
  hc_found: boolean;
  version?: string | null;
  core_name?: string | null;
  error?: string | null;
  hint?: string | null;
}

export interface StateBatchPayload {
  full_sync: boolean;
  terminals: TerminalInfo[];
  removed_addresses: string[];
  previews: TerminalPreview[];
  health: HerdrHealth;
  seq: number;
}

export interface TemplateInfo {
  name: string;
  description: string;
}

export interface BootstrapConfig {
  copy_files: string[];
  setup_command?: string | null;
}

export interface ProjectConfig {
  id: string;
  name: string;
  repo_path: string;
  color: string;
  default_branch: string;
  default_agent: string;
  verify_command?: string | null;
  bootstrap: BootstrapConfig;
  group: string;
}

export interface WorktreeInfo {
  path: string;
  head: string;
  branch: string;
  is_main: boolean;
  is_bare: boolean;
  is_detached: boolean;
  is_merged: boolean;
  dirty_count: number;
  added_lines: number;
  deleted_lines: number;
  changed_files: string[];
  overlap_files: string[];
}

export interface DiffDetail {
  worktree_path: string;
  branch: string;
  stat_summary: string;
  diff_text: string;
  changed_files: string[];
}

export interface RepoInspectInfo {
  canonical_path: string;
  suggested_name: string;
  current_branch: string;
  default_branch: string;
  branches: string[];
  detected_env_files: string[];
  suggested_verify_commands: string[];
  suggested_setup_commands: string[];
}

export interface PromptPreset {
  id: string;
  label: string;
  prompt: string;
}

export type ThemeId = "aurora" | "lounge" | "nordic" | "botanical";
export type RadarDensity = "comfortable" | "balanced" | "compact";
export type RootCardMode = "header_chip" | "card" | "hidden";
export type BgOverlayPosition = "top_center" | "bottom_center" | "bottom_right";

export interface AppSettings {
  theme: ThemeId;
  radar_density: RadarDensity;
  root_card_mode?: RootCardMode;
  stuck_minutes: number;
  notify_on_blocked: boolean;
  notify_on_done: boolean;
  show_merge_overlap: boolean;
  bg_overlay_enabled?: boolean;
  bg_overlay_position?: BgOverlayPosition;
  prompt_presets: PromptPreset[];
  skipped_update_version?: string | null;
}

export interface UpdateCheckResult {
  current_version: string;
  latest_version: string;
  has_update: boolean;
  release_name: string;
  release_notes: string;
  release_url: string;
  published_at?: string | null;
  asset_name?: string | null;
  asset_download_url?: string | null;
  asset_size_bytes?: number | null;
}

export interface UpdateProgressEvent {
  stage: "downloading" | "launching" | "done" | "error" | string;
  downloaded_bytes: number;
  total_bytes?: number | null;
  percent?: number | null;
  message?: string | null;
}

export interface DownloadOutcome {
  file_path: string;
  bytes_written: number;
  dry_run: boolean;
}

export interface GeminiBridgeStatus {
  running: boolean;
  port: number;
  hooks_installed: boolean;
  settings_path: string;
  endpoint_path: string;
  events_received: number;
  last_event_ms?: number | null;
  last_event_name?: string | null;
  last_matched_terminal?: string | null;
  active_gemini_terminals: number;
}

export interface BgOverlayPayload {
  card_key: string;
  address: string;
  bucket: string;
  badge: string;
  project_name: string;
  project_color: string;
  branch: string;
  agent_label: string;
  message: string;
  pending_count: number;
  is_approval: boolean;
  position: BgOverlayPosition;
  theme: ThemeId;
  stamp: string;
  is_preview?: boolean;
}

export interface OverlayOpenCardEvent {
  card_key: string;
  address: string;
}

export type MissionKind = "dev" | "review" | "fix" | "refactor";

export interface WorktreeCardMeta {
  display_name?: string | null;
  note?: string | null;
  mission_kind?: MissionKind | null;
  pr_number?: number | null;
  pr_url?: string | null;
}

export interface AutoMissionInfo {
  kind?: MissionKind | null;
  prNumber?: number | null;
  prUrl?: string | null;
  source: "prompt" | "preview" | "branch";
  updatedAt: number;
}

export interface AckedSessionSnapshot {
  turn: number;
  digest: string;
}

export interface PersistedUiState {
  view_mode: "attention" | "matrix" | string;
  selected_terminal?: string | null;
  attached_terminal?: string | null;
  active_group: string;
  ack_turns: Record<string, number>;
  queued_prompts: Record<string, string[]>;
  last_agent_by_worktree: Record<string, string[]>;
  terminal_width_px?: number | null;
  worktree_meta?: Record<string, WorktreeCardMeta>;
  worktree_order_by_project?: Record<string, string[]>;
}

export interface PersistedBundle {
  projects: ProjectConfig[];
  ui_state: PersistedUiState;
  settings: AppSettings;
}

export interface AttachResult {
  channel: number;
  terminal: TerminalInfo;
  resize_notifications: boolean;
}

export interface TermDataEvent {
  channel: number;
  address: string;
  data_b64: string;
}

export interface TermClosedEvent {
  channel: number;
  address: string;
}

export type AttentionBucket = "needs_you" | "ready" | "running" | "idle";

export interface EnrichedSession {
  address: string;
  terminal: TerminalInfo;
  bucket: AttentionBucket;
  priorityScore: number;
  isStuck: boolean;
  stuckMinutes: number;
  unackedDone: boolean;
  projectId: string | null;
  projectName: string;
  projectColor: string;
  projectGroup: string;
  worktreePath: string;
  branch: string;
  worktree: WorktreeInfo | null;
  previewLines: string[];
  queuedCount: number;
  agentLabel: string;
  elapsedMs: number;
  /** Number of live sessions sharing this worktree card (used by Queue mode) */
  worktreeSessionCount?: number;
}

export interface MatrixWorktreeCell {
  worktree: WorktreeInfo;
  sessions: EnrichedSession[];
  topBucket: AttentionBucket;
}

export interface MatrixProjectLane {
  project: ProjectConfig;
  cells: MatrixWorktreeCell[];
}

export interface DashboardCounts {
  needsYou: number;
  ready: number;
  running: number;
  idle: number;
  total: number;
}

export interface DashboardWorkerResult {
  allSessions: EnrichedSession[];
  sessions: EnrichedSession[];
  byBucket: Record<AttentionBucket, EnrichedSession[]>;
  matrixLanes: MatrixProjectLane[];
  unassignedSessions: EnrichedSession[];
  counts: DashboardCounts;
  globalCounts: DashboardCounts;
  groups: string[];
}
