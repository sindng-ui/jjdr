import { describe, expect, it } from "vitest";
import type { EnrichedSession } from "../types/domain";
import {
  countWorktreeLiveShells,
  getCycledSession,
  getWorktreeLiveSessions,
  MAX_SHELLS_PER_WORKTREE,
  pickPreferredWorktreeSession,
} from "./worktreeSessions";

function mockSession(
  address: string,
  agentLabel: string,
  createdMs: number,
  state: "live" | "finished" = "live",
  worktreePath = "K:/repo/wt-a",
  projectId: string | null = "proj-1"
): EnrichedSession {
  return {
    address,
    terminal: {
      address,
      labels: {},
      argv: [],
      cwd: worktreePath,
      state,
      created_ms: createdMs,
      screen: "",
      cols: 100,
      rows: 30,
      turn: 0,
      title: "",
      keep: true,
    },
    bucket: "idle",
    priorityScore: 0,
    isStuck: false,
    stuckMinutes: 0,
    unackedDone: false,
    projectId,
    projectName: "demo",
    projectColor: "#38bdf8",
    projectGroup: "Default",
    worktreePath,
    branch: "main",
    worktree: null,
    previewLines: [],
    queuedCount: 0,
    agentLabel,
    elapsedMs: 1000,
  };
}

describe("worktreeSessions", () => {
  it("lists only live sessions in the same worktree stably ordered by created_ms", () => {
    const sAi = mockSession("t4", "agy", 2000);
    const sShell = mockSession("t1", "pwsh", 1000);
    const sDead = mockSession("t2", "claude", 500, "finished");
    const sOtherWt = mockSession("t5", "agy", 1500, "live", "K:/repo/wt-b");

    const tabs = getWorktreeLiveSessions([sAi, sShell, sDead, sOtherWt], sAi);
    expect(tabs.map((t) => t.address)).toEqual(["t1", "t4"]);
  });

  it("prefers remembered tab, then AI over plain shell, and cycles cleanly with Ctrl+Tab", () => {
    const sShell = mockSession("t1", "pwsh", 1000);
    const sAi = mockSession("t4", "agy", 2000);
    const sAi2 = mockSession("t7", "claude", 3000);

    expect(pickPreferredWorktreeSession([sShell, sAi])?.address).toBe("t4");
    expect(pickPreferredWorktreeSession([sShell, sAi], "t1")?.address).toBe(
      "t1"
    );

    const tabs = [sShell, sAi, sAi2];
    expect(getCycledSession(tabs, "t1", 1)?.address).toBe("t4");
    expect(getCycledSession(tabs, "t7", 1)?.address).toBe("t1");
    expect(getCycledSession(tabs, "t1", -1)?.address).toBe("t7");
  });

  it("counts only live plain shells in a specific worktree against the max-2 limit", () => {
    const s1 = mockSession("t1", "shell", 1000, "live", "K:/repo/wt-a", "proj-1");
    const s2 = mockSession("t2", "pwsh", 2000, "live", "K:/repo/wt-a", "proj-1");
    const sDead = mockSession("t3", "shell", 500, "finished", "K:/repo/wt-a", "proj-1");
    const sAi = mockSession("t4", "gemini", 3000, "live", "K:/repo/wt-a", "proj-1");
    const sOther = mockSession("t5", "shell", 4000, "live", "K:/repo/wt-b", "proj-1");

    expect(MAX_SHELLS_PER_WORKTREE).toBe(2);
    expect(
      countWorktreeLiveShells([s1, s2, sDead, sAi, sOther], "k:\\repo\\wt-a", "proj-1")
    ).toBe(2);
    expect(
      countWorktreeLiveShells([s1, s2, sDead, sAi, sOther], "K:/repo/wt-b", "proj-1")
    ).toBe(1);
  });
});
