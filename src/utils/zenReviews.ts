import type {
  AutoReviewJob,
  ReviewAssignmentView,
  ReviewRequestWithAssignments,
  TeamPeerInfo,
} from "../types/domain";
import { normalizeGithubHandle } from "./teamReviews";

export interface AutoReturnDecision {
  shouldReturn: boolean;
  nextBaselineKeys: Set<string>;
  newlyArrivedKey: string | null;
}

/**
 * Edge-triggered auto-return detector for Zen Reviews tab:
 * - Remembers the set of actionable Inbox card keys present when entering `Reviews`.
 * - Prunes resolved keys from the baseline so a later re-appearance still triggers.
 * - Returns `shouldReturn: true` the instant ANY new Needs-You or Ready card appears.
 */
export function shouldAutoReturnFromReviews(
  baselineKeys: ReadonlySet<string>,
  currentInboxKeys: readonly string[]
): AutoReturnDecision {
  const currentSet = new Set(currentInboxKeys);
  let newlyArrivedKey: string | null = null;
  for (const key of currentInboxKeys) {
    if (!baselineKeys.has(key)) {
      newlyArrivedKey = key;
      break;
    }
  }
  const nextBaselineKeys = new Set<string>();
  for (const key of baselineKeys) {
    if (currentSet.has(key)) {
      nextBaselineKeys.add(key);
    }
  }
  return {
    shouldReturn: newlyArrivedKey !== null,
    nextBaselineKeys,
    newlyArrivedKey,
  };
}

export interface TeamReviewsSummary {
  outgoingTotal: number;
  outgoingActive: number;
  outgoingAttention: number;
  outgoingCompleted: number;
  incomingTotal: number;
  incomingReady: number;
  incomingActive: number;
  incomingFailed: number;
  totalBadgeCount: number;
  hasAttention: boolean;
}

const OUTGOING_ACTIVE_STATUSES = new Set([
  "pending_offline",
  "dispatched",
  "delivered",
  "queued",
  "reviewing",
]);

function isAssignmentOfflineInterrupted(
  a: ReviewAssignmentView,
  peers: readonly TeamPeerInfo[]
): boolean {
  if (a.status !== "reviewing" && a.status !== "queued") return false;
  const h = normalizeGithubHandle(a.reviewer_id);
  const peer = peers.find((p) => normalizeGithubHandle(p.github_id) === h);
  return Boolean(peer && peer.status === "offline");
}

function isAssignmentAttention(
  a: ReviewAssignmentView,
  peers: readonly TeamPeerInfo[]
): boolean {
  return (
    a.status === "rejected" ||
    a.status === "failed" ||
    a.status === "expired" ||
    isAssignmentOfflineInterrupted(a, peers)
  );
}

export function summarizeTeamReviews(
  authoredReviews: readonly ReviewRequestWithAssignments[],
  autoReviewJobs: readonly AutoReviewJob[],
  peers: readonly TeamPeerInfo[]
): TeamReviewsSummary {
  let outgoingActive = 0;
  let outgoingAttention = 0;
  let outgoingCompleted = 0;

  for (const item of authoredReviews) {
    const active = item.assignments.some((a) =>
      OUTGOING_ACTIVE_STATUSES.has(a.status)
    );
    const attention = item.assignments.some((a) =>
      isAssignmentAttention(a, peers)
    );
    const allCompleted =
      item.assignments.length > 0 &&
      item.assignments.every((a) => a.status === "completed");

    if (attention) outgoingAttention++;
    if (active) outgoingActive++;
    if (allCompleted) outgoingCompleted++;
  }

  let incomingReady = 0;
  let incomingActive = 0;
  let incomingFailed = 0;

  for (const job of autoReviewJobs) {
    if (job.phase === "ready_for_ack") incomingReady++;
    else if (
      job.phase === "reviewing" ||
      job.phase === "creating_wt" ||
      job.phase === "queued"
    ) {
      incomingActive++;
    } else if (job.phase === "failed") {
      incomingFailed++;
    }
  }

  const totalBadgeCount =
    incomingReady + incomingActive + incomingFailed + outgoingActive + outgoingAttention;
  const hasAttention =
    incomingReady > 0 || incomingFailed > 0 || outgoingAttention > 0;

  return {
    outgoingTotal: authoredReviews.length,
    outgoingActive,
    outgoingAttention,
    outgoingCompleted,
    incomingTotal: autoReviewJobs.length,
    incomingReady,
    incomingActive,
    incomingFailed,
    totalBadgeCount,
    hasAttention,
  };
}

function outgoingPriority(
  item: ReviewRequestWithAssignments,
  peers: readonly TeamPeerInfo[]
): number {
  if (item.assignments.some((a) => isAssignmentAttention(a, peers))) return 0;
  if (item.assignments.some((a) => OUTGOING_ACTIVE_STATUSES.has(a.status))) {
    return 1;
  }
  if (item.assignments.some((a) => a.status === "completed")) return 2;
  return 3;
}

export function sortOutgoingReviews(
  reviews: readonly ReviewRequestWithAssignments[],
  peers: readonly TeamPeerInfo[]
): ReviewRequestWithAssignments[] {
  return [...reviews].sort((a, b) => {
    const pa = outgoingPriority(a, peers);
    const pb = outgoingPriority(b, peers);
    if (pa !== pb) return pa - pb;
    return b.request.created_ms - a.request.created_ms;
  });
}

function incomingPriority(job: AutoReviewJob): number {
  switch (job.phase) {
    case "ready_for_ack":
      return 0;
    case "reviewing":
      return 1;
    case "creating_wt":
      return 2;
    case "queued":
      return 3;
    case "failed":
      return 4;
    default:
      return 5;
  }
}

export function sortIncomingAutoReviews(
  jobs: readonly AutoReviewJob[]
): AutoReviewJob[] {
  return [...jobs].sort((a, b) => {
    const pa = incomingPriority(a);
    const pb = incomingPriority(b);
    if (pa !== pb) return pa - pb;
    return b.updated_ms - a.updated_ms;
  });
}

/**
 * Parse a raw PR number (`"3"`, `"#3"`) or full GitHub/GHE PR URL into a positive PR number.
 */
export function parsePrNumberOrUrl(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const numMatch = trimmed.match(/^#?(\d{1,7})$/);
  if (numMatch) {
    const n = Number.parseInt(numMatch[1], 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  const urlMatch = trimmed.match(/\/(?:pull|pulls)\/(\d{1,7})(?:[/#?]|$)/i);
  if (urlMatch) {
    const n = Number.parseInt(urlMatch[1], 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  return null;
}
