import React, { useMemo, useState } from "react";
import {
  ExternalLink,
  GitPullRequest,
  Plus,
  RefreshCw,
  Send,
  X,
} from "lucide-react";
import type {
  ProjectConfig,
  ReviewRequestWithAssignments,
  TeamPeerInfo,
  TeamPresenceStatus,
} from "../../types/domain";
import {
  cancelAuthoredTeamReview,
  inspectPrForReviewRequest,
  listAuthoredTeamReviews,
  openExternalUrl,
} from "../../services/tauriBridge";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import {
  formatAssignmentChip,
  normalizeGithubHandle,
  normalizeRepoKey,
} from "../../utils/teamReviews";
import { formatElapsed } from "../../utils/format";

interface ZenOutgoingReviewsColumnProps {
  reviews: ReviewRequestWithAssignments[];
  peers: TeamPeerInfo[];
  projects: ProjectConfig[];
  relayConnected: boolean;
  onOpenManualModal: () => void;
}

const TONE_STYLE: Record<
  "run" | "ready" | "warn" | "action" | "muted",
  { bg: string; border: string; fg: string }
> = {
  run: { bg: "var(--run-soft)", border: "var(--run-border)", fg: "var(--run-fg)" },
  ready: {
    bg: "var(--ready-soft)",
    border: "var(--ready-border)",
    fg: "var(--ready-fg)",
  },
  warn: { bg: "var(--warn-soft)", border: "var(--warn-border)", fg: "var(--warn-fg)" },
  action: {
    bg: "var(--action-soft)",
    border: "var(--action-border)",
    fg: "var(--action-fg)",
  },
  muted: { bg: "var(--pill-bg)", border: "var(--pill-border)", fg: "var(--text-muted)" },
};

function findProjectForReview(
  item: ReviewRequestWithAssignments,
  projects: ProjectConfig[]
): ProjectConfig | null {
  const normRepo = normalizeRepoKey(item.request.repo_url);
  const repoLeaf = normRepo.split("/").pop() ?? "";
  return (
    projects.find(
      (p) =>
        p.name.toLowerCase() === repoLeaf ||
        p.repo_path.toLowerCase().endsWith(`/${repoLeaf}`) ||
        p.repo_path.toLowerCase().endsWith(`\\${repoLeaf}`)
    ) ??
    projects[0] ??
    null
  );
}

