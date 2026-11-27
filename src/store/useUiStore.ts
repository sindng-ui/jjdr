import { create } from "zustand";
import type {
  EnrichedSession,
  PrReviewCandidate,
  ProjectConfig,
  UpdateCheckResult,
  WorktreeInfo,
} from "../types/domain";
import {
  readStoredRadarColumnWidth,
  readStoredRadarLayout,
  writeStoredRadarColumnWidth,
  writeStoredRadarLayout,
  type RadarLayoutMode,
} from "../utils/radarLayout";

export type ViewMode = "radar" | "queue" | "zen";
export type ZenModeTab = "inbox" | "dispatch";
export type ZenDispatchStep = "pick_project" | "pick_action" | "browse_worker";

export interface ZenHiredSoloState {
  cardKey: string;
  projectId: string;
  worktreePath: string;
  branchName: string;
  address: string | null;
  confirmed: boolean;
}

export interface ZenHiringState {
  projectId: string;
  projectName: string;
  projectColor: string;
  branchName: string;
  startedAt: number;
}

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

export interface ReviewPickerTarget {
  candidate: PrReviewCandidate;
  replaceRequestId?: string;
  replaceReviewerId?: string;
  maxReviewers?: number;
}

interface UiStoreState {
  startupReady: boolean;
  viewMode: ViewMode;
  radarLayoutMode: RadarLayoutMode;
  radarColumnWidthPx: number | null;
  radarFocusSlideDir: "next" | "prev" | null;
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
  lastTerminalSubmit: { address: string; atMs: number } | null;
  zenSkipNonce: number;
  zenPrevNonce: number;
  zenApproveNonce: number;
  zenModeTab: ZenModeTab;
  zenDispatchStep: ZenDispatchStep;
  zenDispatchProjectId: string | null;
  zenRecentAckedAt: Record<string, number>;
  zenHiredSolo: ZenHiredSoloState | null;
  zenHiringState: ZenHiringState | null;
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
  pendingPrReviewPrompt: PrReviewCandidate | null;
  reviewPickerTarget: ReviewPickerTarget | null;
  updateInfo: UpdateCheckResult | null;
  updateModalOpen: boolean;
  toast: { message: string; kind: "info" | "error" | "success" } | null;

