import { describe, expect, it } from "vitest";
import { computeDashboard, computeSessionDigest } from "../workers/dashboardLogic";
import {
  computeNextSkippedOrder,
  selectZenTopCard,
} from "./zenQueue";
import { cardKeyForSession } from "./worktreeSessions";
import type {
  AckedSessionSnapshot,
  EnrichedSession,
  ProjectConfig,
  TerminalInfo,
  WorktreeInfo,
} from "../types/domain";

const NOW = 10_000_000;

const PROJECT: ProjectConfig = {
  id: "p1",
  name: "jjdr",
  repo_path: "K:/repo/jjdr",
  color: "#818cf8",
  default_branch: "main",
  default_agent: "claude",
  bootstrap: { copy_files: [] },
  group: "Work",
};

function mkWt(branch: string, isMain = false): WorktreeInfo {
  return {
    path: isMain ? "K:/repo/jjdr" : `K:/repo/jjdr-wt-${branch}`,
    head: "abc123",
    branch,
    is_main: isMain,
    is_bare: false,
    is_detached: false,
    is_merged: false,
    dirty_count: 0,
    added_lines: 0,
    deleted_lines: 0,
    changed_files: [],
    overlap_files: [],
  };
}

const WORKTREES: WorktreeInfo[] = [
  mkWt("main", true),
  mkWt("perm"),
  mkWt("err"),
  mkWt("stuck"),
  mkWt("readyA"),
  mkWt("readyB"),
  mkWt("run1"),
  mkWt("idle1"),
];

function mkTerm(partial: Partial<TerminalInfo> & { address: string }): TerminalInfo {
  return {
    name: null,
    labels: {},
    argv: ["claude"],
    cwd: "K:/repo/jjdr",
    state: "live",
    created_ms: NOW - 600_000,
    screen: "exact",
    cols: 120,
    rows: 30,
    turn: 1,
    title: "",
    keep: true,
    status_ms: NOW - 30_000,
    ...partial,
  };
}

function sessionStamp(s: EnrichedSession): string {
  const digest = computeSessionDigest(s.terminal, s.previewLines);
  return `${s.address}:${s.terminal.turn}:${s.terminal.status?.state ?? ""}:${digest}`;
}

/**
 * Stateful headless Zen Mode simulator mirroring ZenModeView + dashboardLogic end-to-end.
 */
class ZenSimulator {
  ackTurns: Record<string, number> = {};
  ackedSnapshots: Record<string, AckedSessionSnapshot> = {};
  dismissedStamps: Record<string, string> = {};
  lockedCardKey: string | null = null;
  skippedKeys: string[] = [];
  clearedCount = 0;

  step(terminals: TerminalInfo[]) {
    for (const t of terminals) {
      if (t.status?.state === "working") {
        delete this.ackedSnapshots[t.address];
      }
    }
    const dash = computeDashboard({
      terminals,
      previews: {},
      projects: [PROJECT],
      worktreesByProject: { p1: WORKTREES },
      ackTurns: this.ackTurns,
      ackedSnapshots: this.ackedSnapshots,
      queuedPrompts: {},
      stuckMinutesThreshold: 5,
      searchQuery: "",
      activeGroup: "All",
      nowMs: NOW,
    });

    const visibleNeeds = dash.byBucket.needs_you.filter(
      (s) => this.dismissedStamps[cardKeyForSession(s)] !== sessionStamp(s)
    );
    const visibleReady = dash.byBucket.ready.filter(
      (s) => this.dismissedStamps[cardKeyForSession(s)] !== sessionStamp(s)
    );

    const sel = selectZenTopCard(
      visibleNeeds,
      visibleReady,
      this.lockedCardKey,
      this.skippedKeys
    );

    if (sel.lockedCardResolved) {
      this.clearedCount += 1;
      this.lockedCardKey = sel.activeCard
        ? cardKeyForSession(sel.activeCard)
        : null;
    } else if (!this.lockedCardKey && sel.activeCard) {
      this.lockedCardKey = cardKeyForSession(sel.activeCard);
    }

    return {
      dash,
      activeCard: sel.activeCard,
      remainingCount: sel.remainingCount,
      lockedCardResolved: sel.lockedCardResolved,
      pool: [...visibleNeeds, ...visibleReady],
    };
  }

