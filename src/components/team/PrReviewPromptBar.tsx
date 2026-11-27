import React from "react";
import { GitPullRequest, Users, X } from "lucide-react";
import { useUiStore } from "../../store/useUiStore";
import { dismissPrReviewPrompt } from "../../services/tauriBridge";

/**
 * Non-intrusive Zero-Blur floating quick bar shown at bottom-center when Track B
 * verifies a freshly created PR by the current user (`createdAt <= 15m`, non-Draft).
 */
export const PrReviewPromptBar = React.memo(function PrReviewPromptBar() {
  const candidate = useUiStore((s) => s.pendingPrReviewPrompt);
  const setPendingPrReviewPrompt = useUiStore(
    (s) => s.setPendingPrReviewPrompt
  );
  const setReviewPickerTarget = useUiStore((s) => s.setReviewPickerTarget);

  if (!candidate) return null;

  const handleOpenPicker = () => {
    setPendingPrReviewPrompt(null);
    setReviewPickerTarget({
      candidate,
      maxReviewers: 2,
    });
  };

  const handleDismiss = () => {
    setPendingPrReviewPrompt(null);
    void dismissPrReviewPrompt(
      candidate.repo_url,
      candidate.pr_number,
      candidate.head_sha
    ).catch(() => {});
  };

  return (
    <div
      className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 max-w-[680px] w-[calc(100vw-2rem)] rounded-2xl px-4 py-3 shadow-xl flex items-center justify-between gap-3"
      style={{
        background: "var(--modal-bg)",
        border: "1.5px solid var(--accent-border)",
        color: "var(--text-primary)",
      }}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span
          className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: "var(--accent-soft)",
            color: "var(--accent)",
          }}
        >
          <GitPullRequest className="w-4 h-4" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-bold">
            <span style={{ color: "var(--accent)" }}>
              PR #{candidate.pr_number} created
            </span>
            <span style={{ color: "var(--text-faint)" }}>·</span>
            <span
              className="truncate"
              style={{ color: "var(--text-secondary)" }}
            >
              {candidate.project_name}
            </span>
          </div>
          <div
            className="text-[11.5px] truncate"
            style={{ color: "var(--text-muted)" }}
            title={candidate.pr_title}
          >
            {candidate.pr_title || candidate.head_branch}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={handleOpenPicker}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-opacity hover:opacity-90"
          style={{
            background: "var(--accent)",
            color: "#ffffff",
          }}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Select 2 Reviewers</span>
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          title="Dismiss for this commit"
          className="p-1.5 rounded-xl cursor-pointer hover:opacity-80"
          style={{
            background: "var(--pill-bg)",
            color: "var(--text-muted)",
          }}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
});
