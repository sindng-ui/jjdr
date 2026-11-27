import { describe, expect, it } from "vitest";
import {
  applyStatusEventToAuthoredReviews,
  detectPrCreatedSignal,
  findAuthoredReviewForCard,
  formatAssignmentChip,
  sortPeersForReviewPicker,
} from "./teamReviews";
import type {
  ReviewAssignmentView,
  ReviewRequestWithAssignments,
  TeamPeerInfo,
} from "../types/domain";

function makePeer(
  github_id: string,
  status: TeamPeerInfo["status"],
  repo_urls: string[]
): TeamPeerInfo {
  return {
    github_id,
    display_name: github_id,
    status,
    repo_urls,
    last_seen_ms: 1_700_000_000_000,
  };
}

function makeAuthored(
  request_id: string,
  pr_number: number,
  head_branch: string,
  created_ms: number,
  assignments: Partial<ReviewAssignmentView>[]
): ReviewRequestWithAssignments {
  return {
    request: {
      request_id,
      repo_url: "github.corp.local/team/jjdr",
      pr_number,
      pr_url: `https://github.corp.local/team/jjdr/pull/${pr_number}`,
      pr_title: `PR #${pr_number}`,
      base_branch: "main",
      head_branch,
      head_sha: "abc1234",
      author_id: "alice",
      created_ms,
    },
    assignments: assignments.map((a, idx) => ({
      request_id,
      reviewer_id: a.reviewer_id ?? `rev${idx}`,
      status: a.status ?? "queued",
      reject_reason: a.reject_reason ?? null,
      detail: a.detail ?? null,
      worker_agent: a.worker_agent ?? null,
      claimed_by_device_id: null,
      known_peer: true,
      created_ms,
      updated_ms: a.updated_ms ?? created_ms,
      expires_ms: created_ms + 48 * 3600 * 1000,
    })),
  };
}

describe("teamReviews utilities (Phase 4)", () => {
  it("detects newly created PRs on corporate GHE and ignores read-only gh pr view output", () => {
    // Happy: explicit gh pr create + enterprise GHE URL
    const created = detectPrCreatedSignal([
      "$ gh pr create --fill",
      "Creating pull request for feat/auth into main in team/jjdr",
      "https://github.corp.company.com/team/jjdr/pull/412",
    ]);
    expect(created).toEqual({
      prNumber: 412,
      prUrl: "https://github.corp.company.com/team/jjdr/pull/412",
    });

    // Happy: bare URL line emitted right after gh pr create
    const bare = detectPrCreatedSignal([
      "https://github.corp.company.com/team/jjdr/pull/519",
    ]);
    expect(bare?.prNumber).toBe(519);

    // Despair: read-only gh pr view / diff must NOT trigger Track B prompt
    const viewed = detectPrCreatedSignal([
      "$ gh pr view 412",
      "url: https://github.corp.company.com/team/jjdr/pull/412",
    ]);
    expect(viewed).toBeNull();

    // Despair: no PR URL at all
    expect(detectPrCreatedSignal(["All tests passed."])).toBeNull();
  });

  it("sorts peers with repo+online first, excludes self, and tags already requested reviewers", () => {
    const repo = "https://github.corp.local/team/jjdr.git";
    const peers: TeamPeerInfo[] = [
      makePeer("alice", "online", ["github.corp.local/team/jjdr"]), // self -> excluded
      makePeer("zoe", "offline", []), // rank 5
      makePeer("dave", "online", ["github.corp.local/other/app"]), // rank 4 (no repo, online)
      makePeer("charlie", "offline", ["github.corp.local/team/jjdr"]), // rank 3 (repo, offline)
      makePeer("bob", "paused", ["github.corp.local/team/jjdr"]), // rank 2 (repo, paused)
      makePeer("minsu", "online", ["github.corp.local/team/jjdr"]), // rank 1 (repo, online)
    ];

    const sorted = sortPeersForReviewPicker(peers, repo, "@Alice", ["bob"]);
    expect(sorted.map((x) => x.peer.github_id)).toEqual([
      "minsu",
      "bob",
      "charlie",
      "dave",
      "zoe",
    ]);
    expect(sorted[0].hasRepo).toBe(true);
    expect(sorted[0].isOnline).toBe(true);
    expect(sorted[1].alreadyRequested).toBe(true);
    expect(sorted[1].isPaused).toBe(true);
    expect(sorted[3].hasRepo).toBe(false);
  });

  it("matches latest authored review request for card and patches WS status immutably", () => {
    const older = makeAuthored("req-1", 412, "feat/track-b", 1000, [
      { reviewer_id: "minsu", status: "completed" },
    ]);
    const latest = makeAuthored("req-2", 412, "feat/track-b", 2000, [
      { reviewer_id: "minsu", status: "queued" },
      { reviewer_id: "younghee", status: "pending_offline" },
    ]);

    const matched = findAuthoredReviewForCard([older, latest], {
      prNumber: 412,
      branch: "feat/track-b",
    });
    expect(matched?.request.request_id).toBe("req-2");

    // Branch-only fallback when PR# not yet stamped in metadata
    const byBranch = findAuthoredReviewForCard([older, latest], {
      branch: "feat/track-b",
    });
    expect(byBranch?.request.request_id).toBe("req-2");

    // Immutable WebSocket patch updates only the targeted reviewer slot
    const patched = applyStatusEventToAuthoredReviews([older, latest], {
      request_id: "req-2",
      repo_url: "github.corp.local/team/jjdr",
      pr_number: 412,
      head_sha: "abc1234",
      reviewer_id: "Minsu",
      status: "reviewing",
      worker_agent: "claude",
      detail: "Running auto-review",
      updated_ms: 3000,
    });
    expect(patched[0]).toBe(older);
    expect(patched[1].assignments[0].status).toBe("reviewing");
    expect(patched[1].assignments[0].worker_agent).toBe("claude");
    expect(patched[1].assignments[1].status).toBe("pending_offline");
  });

  it("formats assignment chips with accurate replace/cancel action guards", () => {
    const base: ReviewAssignmentView = {
      request_id: "req-1",
      reviewer_id: "minsu",
      status: "completed",
      known_peer: true,
      created_ms: 1000,
      updated_ms: 2000,
      expires_ms: 9000,
    };

    const doneChip = formatAssignmentChip(base);
    expect(doneChip.label).toBe("Posted");
    expect(doneChip.canReplace).toBe(false);
    expect(doneChip.canCancel).toBe(false);

    const offlineChip = formatAssignmentChip({
      ...base,
      status: "pending_offline",
    });
    expect(offlineChip.canReplace).toBe(true);
    expect(offlineChip.canCancel).toBe(true);

    const rejChip = formatAssignmentChip({
      ...base,
      status: "rejected",
      reject_reason: "excluded_label",
      detail: "wip",
    });
    expect(rejChip.label).toBe("Rejected: label");
    expect(rejChip.canReplace).toBe(true);
    expect(rejChip.canCancel).toBe(false);

    const quotaChip = formatAssignmentChip({
      ...base,
      status: "failed",
      reject_reason: "quota_exhausted",
    });
    expect(quotaChip.label).toBe("AI Quota");
    expect(quotaChip.canReplace).toBe(true);
  });
});
