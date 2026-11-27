import type {
  ReviewAssignmentStatus,
  ReviewAssignmentView,
  ReviewRequestWithAssignments,
  TeamPeerInfo,
  TeamStatusChangedEvent,
} from "../types/domain";

export interface PrCreateSignal {
  prNumber: number;
  prUrl: string | null;
}

export interface AnnotatedReviewerPeer {
  peer: TeamPeerInfo;
  hasRepo: boolean;
  isOnline: boolean;
  isPaused: boolean;
  isOffline: boolean;
  alreadyRequested: boolean;
  priorityRank: number;
}

export interface AssignmentChipInfo {
  reviewerId: string;
  status: ReviewAssignmentStatus;
  label: string;
  shortLabel: string;
  tone: "run" | "ready" | "warn" | "action" | "muted";
  tooltip: string;
  canReplace: boolean;
  canCancel: boolean;
}

const PR_URL_RE =
  /https?:\/\/[^\s<>"'`)\]]+\/(?:pull|pulls)\/(\d{1,7})(?:[/#?][^\s<>"'`)\]]*)?/i;

const PR_CREATE_CONTEXT_RE =
  /\bgh\s+pr\s+create\b|creating\s+pull\s+request|opened\s+(?:a\s+)?(?:new\s+)?pull\s+request|pull\s+request\s+(?:#\d+\s+)?created|created\s+pr\s+#?\d+|pr을\s*생성|pr\s*생성\s*완료/i;

const PR_READONLY_CMD_RE =
  /\bgh\s+pr\s+(?:view|diff|checkout|review|comment|checks|list)\b/i;

export function normalizeGithubHandle(raw?: string | null): string {
  return (raw ?? "").trim().replace(/^@/, "").toLowerCase();
}

export function normalizeRepoKey(raw?: string | null): string {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return "";
  return s
    .replace(/^https?:\/\//, "")
    .replace(/^ssh:\/\//, "")
    .replace(/^git@([^:]+):/, "$1/")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
}

/**
 * Detect whether terminal output/status indicates a newly created PR (Track B first-stage filter).
 * Avoids false positives on read-only `gh pr view` / `gh pr diff` commands; Rust backend performs
 * authoritative 3-stage `gh pr view` verification (author == me, OPEN, !isDraft, createdAt <= 15m).
 */
export function detectPrCreatedSignal(
  lines: string[],
  statusMsg?: string | null
): PrCreateSignal | null {
  const recent = lines.slice(-12);
  const combined = [statusMsg ?? "", ...recent].filter(Boolean).join("\n");
  if (!combined.trim()) return null;

  const urlMatch = combined.match(PR_URL_RE);
  if (!urlMatch) return null;

  const prNumber = Number.parseInt(urlMatch[1], 10);
  if (!Number.isInteger(prNumber) || prNumber <= 0) return null;
  const prUrl = urlMatch[0].replace(/[),.;:!?]+$/, "");

  // Strong positive signal: explicit `gh pr create` or PR creation confirmation wording
  if (PR_CREATE_CONTEXT_RE.test(combined)) {
    return { prNumber, prUrl };
  }

  // If the output explicitly looks like a read-only `gh pr view/diff/review` command, skip
  if (PR_READONLY_CMD_RE.test(combined)) {
    return null;
  }

  // `gh pr create` often outputs ONLY the bare PR URL on its own line right after creation
  const hasBarePrUrlLine = recent.some((line) => {
    const trimmed = line.trim().replace(/[),.;:!?]+$/, "");
    return /^https?:\/\/[^\s]+\/pull\/\d{1,7}$/i.test(trimmed);
  });
  if (hasBarePrUrlLine) {
    return { prNumber, prUrl };
  }

  return null;
}

/**
 * Sort and annotate team peers for the Reviewer Picker:
 * 1) Has repo + Online
 * 2) Has repo + Paused
 * 3) Has repo + Offline
 * 4) No repo + Online
 * 5) Others
 * Always excludes `myGithubId`.
 */
export function sortPeersForReviewPicker(
  peers: TeamPeerInfo[],
  repoUrl: string,
  myGithubId?: string | null,
  alreadyRequestedIds: string[] = []
): AnnotatedReviewerPeer[] {
  const me = normalizeGithubHandle(myGithubId);
  const targetRepo = normalizeRepoKey(repoUrl);
  const alreadySet = new Set(alreadyRequestedIds.map(normalizeGithubHandle).filter(Boolean));

  const items: AnnotatedReviewerPeer[] = [];
  for (const peer of peers) {
    const handle = normalizeGithubHandle(peer.github_id);
    if (!handle || handle === me) continue;

    const hasRepo =
      Boolean(targetRepo) &&
      peer.repo_urls.some((u) => normalizeRepoKey(u) === targetRepo);
    const isOnline = peer.status === "online";
    const isPaused = peer.status === "paused";
    const isOffline = !isOnline && !isPaused;
    const alreadyRequested = alreadySet.has(handle);

    let priorityRank = 5;
    if (hasRepo && isOnline) priorityRank = 1;
    else if (hasRepo && isPaused) priorityRank = 2;
    else if (hasRepo && isOffline) priorityRank = 3;
    else if (!hasRepo && isOnline) priorityRank = 4;

    items.push({
      peer,
      hasRepo,
      isOnline,
      isPaused,
      isOffline,
      alreadyRequested,
      priorityRank,
    });
  }

  items.sort((a, b) => {
    if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank;
    return a.peer.github_id.localeCompare(b.peer.github_id);
  });
  return items;
}

/**
 * Find the most recent authored review request matching a worktree card.
 * Matches by PR number first (if present), or falls back to `head_branch` match.
 */
export function findAuthoredReviewForCard(
  authoredReviews: ReviewRequestWithAssignments[],
  options: {
    prNumber?: number | null;
    branch?: string | null;
    prUrl?: string | null;
  }
): ReviewRequestWithAssignments | null {
  if (authoredReviews.length === 0) return null;

  const targetPr = options.prNumber ?? null;
  const targetBranch = (options.branch ?? "").trim();
  const targetUrl = (options.prUrl ?? "").trim().toLowerCase();

  let best: ReviewRequestWithAssignments | null = null;
  for (const item of authoredReviews) {
    let matched = false;
    if (targetPr !== null && item.request.pr_number === targetPr) {
      if (targetUrl) {
        matched =
          item.request.pr_url.toLowerCase() === targetUrl ||
          targetUrl.includes(`/pull/${targetPr}`);
      } else if (targetBranch) {
        matched =
          !item.request.head_branch || item.request.head_branch === targetBranch;
      } else {
        matched = true;
      }
    } else if (
      targetPr === null &&
      targetBranch &&
      item.request.head_branch === targetBranch
    ) {
      matched = true;
    }

    if (matched) {
      if (!best || item.request.created_ms > best.request.created_ms) {
        best = item;
      }
    }
  }
  return best;
}

/**
 * Immutably patch `authoredReviews` in O(N) on `jjdr:team-status-changed` WebSocket events.
 */
export function applyStatusEventToAuthoredReviews(
  prev: ReviewRequestWithAssignments[],
  event: TeamStatusChangedEvent
): ReviewRequestWithAssignments[] {
  const reviewerNorm = normalizeGithubHandle(event.reviewer_id);
  let changed = false;

  const next = prev.map((entry) => {
    if (entry.request.request_id !== event.request_id) return entry;
    let slotFound = false;
    const nextAssignments = entry.assignments.map((a) => {
      if (normalizeGithubHandle(a.reviewer_id) !== reviewerNorm) return a;
      slotFound = true;
      changed = true;
      return {
        ...a,
        status: event.status,
        reject_reason: event.reject_reason ?? a.reject_reason ?? null,
        detail: event.detail ?? a.detail ?? null,
        worker_agent: event.worker_agent ?? a.worker_agent ?? null,
        updated_ms: Math.max(a.updated_ms, event.updated_ms),
      };
    });
    if (!slotFound) return entry;
    return {
      ...entry,
      assignments: nextAssignments,
    };
  });

  return changed ? next : prev;
}

export function formatRejectReasonShort(reason?: string | null): string {
  switch (reason) {
    case "reviewer_paused":
      return "paused";
    case "repo_not_registered":
      return "no repo";
    case "duplicate_sha":
      return "dup";
    case "expired_ttl":
      return "expired";
    case "pr_closed":
      return "closed";
    case "pr_merged":
      return "merged";
    case "pr_draft":
      return "draft";
    case "excluded_label":
      return "label";
    case "excluded_branch":
      return "branch";
    case "project_disabled":
      return "off";
    case "author_not_allowed":
      return "blocked";
    case "queue_full":
      return "queue full";
    case "gh_auth_error":
      return "gh auth";
    case "quota_exhausted":
      return "quota";
    case "user_declined":
      return "declined";
    default:
      return reason ? reason.replace(/_/g, " ") : "rejected";
  }
}

export function formatAssignmentChip(a: ReviewAssignmentView): AssignmentChipInfo {
  const reasonShort = formatRejectReasonShort(a.reject_reason);
  const agentNote = a.worker_agent ? ` (${a.worker_agent})` : "";

  switch (a.status) {
    case "reviewing":
      return {
        reviewerId: a.reviewer_id,
        status: a.status,
        label: `Reviewing${agentNote}`,
        shortLabel: "Reviewing",
        tone: "run",
        tooltip: `@${a.reviewer_id} is running AI auto-review${agentNote}${a.detail ? ` — ${a.detail}` : ""}`,
        canReplace: false,
        canCancel: true,
      };
    case "completed":
      return {
        reviewerId: a.reviewer_id,
        status: a.status,
        label: "Posted",
        shortLabel: "Posted",
        tone: "ready",
        tooltip: `@${a.reviewer_id} completed review${agentNote}${a.detail ? ` — ${a.detail}` : ""}`,
        canReplace: false,
        canCancel: false,
      };
    case "queued":
      return {
        reviewerId: a.reviewer_id,
        status: a.status,
        label: "Queued",
        shortLabel: "Queued",
        tone: "warn",
        tooltip: `@${a.reviewer_id} queued review (waiting for free worker slot)`,
        canReplace: false,
        canCancel: true,
      };
    case "dispatched":
    case "delivered":
      return {
        reviewerId: a.reviewer_id,
        status: a.status,
        label: "Starting",
        shortLabel: "Starting",
        tone: "run",
        tooltip: `@${a.reviewer_id} received request and is verifying PR`,
        canReplace: false,
        canCancel: true,
      };
    case "pending_offline":
      return {
        reviewerId: a.reviewer_id,
        status: a.status,
        label: "Offline (Queued)",
        shortLabel: "Offline",
        tone: "muted",
        tooltip: `@${a.reviewer_id} is offline — stored in relay mailbox until reconnect`,
        canReplace: true,
        canCancel: true,
      };
    case "rejected":
      return {
        reviewerId: a.reviewer_id,
        status: a.status,
        label: `Rejected: ${reasonShort}`,
        shortLabel: `Rejected: ${reasonShort}`,
        tone: "action",
        tooltip: `@${a.reviewer_id} rejected (${a.reject_reason ?? "rejected"})${a.detail ? `: ${a.detail}` : ""}`,
        canReplace: true,
        canCancel: false,
      };
    case "failed":
      return {
        reviewerId: a.reviewer_id,
        status: a.status,
        label: a.reject_reason === "quota_exhausted" ? "AI Quota" : "Failed",
        shortLabel: a.reject_reason === "quota_exhausted" ? "Quota" : "Failed",
        tone: "action",
        tooltip: `@${a.reviewer_id} review failed${a.detail ? `: ${a.detail}` : ""}`,
        canReplace: true,
        canCancel: false,
      };
    case "expired":
      return {
        reviewerId: a.reviewer_id,
        status: a.status,
        label: "Expired",
        shortLabel: "Expired",
        tone: "muted",
        tooltip: `@${a.reviewer_id} request expired (TTL exceeded while offline)`,
        canReplace: true,
        canCancel: false,
      };
    case "cancelled":
    default:
      return {
        reviewerId: a.reviewer_id,
        status: a.status,
        label: "Cancelled",
        shortLabel: "Cancelled",
        tone: "muted",
        tooltip: `@${a.reviewer_id} request was cancelled${a.detail ? `: ${a.detail}` : ""}`,
        canReplace: true,
        canCancel: false,
      };
  }
}
