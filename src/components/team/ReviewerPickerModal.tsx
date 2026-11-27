import React, { useEffect, useMemo, useState } from "react";
import {
  Check,
  GitPullRequest,
  Loader2,
  PauseCircle,
  Search,
  Send,
  Users,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import {
  cancelAuthoredTeamReview,
  listAuthoredTeamReviews,
  submitTeamReviewRequest,
} from "../../services/tauriBridge";
import { sortPeersForReviewPicker } from "../../utils/teamReviews";

/**
 * Zero-Blur modal to pick up to 2 team reviewers (or 1 reviewer in Replace mode),
 * assign them via `gh pr edit --add-reviewer`, and dispatch the auto-review request via Relay.
 */
export const ReviewerPickerModal = React.memo(function ReviewerPickerModal() {
  const target = useUiStore((s) => s.reviewPickerTarget);
  const setReviewPickerTarget = useUiStore((s) => s.setReviewPickerTarget);
  const showToast = useUiStore((s) => s.showToast);

  const teamSnapshot = useAppStore((s) => s.teamSnapshot);
  const teamSettings = useAppStore((s) => s.settings.team);
  const upsertAuthoredReview = useAppStore((s) => s.upsertAuthoredReview);
  const setAuthoredReviews = useAppStore((s) => s.setAuthoredReviews);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [assignOnGithub, setAssignOnGithub] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const maxReviewers = target?.maxReviewers ?? (target?.replaceReviewerId ? 1 : 2);
  const isReplaceMode = Boolean(target?.replaceRequestId && target?.replaceReviewerId);
  const relayConnected = Boolean(teamSnapshot?.connected);

  useEffect(() => {
    if (!target) return;
    setSelectedIds([]);
    setQuery("");
    setAssignOnGithub(true);
    setSubmitting(false);
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) {
        e.preventDefault();
        setReviewPickerTarget(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [target, submitting, setReviewPickerTarget]);

  const myGithubId =
    teamSnapshot?.github_id || teamSettings?.github_id_override || null;
  const peers = teamSnapshot?.peers ?? [];

  const annotatedPeers = useMemo(() => {
    if (!target) return [];
    const list = sortPeersForReviewPicker(
      peers,
      target.candidate.repo_url,
      myGithubId,
      target.candidate.already_requested_reviewers
    );
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (item) =>
        item.peer.github_id.toLowerCase().includes(q) ||
        item.peer.display_name.toLowerCase().includes(q)
    );
  }, [peers, target, myGithubId, query]);

  // Auto-deselect any reviewer who goes offline or pauses while the modal is open
  useEffect(() => {
    if (!target) return;
    const onlineSet = new Set(
      peers
        .filter((p) => p.status === "online")
        .map((p) => p.github_id.toLowerCase())
    );
    setSelectedIds((prev) => {
      const next = prev.filter((id) => onlineSet.has(id.toLowerCase()));
      return next.length === prev.length ? prev : next;
    });
  }, [target, peers]);

  if (!target) return null;
  const { candidate } = target;

  const toggleReviewer = (githubId: string, selectable: boolean) => {
    if (!selectable || !relayConnected) return;
    setSelectedIds((prev) => {
      if (prev.includes(githubId)) {
        return prev.filter((id) => id !== githubId);
      }
      if (prev.length >= maxReviewers) {
        if (maxReviewers === 1) return [githubId];
        return prev;
      }
      return [...prev, githubId];
    });
  };

  const handleSubmit = async () => {
    if (!relayConnected || selectedIds.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      if (isReplaceMode && target.replaceRequestId && target.replaceReviewerId) {
        await cancelAuthoredTeamReview(
          target.replaceRequestId,
          target.replaceReviewerId,
          "Replaced by author"
        ).catch(() => {});
      }

      const res = await submitTeamReviewRequest({
        project_id: candidate.project_id,
        worktree_path: candidate.worktree_path,
        repo_url: candidate.repo_url,
        pr_number: candidate.pr_number,
        pr_url: candidate.pr_url,
        pr_title: candidate.pr_title,
        base_branch: candidate.base_branch,
        head_branch: candidate.head_branch,
        head_sha: candidate.head_sha,
        reviewer_ids: selectedIds,
        assign_on_github: assignOnGithub,
      });

      if (res.request) {
        upsertAuthoredReview(res.request);
      } else {
        void listAuthoredTeamReviews()
          .then(setAuthoredReviews)
          .catch(() => {});
      }

      const who = res.reviewers_sent.map((id) => `@${id}`).join(", ");
      if (res.queued_offline) {
        showToast(
          `Relay offline — queued review request for ${who} in local outbox${
            res.gh_assigned ? " (GHE assigned)" : ""
          }.`,
          "info",
          4800
        );
      } else if (res.gh_error) {
        showToast(
          `Sent to Relay (${who}), but gh reviewer assign failed: ${res.gh_error}`,
          "error",
          5000
        );
      } else {
        const rejectedCount =
          res.request?.assignments.filter((a) => a.status === "rejected").length ??
          0;
        if (rejectedCount > 0) {
          showToast(
            `Requested ${who} (${rejectedCount} rejected immediately — see status bar).`,
            "info",
            4500
          );
        } else {
          showToast(`Review requested for PR #${candidate.pr_number}: ${who}`, "success");
        }
      }

      setReviewPickerTarget(null);
    } catch (err) {
      showToast(`Failed to request review: ${String(err)}`, "error", 5000);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0, 0, 0, 0.56)" }}
      onClick={() => {
        if (!submitting) setReviewPickerTarget(null);
      }}
    >
      <div
        className="w-full max-w-[540px] rounded-[22px] shadow-2xl overflow-hidden flex flex-col max-h-[84vh]"
        style={{
          background: "var(--modal-bg)",
          border: "1px solid var(--modal-border)",
          color: "var(--text-primary)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="px-5 py-4 flex items-start justify-between gap-3"
          style={{ borderBottom: "1px solid var(--divider)" }}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <GitPullRequest
                className="w-4 h-4 shrink-0"
                style={{ color: "var(--accent)" }}
              />
              <h3 className="text-sm font-extrabold tracking-tight">
                {isReplaceMode
                  ? `Replace @${target.replaceReviewerId} on PR #${candidate.pr_number}`
                  : `Request Auto-Review · PR #${candidate.pr_number}`}
              </h3>
              {candidate.is_draft && (
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{
                    background: "var(--warn-soft)",
                    color: "var(--warn-fg)",
                  }}
                >
                  DRAFT
                </span>
              )}
            </div>
            <p
              className="text-xs mt-1 truncate"
              style={{ color: "var(--text-muted)" }}
              title={candidate.pr_title}
            >
              {candidate.pr_title || candidate.head_branch} · {candidate.project_name}
            </p>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={() => setReviewPickerTarget(null)}
            className="p-1.5 rounded-xl cursor-pointer hover:opacity-80"
            style={{
              background: "var(--pill-bg)",
              color: "var(--text-muted)",
            }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Offline Banner */}
        {!relayConnected && (
          <div
            className="mx-5 mt-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2"
            style={{
              background: "var(--action-soft)",
              border: "1px solid var(--action-border)",
              color: "var(--action-fg)",
            }}
          >
            <WifiOff className="w-4 h-4 shrink-0" />
            <span>
              Relay server is offline — review requests are disabled while disconnected.
            </span>
          </div>
        )}

        {/* Search & Selected Chips */}
        <div className="px-5 pt-3.5 pb-2 space-y-2.5">
          <div className="flex items-center gap-2">
            <div
              className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-xl"
              style={{
                background: "var(--input-bg)",
                border: "1px solid var(--input-border)",
              }}
            >
              <Search
                className="w-3.5 h-3.5 shrink-0"
                style={{ color: "var(--text-muted)" }}
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter connected teammates..."
                className="w-full bg-transparent text-xs outline-none"
                style={{ color: "var(--text-primary)" }}
              />
            </div>
            <span
              className="text-[11px] font-mono-code font-bold px-2.5 py-1.5 rounded-xl shrink-0"
              style={{
                background:
                  selectedIds.length === maxReviewers
                    ? "var(--accent-soft)"
                    : "var(--pill-bg)",
                color:
                  selectedIds.length === maxReviewers
                    ? "var(--accent)"
                    : "var(--text-secondary)",
              }}
            >
              {selectedIds.length}/{maxReviewers} selected
            </span>
          </div>

          {selectedIds.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {selectedIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleReviewer(id, true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold cursor-pointer"
                  style={{
                    background: "var(--accent-soft)",
                    border: "1px solid var(--accent-border)",
                    color: "var(--accent)",
                  }}
                >
                  <span>@{id}</span>
                  <X className="w-3 h-3" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Peer Directory List */}
        <div className="px-5 py-2 overflow-y-auto flex-1 space-y-1.5 min-h-[160px]">
          {annotatedPeers.length === 0 ? (
            <div
              className="rounded-xl p-4 text-center text-xs space-y-1"
              style={{
                background: "var(--input-bg)",
                color: "var(--text-muted)",
              }}
            >
              <Users className="w-5 h-5 mx-auto opacity-60" />
              <p className="font-semibold">
                {peers.length === 0
                  ? "No teammates connected to Relay yet."
                  : "No teammates match your filter."}
              </p>
              <p className="text-[11px]">
                Only online teammates can be selected for auto-review.
              </p>
            </div>
          ) : (
            annotatedPeers.map((item) => {
              const id = item.peer.github_id;
              const isSelected = selectedIds.includes(id);
              const atCap = !isSelected && selectedIds.length >= maxReviewers && maxReviewers > 1;
              const isDisabled = !relayConnected || !item.selectable || atCap;
              const disabledTitle = !relayConnected
                ? "Relay is offline"
                : item.isOffline
                ? "Offline teammate — cannot select as reviewer"
                : item.isPaused
                ? "Auto-review is paused on teammate's PC — cannot select"
                : undefined;
              return (
                <button
                  key={id}
                  type="button"
                  disabled={isDisabled}
                  title={disabledTitle}
                  onClick={() => toggleReviewer(id, item.selectable)}
                  className="w-full text-left px-3 py-2.5 rounded-xl flex items-center justify-between gap-2 transition-opacity cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                  style={{
                    background: isSelected
                      ? "var(--accent-soft)"
                      : "var(--input-bg)",
                    border: isSelected
                      ? "1.5px solid var(--accent-border)"
                      : "1px solid var(--divider)",
                  }}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
                      style={{
                        background: isSelected ? "var(--accent)" : "var(--pill-bg)",
                        color: isSelected ? "#ffffff" : "var(--text-faint)",
                      }}
                    >
                      {isSelected ? <Check className="w-3.5 h-3.5" /> : null}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold font-mono-code truncate">
                          @{id}
                        </span>
                        {item.peer.display_name &&
                          item.peer.display_name.toLowerCase() !==
                            id.toLowerCase() && (
                            <span
                              className="text-[11px] truncate"
                              style={{ color: "var(--text-muted)" }}
                            >
                              ({item.peer.display_name})
                            </span>
                          )}
                        {item.alreadyRequested && (
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                            style={{
                              background: "var(--pill-bg)",
                              color: "var(--text-muted)",
                            }}
                          >
                            GHE assigned
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 text-[10.5px] font-semibold">
                    <span
                      className="px-2 py-0.5 rounded-full"
                      style={
                        item.hasRepo
                          ? {
                              background: "var(--ready-soft)",
                              color: "var(--ready-fg)",
                            }
                          : {
                              background: "var(--pill-bg)",
                              color: "var(--text-faint)",
                            }
                      }
                      title={
                        item.hasRepo
                          ? "Has this repository registered in jjdr"
                          : "Repository not registered on teammate's jjdr (may be rejected)"
                      }
                    >
                      {item.hasRepo ? "Repo OK" : "No Repo"}
                    </span>

                    {item.isOnline ? (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
                        style={{
                          background: "var(--run-soft)",
                          color: "var(--run-fg)",
                        }}
                      >
                        <Wifi className="w-2.5 h-2.5" />
                        Online
                      </span>
                    ) : item.isPaused ? (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
                        style={{
                          background: "var(--warn-soft)",
                          color: "var(--warn-fg)",
                        }}
                      >
                        <PauseCircle className="w-2.5 h-2.5" />
                        Paused
                      </span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
                        style={{
                          background: "var(--pill-bg)",
                          color: "var(--text-muted)",
                        }}
                      >
                        <WifiOff className="w-2.5 h-2.5" />
                        Offline
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div
          className="px-5 py-3.5 flex items-center justify-between gap-3"
          style={{ borderTop: "1px solid var(--divider)" }}
        >
          <label className="inline-flex items-center gap-2 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={assignOnGithub}
              onChange={(e) => setAssignOnGithub(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            <span style={{ color: "var(--text-secondary)" }}>
              Also assign on GitHub (<code>gh pr edit</code>)
            </span>
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => setReviewPickerTarget(null)}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold cursor-pointer"
              style={{
                background: "var(--pill-bg)",
                color: "var(--text-secondary)",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!relayConnected || selectedIds.length === 0 || submitting}
              onClick={() => void handleSubmit()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-45 transition-opacity hover:opacity-90"
              style={{
                background: "var(--accent)",
                color: "#ffffff",
              }}
            >
              {submitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              <span>
                {isReplaceMode
                  ? "Replace Reviewer"
                  : `Send Request (${selectedIds.length}/${maxReviewers})`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
