import { create } from "zustand";
import type { ProjectConfig } from "../types/domain";

export type ViewMode = "radar" | "queue";

export interface DiffModalTarget {
  projectId: string;
  worktreePath: string;
  branch: string;
}

export interface TeardownModalTarget {
  projectId: string;
  worktreePath: string;
  branch: string;
  isMerged: boolean;
  dirtyCount: number;
  terminalAddresses: string[];
}

export interface LaunchModalTarget {
  projectId?: string;
  cwd: string;
  branch?: string;
  defaultAgent?: string;
}

interface UiStoreState {
  viewMode: ViewMode;
  activeGroup: string;
  selectedProjectId: string | null;
  searchQuery: string;
  selectedCardKey: string | null;
  selectedAddress: string | null;
  hoveredAddress: string | null;
  attachedAddress: string | null;
  lastSessionByCardKey: Record<string, string>;
  sidebarOpen: boolean;
  collapsedProjects: Record<string, boolean>;
  idleCollapsed: boolean;
  commandPaletteOpen: boolean;
  projectModalProject: ProjectConfig | "new" | null;
  createWorktreeProjectId: string | null;
  diffTarget: DiffModalTarget | null;
  teardownTarget: TeardownModalTarget | null;
  launchTarget: LaunchModalTarget | null;
  settingsOpen: boolean;
  toast: { message: string; kind: "info" | "error" | "success" } | null;

  setViewMode: (mode: ViewMode) => void;
  toggleViewMode: () => void;
  setActiveGroup: (group: string) => void;
  setSelectedProjectId: (id: string | null) => void;
  toggleSelectedProjectId: (id: string) => void;
  clearFilters: () => void;
  setSearchQuery: (q: string) => void;
  setSelectedCardKey: (key: string | null) => void;
  setSelectedAddress: (addr: string | null) => void;
  setHoveredAddress: (addr: string | null) => void;
  setAttachedAddress: (addr: string | null) => void;
  rememberCardSession: (cardKey: string, addr: string) => void;
  toggleSidebar: () => void;
  toggleProjectCollapsed: (projectId: string) => void;
  toggleIdleCollapsed: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setProjectModalProject: (p: ProjectConfig | "new" | null) => void;
  setCreateWorktreeProjectId: (id: string | null) => void;
  setDiffTarget: (t: DiffModalTarget | null) => void;
  setTeardownTarget: (t: TeardownModalTarget | null) => void;
  setLaunchTarget: (t: LaunchModalTarget | null) => void;
  setSettingsOpen: (open: boolean) => void;
  showToast: (message: string, kind?: "info" | "error" | "success") => void;
  clearToast: () => void;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useUiStore = create<UiStoreState>((set) => ({
  viewMode: "radar",
  activeGroup: "All",
  selectedProjectId: null,
  searchQuery: "",
  selectedCardKey: null,
  selectedAddress: null,
  hoveredAddress: null,
  attachedAddress: null,
  lastSessionByCardKey: {},
  sidebarOpen: true,
  collapsedProjects: {},
  idleCollapsed: false,
  commandPaletteOpen: false,
  projectModalProject: null,
  createWorktreeProjectId: null,
  diffTarget: null,
  teardownTarget: null,
  launchTarget: null,
  settingsOpen: false,
  toast: null,

  setViewMode: (viewMode) => set({ viewMode }),
  toggleViewMode: () =>
    set((s) => ({ viewMode: s.viewMode === "radar" ? "queue" : "radar" })),
  setActiveGroup: (activeGroup) => set({ activeGroup }),
  setSelectedProjectId: (selectedProjectId) => set({ selectedProjectId }),
  toggleSelectedProjectId: (id) =>
    set((s) => ({ selectedProjectId: s.selectedProjectId === id ? null : id })),
  clearFilters: () =>
    set({ selectedProjectId: null, searchQuery: "", activeGroup: "All" }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSelectedCardKey: (selectedCardKey) => set({ selectedCardKey }),
  setSelectedAddress: (selectedAddress) => set({ selectedAddress }),
  setHoveredAddress: (hoveredAddress) => set({ hoveredAddress }),
  setAttachedAddress: (attachedAddress) => set({ attachedAddress }),
  rememberCardSession: (cardKey, addr) =>
    set((s) => ({
      lastSessionByCardKey: { ...s.lastSessionByCardKey, [cardKey]: addr },
    })),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleProjectCollapsed: (projectId) =>
    set((s) => ({
      collapsedProjects: {
        ...s.collapsedProjects,
        [projectId]: !s.collapsedProjects[projectId],
      },
    })),
  toggleIdleCollapsed: () => set((s) => ({ idleCollapsed: !s.idleCollapsed })),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  setProjectModalProject: (projectModalProject) => set({ projectModalProject }),
  setCreateWorktreeProjectId: (createWorktreeProjectId) =>
    set({ createWorktreeProjectId }),
  setDiffTarget: (diffTarget) => set({ diffTarget }),
  setTeardownTarget: (teardownTarget) => set({ teardownTarget }),
  setLaunchTarget: (launchTarget) => set({ launchTarget }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  showToast: (message, kind = "info") => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: { message, kind } });
    toastTimer = setTimeout(() => set({ toast: null }), 3500);
  },
  clearToast: () => set({ toast: null }),
}));
