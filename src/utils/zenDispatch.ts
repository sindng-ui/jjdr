import type {
  EnrichedSession,
  MatrixProjectLane,
  MatrixWorktreeCell,
  ProjectConfig,
  RootCardMode,
  TerminalInfo,
  WorktreeCardMeta,
  WorktreeInfo,
} from "../types/domain";
import { isPlainShellTerminal, normalizePath } from "../workers/dashboardLogic";

export type WorkerReadiness = "fresh" | "continuing" | "dormant";

export interface ZenDispatchWorker {
  cardKey: string;
  normWtPath: string;
  project: ProjectConfig;
  worktree: WorktreeInfo;
  sessions: EnrichedSession[];
  /** Live non-shell AI session if running in idle state; null for dormant/shell-only worktrees */
  aiSession: EnrichedSession | null;
  /** Tier 0: live Idle AI worker, Tier 1: dormant/empty worktree (or plain shell only) */
  tier: 0 | 1;
  readiness: WorkerReadiness;
  /** Most-recently-used timestamp (max of recent Zen ack time and terminal status_ms/created_ms) */
  mruMs: number;
}

export interface ZenDispatchProjectSummary {
  project: ProjectConfig;
  idleAiCount: number;
  emptyWorktreeCount: number;
  totalAvailableCount: number;
  runningCount: number;
  actionableCount: number;
}

export interface DispatchDeckOptions {
  worktreeMeta?: Record<string, WorktreeCardMeta>;
  recentAckedAt?: Record<string, number>;
  rootCardMode?: RootCardMode;
  removingWorktreePaths?: Record<string, true>;
}

function pickLiveIdleAiSession(
  sessions: EnrichedSession[]
): EnrichedSession | null {
  const aiSessions = sessions.filter(
    (s) => s.terminal.state === "live" && !isPlainShellTerminal(s.terminal)
  );
  if (aiSessions.length === 0) return null;
  if (aiSessions.length === 1) return aiSessions[0];
  return [...aiSessions].sort((a, b) => {
    const ta = a.terminal.status_ms ?? a.terminal.created_ms ?? 0;
    const tb = b.terminal.status_ms ?? b.terminal.created_ms ?? 0;
    return tb - ta;
  })[0];
}

export function classifyWorkerReadiness(
  worktree: WorktreeInfo,
  aiSession: EnrichedSession | null,
  meta?: WorktreeCardMeta
): WorkerReadiness {
  if (!aiSession) return "dormant";
  if (worktree.is_merged) return "fresh";
  const hasDirty = worktree.dirty_count > 0;
  const hasMeta = Boolean(meta?.display_name?.trim() || meta?.note?.trim());
  const hasPriorTurns = (aiSession.terminal.turn ?? 0) > 0;
  if (hasDirty || hasMeta || hasPriorTurns) {
    return "continuing";
  }
  return "fresh";
}

function isCellEligibleForDispatch(
  cell: MatrixWorktreeCell,
  rootCardMode?: RootCardMode,
  removingWorktreePaths?: Record<string, true>
): boolean {
  if (cell.worktree.is_main && rootCardMode === "hidden") {
    return false;
  }
  const normPath = normalizePath(cell.worktree.path);
  if (removingWorktreePaths && removingWorktreePaths[normPath]) {
    return false;
  }
  return cell.topBucket === "idle";
}

/**
 * Builds the ordered dispatch deck for a single project:
 * 1. Tier 0: Live Idle AI workers ordered by MRU (recent Zen ack time or latest status_ms) desc.
 * 2. Tier 1: Dormant / empty worktrees (non-ROOT before ROOT, dirty/named before clean, then lane order).
 */
export function buildProjectDispatchDeck(
  lane: MatrixProjectLane | null | undefined,
  options: DispatchDeckOptions = {}
): ZenDispatchWorker[] {
  if (!lane) return [];
  const {
    worktreeMeta = {},
    recentAckedAt = {},
    rootCardMode,
    removingWorktreePaths,
  } = options;

  const entries: Array<{ worker: ZenDispatchWorker; originalIndex: number; hasContext: boolean }> = [];

  lane.cells.forEach((cell, idx) => {
    if (!isCellEligibleForDispatch(cell, rootCardMode, removingWorktreePaths)) {
      return;
    }

    const normWtPath = normalizePath(cell.worktree.path);
    const cardKey = `wt::${lane.project.id}::${normWtPath}`;
    const meta = worktreeMeta[normWtPath];
    const aiSession = pickLiveIdleAiSession(cell.sessions);
    const tier: 0 | 1 = aiSession ? 0 : 1;
    const readiness = classifyWorkerReadiness(cell.worktree, aiSession, meta);

    const sessionActivityMs = aiSession
      ? aiSession.terminal.status_ms ?? aiSession.terminal.created_ms ?? 0
      : 0;
    const ackedMs = recentAckedAt[cardKey] ?? 0;
    const mruMs = Math.max(ackedMs, sessionActivityMs);

    const hasContext =
      cell.worktree.dirty_count > 0 ||
      Boolean(meta?.display_name?.trim() || meta?.note?.trim());

    entries.push({
      worker: {
        cardKey,
        normWtPath,
        project: lane.project,
        worktree: cell.worktree,
        sessions: cell.sessions,
        aiSession,
        tier,
        readiness,
        mruMs,
      },
      originalIndex: idx,
      hasContext,
    });
  });

  entries.sort((a, b) => {
    if (a.worker.tier !== b.worker.tier) {
      return a.worker.tier - b.worker.tier;
    }
    if (a.worker.tier === 0) {
      if (a.worker.mruMs !== b.worker.mruMs) {
        return b.worker.mruMs - a.worker.mruMs;
      }
      return a.originalIndex - b.originalIndex;
    }
    // Tier 1: empty / dormant worktrees — non-main first, then ones with dirty/meta context
    if (a.worker.worktree.is_main !== b.worker.worktree.is_main) {
      return a.worker.worktree.is_main ? 1 : -1;
    }
    if (a.hasContext !== b.hasContext) {
      return a.hasContext ? -1 : 1;
    }
    return a.originalIndex - b.originalIndex;
  });

  return entries.map((e) => e.worker);
}

