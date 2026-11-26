import { describe, expect, it } from "vitest";
import {
  computeDashboard,
  computeSessionDigest,
  isPermissionApprovalPending,
} from "../workers/dashboardLogic";
import {
  computeRunningProgressVisual,
  selectZenTopCard,
} from "./zenQueue";
import { buildProjectDispatchDeck } from "./zenDispatch";
import {
  buildBgOverlayPayload,
  selectTopBgOverlayCandidate,
} from "./bgOverlay";
import { cardKeyForSession } from "./worktreeSessions";
import type {
  AckedSessionSnapshot,
  ProjectConfig,
  StatusInfo,
  TerminalInfo,
  WorktreeInfo,
} from "../types/domain";

const NOW = 50_000_000;

const PROJECT: ProjectConfig = {
  id: "proj-corp",
  name: "corp-api",
  repo_path: "K:/work/corp-api",
  color: "#34d399",
  default_branch: "main",
  default_agent: "gemini",
  bootstrap: { copy_files: [] },
  group: "Company",
};

function mkWt(branch: string, isMain = false): WorktreeInfo {
  return {
    path: isMain ? "K:/work/corp-api" : `K:/work/corp-api-wt-${branch}`,
    head: "def456",
    branch,
    is_main: isMain,
    is_bare: false,
    is_detached: false,
    is_merged: false,
    dirty_count: 1,
    added_lines: 12,
    deleted_lines: 3,
    changed_files: ["src/service.ts"],
    overlap_files: [],
  };
}

const WORKTREES: WorktreeInfo[] = [
  mkWt("main", true),
  mkWt("feat-auth"),
  mkWt("feat-cache"),
];

function mkGeminiTerminal(
  partial: Partial<TerminalInfo> & { address: string }
): TerminalInfo {
  const cwd = partial.cwd ?? "K:/work/corp-api-wt-feat-auth";
  return {
    name: `corp-api-${partial.address}`,
    labels: {
      "jjdr.project": PROJECT.id,
      "jjdr.worktree": cwd.toLowerCase(),
      "jjdr.agent": "gemini",
      "jjdr.gemini_tag": `tag-${partial.address}`,
    },
    argv: ["gemini", "-y"],
    cwd,
    state: "live",
    created_ms: NOW - 300_000,
    screen: "exact",
    cols: 120,
    rows: 36,
    status: null,
    status_ms: NOW - 60_000,
    turn: 0,
    title: "",
    keep: true,
    ...partial,
  };
}

function runDashboard(
  terminals: TerminalInfo[],
  opts?: {
    ackTurns?: Record<string, number>;
    ackedSnapshots?: Record<string, AckedSessionSnapshot>;
    nowMs?: number;
  }
) {
  return computeDashboard({
    terminals,
    previews: {},
    projects: [PROJECT],
    worktreesByProject: { [PROJECT.id]: WORKTREES },
    ackTurns: opts?.ackTurns ?? {},
    ackedSnapshots: opts?.ackedSnapshots ?? {},
    queuedPrompts: {},
    activeGroup: "All",
    searchQuery: "",
    stuckMinutesThreshold: 20,
    nowMs: opts?.nowMs ?? NOW,
  });
}

