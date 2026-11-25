import { beforeEach, describe, expect, it } from "vitest";
import type {
  EnrichedSession,
  MatrixProjectLane,
  MatrixWorktreeCell,
  ProjectConfig,
  WorktreeInfo,
} from "../types/domain";
import {
  DEFAULT_RADAR_LAYOUT,
  extractProjectIdFromCardKey,
  getRadarColumnWidthPx,
  getRadarFocusedColumnWidthPx,
  normalizeRadarLayout,
  pickPreferredCellForLane,
  readStoredRadarLayout,
  resolveFocusedRadarColumn,
  writeStoredRadarLayout,
} from "./radarLayout";

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (idx: number) => Array.from(store.keys())[idx] ?? null,
    removeItem: (k: string) => {
      store.delete(k);
    },
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
  };
}

function makeProject(id: string, name: string): ProjectConfig {
  return {
    id,
    name,
    repo_path: `C:/repo/${id}`,
    default_branch: "main",
    group: "Core",
    color: "#38bdf8",
    default_agent: "agy",
    verify_command: null,
    bootstrap: { copy_files: [], setup_command: null },
  };
}

function makeCell(
  projectId: string,
  branch: string,
  topBucket: MatrixWorktreeCell["topBucket"],
  isMain = false
): MatrixWorktreeCell {
  const worktree: WorktreeInfo = {
    path: `C:/repo/${projectId}/${branch}`,
    branch,
    head: "abc1234",
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
  return {
    worktree,
    sessions: [],
    topBucket,
  };
}

function makeSession(
  address: string,
  projectId: string | null,
  bucket: EnrichedSession["bucket"]
): EnrichedSession {
  return {
    address,
    terminal: {
      address,
      name: address,
      labels: {},
      argv: ["agy"],
      cwd: "C:/repo",
      state: "live",
      created_ms: 1,
      screen: "",
      cols: 100,
      rows: 30,
      turn: 1,
      title: "",
      keep: true,
    },
    bucket,
    projectId,
    projectName: projectId ?? "External",
    projectColor: "#38bdf8",
    projectGroup: "Core",
    branch: "main",
    worktreePath: "C:/repo",
    agentLabel: "agy",
    isStuck: false,
    stuckMinutes: 0,
    previewLines: [],
    worktreeSessionCount: 1,
    priorityScore: 0,
    unackedDone: false,
    worktree: null,
    queuedCount: 0,
    elapsedMs: 0,
  };
}

describe("radarLayout", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "window", {
      value: { localStorage: createMemoryStorage() },
      configurable: true,
      writable: true,
    });
  });

  it("defaults to vertical columns and persists columns/rows switches", () => {
    expect(DEFAULT_RADAR_LAYOUT).toBe("columns");
    expect(readStoredRadarLayout()).toBe("columns");
    expect(normalizeRadarLayout("invalid")).toBe("columns");

    writeStoredRadarLayout("rows");
    expect(readStoredRadarLayout()).toBe("rows");

    writeStoredRadarLayout("columns");
    expect(readStoredRadarLayout()).toBe("columns");
  });

  it("maps density presets to stable overview and expanded focus column widths", () => {
    expect(getRadarColumnWidthPx("comfortable")).toBe(308);
    expect(getRadarColumnWidthPx("balanced")).toBe(276);
    expect(getRadarColumnWidthPx("compact")).toBe(244);
    expect(getRadarColumnWidthPx(null)).toBe(276);

    expect(getRadarFocusedColumnWidthPx("comfortable")).toBe(388);
    expect(getRadarFocusedColumnWidthPx("balanced")).toBe(356);
    expect(getRadarFocusedColumnWidthPx("compact")).toBe(320);
    expect(getRadarFocusedColumnWidthPx(null)).toBe(356);
  });

  it("extracts projectId cleanly from wt:: card keys", () => {
    expect(extractProjectIdFromCardKey("wt::proj-1::c:/repo/proj-1")).toBe("proj-1");
    expect(extractProjectIdFromCardKey("ext::term-1")).toBeNull();
    expect(extractProjectIdFromCardKey(null)).toBeNull();
  });

  it("resolves focused Radar column with priority: attached -> selectedCardKey -> selectedProjectId -> first lane", () => {
    const laneA: MatrixProjectLane = {
      project: makeProject("pA", "Alpha"),
      cells: [makeCell("pA", "main", "idle", true)],
    };
    const laneB: MatrixProjectLane = {
      project: makeProject("pB", "Beta"),
      cells: [makeCell("pB", "main", "ready", true)],
    };
    const extSess = makeSession("ext-1", null, "running");
    const sessB = makeSession("term-b", "pB", "ready");

    // 1. Attached session wins over selectedCardKey
    expect(
      resolveFocusedRadarColumn({
        lanes: [laneA, laneB],
        unassigned: [extSess],
        allSessions: [sessB, extSess],
        attachedAddress: "term-b",
        selectedCardKey: "wt::pA::c:/repo/pa/main",
        selectedProjectId: "pA",
      })
    ).toEqual({ kind: "project", projectId: "pB" });

    // 2. Attached external shell focuses External Shells column
    expect(
      resolveFocusedRadarColumn({
        lanes: [laneA, laneB],
        unassigned: [extSess],
        allSessions: [sessB, extSess],
        attachedAddress: "ext-1",
        selectedCardKey: "wt::pA::c:/repo/pa/main",
        selectedProjectId: null,
      })
    ).toEqual({ kind: "external" });

    // 3. Selected card key when nothing is attached
    expect(
      resolveFocusedRadarColumn({
        lanes: [laneA, laneB],
        unassigned: [extSess],
        allSessions: [sessB, extSess],
        attachedAddress: null,
        selectedCardKey: "wt::pB::c:/repo/pb/main",
        selectedProjectId: null,
      })
    ).toEqual({ kind: "project", projectId: "pB" });

    // 4. Fallback to first lane
    expect(
      resolveFocusedRadarColumn({
        lanes: [laneA, laneB],
        unassigned: [],
        allSessions: [],
        attachedAddress: null,
        selectedCardKey: null,
        selectedProjectId: null,
      })
    ).toEqual({ kind: "project", projectId: "pA" });
  });

  it("picks preferred cell for a lane by urgency then non-root tie-breaker", () => {
    const lane: MatrixProjectLane = {
      project: makeProject("pA", "Alpha"),
      cells: [
        makeCell("pA", "main", "idle", true),
        makeCell("pA", "feat-1", "idle", false),
      ],
    };
    expect(pickPreferredCellForLane(lane)?.worktree.branch).toBe("feat-1");

    const urgentLane: MatrixProjectLane = {
      project: makeProject("pB", "Beta"),
      cells: [
        makeCell("pB", "main", "needs_you", true),
        makeCell("pB", "feat-2", "ready", false),
      ],
    };
    expect(pickPreferredCellForLane(urgentLane)?.worktree.branch).toBe("main");
  });
});