/**
 * Summarizes dispatch availability across all visible project lanes,
 * preserving the user's configured project order for zero spatial surprise.
 */
export function buildDispatchProjectSummaries(
  matrixLanes: MatrixProjectLane[],
  options: DispatchDeckOptions = {}
): ZenDispatchProjectSummary[] {
  const { rootCardMode, removingWorktreePaths } = options;

  return matrixLanes.map((lane) => {
    let idleAiCount = 0;
    let emptyWorktreeCount = 0;
    let runningCount = 0;
    let actionableCount = 0;

    for (const cell of lane.cells) {
      const normPath = normalizePath(cell.worktree.path);
      if (removingWorktreePaths && removingWorktreePaths[normPath]) {
        continue;
      }
      if (cell.worktree.is_main && rootCardMode === "hidden") {
        continue;
      }

      if (cell.topBucket === "needs_you" || cell.topBucket === "ready") {
        actionableCount += 1;
      } else if (cell.topBucket === "running") {
        runningCount += 1;
      } else {
        const ai = pickLiveIdleAiSession(cell.sessions);
        if (ai) idleAiCount += 1;
        else emptyWorktreeCount += 1;
      }
    }

    return {
      project: lane.project,
      idleAiCount,
      emptyWorktreeCount,
      totalAvailableCount: idleAiCount + emptyWorktreeCount,
      runningCount,
      actionableCount,
    };
  });
}

/** Circularly steps the active worker index by +1 (next) or -1 (previous). */
export function stepDispatchIndex(
  currentIndex: number,
  total: number,
  delta: number
): number {
  if (total <= 0) return 0;
  return (((currentIndex + delta) % total) + total) % total;
}

/**
 * Builds an immediate ZenDispatchWorker object for a newly hired worktree even
 * before the 80ms dashboard worker recomputes `matrixLanes`, preventing 0ms flicker.
 */
export function buildFallbackHiredWorker(params: {
  project: ProjectConfig;
  worktreePath: string;
  branchName: string;
  address: string | null;
  terminal?: TerminalInfo | null;
}): ZenDispatchWorker {
  const { project, worktreePath, branchName, address, terminal } = params;
  const normWtPath = normalizePath(worktreePath);
  const cardKey = `wt::${project.id}::${normWtPath}`;

  const worktree: WorktreeInfo = {
    path: worktreePath,
    head: "",
    branch: branchName || "new-branch",
    is_main: false,
    is_bare: false,
    is_detached: false,
    is_merged: false,
    dirty_count: 0,
    added_lines: 0,
    deleted_lines: 0,
    changed_files: [],
    overlap_files: [],
  };

  let aiSession: EnrichedSession | null = null;
  if (address) {
    const t: TerminalInfo = terminal ?? {
      address,
      labels: { "jjdr.project": project.id, "jjdr.agent": project.default_agent || "ai" },
      argv: [project.default_agent || "ai"],
      cwd: worktreePath,
      state: "live",
      created_ms: Date.now(),
      status_ms: Date.now(),
      screen: "",
      cols: 120,
      rows: 40,
      turn: 0,
      title: project.default_agent || "AI",
      keep: true,
    };
    if (!isPlainShellTerminal(t)) {
      aiSession = {
        address: t.address,
        terminal: t,
        bucket: "idle",
        priorityScore: 3_000_000,
        isStuck: false,
        stuckMinutes: 0,
        unackedDone: false,
        projectId: project.id,
        projectName: project.name,
        projectColor: project.color,
        projectGroup: project.group,
        worktreePath,
        branch: worktree.branch,
        worktree,
        previewLines: [],
        queuedCount: 0,
        agentLabel: t.labels["jjdr.agent"] || project.default_agent || "AI",
        elapsedMs: 0,
      };
    }
  }

  return {
    cardKey,
    normWtPath,
    project,
    worktree,
    sessions: aiSession ? [aiSession] : [],
    aiSession,
    tier: aiSession ? 0 : 1,
    readiness: aiSession ? "fresh" : "dormant",
    mruMs: Date.now(),
  };
}

const TRUST_PROMPT_PATTERN =
  /do you trust|trust\s+(this\s+)?(folder|directory|workspace|files)|yes,\s*i\s*trust|trust\s+folder|safety\s+check/i;

/**
 * Returns true while a newly spawned AI CLI is waiting for an interactive
 * folder-trust / permission / auth confirmation rather than a real user task.
 */
export function isTrustOrSetupPrompt(
  terminal: TerminalInfo | null | undefined,
  previewLines: string[] = []
): boolean {
  if (!terminal || terminal.state !== "live") return false;
  const st = terminal.status?.state ?? "";
  if (st === "blocked") return true;
  const msg = terminal.status?.msg ?? "";
  if (msg && TRUST_PROMPT_PATTERN.test(msg)) return true;
  if (previewLines.length > 0) {
    const tail = previewLines.slice(-10).join("\n");
    if (TRUST_PROMPT_PATTERN.test(tail)) return true;
  }
  return false;
}