export const ZenOutgoingReviewsColumn = React.memo(
  function ZenOutgoingReviewsColumn({
    reviews,
    peers,
    projects,
    relayConnected,
    onOpenManualModal,
  }: ZenOutgoingReviewsColumnProps) {
    const showToast = useUiStore((s) => s.showToast);
    const setReviewPickerTarget = useUiStore((s) => s.setReviewPickerTarget);
    const setAuthoredReviews = useAppStore((s) => s.setAuthoredReviews);
    const [busyKey, setBusyKey] = useState<string | null>(null);

    const peerStatusByHandle = useMemo(() => {
      const map = new Map<string, TeamPresenceStatus>();
      for (const peer of peers) {
        const key = normalizeGithubHandle(peer.github_id);
        if (key) map.set(key, peer.status);
      }
      return map;
    }, [peers]);

    const handleCancel = async (requestId: string, reviewerId: string) => {
      const key = `cancel:${requestId}:${reviewerId}`;
      setBusyKey(key);
      try {
        await cancelAuthoredTeamReview(requestId, reviewerId, "cancelled_by_author");
        const refreshed = await listAuthoredTeamReviews();
        setAuthoredReviews(refreshed);
        showToast(`@${reviewerId} 리뷰 요청을 취소했습니다`, "info", 1800);
      } catch (err) {
        showToast(`취소 실패: ${String(err)}`, "error");
      } finally {
        setBusyKey(null);
      }
    };

    const handleReplaceOrAdd = async (
      item: ReviewRequestWithAssignments,
      replaceReviewerId?: string
    ) => {
      if (!relayConnected) {
        showToast("Relay 연결이 꺼져 있어 리뷰어를 지정할 수 없습니다.", "error");
        return;
      }
      const project = findProjectForReview(item, projects);
      if (!project) {
        showToast("매칭되는 등록 프로젝트를 찾지 못했습니다.", "error");
        return;
      }
      const key = `pick:${item.request.request_id}:${replaceReviewerId ?? "add"}`;
      setBusyKey(key);
      try {
        const candidate = await inspectPrForReviewRequest({
          projectId: project.id,
          worktreePath: project.repo_path,
          prNumber: item.request.pr_number,
          prUrlHint: item.request.pr_url,
          manual: true,
        });
        setReviewPickerTarget({
          candidate,
          replaceRequestId: replaceReviewerId ? item.request.request_id : undefined,
          replaceReviewerId,
          maxReviewers: replaceReviewerId ? 1 : 2,
        });
      } catch (err) {
        showToast(`PR 조회 실패: ${String(err)}`, "error");
      } finally {
        setBusyKey(null);
      }
    };

    return (
      <section className="flex flex-col min-h-0 rounded-2xl overflow-hidden jjdr-tray">
        <div
          className="px-4 py-2.5 flex items-center justify-between gap-2 shrink-0"
          style={{ borderBottom: "1px solid var(--divider)" }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Send className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--accent)" }} />
            <span
              className="text-xs font-bold truncate"
              style={{ color: "var(--text-primary)" }}
            >
              Sent Reviews (내가 요청한 PR)
            </span>
            <span
              className="text-[10.5px] font-mono-code px-1.5 py-0.5 rounded-full"
              style={{ background: "var(--pill-bg)", color: "var(--text-muted)" }}
            >
              {reviews.length}
            </span>
          </div>
          <button
            type="button"
            onClick={onOpenManualModal}
            className="jjdr-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold cursor-pointer"
            style={{ color: "var(--accent)" }}
          >
            <Plus className="w-3 h-3" />
            <span>Request</span>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
          {reviews.length === 0 ? (
            <div className="py-10 px-4 text-center space-y-2.5">
              <p className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                아직 요청한 팀 리뷰가 없습니다
              </p>
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                상단 [+ Request Review] 버튼으로 내가 열어둔 PR을 골라 팀원에게 바로
                리뷰를 요청해보세요.
              </p>
            </div>
          ) : (
            reviews.map((item) => {
              const { request, assignments } = item;
              const repoShort = request.repo_url.split("/").pop() ?? request.repo_url;
              const activeCount = assignments.filter(
                (a) =>
                  a.status === "queued" ||
                  a.status === "reviewing" ||
                  a.status === "dispatched" ||
                  a.status === "delivered" ||
                  a.status === "completed"
              ).length;
              const canAddMore = activeCount < 2 && relayConnected;

              return (
                <div
                  key={request.request_id}
                  className="rounded-2xl p-3 space-y-2"
                  style={{
                    background: "var(--card-bg)",
                    border: "1px solid var(--card-border)",
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className="inline-flex items-center gap-1 text-[10.5px] font-mono-code font-bold px-2 py-0.5 rounded-full"
                          style={{
                            background: "var(--accent-soft)",
                            color: "var(--accent)",
                          }}
                        >
                          <GitPullRequest className="w-3 h-3" />
                          PR #{request.pr_number}
                        </span>
                        <span
                          className="text-[10.5px] font-mono-code"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {repoShort}
                        </span>
                        <span
                          className="text-[10px] font-mono-code"
                          style={{ color: "var(--text-faint)" }}
                        >
                          · {formatElapsed(Date.now() - request.created_ms)}
                        </span>
                      </div>
                      <div
                        className="text-xs font-bold mt-1 truncate"
                        style={{ color: "var(--text-primary)" }}
                        title={request.pr_title}
                      >
                        {request.pr_title || `PR #${request.pr_number}`}
                      </div>
                      <div
                        className="text-[10.5px] font-mono-code truncate"
                        style={{ color: "var(--text-faint)" }}
                      >
                        {request.head_branch} → {request.base_branch}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {canAddMore && (
                        <button
                          type="button"
                          disabled={busyKey !== null}
                          onClick={() => void handleReplaceOrAdd(item)}
                          title="리뷰어 추가 배정"
                          className="jjdr-pill inline-flex items-center gap-0.5 px-2 py-1 rounded-full text-[10.5px] font-semibold cursor-pointer disabled:opacity-40"
                          style={{ color: "var(--accent)" }}
                        >
                          <Plus className="w-3 h-3" />
                          <span>Add</span>
                        </button>
                      )}
                      {request.pr_url && (
                        <button
                          type="button"
                          onClick={() => void openExternalUrl(request.pr_url)}
                          title="GitHub에서 PR 열기"
                          className="jjdr-pill p-1.5 rounded-full cursor-pointer"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Reviewer assignment status chips */}
                  <div className="flex flex-wrap gap-1.5">
                    {assignments.map((a) => {
                      const peerStatus = peerStatusByHandle.get(
                        normalizeGithubHandle(a.reviewer_id)
                      );
                      const chip = formatAssignmentChip(a, peerStatus);
                      const tone = TONE_STYLE[chip.tone];
                      const isBusy =
                        busyKey === `cancel:${request.request_id}:${a.reviewer_id}` ||
                        busyKey === `pick:${request.request_id}:${a.reviewer_id}`;
                      return (
                        <div
                          key={`${a.request_id}:${a.reviewer_id}`}
                          title={chip.tooltip}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono-code"
                          style={{
                            background: tone.bg,
                            border: `1px solid ${tone.border}`,
                            color: tone.fg,
                          }}
                        >
                          <span className="font-semibold">@{a.reviewer_id}</span>
                          <span>{chip.shortLabel}</span>
                          {chip.canReplace && (
                            <button
                              type="button"
                              disabled={isBusy || !relayConnected}
                              onClick={() =>
                                void handleReplaceOrAdd(item, a.reviewer_id)
                              }
                              title="다른 온라인 팀원으로 교체"
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-bold hover:bg-black/15 cursor-pointer disabled:opacity-40"
                            >
                              <RefreshCw className="w-2.5 h-2.5" />
                              <span>Replace</span>
                            </button>
                          )}
                          {chip.canCancel && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void handleCancel(request.request_id, a.reviewer_id)
                              }
                              title="이 리뷰어 요청 취소"
                              className="p-0.5 rounded-full hover:bg-black/15 cursor-pointer disabled:opacity-40"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    );
  }
);