  stampCurrent(terminals: TerminalInfo[]) {
    const cur = this.step(terminals);
    if (!cur.activeCard) return cur;
    const key = cardKeyForSession(cur.activeCard);
    const digest = computeSessionDigest(
      cur.activeCard.terminal,
      cur.activeCard.previewLines
    );
    if (cur.activeCard.terminal.turn > 0) {
      this.ackTurns[cur.activeCard.address] = cur.activeCard.terminal.turn;
    }
    this.ackedSnapshots[cur.activeCard.address] = {
      turn: cur.activeCard.terminal.turn,
      digest,
    };
    this.dismissedStamps[key] = sessionStamp(cur.activeCard);
    this.clearedCount += 1;
    this.lockedCardKey = null;
    return this.step(terminals);
  }

  manualSkip(terminals: TerminalInfo[]) {
    const cur = this.step(terminals);
    if (!cur.activeCard) return cur;
    const key = cardKeyForSession(cur.activeCard);
    const { nextKey, nextSkippedKeys } = computeNextSkippedOrder(
      cur.pool,
      key,
      this.skippedKeys
    );
    this.skippedKeys = nextSkippedKeys;
    this.lockedCardKey = nextKey;
    return this.step(terminals);
  }

  /** Simulates navigating to Radar/Queue and coming back (ZenModeView unmount -> remount) */
  leaveAndReturnToZen(terminals: TerminalInfo[]) {
    this.lockedCardKey = null;
    this.skippedKeys = [];
    // Note: ackTurns & dismissedStamps survive in global stores!
    return this.step(terminals);
  }
}

