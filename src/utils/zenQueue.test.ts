import { describe, expect, it } from "vitest";
import { computeNextSkippedOrder, selectZenTopCard } from "./zenQueue";
import type { EnrichedSession, TerminalInfo } from "../types/domain";

function mkSession(
  address: string,
  projectId: string,
  wtPath: string,
  bucket: "needs_you" | "ready"
): EnrichedSession {
  const terminal: TerminalInfo = {
    address,
    name: null,
    labels: {},
    argv: ["claude"],
    cwd: wtPath,
    state: "live",
    created_ms: 1_000_000,
    screen: "exact",
    cols: 120,
    rows: 30,
    turn: 1,
    title: "",
    keep: true,
    status: bucket === "needs_you" ? { state: "blocked", kind: "permission" } : { state: "done" },
  };
  return {
    address,
    terminal,
    bucket,
    priorityScore: 0,
    isStuck: false,
    stuckMinutes: 0,
    unackedDone: bucket === "ready",
    projectId,
    projectName: "jjdr",
    projectColor: "#818cf8",
    projectGroup: "Work",
    worktreePath: wtPath,
    branch: address,
    worktree: null,
    previewLines: [],
    queuedCount: 0,
    agentLabel: "claude",
    elapsedMs: 60_000,
  };
}

describe("zenQueue", () => {
  it("picks needs_you over ready and enforces Sticky Lock against background interruptions", () => {
    const a = mkSession("t1", "p1", "K:/repo/wt-a", "ready");
    const b = mkSession("t2", "p1", "K:/repo/wt-b", "needs_you");

    // No lock -> picks highest priority (needs_you: t2)
    const initial = selectZenTopCard([b], [a], null, []);
    expect(initial.activeCard?.address).toBe("t2");
    expect(initial.remainingCount).toBe(1);
    expect(initial.lockedCardResolved).toBe(false);

    // Sticky Lock on wt-a: even when wt-b becomes needs_you in background, wt-a stays locked!
    const locked = selectZenTopCard([b], [a], "wt::p1::k:/repo/wt-a", []);
    expect(locked.activeCard?.address).toBe("t1");
    expect(locked.lockedCardResolved).toBe(false);

    // Once locked wt-a is resolved (removed from actionable), smoothly advances to wt-b
    const resolved = selectZenTopCard([b], [], "wt::p1::k:/repo/wt-a", []);
    expect(resolved.activeCard?.address).toBe("t2");
    expect(resolved.lockedCardResolved).toBe(true);
  });

  it("rotates cleanly through all actionable cards on manual skip (Ctrl+N / Lever / Dial)", () => {
    const a = mkSession("t1", "p1", "K:/repo/wt-a", "needs_you");
    const b = mkSession("t2", "p1", "K:/repo/wt-b", "ready");
    const c = mkSession("t3", "p1", "K:/repo/wt-c", "ready");
    const pool = [a, b, c];

    const s1 = computeNextSkippedOrder(pool, "wt::p1::k:/repo/wt-a", []);
    expect(s1.nextKey).toBe("wt::p1::k:/repo/wt-b");

    const s2 = computeNextSkippedOrder(pool, s1.nextKey!, s1.nextSkippedKeys);
    expect(s2.nextKey).toBe("wt::p1::k:/repo/wt-c");

    // Full wrap around returns to wt-a
    const s3 = computeNextSkippedOrder(pool, s2.nextKey!, s2.nextSkippedKeys);
    expect(s3.nextKey).toBe("wt::p1::k:/repo/wt-a");
  });

  it("returns null activeCard when all tasks are cleared", () => {
    const res = selectZenTopCard([], [], "wt::p1::k:/repo/wt-a", []);
    expect(res.activeCard).toBeNull();
    expect(res.remainingCount).toBe(0);
    expect(res.lockedCardResolved).toBe(true);
  });
});
