import { create } from "zustand";
import type {
  AppSettings,
  DashboardWorkerResult,
  HerdrHealth,
  ProjectConfig,
  StateBatchPayload,
  TemplateInfo,
  TerminalInfo,
  TerminalPreview,
  WorktreeInfo,
} from "../types/domain";

const DEFAULT_SETTINGS: AppSettings = {
  stuck_minutes: 5,
  notify_on_blocked: true,
  notify_on_done: false,
  show_merge_overlap: true,
  prompt_presets: [
    { id: "test", label: "Run Tests", prompt: "Run the test suite and fix any failures." },
    { id: "review", label: "Self Review", prompt: "Review your diff carefully for edge cases and performance issues." },
    { id: "lint", label: "Fix Lint", prompt: "Run lint and typecheck, and fix all errors." },
    { id: "commit", label: "Commit Msg", prompt: "Summarize all changes concisely and propose a clean commit message." },
  ],
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
  queuedPrompts: Record<string, string[]>;
  lastAgentByWorktree: Record<string, string[]>;
  computed: DashboardWorkerResult;
  hydrated: boolean;
  seq: number;

  applyBatch: (batch: StateBatchPayload) => void;
  setHealth: (health: HerdrHealth) => void;
  setProjects: (projects: ProjectConfig[]) => void;
  setWorktreesByProject: (map: Record<string, WorktreeInfo[]>) => void;
  setProjectWorktrees: (projectId: string, list: WorktreeInfo[]) => void;
  setTemplates: (templates: TemplateInfo[]) => void;
  setSettings: (settings: AppSettings) => void;
  setHydratedData: (data: {
    projects: ProjectConfig[];
    settings: AppSettings;
    ackTurns: Record<string, number>;
    queuedPrompts: Record<string, string[]>;
    lastAgentByWorktree: Record<string, string[]>;
  }) => void;
  acknowledgeTurn: (address: string, turn: number) => void;
  enqueuePrompt: (address: string, prompt: string) => void;
  popQueuedPrompt: (address: string) => string | null;
  removeQueuedPrompt: (address: string, index: number) => void;
  recordLastAgent: (normWorktreePath: string, argv: string[]) => void;
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
  queuedPrompts: {},
  lastAgentByWorktree: {},
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
  setWorktreesByProject: (worktreesByProject) => set({ worktreesByProject }),
  setProjectWorktrees: (projectId, list) =>
    set((state) => ({
      worktreesByProject: { ...state.worktreesByProject, [projectId]: list },
    })),
  setTemplates: (templates) => set({ templates }),
  setSettings: (settings) => set({ settings }),
  setHydratedData: ({ projects, settings, ackTurns, queuedPrompts, lastAgentByWorktree }) =>
    set({
      projects,
      settings,
      ackTurns,
      queuedPrompts,
      lastAgentByWorktree,
      hydrated: true,
    }),

  acknowledgeTurn: (address, turn) =>
    set((state) => ({
      ackTurns: { ...state.ackTurns, [address]: Math.max(state.ackTurns[address] ?? 0, turn) },
    })),

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

  setComputed: (computed) => set({ computed }),
}));
