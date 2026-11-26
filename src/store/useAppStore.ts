import { create } from "zustand";
import type {
  AckedSessionSnapshot,
  AppSettings,
  DashboardWorkerResult,
  HerdrHealth,
  ProjectConfig,
  StateBatchPayload,
  TemplateInfo,
  TerminalInfo,
  TerminalPreview,
  WorktreeCardMeta,
  WorktreeInfo,
} from "../types/domain";
import {
  applyThemeToDom,
  DEFAULT_RADAR_DENSITY,
  normalizeRadarDensity,
  normalizeThemeId,
  readStoredTheme,
} from "../utils/themes";
import { normalizePath } from "../workers/dashboardLogic";

const INITIAL_THEME = readStoredTheme();
applyThemeToDom(INITIAL_THEME);

const DEFAULT_SETTINGS: AppSettings = {
  theme: INITIAL_THEME,
  radar_density: DEFAULT_RADAR_DENSITY,
  root_card_mode: "header_chip",
  stuck_minutes: 5,
  notify_on_blocked: false,
  notify_on_done: false,
  show_merge_overlap: true,
  bg_overlay_enabled: false,
  bg_overlay_position: "top_center",
  prompt_presets: [
    { id: "test", label: "Run Tests", prompt: "Run the test suite and fix any failures." },
    { id: "review", label: "Self Review", prompt: "Review your diff carefully for edge cases and performance issues." },
    { id: "lint", label: "Fix Lint", prompt: "Run lint and typecheck, and fix all errors." },
    { id: "commit", label: "Commit Msg", prompt: "Summarize all changes concisely and propose a clean commit message." },
  ],
  skipped_update_version: null,
};

const EMPTY_COMPUTED: DashboardWorkerResult = {
  allSessions: [],
  sessions: [],
  byBucket: { needs_you: [], ready: [], running: [], idle: [] },
  matrixLanes: [],
  unassignedSessions: [],
  counts: { needsYou: 0, ready: 0, running: 0, idle: 0, total: 0 },
  globalCounts: { needsYou: 0, ready: 0, running: 0, idle: 0, total: 0 },
  groups: ["All"],
};

interface AppStoreState {
  health: HerdrHealth;
  terminals: Record<string, TerminalInfo>;
  previews: Record<string, TerminalPreview>;
  projects: ProjectConfig[];
  worktreesByProject: Record<string, WorktreeInfo[]>;
  templates: TemplateInfo[];
  settings: AppSettings;
  ackTurns: Record<string, number>;
  ackedSnapshots: Record<string, AckedSessionSnapshot>;
  queuedPrompts: Record<string, string[]>;
  lastAgentByWorktree: Record<string, string[]>;
  worktreeMeta: Record<string, WorktreeCardMeta>;
  worktreeOrderByProject: Record<string, string[]>;
  removingWorktreePaths: Record<string, true>;
  computed: DashboardWorkerResult;
  hydrated: boolean;
  seq: number;

  applyBatch: (batch: StateBatchPayload) => void;
  setHealth: (health: HerdrHealth) => void;
  setProjects: (projects: ProjectConfig[]) => void;
  setWorktreesByProject: (map: Record<string, WorktreeInfo[]>) => void;
  setProjectWorktrees: (projectId: string, list: WorktreeInfo[]) => void;
  markWorktreeRemoving: (projectId: string, normWorktreePath: string) => void;
  finishWorktreeRemoving: (
    projectId: string,
    normWorktreePath: string,
    latestWorktrees?: WorktreeInfo[] | null
  ) => void;
  setTemplates: (templates: TemplateInfo[]) => void;
  setSettings: (settings: AppSettings) => void;
  setHydratedData: (data: {
    projects: ProjectConfig[];
    settings: AppSettings;
    ackTurns: Record<string, number>;
    queuedPrompts: Record<string, string[]>;
    lastAgentByWorktree: Record<string, string[]>;
    worktreeMeta: Record<string, WorktreeCardMeta>;
    worktreeOrderByProject: Record<string, string[]>;
  }) => void;
  acknowledgeTurn: (address: string, turn: number) => void;
  acknowledgeSession: (address: string, turn: number, digest: string) => void;
  clearAckedSnapshot: (address: string) => void;
  enqueuePrompt: (address: string, prompt: string) => void;
  popQueuedPrompt: (address: string) => string | null;
  removeQueuedPrompt: (address: string, index: number) => void;
  recordLastAgent: (normWorktreePath: string, argv: string[]) => void;
  setWorktreeMeta: (normWorktreePath: string, meta: WorktreeCardMeta | null) => void;
  setProjectWorktreeOrder: (projectId: string, orderedNormPaths: string[]) => void;
  setComputed: (result: DashboardWorkerResult) => void;
}

