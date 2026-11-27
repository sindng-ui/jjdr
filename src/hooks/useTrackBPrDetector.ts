import { useEffect, useRef } from "react";
import {
  inspectPrForReviewRequest,
  isTauriRuntime,
} from "../services/tauriBridge";
import { useAppStore } from "../store/useAppStore";
import { useUiStore } from "../store/useUiStore";
import { detectPrCreatedSignal } from "../utils/teamReviews";
import { normalizePath } from "../workers/dashboardLogic";

/**
 * Track B PR Creation Detector:
 * Watches live terminal previews when Team Orchestration is enabled, detects `gh pr create`
 * completions, and delegates authoritative 3-stage verification (`author == me`, `OPEN`,
 * `!isDraft`, `createdAt <= 15m`, `prompted_pr_keys`) to Rust `inspect_pr_for_review_request`.
 * Zero work when Team Orchestration is disabled.
 */
export function useTrackBPrDetector() {
  const teamEnabled = useAppStore((s) => s.settings.team?.enabled ?? false);
  const hydrated = useAppStore((s) => s.hydrated);
  const allSessions = useAppStore((s) => s.computed.allSessions);
  const autoReviewJobsByWorktree = useAppStore(
    (s) => s.autoReviewJobsByWorktree
  );

  // Deduplicate inspections within the current app session per (projectId, prNumber)
  const inspectedRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isTauriRuntime() || !hydrated || !teamEnabled) return;
    if (allSessions.length === 0) return;

    let cancelled = false;

    for (const session of allSessions) {
      if (!session.projectId || !session.worktreePath) continue;
      if (session.terminal.state !== "live") continue;

      const normWt = normalizePath(session.worktreePath);
      // Never treat ephemeral reviewer worktrees as authored PR creation
      if (autoReviewJobsByWorktree[normWt]) continue;
      if (normWt.includes("/jjdr-rev-pr")) continue;

      const signal = detectPrCreatedSignal(
        session.previewLines,
        session.terminal.status?.msg
      );
      if (!signal) continue;

      const dedupKey = `${session.projectId}#${signal.prNumber}`;
      if (
        inspectedRef.current.has(dedupKey) ||
        inFlightRef.current.has(dedupKey)
      ) {
        continue;
      }

      inFlightRef.current.add(dedupKey);
      const projectId = session.projectId;
      const worktreePath = session.worktreePath;

      void inspectPrForReviewRequest({
        projectId,
        worktreePath,
        prNumber: signal.prNumber,
        prUrlHint: signal.prUrl,
        manual: false,
      })
        .then((candidate) => {
          inFlightRef.current.delete(dedupKey);
          inspectedRef.current.add(dedupKey);
          if (cancelled || !candidate.eligible_for_auto_prompt) return;

          const ui = useUiStore.getState();
          // Avoid clobbering an already-open picker modal
          if (ui.reviewPickerTarget) return;
          ui.setPendingPrReviewPrompt(candidate);
        })
        .catch(() => {
          inFlightRef.current.delete(dedupKey);
          // Mark inspected to avoid hammering `gh` on non-repo or transient invalid PR numbers
          inspectedRef.current.add(dedupKey);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [teamEnabled, hydrated, allSessions, autoReviewJobsByWorktree]);
}
