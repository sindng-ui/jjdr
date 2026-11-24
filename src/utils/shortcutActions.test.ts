import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../store/useAppStore";
import { useUiStore } from "../store/useUiStore";
import { computeDashboard } from "../workers/dashboardLogic";
import {
  buildActionableCardList,
  commitKeyboardCardGrab,
  jumpToNextActionable,
} from "./shortcutActions";
import type { ProjectConfig, TerminalInfo, WorktreeInfo } from "../types/domain";

function mkTerm(partial: Partial<TerminalInfo>): TerminalInfo {
  return {
    address: "t1",
    name: null,
    labels: {},
    argv: ["claude"],
    cwd: "K:/repo/app-wt-a",
    state: "live",
    created_ms: 1_000_000,
    screen: "exact",
    cols: 120,
    rows: 30,
    turn: 1,
    title: "",
    keep: true,
    ...partial,
  };
}

const PROJ: ProjectConfig = {
  id: "p1",
  name: "app",
  repo_path: "K:/repo/app",
  color: "#58a6ff",
  default_branch: "main",
  default_agent: "agy",
  bootstrap: { copy_files: [] },
  group: "Work",
};

const WORKTREES: WorktreeInfo[] = [
  {
    path: "K:/repo/app",
    head: "111",
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
    path: "K:/repo/app-wt-a",
    head: "222",
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
    path: "K:/repo/app-wt-b",
    head: "333",
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
];

describe("shortcutActions", () => {
  beforeEach(() => {
    useUiStore.setState({
      viewMode: "queue",
      selectedProjectId: null,
      selectedCardKey: null,
      selectedAddress: null,
      attachedAddress: null,
      terminalDrawerOpen: false,
      cardGrabState: null,
      toast: null,
    });
  });

  it("jumps strictly one worktree card per Ctrl+N even when a card has 3 actionable sessions (#10)", () => {
    const terminals = [
      mkTerm({ address: "t-a1", cwd: "K:/repo/app-wt-a", status: { state: "done" } }),
      mkTerm({ address: "t-a2", cwd: "K:/repo/app-wt-a", status: { state: "done" } }),
      mkTerm({ address: "t-a3", cwd: "K:/repo/app-wt-a", status: { state: "done" } }),
      mkTerm({ address: "t-b1", cwd: "K:/repo/app-wt-b", status: { state: "done" } }),
    ];
    const computed = computeDashboard({
      terminals,
      previews: {},
      projects: [PROJ],
      worktreesByProject: { p1: WORKTREES },
      ackTurns: {},
      queuedPrompts: {},
      stuckMinutesThreshold: 5,
      searchQuery: "",
      activeGroup: "All",
      nowMs: 2_000_000,
    });
    useAppStore.setState({ computed, projects: [PROJ] });

    const list = buildActionableCardList();
    expect(list).toHaveLength(2);
    expect(list.map((i) => i.cardKey)).toEqual([
      "wt::p1::k:/repo/app-wt-a",
      "wt::p1::k:/repo/app-wt-b",
    ]);

    jumpToNextActionable(1);
    expect(useUiStore.getState().selectedCardKey).toBe("wt::p1::k:/repo/app-wt-a");

    // Second press MUST advance directly to feat/b (never loop inside feat/a's 3 sessions!)
    jumpToNextActionable(1);
    expect(useUiStore.getState().selectedCardKey).toBe("wt::p1::k:/repo/app-wt-b");

    // Third press wraps cleanly back to feat/a
    jumpToNextActionable(1);
    expect(useUiStore.getState().selectedCardKey).toBe("wt::p1::k:/repo/app-wt-a");
  });

  it("commits 1:1 card swap via keyboard grab state without shifting middle cards (#12)", () => {
    const computed = computeDashboard({
      terminals: [],
      previews: {},
      projects: [PROJ],
      worktreesByProject: { p1: WORKTREES },
      ackTurns: {},
      queuedPrompts: {},
      stuckMinutesThreshold: 5,
      searchQuery: "",
      activeGroup: "All",
      nowMs: 2_000_000,
    });
    useAppStore.setState({
      computed,
      projects: [PROJ],
      worktreeOrderByProject: {},
    });
    useUiStore.setState({
      cardGrabState: {
        projectId: "p1",
        sourceKey: "wt::p1::k:/repo/app",
        sourceNormPath: "k:/repo/app",
        targetKey: "wt::p1::k:/repo/app-wt-b",
        targetNormPath: "k:/repo/app-wt-b",
      },
    });

    const committed = commitKeyboardCardGrab();
    expect(committed).toBe(true);
    expect(useUiStore.getState().cardGrabState).toBeNull();
    expect(useAppStore.getState().worktreeOrderByProject.p1).toEqual([
      "k:/repo/app-wt-b",
      "k:/repo/app-wt-a",
      "k:/repo/app",
    ]);
  });
});
