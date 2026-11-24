import { describe, expect, it } from "vitest";
import {
  classifyBucket,
  computeDashboard,
  isPermissionApprovalPending,
  isPlainShellTerminal,
  isSystemPath,
} from "./dashboardLogic";
import type { ProjectConfig, TerminalInfo, WorktreeInfo } from "../types/domain";

function makeTerminal(partial: Partial<TerminalInfo>): TerminalInfo {
  return {
    address: "t1",
    name: null,
    labels: {},
    argv: ["claude"],
    cwd: "K:/repo/app-wt-auth",
    state: "live",
    created_ms: 1_000_000,
    screen: "exact",
    cols: 120,
    rows: 30,
    turn: 0,
    title: "",
    keep: true,
    ...partial,
  };
}

describe("dashboardLogic", () => {
  it("prioritizes blocked, stuck, ready, running, and idle accurately", () => {
    const now = 2_000_000;
    const blocked = makeTerminal({
      address: "t1",
      status: { state: "blocked", kind: "permission", msg: "Approve edit?" },
      status_ms: now - 5_000,
    });
    const stuck = makeTerminal({
      address: "t2",
      status: { state: "working" },
      status_ms: now - 6 * 60_000,
    });
    const ready = makeTerminal({
      address: "t3",
      status: { state: "done" },
      turn: 2,
      status_ms: now - 2_000,
    });
    const running = makeTerminal({
      address: "t4",
      status: { state: "working", progress: 50 },
      status_ms: now - 30_000,
    });
    const idle = makeTerminal({
      address: "t5",
      status: { state: "idle" },
      turn: 1,
      status_ms: now - 10_000,
    });

    expect(classifyBucket(blocked, 0, 5, now).bucket).toBe("needs_you");
    expect(classifyBucket(stuck, 0, 5, now).isStuck).toBe(true);
    expect(classifyBucket(stuck, 0, 5, now).bucket).toBe("needs_you");
    expect(classifyBucket(ready, 1, 5, now).bucket).toBe("ready");
    // Once acknowledged at turn 2, even persistent status="done" transitions cleanly to idle
    expect(classifyBucket(ready, 2, 5, now).bucket).toBe("idle");
    expect(classifyBucket(running, 0, 5, now).bucket).toBe("running");
    expect(classifyBucket(idle, 1, 5, now).bucket).toBe("idle");
  });

  it("rehydrates external sessions without jjdr labels by longest CWD match", () => {
    const projects: ProjectConfig[] = [
      {
        id: "p1",
        name: "jjdr",
        repo_path: "K:\\repo\\jjdr",
        color: "#58a6ff",
        default_branch: "main",
        default_agent: "claude",
        bootstrap: { copy_files: [] },
        group: "Work",
      },
    ];
    const worktreesByProject: Record<string, WorktreeInfo[]> = {
      p1: [
        {
          path: "K:/repo/jjdr",
          head: "aaa",
          branch: "main",
          is_main: true,
          is_bare: false,
          is_detached: false,
          is_merged: false,
          dirty_count: 0,
          added_lines: 0,
          deleted_lines: 0,
          changed_files: [],
          overlap_files: [],
        },
        {
          path: "K:/repo/jjdr-wt-login",
          head: "bbb",
          branch: "feat/login",
          is_main: false,
          is_bare: false,
          is_detached: false,
          is_merged: false,
          dirty_count: 2,
          added_lines: 42,
          deleted_lines: 5,
          changed_files: ["src/auth.ts"],
          overlap_files: [],
        },
      ],
    };

    const externalTerm = makeTerminal({
      address: "t9",
      cwd: "k:\\repo\\jjdr-wt-login\\src",
      labels: {}, // Launched outside jjdr (e.g. hc run or herdr-app)
      status: { state: "done" },
      turn: 3,
    });

    const res = computeDashboard({
      terminals: [externalTerm],
      previews: {},
      projects,
      worktreesByProject,
      ackTurns: {},
      queuedPrompts: {},
      stuckMinutesThreshold: 5,
      searchQuery: "",
      activeGroup: "All",
      nowMs: 2_000_000,
    });

    expect(res.counts.ready).toBe(1);
    expect(res.sessions[0].projectId).toBe("p1");
    expect(res.sessions[0].branch).toBe("feat/login");
    expect(res.matrixLanes[0].cells[1].sessions).toHaveLength(1);
  });

  it("applies custom worktree ordering and matches custom display name/note in search", () => {
    const projects: ProjectConfig[] = [
      {
        id: "p1",
        name: "jjdr",
        repo_path: "K:/repo/jjdr",
        color: "#58a6ff",
        default_branch: "main",
        default_agent: "agy",
        bootstrap: { copy_files: [] },
        group: "Work",
      },
    ];
    const worktreesByProject: Record<string, WorktreeInfo[]> = {
      p1: [
        {
          path: "K:/repo/jjdr",
          head: "aaa",
          branch: "main",
          is_main: true,
          is_bare: false,
          is_detached: false,
          is_merged: false,
          dirty_count: 0,
          added_lines: 0,
          deleted_lines: 0,
          changed_files: [],
          overlap_files: [],
        },
        {
          path: "K:/repo/jjdr-wt-a",
          head: "bbb",
          branch: "feat/a",
          is_main: false,
          is_bare: false,
          is_detached: false,
          is_merged: false,
          dirty_count: 0,
          added_lines: 0,
          deleted_lines: 0,
          changed_files: [],
          overlap_files: [],
        },
        {
          path: "K:/repo/jjdr-wt-b",
          head: "ccc",
          branch: "feat/b",
          is_main: false,
          is_bare: false,
          is_detached: false,
          is_merged: false,
          dirty_count: 0,
          added_lines: 0,
          deleted_lines: 0,
          changed_files: [],
          overlap_files: [],
        },
      ],
    };

    const ordered = computeDashboard({
      terminals: [],
      previews: {},
      projects,
      worktreesByProject,
      ackTurns: {},
      queuedPrompts: {},
      worktreeOrderByProject: {
        p1: ["k:/repo/jjdr-wt-b", "k:/repo/jjdr"],
      },
      stuckMinutesThreshold: 5,
      searchQuery: "",
      activeGroup: "All",
      nowMs: 2_000_000,
    });
    expect(ordered.matrixLanes[0].cells.map((c) => c.worktree.branch)).toEqual([
      "feat/b",
      "main",
      "feat/a",
    ]);

    const searched = computeDashboard({
      terminals: [],
      previews: {},
      projects,
      worktreesByProject,
      ackTurns: {},
      queuedPrompts: {},
      worktreeMeta: {
        "k:/repo/jjdr-wt-a": {
          display_name: "결제 API 리팩토링",
          note: "긴급 확인",
        },
      },
      stuckMinutesThreshold: 5,
      searchQuery: "결제",
      activeGroup: "All",
      nowMs: 2_000_000,
    });
    expect(searched.matrixLanes[0].cells).toHaveLength(1);
    expect(searched.matrixLanes[0].cells[0].worktree.branch).toBe("feat/a");
  });

  it("hides finished failed terminals and unassigned OS system-path terminals (#1)", () => {
    const failedSystem = makeTerminal({
      address: "t-sys-fail",
      cwd: "C:\\Windows\\System32",
      state: "finished",
      exit_code: 1,
    });
    const liveSystem = makeTerminal({
      address: "t-sys-live",
      cwd: "C:\\System32\\drivers",
      state: "live",
      status: { state: "error", msg: "spawn failed" },
    });
    const failedInRepo = makeTerminal({
      address: "t-repo-fail",
      cwd: "K:/repo/jjdr",
      state: "finished",
      exit_code: 127,
    });
    const validLive = makeTerminal({
      address: "t-ok",
      cwd: "K:/Users/dev/project",
      state: "live",
      status: { state: "done" },
      turn: 1,
    });

    expect(isSystemPath("C:\\Windows\\System32")).toBe(true);
    expect(isSystemPath("C:\\System\\Temp")).toBe(true);
    expect(isSystemPath("K:/repo/jjdr")).toBe(false);

    const res = computeDashboard({
      terminals: [failedSystem, liveSystem, failedInRepo, validLive],
      previews: {},
      projects: [],
      worktreesByProject: {},
      ackTurns: {},
      queuedPrompts: {},
      stuckMinutesThreshold: 5,
      searchQuery: "",
      activeGroup: "All",
      nowMs: 2_000_000,
    });

    expect(res.allSessions.map((s) => s.address)).toEqual(["t-ok"]);
    expect(res.unassignedSessions.map((s) => s.address)).toEqual(["t-ok"]);
    expect(res.globalCounts.needsYou).toBe(0);
    expect(res.globalCounts.ready).toBe(1);
  });

  it("only flags permission approval button for live blocked+permission status (#3)", () => {
    const perm = makeTerminal({
      state: "live",
      status: { state: "blocked", kind: "permission", msg: "Run rm?" },
    });
    const question = makeTerminal({
      state: "live",
      status: { state: "blocked", kind: "question", msg: "Pick option" },
    });
    const stuckWorking = makeTerminal({
      state: "live",
      status: { state: "working" },
    });
    const errored = makeTerminal({
      state: "live",
      status: { state: "error", msg: "Rate limit" },
    });
    const finishedPerm = makeTerminal({
      state: "finished",
      status: { state: "blocked", kind: "permission" },
    });

    expect(isPermissionApprovalPending(perm)).toBe(true);
    expect(isPermissionApprovalPending(question)).toBe(false);
    expect(isPermissionApprovalPending(stuckWorking)).toBe(false);
    expect(isPermissionApprovalPending(errored)).toBe(false);
    expect(isPermissionApprovalPending(finishedPerm)).toBe(false);
  });

  it("deduplicates Queue cards per worktree and keeps plain PowerShell out of Ready", () => {
    const projects: ProjectConfig[] = [
      {
        id: "p1",
        name: "happytext",
        repo_path: "K:/repo/happytext",
        color: "#58a6ff",
        default_branch: "main",
        default_agent: "claude",
        bootstrap: { copy_files: [] },
        group: "Work",
      },
    ];
    const worktreesByProject: Record<string, WorktreeInfo[]> = {
      p1: [
        {
          path: "K:/repo/happytext",
          head: "aaa",
          branch: "main",
          is_main: true,
          is_bare: false,
          is_detached: false,
          is_merged: false,
          dirty_count: 0,
          added_lines: 0,
          deleted_lines: 0,
          changed_files: [],
          overlap_files: [],
        },
        {
          path: "K:/repo/happytext-wt-555",
          head: "bbb",
          branch: "555",
          is_main: false,
          is_bare: false,
          is_detached: false,
          is_merged: false,
          dirty_count: 0,
          added_lines: 0,
          deleted_lines: 0,
          changed_files: [],
          overlap_files: [],
        },
      ],
    };

    // Worktree 555 has: 1 AI ready + 1 AI idle + 1 PowerShell with turn=2 (done)
    // ROOT main has: 1 AI idle + 1 PowerShell with turn=1 (done)
    const terminals: TerminalInfo[] = [
      makeTerminal({
        address: "t-555-ai-ready",
        cwd: "K:/repo/happytext-wt-555",
        argv: ["claude"],
        status: { state: "done" },
        turn: 2,
      }),
      makeTerminal({
        address: "t-555-ai-idle",
        cwd: "K:/repo/happytext-wt-555",
        argv: ["gemini"],
        status: { state: "idle" },
        turn: 0,
      }),
      makeTerminal({
        address: "t-555-pwsh",
        cwd: "K:/repo/happytext-wt-555",
        argv: [],
        labels: { "jjdr.agent": "shell" },
        status: { state: "done" },
        turn: 3,
      }),
      makeTerminal({
        address: "t-root-pwsh",
        cwd: "K:/repo/happytext",
        argv: [],
        labels: { "jjdr.agent": "shell" },
        status: { state: "done" },
        turn: 1,
      }),
      makeTerminal({
        address: "t-root-ai-idle",
        cwd: "K:/repo/happytext",
        argv: ["gemini"],
        status: { state: "idle" },
        turn: 0,
        status_ms: 1_500_000,
      }),
    ];

    expect(isPlainShellTerminal(terminals[2])).toBe(true);
    expect(isPlainShellTerminal(terminals[0])).toBe(false);

    const res = computeDashboard({
      terminals,
      previews: {},
      projects,
      worktreesByProject,
      ackTurns: {},
      queuedPrompts: {},
      stuckMinutesThreshold: 5,
      searchQuery: "",
      activeGroup: "All",
      nowMs: 2_000_000,
    });

    // Queue mode must show each worktree card strictly ONCE:
    // wt-555 -> Ready (1 card, sibling count 3), ROOT main -> Standby/idle (AI preferred over pwsh)
    expect(res.byBucket.ready).toHaveLength(1);
    expect(res.byBucket.ready[0].branch).toBe("555");
    expect(res.byBucket.ready[0].worktreeSessionCount).toBe(3);

    expect(res.byBucket.idle).toHaveLength(1);
    expect(res.byBucket.idle[0].branch).toBe("main");
    expect(res.byBucket.idle[0].agentLabel).toBe("gemini");
    expect(res.byBucket.idle[0].worktreeSessionCount).toBe(2);

    expect(res.counts.ready).toBe(1);
    expect(res.counts.idle).toBe(1);
    expect(res.counts.total).toBe(2);
    expect(res.globalCounts).toEqual(res.counts);
    // All 5 tabs remain accessible in allSessions
    expect(res.allSessions).toHaveLength(5);
  });
});
