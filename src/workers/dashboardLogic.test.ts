import { describe, expect, it } from "vitest";
import { classifyBucket, computeDashboard } from "./dashboardLogic";
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
});