  setViewMode: (mode: ViewMode) => void;
  setRadarLayoutMode: (mode: RadarLayoutMode) => void;
  setRadarColumnWidthPx: (widthPx: number | null) => void;
  setRadarFocusSlideDir: (dir: "next" | "prev" | null) => void;
  completeStartupRouting: (tab: ZenModeTab) => void;
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
  recordTerminalSubmit: (address: string) => void;
  requestZenSkip: () => void;
  requestZenPrev: () => void;
  requestZenApprove: () => void;
  setZenModeTab: (tab: ZenModeTab) => void;
  openZenDispatch: (projectId?: string | null) => void;
  setZenDispatchStep: (step: ZenDispatchStep) => void;
  setZenDispatchProjectId: (projectId: string | null) => void;
  returnToZenInbox: () => void;
  recordZenAcked: (cardKey: string, nowMs?: number) => void;
  landZenHiredWorker: (target: Omit<ZenHiredSoloState, "confirmed">) => void;
  confirmZenHiredSolo: () => void;
  clearZenHiredSolo: () => void;
  setZenHiringState: (state: ZenHiringState | null) => void;
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
  setPendingPrReviewPrompt: (candidate: PrReviewCandidate | null) => void;
  setReviewPickerTarget: (target: ReviewPickerTarget | null) => void;
  setUpdateInfo: (info: UpdateCheckResult | null) => void;
  setUpdateModalOpen: (open: boolean) => void;
  openUpdateModal: (info: UpdateCheckResult) => void;
  showToast: (message: string, kind?: "info" | "error" | "success", durationMs?: number) => void;
  clearToast: () => void;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useUiStore = create<UiStoreState>((set) => ({
  startupReady: false,
  viewMode: "zen",
  radarLayoutMode: readStoredRadarLayout(),
  radarColumnWidthPx: readStoredRadarColumnWidth(),
  radarFocusSlideDir: null,
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
  lastTerminalSubmit: null,
  zenSkipNonce: 0,
  zenPrevNonce: 0,
  zenApproveNonce: 0,
  zenModeTab: "inbox",
  zenDispatchStep: "pick_project",
  zenDispatchProjectId: null,
  zenRecentAckedAt: {},
  zenHiredSolo: null,
  zenHiringState: null,
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
  pendingPrReviewPrompt: null,
  reviewPickerTarget: null,
  updateInfo: null,
  updateModalOpen: false,
  toast: null,

  setViewMode: (viewMode) =>
    set((s) => {
      if (viewMode === "zen" && s.viewMode !== "zen") {
        return {
          viewMode,
          startupReady: true,
          zenModeTab: "inbox",
          zenDispatchStep: "pick_project",
          zenDispatchProjectId: null,
          zenHiredSolo: null,
          zenHiringState: null,
        };
      }
      return { viewMode, startupReady: true };
    }),
  setRadarLayoutMode: (radarLayoutMode) => {
    writeStoredRadarLayout(radarLayoutMode);
    set({ radarLayoutMode });
  },
  setRadarColumnWidthPx: (radarColumnWidthPx) => {
    writeStoredRadarColumnWidth(radarColumnWidthPx);
    set({ radarColumnWidthPx });
  },
  setRadarFocusSlideDir: (radarFocusSlideDir) => set({ radarFocusSlideDir }),
  completeStartupRouting: (tab) =>
    set((s) => {
      // Respect user's manual view switch if they already navigated away during boot
      if (s.startupReady && s.viewMode !== "zen") {
        return { startupReady: true };
      }
      if (tab === "dispatch") {
        return {
          startupReady: true,
          viewMode: "zen",
          zenModeTab: "dispatch",
          zenDispatchStep: "pick_project",
          zenDispatchProjectId: null,
          zenHiredSolo: null,
          attachedAddress: null,
          terminalDrawerOpen: false,
        };
      }
      return {
        startupReady: true,
        viewMode: "zen",
        zenModeTab: "inbox",
        zenDispatchStep: "pick_project",
        zenDispatchProjectId: null,
        zenHiredSolo: null,
      };
    }),
  toggleViewMode: () =>
    set((s) => {
      const next: ViewMode =
        s.viewMode === "radar"
          ? "queue"
          : s.viewMode === "queue"
          ? "zen"
          : "radar";
      if (next === "zen") {
        return {
          viewMode: next,
          zenModeTab: "inbox",
          zenDispatchStep: "pick_project",
          zenDispatchProjectId: null,
          zenHiredSolo: null,
          zenHiringState: null,
        };
      }
      return { viewMode: next };
    }),
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
  recordTerminalSubmit: (address) =>
    set({ lastTerminalSubmit: { address, atMs: Date.now() } }),
  requestZenSkip: () =>
    set((s) => ({ zenSkipNonce: s.zenSkipNonce + 1 })),
  requestZenPrev: () =>
    set((s) => ({ zenPrevNonce: s.zenPrevNonce + 1 })),
  requestZenApprove: () =>
    set((s) => ({ zenApproveNonce: s.zenApproveNonce + 1 })),
  setZenModeTab: (zenModeTab) =>
    set((s) => ({
      zenModeTab,
      zenDispatchStep:
        zenModeTab === "dispatch" ? s.zenDispatchStep : "pick_project",
    })),
  openZenDispatch: (projectId = null) =>
    set({
      viewMode: "zen",
      zenModeTab: "dispatch",
      zenDispatchProjectId: projectId,
      zenDispatchStep: projectId ? "pick_action" : "pick_project",
      zenHiredSolo: null,
      attachedAddress: null,
      terminalDrawerOpen: false,
    }),
  setZenDispatchStep: (zenDispatchStep) =>
    set((s) => ({
      zenDispatchStep,
      zenHiredSolo: zenDispatchStep === "browse_worker" ? s.zenHiredSolo : null,
    })),
  setZenDispatchProjectId: (zenDispatchProjectId) =>
    set({ zenDispatchProjectId }),
  returnToZenInbox: () =>
    set({
      zenModeTab: "inbox",
      zenDispatchStep: "pick_project",
      zenDispatchProjectId: null,
      zenHiredSolo: null,
      zenHiringState: null,
    }),
  recordZenAcked: (cardKey, nowMs = Date.now()) =>
    set((s) => ({
      zenRecentAckedAt: { ...s.zenRecentAckedAt, [cardKey]: nowMs },
    })),
  landZenHiredWorker: (target) =>
    set({
      viewMode: "zen",
      zenModeTab: "dispatch",
      zenHiringState: null,
      zenDispatchProjectId: target.projectId,
      zenDispatchStep: "browse_worker",
      zenHiredSolo: { ...target, confirmed: false },
      attachedAddress: null,
      terminalDrawerOpen: false,
    }),
  confirmZenHiredSolo: () =>
    set((s) => ({
      zenHiredSolo: s.zenHiredSolo
        ? { ...s.zenHiredSolo, confirmed: true }
        : null,
    })),
  clearZenHiredSolo: () => set({ zenHiredSolo: null }),
  setZenHiringState: (zenHiringState) => set({ zenHiringState }),
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
  setPendingPrReviewPrompt: (pendingPrReviewPrompt) =>
    set({ pendingPrReviewPrompt }),
  setReviewPickerTarget: (reviewPickerTarget) => set({ reviewPickerTarget }),
  setUpdateInfo: (updateInfo) => set({ updateInfo }),
  setUpdateModalOpen: (updateModalOpen) => set({ updateModalOpen }),
  openUpdateModal: (updateInfo) => set({ updateInfo, updateModalOpen: true }),
  showToast: (message, kind = "info", durationMs = 3500) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: { message, kind } });
    toastTimer = setTimeout(() => set({ toast: null }), durationMs);
  },
  clearToast: () => set({ toast: null }),
}));