describe("Gemini CLI Bridge Virtual E2E Scenarios", () => {
  it("SCENARIO 1: Full single-turn lifecycle across Radar, Queue, Zen Inbox, Approve CTA, and BG HUD", () => {
    const ackTurns: Record<string, number> = {};
    const ackedSnapshots: Record<string, AckedSessionSnapshot> = {};

    // Phase 0: Newly spawned Gemini (no bridge event yet -> idle)
    const t0 = mkGeminiTerminal({ address: "gem-1" });
    const d0 = runDashboard([t0]);
    expect(d0.counts).toEqual({
      needsYou: 0,
      ready: 0,
      running: 0,
      idle: 1,
      total: 1,
    });
    expect(selectZenTopCard(d0.byBucket.needs_you, d0.byBucket.ready, null, []).activeCard).toBeNull();
    expect(selectTopBgOverlayCandidate(d0.allSessions).top).toBeNull();

    // Phase 1: BeforeAgent -> working (Running bucket, visible in Zen Chill running list)
    const t1: TerminalInfo = {
      ...t0,
      status: { state: "working", app: "gemini", msg: "Thinking..." },
      status_ms: NOW - 180_000,
    };
    const d1 = runDashboard([t1]);
    expect(d1.counts.running).toBe(1);
    expect(d1.byBucket.running[0].address).toBe("gem-1");
    expect(isPermissionApprovalPending(t1)).toBe(false);
    expect(selectTopBgOverlayCandidate(d1.allSessions).top).toBeNull();

    // Verify Zen Chill timed progress visual advances for 3m elapsed Gemini task
    const prog = computeRunningProgressVisual(d1.byBucket.running[0].elapsedMs);
    expect(prog.percent).toBeGreaterThan(25);
    expect(prog.stage).toBe("steady");

    // Phase 2: Notification(ToolPermission) -> blocked(permission)
    // Must appear in Needs You, enable Approve button, top Zen Inbox, AND trigger BG Overlay HUD!
    const t2: TerminalInfo = {
      ...t1,
      status: {
        state: "blocked",
        app: "gemini",
        kind: "permission",
        msg: "Allow execution of: npm test?",
      },
      status_ms: NOW - 5_000,
    };
    const d2 = runDashboard([t2]);
    expect(d2.counts.needsYou).toBe(1);
    expect(isPermissionApprovalPending(t2)).toBe(true);

    const zenTopBlocked = selectZenTopCard(d2.byBucket.needs_you, d2.byBucket.ready, null, []).activeCard;
    expect(zenTopBlocked?.address).toBe("gem-1");
    expect(zenTopBlocked?.bucket).toBe("needs_you");

    const hudSel = selectTopBgOverlayCandidate(d2.allSessions);
    expect(hudSel.top?.address).toBe("gem-1");
    expect(hudSel.pendingCount).toBe(1);
    const hudPayload = buildBgOverlayPayload(hudSel.top!, hudSel.pendingCount, "bottom_right", "aurora", false, {});
    expect(hudPayload.is_approval).toBe(true);
    expect(hudPayload.message).toContain("npm test");

    // Phase 3: User clicks Approve (Enter) -> Rust bridge immediately releases blocked -> working!
    const t3: TerminalInfo = {
      ...t2,
      status: {
        state: "working",
        app: "gemini",
        kind: null,
        msg: "Resuming after approval...",
      },
      status_ms: NOW - 2_000,
    };
    const d3 = runDashboard([t3]);
    expect(d3.counts.needsYou).toBe(0);
    expect(d3.counts.running).toBe(1);
    expect(isPermissionApprovalPending(t3)).toBe(false);
    expect(selectZenTopCard(d3.byBucket.needs_you, d3.byBucket.ready, null, []).activeCard).toBeNull();
    expect(selectTopBgOverlayCandidate(d3.allSessions).top).toBeNull();

    // Phase 4: AfterAgent -> done + turn=1 (Ready bucket, Zen Inbox card, BG HUD ready notice)
    const t4: TerminalInfo = {
      ...t3,
      status: {
        state: "done",
        app: "gemini",
        kind: null,
        msg: "Implemented JWT refresh and added 6 tests.",
      },
      status_ms: NOW,
      turn: 1,
    };
    const d4 = runDashboard([t4]);
    expect(d4.counts.ready).toBe(1);
    expect(d4.byBucket.ready[0].unackedDone).toBe(true);
    expect(isPermissionApprovalPending(t4)).toBe(false);

    const zenTopReady = selectZenTopCard(d4.byBucket.needs_you, d4.byBucket.ready, null, []).activeCard;
    expect(zenTopReady?.address).toBe("gem-1");
    expect(zenTopReady?.bucket).toBe("ready");

    // Phase 5: Boss stamps CLEARED (ack turn=1) -> transitions cleanly to Idle & Zen All Clear!
    ackTurns["gem-1"] = 1;
    ackedSnapshots["gem-1"] = {
      turn: 1,
      digest: computeSessionDigest(t4, []),
    };
    const d5 = runDashboard([t4], { ackTurns, ackedSnapshots });
    expect(d5.counts.ready).toBe(0);
    expect(d5.counts.idle).toBe(1);
    expect(selectZenTopCard(d5.byBucket.needs_you, d5.byBucket.ready, null, []).activeCard).toBeNull();
  });

  it("SCENARIO 2: Multi-turn re-entry after previous turn was acknowledged", () => {
    const ackTurns: Record<string, number> = { "gem-1": 1 };
    const ackedSnapshots: Record<string, AckedSessionSnapshot> = {
      "gem-1": { turn: 1, digest: "Turn 1 finished." },
    };

    // Turn 2 starts -> working
    const tWorking = mkGeminiTerminal({
      address: "gem-1",
      turn: 1,
      status: { state: "working", app: "gemini", msg: "Thinking..." },
    });
    const dWork = runDashboard([tWorking], { ackTurns, ackedSnapshots });
    expect(dWork.counts.running).toBe(1);

    // Turn 2 finishes -> bridge increments synthetic_turn to 2 -> MUST resurface in Ready & Zen Inbox!
    const tDone2 = mkGeminiTerminal({
      address: "gem-1",
      turn: 2,
      status: { state: "done", app: "gemini", msg: "Turn 2 refactored cleanly." },
    });
    const dDone2 = runDashboard([tDone2], { ackTurns, ackedSnapshots });
    expect(dDone2.counts.ready).toBe(1);
    expect(dDone2.byBucket.ready[0].unackedDone).toBe(true);
    expect(selectZenTopCard(dDone2.byBucket.needs_you, dDone2.byBucket.ready, null, []).activeCard?.address).toBe("gem-1");
  });

  it("SCENARIO 3: Dual Gemini + PowerShell in same worktree obeys strict priority and never promotes Shell to Ready", () => {
    const sharedCwd = "K:/work/corp-api-wt-feat-auth";
    const gemPerm = mkGeminiTerminal({
      address: "gem-perm",
      cwd: sharedCwd,
      status: { state: "blocked", app: "gemini", kind: "permission", msg: "Allow edit?" },
    });
    const gemRun = mkGeminiTerminal({
      address: "gem-run",
      cwd: sharedCwd,
      status: { state: "working", app: "gemini", msg: "Thinking..." },
    });
    const shell: TerminalInfo = {
      address: "pwsh-1",
      name: "shell-1",
      labels: {
        "jjdr.project": PROJECT.id,
        "jjdr.worktree": sharedCwd.toLowerCase(),
        "jjdr.agent": "shell",
      },
      argv: ["pwsh"],
      cwd: sharedCwd,
      state: "live",
      created_ms: NOW - 100_000,
      screen: "exact",
      cols: 120,
      rows: 30,
      status: { state: "done", app: "pwsh", msg: "PS>" },
      status_ms: NOW,
      turn: 5,
      title: "PowerShell",
      keep: true,
    };

    const d = runDashboard([gemPerm, gemRun, shell]);
    // Queue deduplicates by worktree card -> top session on the card is gem-perm (needs_you)
    expect(d.byBucket.needs_you).toHaveLength(1);
    expect(d.byBucket.needs_you[0].address).toBe("gem-perm");
    expect(d.byBucket.needs_you[0].worktreeSessionCount).toBe(3);

    // Even if both Geminis are idle, the PowerShell tab with turn=5 must stay idle (never false Ready!)
    const dIdleOnly = runDashboard([shell]);
    expect(dIdleOnly.counts.ready).toBe(0);
    expect(dIdleOnly.counts.idle).toBe(1);
  });

  it("SCENARIO 4: Zen Dispatch lists idle Gemini worker and tracks deployment when BeforeAgent arrives", () => {
    const idleGem = mkGeminiTerminal({
      address: "gem-idle",
      cwd: "K:/work/corp-api-wt-feat-cache",
      status: { state: "idle", app: "gemini", msg: "Ready for prompt" },
      turn: 1,
    });
    const dIdle = runDashboard([idleGem], { ackTurns: { "gem-idle": 1 } });
    const deck = buildProjectDispatchDeck(dIdle.matrixLanes[0]);
    const cacheWorker = deck.find((w) => w.worktree.branch === "feat-cache");
    expect(cacheWorker).toBeDefined();
    expect(cacheWorker?.aiSession?.address).toBe("gem-idle");
    expect(cacheWorker?.readiness).toBe("continuing");

    // User types prompt & presses Enter -> BeforeAgent flips status to working
    const workingGem: TerminalInfo = {
      ...idleGem,
      status: { state: "working", app: "gemini", msg: "Thinking..." },
    };
    const dWorking = runDashboard([workingGem], { ackTurns: { "gem-idle": 1 } });
    const deckAfter = buildProjectDispatchDeck(dWorking.matrixLanes[0]);
    // Once working, worker is actively deployed and leaves the idle dispatch deck
    expect(deckAfter.find((w) => w.worktree.branch === "feat-cache")).toBeUndefined();
    expect(dWorking.byBucket.running[0].address).toBe("gem-idle");
  });

  it("SCENARIO 5: Claude vs Gemini 100% behavioral parity across every status state", () => {
    const states: Array<{ status: StatusInfo; turn: number }> = [
      { status: { state: "working", msg: "Thinking..." }, turn: 0 },
      { status: { state: "blocked", kind: "permission", msg: "Allow?" }, turn: 0 },
      { status: { state: "blocked", kind: "question", msg: "Choose option" }, turn: 0 },
      { status: { state: "done", msg: "All complete." }, turn: 1 },
      { status: { state: "error", msg: "API Error 500" }, turn: 0 },
    ];

    for (const sample of states) {
      const claudeTerm: TerminalInfo = {
        ...mkGeminiTerminal({
          address: "c-1",
          cwd: "K:/work/corp-api-wt-feat-auth",
        }),
        argv: ["claude", "--dangerously-skip-permissions"],
        labels: {
          "jjdr.project": PROJECT.id,
          "jjdr.worktree": "k:/work/corp-api-wt-feat-auth",
          "jjdr.agent": "claude",
        },
        status: { ...sample.status, app: "claude" },
        turn: sample.turn,
      };
      const geminiTerm = mkGeminiTerminal({
        address: "g-1",
        cwd: "K:/work/corp-api-wt-feat-cache",
        status: { ...sample.status, app: "gemini" },
        turn: sample.turn,
      });

      const dc = runDashboard([claudeTerm]);
      const dg = runDashboard([geminiTerm]);

      expect(dg.allSessions[0].bucket).toBe(dc.allSessions[0].bucket);
      expect(dg.allSessions[0].unackedDone).toBe(dc.allSessions[0].unackedDone);
      expect(isPermissionApprovalPending(geminiTerm)).toBe(
        isPermissionApprovalPending(claudeTerm)
      );
      expect(Boolean(selectTopBgOverlayCandidate(dg.allSessions).top)).toBe(
        Boolean(selectTopBgOverlayCandidate(dc.allSessions).top)
      );
    }
  });

  it("SCENARIO 6: API/Quota error surfaces in Needs You WITHOUT showing a false Approve button", () => {
    const errGem = mkGeminiTerminal({
      address: "gem-err",
      status: {
        state: "error",
        app: "gemini",
        kind: null,
        msg: "Error: 429 Too Many Requests - Quota exceeded",
      },
    });
    const d = runDashboard([errGem]);
    expect(d.counts.needsYou).toBe(1);
    expect(isPermissionApprovalPending(errGem)).toBe(false);
    expect(cardKeyForSession(d.byBucket.needs_you[0])).toBeTruthy();

    const hudSel = selectTopBgOverlayCandidate(d.allSessions);
    expect(hudSel.top?.address).toBe("gem-err");
    const payload = buildBgOverlayPayload(hudSel.top!, hudSel.pendingCount, "top_center", "nordic", false, {});
    expect(payload.is_approval).toBe(false);
  });

  it("DESPAIR 1: Null/empty permission message still shows Approve CTA and safe HUD fallback", () => {
    const permNoMsg = mkGeminiTerminal({
      address: "gem-empty-perm",
      status: {
        state: "blocked",
        app: "gemini",
        kind: "permission",
        msg: null,
      },
    });
    const d = runDashboard([permNoMsg]);
    expect(d.counts.needsYou).toBe(1);
    expect(isPermissionApprovalPending(permNoMsg)).toBe(true);
    const hud = selectTopBgOverlayCandidate(d.allSessions);
    expect(hud.top?.address).toBe("gem-empty-perm");
    const payload = buildBgOverlayPayload(hud.top!, hud.pendingCount, "bottom_right", "lounge", false, {});
    expect(payload.is_approval).toBe(true);
    expect(payload.message.length).toBeGreaterThan(0);
  });

  it("DESPAIR 2: 45-minute Stuck working Gemini stays in running (never intrudes Zen Inbox or HUD) & caps progress <= 95%", () => {
    const stuckGem = mkGeminiTerminal({
      address: "gem-stuck",
      status: { state: "working", app: "gemini", msg: "Deep analysis..." },
      status_ms: NOW - 45 * 60_000,
    });
    const d = runDashboard([stuckGem]);
    expect(d.counts.running).toBe(1);
    expect(d.counts.needsYou).toBe(0);
    expect(d.byBucket.running[0].isStuck).toBe(true);
    expect(d.byBucket.running[0].stuckMinutes).toBe(45);
    expect(selectZenTopCard(d.byBucket.needs_you, d.byBucket.ready, null, []).activeCard).toBeNull();
    expect(selectTopBgOverlayCandidate(d.allSessions).top).toBeNull();

    const prog = computeRunningProgressVisual(d.byBucket.running[0].elapsedMs);
    expect(prog.stage).toBe("long");
    expect(prog.percent).toBeLessThanOrEqual(95);
    expect(prog.percent).toBeGreaterThanOrEqual(85);
  });

  it("DESPAIR 3: Mid-work process crash (exit_code=137) surfaces cleanly without false Approve button", () => {
    const crashedGem = mkGeminiTerminal({
      address: "gem-crash",
      state: "finished",
      exit_code: 137,
      finished_ms: NOW - 1_000,
      status: null,
    });
    const d = runDashboard([crashedGem]);
    // Dashboard filters finished sessions out of active live buckets, and permission check is strictly false
    expect(isPermissionApprovalPending(crashedGem)).toBe(false);
    expect(selectTopBgOverlayCandidate(d.allSessions).top).toBeNull();
  });

  it("DESPAIR 4: Corrupted/future timestamps, negative turns, and unknown states never produce NaN or throw", () => {
    const weirdGem = mkGeminiTerminal({
      address: "gem-weird",
      status: { state: "weird_future_state", app: "gemini", msg: "" },
      status_ms: NOW + 999_999,
      turn: -5,
    });
    const d = runDashboard([weirdGem]);
    expect(d.counts.total).toBe(1);
    expect(d.allSessions[0].elapsedMs).toBe(0);
    expect(Number.isNaN(d.allSessions[0].priorityScore)).toBe(false);

    const progNeg = computeRunningProgressVisual(-50_000);
    expect(Number.isNaN(progNeg.percent)).toBe(false);
    expect(progNeg.percent).toBeGreaterThanOrEqual(0);
  });

  it("DESPAIR 5: Stress test — 100 concurrent Gemini sessions across 50 worktrees compute in < 100ms", () => {
    const manyWorktrees: WorktreeInfo[] = [mkWt("main", true)];
    const manyTerms: TerminalInfo[] = [];
    const states: Array<StatusInfo | null> = [
      { state: "working", app: "gemini", msg: "Thinking..." },
      { state: "blocked", app: "gemini", kind: "permission", msg: "Allow?" },
      { state: "done", app: "gemini", msg: "Done!" },
      { state: "idle", app: "gemini", msg: "Idle" },
      { state: "error", app: "gemini", msg: "429" },
    ];
    for (let i = 0; i < 49; i++) {
      const wt = mkWt(`wt-${i}`);
      manyWorktrees.push(wt);
      for (let j = 0; j < 2; j++) {
        const idx = i * 2 + j;
        manyTerms.push(
          mkGeminiTerminal({
            address: `gem-stress-${idx}`,
            cwd: wt.path,
            status: states[idx % states.length],
            turn: states[idx % states.length]?.state === "done" ? 1 : 0,
            status_ms: NOW - idx * 1000,
          })
        );
      }
    }

    const t0 = performance.now();
    const res = computeDashboard({
      terminals: manyTerms,
      previews: {},
      projects: [PROJECT],
      worktreesByProject: { [PROJECT.id]: manyWorktrees },
      ackTurns: {},
      ackedSnapshots: {},
      queuedPrompts: {},
      activeGroup: "All",
      searchQuery: "",
      stuckMinutesThreshold: 20,
      nowMs: NOW,
    });
    const topZen = selectZenTopCard(res.byBucket.needs_you, res.byBucket.ready, null, []);
    const topHud = selectTopBgOverlayCandidate(res.allSessions);
    const dt = performance.now() - t0;

    expect(res.allSessions.length).toBe(98);
    expect(topZen.activeCard).not.toBeNull();
    expect(topHud.top).not.toBeNull();
    expect(dt).toBeLessThan(100);
  });
});
