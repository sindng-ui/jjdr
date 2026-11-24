import { create } from "zustand";
import type {
  EnrichedSession,
  ProjectConfig,
  WorktreeInfo,
} from "../types/domain";

export type ViewMode = "radar" | "queue" | "zen";

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

export interface EditWorktreeTarget {
  projectId: string;
  worktreePath: string;
  branch: string;
  isMain: boolean;
}

export interface WorktreeContextMenuTarget {
  x: number;
  y: number;
  cardKey: string;
  project: ProjectConfig;
  worktree: WorktreeInfo;
  sessions: EnrichedSession[];
}

export interface MarkdownViewerTarget {
  absolutePath: string;
  relativePath: string;
  projectName: string;
  rootPath: string;
}

export interface CodeViewerTarget {
  absolutePath: string;
  relativePath: string;
  projectName: string;
  rootPath: string;
}

export interface CardGrabState {
  projectId: string;
  sourceKey: string;
  sourceNormPath: string;
  targetKey: string;
  targetNormPath: string;
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
  terminalDrawerOpen: boolean;
  terminalWidthPx: number | null;
  terminalFocusNonce: number;
  zenSkipNonce: number;
  zenApproveNonce: number;
  zenDismissedStamps: Record<string, string>;
  lastSessionByCardKey: Record<string, string>;
  sidebarOpen: boolean;
  collapsedProjects: Record<string, boolean>;
  idleCollapsed: boolean;
  commandPaletteOpen: boolean;
  quickFileOpen: boolean;
  markdownViewerTarget: MarkdownViewerTarget | null;
  codeViewerTarget: CodeViewerTarget | null;
  cardGrabState: CardGrabState | null;
  projectModalProject: ProjectConfig | "new" | null;
  createWorktreeProjectId: string | null;
  editWorktreeTarget: EditWorktreeTarget | null;
  contextMenu: WorktreeContextMenuTarget | null;
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
  setTerminalDrawerOpen: (open: boolean) => void;
  detachToEmptyDrawer: () => void;
  closeTerminalDrawer: () => void;
  setTerminalWidthPx: (widthPx: number | null) => void;
  requestTerminalFocus: () => void;
  requestZenSkip: () => void;
  requestZenApprove: () => void;
  dismissZenCardStamp: (cardKey: string, stamp: string) => void;
  rememberCardSession: (cardKey: string, addr: string) => void;
  toggleSidebar: () => void;
  toggleProjectCollapsed: (projectId: string) => void;
  toggleIdleCollapsed: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setQuickFileOpen: (open: boolean) => void;
  setMarkdownViewerTarget: (t: MarkdownViewerTarget | null) => void;
  setCodeViewerTarget: (t: CodeViewerTarget | null) => void;
  setCardGrabState: (state: CardGrabState | null) => void;
  setProjectModalProject: (p: ProjectConfig | "new" | null) => void;
  setCreateWorktreeProjectId: (id: string | null) => void;
  setEditWorktreeTarget: (t: EditWorktreeTarget | null) => void;
  setContextMenu: (m: WorktreeContextMenuTarget | null) => void;
  setDiffTarget: (t: DiffModalTarget | null) => void;
  setTeardownTarget: (t: TeardownModalTarget | null) => void;
  setLaunchTarget: (t: LaunchModalTarget | null) => void;
  setSettingsOpen: (open: boolean) => void;
  showToast: (message: string, kind?: "info" | "error" | "success", durationMs?: number) => void;
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
  terminalDrawerOpen: false,
  terminalWidthPx: null,
  terminalFocusNonce: 0,
  zenSkipNonce: 0,
  zenApproveNonce: 0,
  zenDismissedStamps: {},
  lastSessionByCardKey: {},
  sidebarOpen: true,
  collapsedProjects: {},
  idleCollapsed: false,
  commandPaletteOpen: false,
  quickFileOpen: false,
  markdownViewerTarget: null,
  codeViewerTarget: null,
  cardGrabState: null,
  projectModalProject: null,
  createWorktreeProjectId: null,
  editWorktreeTarget: null,
  contextMenu: null,
  diffTarget: null,
  teardownTarget: null,
  launchTarget: null,
  settingsOpen: false,
  toast: null,

  setViewMode: (viewMode) => set({ viewMode }),
  toggleViewMode: () =>
    set((s) => ({
      viewMode:
        s.viewMode === "radar"
          ? "queue"
          : s.viewMode === "queue"
          ? "zen"
          : "radar",
    })),
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
  setAttachedAddress: (attachedAddress) =>
    set({
      attachedAddress,
      terminalDrawerOpen: attachedAddress !== null,
    }),
  setTerminalDrawerOpen: (terminalDrawerOpen) =>
    set((s) => ({
      terminalDrawerOpen,
      attachedAddress: terminalDrawerOpen ? s.attachedAddress : null,
    })),
  detachToEmptyDrawer: () =>
    set({
      attachedAddress: null,
      terminalDrawerOpen: true,
    }),
  closeTerminalDrawer: () =>
    set({
      attachedAddress: null,
      terminalDrawerOpen: false,
    }),
  setTerminalWidthPx: (terminalWidthPx) => set({ terminalWidthPx }),
  requestTerminalFocus: () =>
    set((s) => ({ terminalFocusNonce: s.terminalFocusNonce + 1 })),
  requestZenSkip: () =>
    set((s) => ({ zenSkipNonce: s.zenSkipNonce + 1 })),
  requestZenApprove: () =>
    set((s) => ({ zenApproveNonce: s.zenApproveNonce + 1 })),
  dismissZenCardStamp: (cardKey, stamp) =>
    set((s) => ({
      zenDismissedStamps: { ...s.zenDismissedStamps, [cardKey]: stamp },
    })),
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
  setQuickFileOpen: (quickFileOpen) => set({ quickFileOpen }),
  setMarkdownViewerTarget: (markdownViewerTarget) =>
    set({ markdownViewerTarget }),
  setCodeViewerTarget: (codeViewerTarget) => set({ codeViewerTarget }),
  setCardGrabState: (cardGrabState) => set({ cardGrabState }),
  setProjectModalProject: (projectModalProject) => set({ projectModalProject }),
  setCreateWorktreeProjectId: (createWorktreeProjectId) =>
    set({ createWorktreeProjectId }),
  setEditWorktreeTarget: (editWorktreeTarget) => set({ editWorktreeTarget }),
  setContextMenu: (contextMenu) => set({ contextMenu }),
  setDiffTarget: (diffTarget) => set({ diffTarget }),
  setTeardownTarget: (teardownTarget) => set({ teardownTarget }),
  setLaunchTarget: (launchTarget) => set({ launchTarget }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  showToast: (message, kind = "info", durationMs = 3500) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: { message, kind } });
    toastTimer = setTimeout(() => set({ toast: null }), durationMs);
  },
  clearToast: () => set({ toast: null }),
}));
