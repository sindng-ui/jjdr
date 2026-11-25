import { describe, expect, it } from "vitest";
import type {
  EnrichedSession,
  MatrixProjectLane,
  ProjectConfig,
  TerminalInfo,
  WorktreeInfo,
} from "../types/domain";
import {
  buildDispatchProjectSummaries,
  buildFallbackHiredWorker,
  buildProjectDispatchDeck,
  classifyWorkerReadiness,
  isTrustOrSetupPrompt,
  stepDispatchIndex,
} from "./zenDispatch";

function makeProject(id: string, name: string): ProjectConfig {
  return {
    id,
    name,
    repo_path: `C:/repos/${id}`,
    color: "#38bdf8",
    default_branch: "main",
    default_agent: "claude",
    bootstrap: { copy_files: [] },
    group: "Work",
  };
}

function makeWorktree(
  path: string,
  branch: string,
  overrides: Partial<WorktreeInfo> = {}
): WorktreeInfo {
  return {
    path,
    head: "abc123",
    branch,
    is_main: false,
    is_bare: false,
    is_detached: false,
    is_merged: false,
    dirty_count: 0,
    added_lines: 0,
    deleted_lines: 0,
    changed_files: [],
    overlap_files: [],
    ...overrides,
  };
}

function makeSession(
  address: string,
  worktree: WorktreeInfo,
  projectId: string,
  overrides: Partial<TerminalInfo> = {},
  bucket: EnrichedSession["bucket"] = "idle"
): EnrichedSession {
  const terminal: TerminalInfo = {
    address,
    labels: { "jjdr.project": projectId, "jjdr.agent": "claude" },
    argv: ["claude"],
    cwd: worktree.path,
    state: "live",
    created_ms: 1000,
    status_ms: 1000,
    screen: "",
    cols: 120,
    rows: 40,
    turn: 0,
    title: "claude",
    keep: true,
    ...overrides,
  };

  return {
    address,
    terminal,
    bucket,
    priorityScore: 3_000_000,
    isStuck: false,
    stuckMinutes: 0,
    unackedDone: false,
    projectId,
    projectName: projectId,
    projectColor: "#38bdf8",
    projectGroup: "Work",
    worktreePath: worktree.path,
    branch: worktree.branch,
    worktree,
    previewLines: [],
    queuedCount: 0,
    agentLabel: "claude",
    elapsedMs: 1000,
  };
}

