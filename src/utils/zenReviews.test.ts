import { describe, expect, it } from "vitest";
import {
  parsePrNumberOrUrl,
  shouldAutoReturnFromReviews,
  sortIncomingAutoReviews,
  sortOutgoingReviews,
  summarizeTeamReviews,
} from "./zenReviews";
import type {
  AutoReviewJob,
  ReviewRequestWithAssignments,
  TeamPeerInfo,
} from "../types/domain";

function makeJob(
  id: string,
  phase: AutoReviewJob["phase"],
  updatedMs = 1000
): AutoReviewJob {
  return {
    request_id: id,
    repo_url: "github.com/org/app",
    project_id: "p1",
    project_name: "app",
    repo_path: "/repo",
    pr_number: 10,
    pr_url: "https://github.com/org/app/pull/10",
    pr_title: "Test PR",
    base_branch: "main",
    head_branch: "feat",
    head_sha: "abc",
    author_id: "alice",
    agent_id: "claude",
    model: "sonnet",
    phase,
    fallback_used: false,
    resume_attempts: 0,
    created_ms: updatedMs,
    updated_ms: updatedMs,
  };
}

function makeOutgoing(
  id: string,
  status: ReviewRequestWithAssignments["assignments"][number]["status"],
  reviewerId = "bob",
  createdMs = 1000
): ReviewRequestWithAssignments {
  return {
    request: {
      request_id: id,
      repo_url: "github.com/org/app",
      pr_number: 3,
      pr_url: "https://github.com/org/app/pull/3",
      pr_title: "Feature",
      base_branch: "main",
      head_branch: "feat/x",
      head_sha: "def",
      author_id: "me",
      created_ms: createdMs,
    },
    assignments: [
      {
        request_id: id,
        reviewer_id: reviewerId,
        status,
        known_peer: true,
        created_ms: createdMs,
        updated_ms: createdMs,
        expires_ms: createdMs + 7200_000,
      },
    ],
  };
}

describe("zenReviews pure utilities", () => {
  it("edge-triggers auto-return to Inbox ONLY when a newly arrived card appears", () => {
    // Entered Reviews from Time to chill (0 cards) -> stays when still 0
    const idle = shouldAutoReturnFromReviews(new Set(), []);
    expect(idle.shouldReturn).toBe(false);

    // New task arrives while viewing Reviews -> immediately triggers return!
    const arrived = shouldAutoReturnFromReviews(new Set(), ["wt::p1::/repo/wt1"]);
    expect(arrived.shouldReturn).toBe(true);
    expect(arrived.newlyArrivedKey).toBe("wt::p1::/repo/wt1");

    // Deliberately opened Reviews while card A was already waiting -> must NOT bounce immediately
    const baseline = new Set(["wt::p1::/repo/wtA"]);
    const stay = shouldAutoReturnFromReviews(baseline, ["wt::p1::/repo/wtA"]);
    expect(stay.shouldReturn).toBe(false);

    // While viewing Reviews, card B arrives -> triggers return!
    const arrivalB = shouldAutoReturnFromReviews(baseline, [
      "wt::p1::/repo/wtA",
      "wt::p1::/repo/wtB",
    ]);
    expect(arrivalB.shouldReturn).toBe(true);
    expect(arrivalB.newlyArrivedKey).toBe("wt::p1::/repo/wtB");

    // If card A clears while on Reviews, baseline prunes A so A re-appearing later triggers again
    const pruned = shouldAutoReturnFromReviews(baseline, []);
    expect(pruned.shouldReturn).toBe(false);
    expect(pruned.nextBaselineKeys.size).toBe(0);
    expect(
      shouldAutoReturnFromReviews(pruned.nextBaselineKeys, ["wt::p1::/repo/wtA"])
        .shouldReturn
    ).toBe(true);
  });

  it("summarizes and sorts outgoing and incoming reviews with attention first", () => {
    const peers: TeamPeerInfo[] = [
      {
        github_id: "bob",
        display_name: "Bob",
        status: "offline",
        repo_urls: ["github.com/org/app"],
        last_seen_ms: 1000,
      },
      {
        github_id: "carol",
        display_name: "Carol",
        status: "online",
        repo_urls: ["github.com/org/app"],
        last_seen_ms: 1000,
      },
    ];

    const outgoing = [
      makeOutgoing("done-1", "completed", "carol", 3000),
      makeOutgoing("run-1", "reviewing", "carol", 2000),
      makeOutgoing("off-1", "reviewing", "bob", 1000), // bob went offline -> attention!
    ];
    const incoming = [
      makeJob("q-1", "queued", 3000),
      makeJob("ack-1", "ready_for_ack", 1000),
      makeJob("rev-1", "reviewing", 2000),
    ];

    const summary = summarizeTeamReviews(outgoing, incoming, peers);
    expect(summary.outgoingActive).toBe(2);
    expect(summary.outgoingAttention).toBe(1);
    expect(summary.incomingReady).toBe(1);
    expect(summary.incomingActive).toBe(2);
    expect(summary.hasAttention).toBe(true);

    expect(sortOutgoingReviews(outgoing, peers).map((x) => x.request.request_id)).toEqual([
      "off-1",
      "run-1",
      "done-1",
    ]);
    expect(sortIncomingAutoReviews(incoming).map((x) => x.request_id)).toEqual([
      "ack-1",
      "rev-1",
      "q-1",
    ]);
  });

  it("parses raw PR numbers, #N notation, and full GitHub/GHE URLs", () => {
    expect(parsePrNumberOrUrl("3")).toBe(3);
    expect(parsePrNumberOrUrl("#42")).toBe(42);
    expect(parsePrNumberOrUrl("https://github.com/sindng-ui/jjdr/pull/3")).toBe(3);
    expect(
      parsePrNumberOrUrl("https://github.corp.local/team/app/pulls/128/files")
    ).toBe(128);
    expect(parsePrNumberOrUrl("0")).toBeNull();
    expect(parsePrNumberOrUrl("not-a-pr")).toBeNull();
  });
});