describe("Zen Mode multi-priority simulation suite", () => {
  it("Scenario 1: strictly orders permission > error > ready, keeps long-working cards in running, and drains cleanly to All Clear", () => {
    const sim = new ZenSimulator();
    const terminals = [
      mkTerm({ address: "t-idle", cwd: "K:/repo/jjdr-wt-idle1", status: { state: "idle" }, turn: 0 }),
      mkTerm({ address: "t-run", cwd: "K:/repo/jjdr-wt-run1", status: { state: "working" }, status_ms: NOW - 60_000 }),
      mkTerm({ address: "t-ready", cwd: "K:/repo/jjdr-wt-readyA", status: { state: "done" }, turn: 2 }),
      mkTerm({ address: "t-stuck", cwd: "K:/repo/jjdr-wt-stuck", status: { state: "working" }, status_ms: NOW - 7 * 60_000 }),
      mkTerm({ address: "t-err", cwd: "K:/repo/jjdr-wt-err", status: { state: "error", msg: "API 500" } }),
      mkTerm({ address: "t-perm", cwd: "K:/repo/jjdr-wt-perm", status: { state: "blocked", kind: "permission", msg: "Allow bash?" } }),
    ];

    const s1 = sim.step(terminals);
    expect(s1.activeCard?.branch).toBe("perm");
    expect(s1.remainingCount).toBe(2);

    const s2 = sim.stampCurrent(terminals);
    expect(s2.activeCard?.branch).toBe("err");

    const s3 = sim.stampCurrent(terminals);
    expect(s3.activeCard?.branch).toBe("readyA");

    const s4 = sim.stampCurrent(terminals);
    expect(s4.activeCard).toBeNull();
    // Both normal working and long-running (>5m) working stay in `running`
    expect(s4.dash.byBucket.running.map((r) => r.branch).sort()).toEqual(["run1", "stuck"]);
    expect(sim.clearedCount).toBe(3);
  });

  it("Scenario 2: Sticky Lock prevents higher-priority background arrivals from interrupting active card", () => {
    const sim = new ZenSimulator();
    const readyA = mkTerm({ address: "t-a", cwd: "K:/repo/jjdr-wt-readyA", status: { state: "done" }, turn: 1 });
    const idlePerm = mkTerm({ address: "t-perm", cwd: "K:/repo/jjdr-wt-perm", status: { state: "working" }, status_ms: NOW - 10_000 });
    const idleErr = mkTerm({ address: "t-err", cwd: "K:/repo/jjdr-wt-err", status: { state: "working" }, status_ms: NOW - 10_000 });

    // Start viewing readyA
    const initial = sim.step([readyA, idlePerm, idleErr]);
    expect(initial.activeCard?.branch).toBe("readyA");

    // Suddenly both perm (permission!) and err (error!) fire in background!
    const urgentPerm = { ...idlePerm, status: { state: "blocked", kind: "permission", msg: "Run rm?" } };
    const urgentErr = { ...idleErr, status: { state: "error", msg: "Crash" } };

    const interrupted = sim.step([readyA, urgentPerm, urgentErr]);
    // Sticky Lock MUST hold readyA undisturbed!
    expect(interrupted.activeCard?.branch).toBe("readyA");
    expect(interrupted.remainingCount).toBe(2);

    // Once user resolves readyA, the highest priority (perm > err) rises immediately!
    const afterResolve = sim.stampCurrent([readyA, urgentPerm, urgentErr]);
    expect(afterResolve.activeCard?.branch).toBe("perm");
  });

  it("Scenario 3: typing in right terminal transitions active card to working -> auto-advances to next card", () => {
    const sim = new ZenSimulator();
    const readyA = mkTerm({ address: "t-a", cwd: "K:/repo/jjdr-wt-readyA", status: { state: "done" }, turn: 2 });
    const readyB = mkTerm({ address: "t-b", cwd: "K:/repo/jjdr-wt-readyB", status: { state: "done" }, turn: 1 });

    expect(sim.step([readyA, readyB]).activeCard?.branch).toBe("readyA");

    // User sends prompt in right terminal -> herdr-core flips readyA to working!
    const workingA = { ...readyA, status: { state: "working" }, status_ms: NOW - 1_000 };
    const next = sim.step([workingA, readyB]);
    expect(next.lockedCardResolved).toBe(true);
    expect(next.activeCard?.branch).toBe("readyB");
    expect(sim.clearedCount).toBe(1);
  });

  it("Scenario 4: stamped Ready card NEVER resurrects after Radar roundtrip, but wakes up on a NEW turn (including turn=0 edge case)", () => {
    const sim = new ZenSimulator();
    // Case A: normal turn=2 done (more recent)
    const readyTurn2 = mkTerm({ address: "t-a", cwd: "K:/repo/jjdr-wt-readyA", status: { state: "done" }, turn: 2, status_ms: NOW - 2_000 });
    // Case B: edge case turn=0 done
    const readyTurn0 = mkTerm({ address: "t-b", cwd: "K:/repo/jjdr-wt-readyB", status: { state: "done" }, turn: 0, status_ms: NOW - 5_000 });

    expect(sim.step([readyTurn2, readyTurn0]).activeCard?.branch).toBe("readyA");
    sim.stampCurrent([readyTurn2, readyTurn0]); // clear readyA
    const afterBoth = sim.stampCurrent([readyTurn2, readyTurn0]); // clear readyB
    expect(afterBoth.activeCard).toBeNull();

    // User visits Radar and returns to Zen -> NEITHER card may resurrect!
    const returned = sim.leaveAndReturnToZen([readyTurn2, readyTurn0]);
    expect(returned.activeCard).toBeNull();

    // Later, readyTurn0 completes its first real turn (turn=1) -> MUST wake up!
    const wokeB = { ...readyTurn0, turn: 1, status_ms: NOW };
    const afterWakeB = sim.step([readyTurn2, wokeB]);
    expect(afterWakeB.activeCard?.branch).toBe("readyB");

    // And readyTurn2 completes turn=3 -> rises after readyB is resolved!
    const wokeA = { ...readyTurn2, turn: 3, status_ms: NOW };
    sim.stampCurrent([wokeA, wokeB]);
    expect(sim.step([wokeA, wokeB]).activeCard?.branch).toBe("readyA");
  });

  it("Scenario 5: manual skip (Ctrl+N / Lever / Dial) prioritizes newly arrived urgent card over unskipped lower card, and wraps cleanly", () => {
    const sim = new ZenSimulator();
    const a = mkTerm({ address: "t-a", cwd: "K:/repo/jjdr-wt-readyA", status: { state: "done" }, turn: 1, status_ms: NOW - 10_000 });
    const b = mkTerm({ address: "t-b", cwd: "K:/repo/jjdr-wt-readyB", status: { state: "done" }, turn: 1, status_ms: NOW - 20_000 });
    const err = mkTerm({ address: "t-e", cwd: "K:/repo/jjdr-wt-err", status: { state: "error", msg: "API fail" }, status_ms: NOW - 8 * 60_000 });

    // Order: err -> readyA -> readyB
    expect(sim.step([a, b, err]).activeCard?.branch).toBe("err");

    // Skip 1: err -> readyA
    expect(sim.manualSkip([a, b, err]).activeCard?.branch).toBe("readyA");

    // New urgent permission card arrives while on readyA (Sticky Lock keeps readyA)
    const perm = mkTerm({ address: "t-p", cwd: "K:/repo/jjdr-wt-perm", status: { state: "blocked", kind: "permission" } });
    expect(sim.step([a, b, err, perm]).activeCard?.branch).toBe("readyA");

    // Skip 2: readyA -> newly arrived perm (higher priority than readyB!)
    expect(sim.manualSkip([a, b, err, perm]).activeCard?.branch).toBe("perm");

    // Skip 3: perm -> readyB
    expect(sim.manualSkip([a, b, err, perm]).activeCard?.branch).toBe("readyB");

    // Skip 4: full cycle wraps back cleanly (does not get stuck)
    const wrapped = sim.manualSkip([a, b, err, perm]);
    expect(wrapped.activeCard?.branch).toBe("perm"); // top priority in fresh cycle
  });

  it("Scenario 6: ignores plain PowerShell done/turn prompts, finished failed terminals, and C:\\Windows\\System32 orphans", () => {
    const sim = new ZenSimulator();
    const terminals = [
      mkTerm({ address: "t-pwsh", cwd: "K:/repo/jjdr-wt-readyA", argv: [], labels: { "jjdr.agent": "shell" }, status: { state: "done" }, turn: 9 }),
      mkTerm({ address: "t-dead", cwd: "K:/repo/jjdr-wt-err", state: "finished", exit_code: 1 }),
      mkTerm({ address: "t-sys", cwd: "C:\\Windows\\System32", state: "live", status: { state: "error" } }),
      mkTerm({ address: "t-idle", cwd: "K:/repo/jjdr-wt-idle1", status: { state: "idle" }, turn: 0 }),
    ];

    const res = sim.step(terminals);
    expect(res.activeCard).toBeNull();
    expect(res.dash.byBucket.needs_you).toHaveLength(0);
    expect(res.dash.byBucket.ready).toHaveLength(0);
    expect(res.dash.byBucket.idle).toHaveLength(2); // pwsh + idle1
  });

  it("Scenario 7: All Clear auto-wakes when a background Running AI finishes its task", () => {
    const sim = new ZenSimulator();
    const run1 = mkTerm({ address: "t-r1", cwd: "K:/repo/jjdr-wt-run1", status: { state: "working", progress: 70 }, status_ms: NOW - 90_000, turn: 1 });

    // All Clear while run1 is working
    const clearState = sim.step([run1]);
    expect(clearState.activeCard).toBeNull();
    expect(clearState.dash.byBucket.running).toHaveLength(1);

    // run1 finishes turn 2 -> Zen automatically wakes up with run1 card!
    const doneRun1 = { ...run1, status: { state: "done", msg: "Build green!" }, turn: 2, status_ms: NOW };
    const woke = sim.step([doneRun1]);
    expect(woke.activeCard?.branch).toBe("run1");
    expect(woke.activeCard?.bucket).toBe("ready");
  });

  it("Scenario 8: single remaining card stays stable on repeated Ctrl+N / lever pulls without crashing", () => {
    const sim = new ZenSimulator();
    const only = mkTerm({ address: "t-only", cwd: "K:/repo/jjdr-wt-readyA", status: { state: "done" }, turn: 1 });

    expect(sim.step([only]).activeCard?.branch).toBe("readyA");
    expect(sim.manualSkip([only]).activeCard?.branch).toBe("readyA");
    expect(sim.manualSkip([only]).activeCard?.branch).toBe("readyA");
    expect(sim.step([only]).remainingCount).toBe(0);
  });

  it("Scenario 9: worktree with multiple AI sessions surfaces the second ready AI session after first is cleared", () => {
    const sim = new ZenSimulator();
    const ai1 = mkTerm({ address: "t-ai1", cwd: "K:/repo/jjdr-wt-readyA", argv: ["claude"], status: { state: "done" }, turn: 2, status_ms: NOW - 5_000 });
    const ai2 = mkTerm({ address: "t-ai2", cwd: "K:/repo/jjdr-wt-readyA", argv: ["gemini"], status: { state: "done" }, turn: 1, status_ms: NOW - 20_000 });

    const s1 = sim.step([ai1, ai2]);
    expect(s1.activeCard?.address).toBe("t-ai1");
    expect(s1.activeCard?.worktreeSessionCount).toBe(2);

    // Stamp ai1 done -> ai2 is still unacked in the same worktree, so it surfaces cleanly!
    const s2 = sim.stampCurrent([ai1, ai2]);
    expect(s2.activeCard?.address).toBe("t-ai2");

    // Stamp ai2 done -> now truly All Clear!
    const s3 = sim.stampCurrent([ai1, ai2]);
    expect(s3.activeCard).toBeNull();
  });

  it("Scenario 10: last card with turn=0 and drifting status_ms NEVER resurrects after stamping done", () => {
    const sim = new ZenSimulator();
    const agyLast = mkTerm({
      address: "t-agy",
      cwd: "K:/repo/jjdr-wt-readyA",
      argv: ["agy"],
      status: { state: "done", msg: "형님, 안녕하세요! 반가워요!" },
      turn: 0,
      status_ms: NOW - 15_000,
    });

    expect(sim.step([agyLast]).activeCard?.branch).toBe("readyA");

    // Stamp last card done -> immediately All Clear
    const afterStamp = sim.stampCurrent([agyLast]);
    expect(afterStamp.activeCard).toBeNull();
    expect(afterStamp.dash.byBucket.ready).toHaveLength(0);
    expect(afterStamp.dash.byBucket.idle).toHaveLength(1);

    // Periodic herdr-core sync updates status_ms repeatedly while still done with same message
    const drifted = { ...agyLast, status_ms: NOW + 3_500 };
    expect(sim.step([drifted]).activeCard).toBeNull();
    expect(sim.leaveAndReturnToZen([drifted]).activeCard).toBeNull();

    // Only when the AI actually runs a new task (working -> new done msg) does it wake back up!
    const working = { ...drifted, status: { state: "working" }, status_ms: NOW + 5_000 };
    expect(sim.step([working]).activeCard).toBeNull();
    const newDone = { ...working, status: { state: "done", msg: "새 작업 완료!" }, status_ms: NOW + 9_000 };
    expect(sim.step([newDone]).activeCard?.branch).toBe("readyA");
  });
});
