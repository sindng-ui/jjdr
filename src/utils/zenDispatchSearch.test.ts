import { describe, expect, it } from "vitest";
import type { AutoMissionInfo, WorktreeCardMeta } from "../types/domain";
import type { ZenDispatchWorker } from "./zenDispatch";
import { filterDispatchWorkers } from "./zenDispatchSearch";

function makeWorker(
  id: string,
  branch: string,
  projectName = "jjdr"
): ZenDispatchWorker {
  const path = `c:/repo/${id}`;
  return {
    cardKey: `wt::p1::${path}`,
    normWtPath: path,
    project: {
      id: "p1",
      name: projectName,
      repo_path: "c:/repo",
      color: "#60a5fa",
      default_branch: "main",
      default_agent: "claude",
      bootstrap: { copy_files: [] },
      group: "Work",
    },
    worktree: {
      path,
      head: "abc",
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
    },
    sessions: [],
    aiSession: null,
    tier: 0,
    readiness: "fresh",
    mruMs: 1000,
  };
}

describe("filterDispatchWorkers", () => {
  const deck = [
    makeWorker("wt-a", "feat/payment-api", "Billing"),
    makeWorker("wt-b", "fix/login-crash", "Auth"),
    makeWorker("wt-c", "review/cleanup", "Core"),
  ];

  const meta: Record<string, WorktreeCardMeta> = {
    "c:/repo/wt-a": { display_name: "결제 모듈", note: "PG 연동" },
    "c:/repo/wt-b": { display_name: "로그인 핫픽스", pr_number: 114, mission_kind: "review" },
  };

  const autoMission: Record<string, AutoMissionInfo> = {
    "c:/repo/wt-c": { kind: "refactor", prNumber: 205, source: "prompt", updatedAt: 10 },
  };

  it("returns the full deck in original order when query is empty", () => {
    const res = filterDispatchWorkers(deck, "   ", meta, autoMission);
    expect(res.map((r) => r.deckIndex)).toEqual([0, 1, 2]);
  });

  it("matches by PR number in multiple formats (114, #114, pr114)", () => {
    for (const q of ["114", "#114", "pr114", "PR #114"]) {
      const res = filterDispatchWorkers(deck, q, meta, autoMission);
      expect(res).toHaveLength(1);
      expect(res[0].deckIndex).toBe(1);
    }
    const autoPr = filterDispatchWorkers(deck, "205", meta, autoMission);
    expect(autoPr).toHaveLength(1);
    expect(autoPr[0].deckIndex).toBe(2);
  });

  it("matches by display name, branch, project name, note, and Korean/English mission kind", () => {
    expect(filterDispatchWorkers(deck, "결제", meta, autoMission)[0]?.deckIndex).toBe(0);
    expect(filterDispatchWorkers(deck, "login-crash", meta, autoMission)[0]?.deckIndex).toBe(1);
    expect(filterDispatchWorkers(deck, "Billing", meta, autoMission)[0]?.deckIndex).toBe(0);
    expect(filterDispatchWorkers(deck, "PG", meta, autoMission)[0]?.deckIndex).toBe(0);
    expect(filterDispatchWorkers(deck, "리뷰 114", meta, autoMission)[0]?.deckIndex).toBe(1);
  });

  it("returns empty list when nothing matches", () => {
    expect(filterDispatchWorkers(deck, "nonexistent-999", meta, autoMission)).toEqual([]);
  });
});
