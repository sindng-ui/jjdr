import React, { useState } from "react";
import { RefreshCw, X } from "lucide-react";
import type { ReviewRequestWithAssignments } from "../../types/domain";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import {
  cancelAuthoredTeamReview,
  listAuthoredTeamReviews,
} from "../../services/tauriBridge";
import { formatAssignmentChip } from "../../utils/teamReviews";

interface AuthorReviewStatusBarProps {
  review: ReviewRequestWithAssignments;
  projectId: string;
  projectName: string;
  worktreePath: string;
  compact?: boolean;
}

const TONE_STYLES: Record<
  "run" | "ready" | "warn" | "action" | "muted",
  { bg: string; fg: string; border: string; dot: string }
> = {
  run: {
    bg: "var(--run-soft)",
    fg: "var(--run-fg)",
    border: "var(--run-border)",
    dot: "var(--run-fg)",
  },
  ready: {
    bg: "var(--ready-soft)",
    fg: "var(--ready-fg)",
    border: "var(--ready-border)",
    dot: "var(--ready-fg)",
  },
  warn: {
    bg: "var(--warn-soft)",
    fg: "var(--warn-fg)",
    border: "var(--warn-border)",
    dot: "var(--warn-fg)",
  },
  action: {
    bg: "var(--action-soft)",
    fg: "var(--action-fg)",
    border: "var(--action-border)",
    dot: "var(--action-fg)",
  },
  muted: {
    bg: "var(--pill-bg)",
    fg: "var(--text-muted)",
    border: "var(--pill-border)",
    dot: "var(--text-faint)",
  },
};

/**
 * Live Author Mini-Status Bar rendered at the bottom of authored PR cards (RadarTile & ZenHeroCard).
 * Shows real-time per-reviewer status (`@minsu ● Reviewing | @younghee ✓ Posted`) with
 * one-click `[Replace]` and `[×]` actions on offline/rejected/failed slots.
 */
export const AuthorReviewStatusBar = React.memo(function AuthorReviewStatusBar({
  review,
  projectId,
  projectName,
  worktreePath,
  compact = false,
}: AuthorReviewStatusBarProps) {
  const setReviewPickerTarget = useUiStore((s) => s.setReviewPickerTarget);
  const showToast = useUiStore((s) => s.showToast);
  const setAuthoredReviews = useAppStore((s) => s.setAuthoredReviews);
  const [busyReviewer, setBusyReviewer] = useState<string | null>(null);

  if (!review.assignments.length) return null;

  const handleReplace = (e: React.MouseEvent, oldReviewerId: string) => {
    e.stopPropagation();
    const { request } = review;
    setReviewPickerTarget({
      candidate: {
        repo_url: request.repo_url,
        project_id: projectId,
        project_name: projectName,
        worktree_path: worktreePath,
        pr_number: request.pr_number,
        pr_url: request.pr_url,
        pr_title: request.pr_title,
        base_branch: request.base_branch,
        head_branch: request.head_branch,
        head_sha: request.head_sha,
        author_id: request.author_id,
        is_draft: false,
        created_at_ms: request.created_ms,
        already_requested_reviewers: review.assignments
          .filter((a) => a.reviewer_id !== oldReviewerId)
          .map((a) => a.reviewer_id),
        eligible_for_auto_prompt: false,
        skip_reason: null,
      },
      replaceRequestId: request.request_id,
      replaceReviewerId: oldReviewerId,
      maxReviewers: 1,
    });
  };

  const handleCancelSlot = async (
    e: React.MouseEvent,
    reviewerId: string
  ) => {
    e.stopPropagation();
    if (busyReviewer) return;
    setBusyReviewer(reviewerId);
    try {
      await cancelAuthoredTeamReview(
        review.request.request_id,
        reviewerId,
        "Cancelled by author"
      );
      const latest = await listAuthoredTeamReviews().catch(() => null);
      if (latest) setAuthoredReviews(latest);
      showToast(`Cancelled review request for @${reviewerId}`, "info");
    } catch (err) {
      showToast(`Cancel failed: ${String(err)}`, "error");
    } finally {
      setBusyReviewer(null);
    }
  };

  return (
    <div
      data-no-drag="true"
      onClick={(e) => e.stopPropagation()}
      className={`flex items-center gap-1.5 flex-wrap ${
        compact ? "pt-1" : "pt-1.5"
      }`}
    >
      {review.assignments.map((assignment) => {
        const chip = formatAssignmentChip(assignment);
        const st = TONE_STYLES[chip.tone];
        const isBusy = busyReviewer === assignment.reviewer_id;
        return (
          <span
            key={assignment.reviewer_id}
            title={chip.tooltip}
            className={`inline-flex items-center gap-1 rounded-full font-mono-code ${
              compact
                ? "px-2 py-0.5 text-[10px]"
                : "px-2.5 py-0.5 text-[11px]"
            }`}
            style={{
              background: st.bg,
              border: `1px solid ${st.border}`,
              color: st.fg,
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: st.dot }}
            />
            <span className="font-bold">@{chip.reviewerId}</span>
            <span className="opacity-90">
              {compact ? chip.shortLabel : chip.label}
            </span>

            {chip.canReplace && (
              <button
                type="button"
                onClick={(e) => handleReplace(e, assignment.reviewer_id)}
                title={`Replace @${assignment.reviewer_id} with another reviewer`}
                className="ml-0.5 inline-flex items-center gap-0.5 px-1 rounded hover:opacity-80 cursor-pointer font-sans font-bold"
                style={{
                  background: "rgba(0,0,0,0.14)",
                  color: st.fg,
                }}
              >
                <RefreshCw className="w-2.5 h-2.5" />
                {!compact && <span>Replace</span>}
              </button>
            )}

            {chip.canCancel && (
              <button
                type="button"
                disabled={isBusy}
                onClick={(e) => void handleCancelSlot(e, assignment.reviewer_id)}
                title={`Cancel request to @${assignment.reviewer_id}`}
                className="inline-flex items-center p-0.5 rounded hover:opacity-80 cursor-pointer disabled:opacity-40"
                style={{ color: st.fg }}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
});