describe("zenDispatch", () => {
  it("orders live Idle AI workers (MRU desc) ahead of empty/shell-only worktrees", () => {
    const proj = makeProject("p1", "Alpha");
    const wtRoot = makeWorktree("C:/repos/p1", "main", { is_main: true });
    const wtOldAi = makeWorktree("C:/repos/p1-old", "feat/old", { dirty_count: 2 });
    const wtRecentAi = makeWorktree("C:/repos/p1-recent", "feat/recent", { dirty_count: 1 });
    const wtEmptyDirty = makeWorktree("C:/repos/p1-empty-dirty", "fix/wip", { dirty_count: 3 });
    const wtEmptyClean = makeWorktree("C:/repos/p1-empty-clean", "feat/clean");
    const wtRunning = makeWorktree("C:/repos/p1-run", "feat/running");

    const sOldAi = makeSession("t-old", wtOldAi, "p1", { status_ms: 5_000, turn: 2 });
    const sRecentAi = makeSession("t-recent", wtRecentAi, "p1", { status_ms: 9_000, turn: 1 });
    const sShellOnly = makeSession(
      "t-shell",
      wtEmptyClean,
      "p1",
      {
        labels: { "jjdr.project": "p1", "jjdr.agent": "pwsh" },
        argv: ["pwsh"],
        status_ms: 20_000,
      },
      "idle"
    );
    const sRunning = makeSession("t-run", wtRunning, "p1", { status_ms: 30_000 }, "running");

    const lane: MatrixProjectLane = {
      project: proj,
      cells: [
        { worktree: wtRoot, sessions: [], topBucket: "idle" },
        { worktree: wtEmptyClean, sessions: [sShellOnly], topBucket: "idle" },
        { worktree: wtOldAi, sessions: [sOldAi], topBucket: "idle" },
        { worktree: wtEmptyDirty, sessions: [], topBucket: "idle" },
        { worktree: wtRunning, sessions: [sRunning], topBucket: "running" },
        { worktree: wtRecentAi, sessions: [sRecentAi], topBucket: "idle" },
      ],
    };

    const deck = buildProjectDispatchDeck(lane);
    expect(deck.map((w) => w.worktree.branch)).toEqual([
      "feat/recent", // Tier 0 AI (status_ms 9000)
      "feat/old", // Tier 0 AI (status_ms 5000)
      "fix/wip", // Tier 1 empty dirty (non-ROOT)
      "feat/clean", // Tier 1 shell-only clean (non-ROOT)
      "main", // Tier 1 ROOT last
    ]);
    expect(deck[0].tier).toBe(0);
    expect(deck[1].tier).toBe(0);
    expect(deck[2].tier).toBe(1);
    expect(deck[3].aiSession).toBeNull();
  });

  it("prioritizes recently Zen-acknowledged worker as #1 in MRU order", () => {
    const proj = makeProject("p1", "Alpha");
    const wtA = makeWorktree("C:/repos/p1-a", "feat/a");
    const wtB = makeWorktree("C:/repos/p1-b", "feat/b");
    const sA = makeSession("t-a", wtA, "p1", { status_ms: 2_000 });
    const sB = makeSession("t-b", wtB, "p1", { status_ms: 8_000 });

    const lane: MatrixProjectLane = {
      project: proj,
      cells: [
        { worktree: wtA, sessions: [sA], topBucket: "idle" },
        { worktree: wtB, sessions: [sB], topBucket: "idle" },
      ],
    };

    const deck = buildProjectDispatchDeck(lane, {
      recentAckedAt: { "wt::p1::c:/repos/p1-a": 15_000 },
    });
    expect(deck.map((w) => w.worktree.branch)).toEqual(["feat/a", "feat/b"]);
  });

  it("respects rootCardMode='hidden' and removingWorktreePaths", () => {
    const proj = makeProject("p1", "Alpha");
    const wtRoot = makeWorktree("C:/repos/p1", "main", { is_main: true });
    const wtDel = makeWorktree("C:/repos/p1-del", "feat/del");
    const wtKeep = makeWorktree("C:/repos/p1-keep", "feat/keep");

    const lane: MatrixProjectLane = {
      project: proj,
      cells: [
        { worktree: wtRoot, sessions: [], topBucket: "idle" },
        { worktree: wtDel, sessions: [], topBucket: "idle" },
        { worktree: wtKeep, sessions: [], topBucket: "idle" },
      ],
    };

    const deck = buildProjectDispatchDeck(lane, {
      rootCardMode: "hidden",
      removingWorktreePaths: { "c:/repos/p1-del": true },
    });
    expect(deck.map((w) => w.worktree.branch)).toEqual(["feat/keep"]);
  });

  it("classifies worker readiness accurately (fresh / continuing / dormant)", () => {
    const wtClean = makeWorktree("C:/repos/p1-c", "feat/c");
    const wtDirty = makeWorktree("C:/repos/p1-d", "feat/d", { dirty_count: 1 });
    const wtMerged = makeWorktree("C:/repos/p1-m", "feat/m", {
      is_merged: true,
      dirty_count: 0,
    });
    const aiFresh = makeSession("t1", wtClean, "p1", { turn: 0 });
    const aiTurn = makeSession("t2", wtClean, "p1", { turn: 3 });

    expect(classifyWorkerReadiness(wtClean, null)).toBe("dormant");
    expect(classifyWorkerReadiness(wtClean, aiFresh)).toBe("fresh");
    expect(classifyWorkerReadiness(wtDirty, aiFresh)).toBe("continuing");
    expect(classifyWorkerReadiness(wtClean, aiTurn)).toBe("continuing");
    expect(
      classifyWorkerReadiness(wtClean, aiFresh, { display_name: "리뷰 반영" })
    ).toBe("continuing");
    expect(classifyWorkerReadiness(wtMerged, aiTurn)).toBe("fresh");
  });

  it("summarizes project availability counts accurately", () => {
    const p1 = makeProject("p1", "Alpha");
    const wtAi = makeWorktree("C:/repos/p1-ai", "feat/ai");
    const wtEmpty = makeWorktree("C:/repos/p1-empty", "feat/empty");
    const wtRun = makeWorktree("C:/repos/p1-run", "feat/run");
    const wtReady = makeWorktree("C:/repos/p1-ready", "feat/ready");

    const lane: MatrixProjectLane = {
      project: p1,
      cells: [
        { worktree: wtAi, sessions: [makeSession("t1", wtAi, "p1")], topBucket: "idle" },
        { worktree: wtEmpty, sessions: [], topBucket: "idle" },
        { worktree: wtRun, sessions: [makeSession("t2", wtRun, "p1", {}, "running")], topBucket: "running" },
        { worktree: wtReady, sessions: [makeSession("t3", wtReady, "p1", {}, "ready")], topBucket: "ready" },
      ],
    };

    const [summary] = buildDispatchProjectSummaries([lane]);
    expect(summary.idleAiCount).toBe(1);
    expect(summary.emptyWorktreeCount).toBe(1);
    expect(summary.totalAvailableCount).toBe(2);
    expect(summary.runningCount).toBe(1);
    expect(summary.actionableCount).toBe(1);
  });

  it("steps dispatch index circularly forward and backward", () => {
    expect(stepDispatchIndex(0, 3, 1)).toBe(1);
    expect(stepDispatchIndex(2, 3, 1)).toBe(0);
    expect(stepDispatchIndex(0, 3, -1)).toBe(2);
    expect(stepDispatchIndex(0, 0, 1)).toBe(0);
  });

  it("builds a fallback hired worker immediately before matrixLanes updates", () => {
    const p1 = makeProject("p1", "Alpha");
    const w = buildFallbackHiredWorker({
      project: p1,
      worktreePath: "C:/repos/p1-new",
      branchName: "feat/new-hero",
      address: "t-99",
    });
    expect(w.cardKey).toBe("wt::p1::c:/repos/p1-new");
    expect(w.worktree.branch).toBe("feat/new-hero");
    expect(w.tier).toBe(0);
    expect(w.readiness).toBe("fresh");
    expect(w.aiSession?.address).toBe("t-99");

    const dormant = buildFallbackHiredWorker({
      project: p1,
      worktreePath: "C:/repos/p1-empty",
      branchName: "feat/empty",
      address: null,
    });
    expect(dormant.tier).toBe(1);
    expect(dormant.readiness).toBe("dormant");
    expect(dormant.aiSession).toBeNull();
  });

  it("detects folder trust and blocked setup prompts so Yes does not trigger false dispatch", () => {
    const wt = makeWorktree("C:/repos/p1-new", "feat/new");
    const blockedSession = makeSession("t1", wt, "p1", {
      status: { state: "blocked", kind: "permission", msg: "Trust folder?" },
    });
    const idleTrustPreview = makeSession("t2", wt, "p1", {
      status: { state: "idle" },
    });
    const normalIdle = makeSession("t3", wt, "p1", {
      status: { state: "idle" },
    });

    expect(isTrustOrSetupPrompt(blockedSession.terminal, [])).toBe(true);
    expect(
      isTrustOrSetupPrompt(idleTrustPreview.terminal, [
        "Do you trust the files in this folder?",
        "1. Yes, I trust this folder",
      ])
    ).toBe(true);
    expect(
      isTrustOrSetupPrompt(normalIdle.terminal, ["> Ready for your prompt"])
    ).toBe(false);
  });
});