export const useAppStore = create<AppStoreState>((set, get) => ({
  health: {
    connected: false,
    hc_found: true,
    version: null,
    core_name: null,
    error: null,
    hint: null,
  },
  terminals: {},
  previews: {},
  projects: [],
  worktreesByProject: {},
  templates: [],
  settings: DEFAULT_SETTINGS,
  ackTurns: {},
  ackedSnapshots: {},
  queuedPrompts: {},
  lastAgentByWorktree: {},
  worktreeMeta: {},
  worktreeOrderByProject: {},
  removingWorktreePaths: {},
  computed: EMPTY_COMPUTED,
  hydrated: false,
  seq: 0,

  applyBatch: (batch) =>
    set((state) => {
      const nextTerminals = batch.full_sync ? {} : { ...state.terminals };
      for (const t of batch.terminals) {
        nextTerminals[t.address] = t;
      }
      for (const addr of batch.removed_addresses) {
        delete nextTerminals[addr];
      }

      const nextPreviews = batch.full_sync ? {} : { ...state.previews };
      for (const p of batch.previews) {
        nextPreviews[p.address] = p;
      }
      for (const addr of batch.removed_addresses) {
        delete nextPreviews[addr];
      }

      return {
        terminals: nextTerminals,
        previews: nextPreviews,
        health: batch.health,
        seq: batch.seq,
      };
    }),

  setHealth: (health) => set({ health }),
  setProjects: (projects) => set({ projects }),
  setWorktreesByProject: (worktreesByProject) =>
    set((state) => {
      const removing = state.removingWorktreePaths;
      if (Object.keys(removing).length === 0) {
        return { worktreesByProject };
      }
      const filtered: Record<string, WorktreeInfo[]> = {};
      for (const [pid, list] of Object.entries(worktreesByProject)) {
        filtered[pid] = list.filter((w) => !removing[normalizePath(w.path)]);
      }
      return { worktreesByProject: filtered };
    }),
  setProjectWorktrees: (projectId, list) =>
    set((state) => {
      const removing = state.removingWorktreePaths;
      const nextList =
        Object.keys(removing).length === 0
          ? list
          : list.filter((w) => !removing[normalizePath(w.path)]);
      return {
        worktreesByProject: { ...state.worktreesByProject, [projectId]: nextList },
      };
    }),
  markWorktreeRemoving: (projectId, normWorktreePath) =>
    set((state) => {
      const curList = state.worktreesByProject[projectId] ?? [];
      const nextList = curList.filter(
        (w) => normalizePath(w.path) !== normWorktreePath
      );
      return {
        removingWorktreePaths: {
          ...state.removingWorktreePaths,
          [normWorktreePath]: true,
        },
        worktreesByProject: {
          ...state.worktreesByProject,
          [projectId]: nextList,
        },
      };
    }),
  finishWorktreeRemoving: (projectId, normWorktreePath, latestWorktrees) =>
    set((state) => {
      const nextRemoving = { ...state.removingWorktreePaths };
      delete nextRemoving[normWorktreePath];
      if (!latestWorktrees) {
        return { removingWorktreePaths: nextRemoving };
      }
      const filtered = latestWorktrees.filter(
        (w) => !nextRemoving[normalizePath(w.path)]
      );
      return {
        removingWorktreePaths: nextRemoving,
        worktreesByProject: {
          ...state.worktreesByProject,
          [projectId]: filtered,
        },
      };
    }),
  setTemplates: (templates) => set({ templates }),
  setSettings: (settings) => {
    const normalized: AppSettings = {
      ...settings,
      theme: normalizeThemeId(settings.theme),
      radar_density: normalizeRadarDensity(settings.radar_density),
      root_card_mode:
        settings.root_card_mode === "card" ||
        settings.root_card_mode === "hidden" ||
        settings.root_card_mode === "header_chip"
          ? settings.root_card_mode
          : "header_chip",
      bg_overlay_enabled: settings.bg_overlay_enabled ?? false,
      bg_overlay_position:
        settings.bg_overlay_position === "bottom_center" ||
        settings.bg_overlay_position === "bottom_right" ||
        settings.bg_overlay_position === "top_center"
          ? settings.bg_overlay_position
          : "top_center",
    };
    applyThemeToDom(normalized.theme);
    set({ settings: normalized });
  },
  setHydratedData: ({
    projects,
    settings,
    ackTurns,
    queuedPrompts,
    lastAgentByWorktree,
    worktreeMeta,
    worktreeOrderByProject,
  }) => {
    const normalizedSettings: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...settings,
      theme: normalizeThemeId(settings?.theme),
      radar_density: normalizeRadarDensity(settings?.radar_density),
      root_card_mode:
        settings?.root_card_mode === "card" ||
        settings?.root_card_mode === "hidden" ||
        settings?.root_card_mode === "header_chip"
          ? settings.root_card_mode
          : "header_chip",
      bg_overlay_enabled: settings?.bg_overlay_enabled ?? false,
      bg_overlay_position:
        settings?.bg_overlay_position === "bottom_center" ||
        settings?.bg_overlay_position === "bottom_right" ||
        settings?.bg_overlay_position === "top_center"
          ? settings.bg_overlay_position
          : "top_center",
    };
    applyThemeToDom(normalizedSettings.theme);
    set({
      projects,
      settings: normalizedSettings,
      ackTurns,
      queuedPrompts,
      lastAgentByWorktree,
      worktreeMeta,
      worktreeOrderByProject,
      hydrated: true,
    });
  },

  acknowledgeTurn: (address, turn) =>
    set((state) => ({
      ackTurns: { ...state.ackTurns, [address]: Math.max(state.ackTurns[address] ?? 0, turn) },
    })),

  acknowledgeSession: (address, turn, digest) =>
    set((state) => ({
      ackTurns:
        turn > 0
          ? { ...state.ackTurns, [address]: Math.max(state.ackTurns[address] ?? 0, turn) }
          : state.ackTurns,
      ackedSnapshots: {
        ...state.ackedSnapshots,
        [address]: { turn, digest },
      },
    })),

  clearAckedSnapshot: (address) =>
    set((state) => {
      if (!(address in state.ackedSnapshots)) return state;
      const next = { ...state.ackedSnapshots };
      delete next[address];
      return { ackedSnapshots: next };
    }),

  enqueuePrompt: (address, prompt) =>
    set((state) => {
      const cur = state.queuedPrompts[address] ?? [];
      return {
        queuedPrompts: { ...state.queuedPrompts, [address]: [...cur, prompt] },
      };
    }),

  popQueuedPrompt: (address) => {
    const cur = get().queuedPrompts[address] ?? [];
    if (cur.length === 0) return null;
    const [head, ...rest] = cur;
    set((state) => {
      const next = { ...state.queuedPrompts };
      if (rest.length === 0) delete next[address];
      else next[address] = rest;
      return { queuedPrompts: next };
    });
    return head;
  },

  removeQueuedPrompt: (address, index) =>
    set((state) => {
      const cur = state.queuedPrompts[address] ?? [];
      const nextList = cur.filter((_, i) => i !== index);
      const next = { ...state.queuedPrompts };
      if (nextList.length === 0) delete next[address];
      else next[address] = nextList;
      return { queuedPrompts: next };
    }),

  recordLastAgent: (normWorktreePath, argv) =>
    set((state) => ({
      lastAgentByWorktree: {
        ...state.lastAgentByWorktree,
        [normWorktreePath]: argv,
      },
    })),

  setWorktreeMeta: (normWorktreePath, meta) =>
    set((state) => {
      const next = { ...state.worktreeMeta };
      const cleanedName = meta?.display_name?.trim() || null;
      const cleanedNote = meta?.note?.trim() || null;
      if (!cleanedName && !cleanedNote) {
        delete next[normWorktreePath];
      } else {
        next[normWorktreePath] = {
          display_name: cleanedName,
          note: cleanedNote,
        };
      }
      return { worktreeMeta: next };
    }),

  setProjectWorktreeOrder: (projectId, orderedNormPaths) =>
    set((state) => ({
      worktreeOrderByProject: {
        ...state.worktreeOrderByProject,
        [projectId]: orderedNormPaths,
      },
    })),

  setComputed: (computed) => set({ computed }),
}));
