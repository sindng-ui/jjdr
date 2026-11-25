import { describe, expect, it } from "vitest";
import type { EnrichedSession } from "../../types/domain";
import {
  buildBgOverlayPayload,
  buildPreviewBgOverlayPayload,
  normalizeBgOverlayPosition,
  selectTopBgOverlayCandidate,
} from "../bgOverlay";

function mkSession(overrides: Partial<EnrichedSession> = {}): EnrichedSession {
  return {
    address: "t1",
    terminal: {
      address: "t1",
      name: "t1",
      labels: {},
      argv: ["claude"],
      cwd: "K:/repo/wt-a",
      state: "live",
      created_ms: 1000,
      screen: "",
      cols: 120,
      rows: 30,
      status: { state: "done", msg: "Finished build" },
      status_ms: 2000,
      turn: 3,
      title: "",
      keep: false,
    },
    bucket: "ready",
    priorityScore: 500,
    isStuck: false,
    stuckMinutes: 0,
    unackedDone: true,
    projectId: "p1",
    projectName: "alpha",
    projectColor: "#38bdf8",
    projectGroup: "Default",
    worktreePath: "K:/repo/wt-a",
    branch: "feat/a",
    worktree: null,
    previewLines: ["All tests passed"],
    queuedCount: 0,
    agentLabel: "claude",
    elapsedMs: 12_000,
    ...overrides,
  };
}

describe("bgOverlay helpers", () => {
  it("normalizes invalid position values to top_center", () => {
    expect(normalizeBgOverlayPosition("top_center")).toBe("top_center");
    expect(normalizeBgOverlayPosition("bottom_center")).toBe("bottom_center");
    expect(normalizeBgOverlayPosition("bottom_right")).toBe("bottom_right");
    expect(normalizeBgOverlayPosition("unknown")).toBe("top_center");
    expect(normalizeBgOverlayPosition(undefined)).toBe("top_center");
  });

  it("prioritizes needs_you strictly above ready and deduplicates per worktree", () => {
    const readyHigh = mkSession({
      address: "t1",
      bucket: "ready",
      priorityScore: 999,
      worktreePath: "K:/repo/wt-ready",
      branch: "feat/ready",
    });
    const blocked = mkSession({
      address: "t2",
      bucket: "needs_you",
      priorityScore: 100,
      worktreePath: "K:/repo/wt-blocked",
      branch: "feat/blocked",
      terminal: {
        ...mkSession().terminal,
        address: "t2",
        status: { state: "blocked", kind: "permission", msg: "Approve rm?" },
      },
    });
    const blockedSibling = mkSession({
      address: "t3",
      bucket: "needs_you",
      priorityScore: 50,
      worktreePath: "K:/repo/wt-blocked",
      branch: "feat/blocked",
    });
    const running = mkSession({
      address: "t4",
      bucket: "running",
      priorityScore: 9999,
      worktreePath: "K:/repo/wt-run",
    });

    const { top, pendingCount } = selectTopBgOverlayCandidate([
      readyHigh,
      blocked,
      blockedSibling,
      running,
    ]);

    expect(top?.address).toBe("t2");
    expect(pendingCount).toBe(2); // wt-blocked + wt-ready (deduped sibling, excluded running)
  });

  it("builds payload with approval badge and fallback preview when queue is empty", () => {
    const blocked = mkSession({
      address: "t2",
      bucket: "needs_you",
      terminal: {
        ...mkSession().terminal,
        address: "t2",
        status: { state: "blocked", kind: "permission", msg: "Allow tool run?" },
      },
    });
    const payload = buildBgOverlayPayload(blocked, 3, "top_center", "aurora");
    expect(payload.badge).toBe("APPROVAL");
    expect(payload.is_approval).toBe(true);
    expect(payload.pending_count).toBe(3);
    expect(payload.message).toBe("Allow tool run?");

    const preview = buildPreviewBgOverlayPayload([], "bottom_right", "nordic");
    expect(preview.is_preview).toBe(true);
    expect(preview.position).toBe("bottom_right");
    expect(preview.theme).toBe("nordic");
  });
});
