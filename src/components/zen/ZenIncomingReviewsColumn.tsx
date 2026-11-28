import React, { useMemo, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  FileText,
  Inbox,
  Terminal,
  X,
} from "lucide-react";
import type { AutoReviewJob } from "../../types/domain";
import {
  ackAutoReviewJob,
  cancelAutoReviewJob,
  openExternalUrl,
} from "../../services/tauriBridge";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import { formatElapsed } from "../../utils/format";

interface ZenIncomingReviewsColumnProps {
  jobs: AutoReviewJob[];
  onPeekTerminal: (address: string) => void;
}

const PHASE_META: Record<
  string,
  { label: string; bg: string; border: string; fg: string; pulse?: boolean }
> = {
  ready_for_ack: {
    label: "Ready for Ack",
    bg: "var(--ready-soft)",
    border: "var(--ready-border)",
    fg: "var(--ready-fg)",
  },
  reviewing: {
    label: "Reviewing",
    bg: "var(--run-soft)",
    border: "var(--run-border)",
    fg: "var(--run-fg)",
    pulse: true,
  },
  creating_wt: {
    label: "Preparing WT",
    bg: "var(--run-soft)",
    border: "var(--run-border)",
    fg: "var(--run-fg)",
    pulse: true,
  },
  queued: {
    label: "Queued",
    bg: "var(--pill-bg)",
    border: "var(--pill-border)",
    fg: "var(--text-secondary)",
  },
  cleaning_up: {
    label: "Cleaning Up",
    bg: "var(--pill-bg)",
    border: "var(--pill-border)",
    fg: "var(--text-muted)",
  },
  failed: {
    label: "Failed",
    bg: "var(--action-soft)",
    border: "var(--action-border)",
    fg: "var(--action-fg)",
  },
};

export const ZenIncomingReviewsColumn = React.memo(
  function ZenIncomingReviewsColumn({
    jobs,
    onPeekTerminal,
  }: ZenIncomingReviewsColumnProps) {
    const showToast = useUiStore((s) => s.showToast);
    const setMarkdownViewerTarget = useUiStore((s) => s.setMarkdownViewerTarget);
    const [busyId, setBusyId] = useState<string | null>(null);

    // Subscribe only to a primitive key of live matching terminal addresses so streaming terminal output causes ZERO re-renders
    const liveReviewTerminalsKey = useAppStore((s) => {
      if (jobs.length === 0) return "";
      let key = "";
      for (const job of jobs) {
        const addr = job.terminal_address;
        if (addr && s.terminals[addr]?.state === "live") {
          key += `${addr}\0`;
        }
      }
      return key;
    });

    const liveReviewTerminalSet = useMemo(() => {
      if (!liveReviewTerminalsKey) return new Set<string>();
      return new Set(liveReviewTerminalsKey.split("\0").filter(Boolean));
    }, [liveReviewTerminalsKey]);

    const handleAck = async (job: AutoReviewJob) => {
      setBusyId(job.request_id);
      try {
        await ackAutoReviewJob(job.request_id);
        showToast(
          `PR #${job.pr_number} 리뷰 결재 완료 · 임시 Worktree 정리 중`,
          "success",
          2200
        );
      } catch (err) {
        showToast(`결재 실패: ${String(err)}`, "error");
      } finally {
        setBusyId(null);
      }
    };

    const handleCancel = async (job: AutoReviewJob) => {
      setBusyId(job.request_id);
      try {
        await cancelAutoReviewJob(job.request_id);
        showToast(`PR #${job.pr_number} 자동 리뷰를 취소했습니다`, "info", 1800);
      } catch (err) {
        showToast(`취소 실패: ${String(err)}`, "error");
      } finally {
        setBusyId(null);
      }
    };

    const handleOpenReport = (job: AutoReviewJob) => {
      if (!job.report_path) return;
      const root = job.worktree_path || job.repo_path;
      setMarkdownViewerTarget({
        absolutePath: job.report_path,
        relativePath: `.jjdr-review-pr${job.pr_number}.md`,
        projectName: `${job.project_name} · PR #${job.pr_number} Review`,
        rootPath: root,
      });
    };

    return (
      <section className="flex flex-col min-h-0 rounded-2xl overflow-hidden jjdr-tray">
        <div
          className="px-4 py-2.5 flex items-center justify-between gap-2 shrink-0"
          style={{ borderBottom: "1px solid var(--divider)" }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Inbox className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--ready-fg)" }} />
            <span
              className="text-xs font-bold truncate"
              style={{ color: "var(--text-primary)" }}
            >
              Incoming Auto-Reviews (나에게 온 리뷰)
            </span>
            <span
              className="text-[10.5px] font-mono-code px-1.5 py-0.5 rounded-full"
              style={{ background: "var(--pill-bg)", color: "var(--text-muted)" }}
            >
              {jobs.length}
            </span>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
          {jobs.length === 0 ? (
            <div className="py-10 px-4 text-center space-y-2">
              <p className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                현재 진행 중이거나 대기 중인 자동 리뷰가 없습니다
              </p>
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                팀원이 리뷰를 요청하면 이곳과 Zen Inbox에 실시간으로 표시됩니다.
              </p>
            </div>
          ) : (
            jobs.map((job) => {
              const meta = PHASE_META[job.phase] ?? PHASE_META.queued;
              const isBusy = busyId === job.request_id;
              const liveTerminalAddr =
                job.terminal_address &&
                liveReviewTerminalSet.has(job.terminal_address)
                  ? job.terminal_address
                  : null;

              return (
                <div
                  key={job.request_id}
                  className="rounded-2xl p-3 space-y-2"
                  style={{
                    background: "var(--card-bg)",
                    border: `1px solid ${
                      job.phase === "ready_for_ack"
                        ? "var(--ready-border)"
                        : "var(--card-border)"
                    }`,
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className="inline-flex items-center gap-1 text-[10.5px] font-mono-code font-bold px-2 py-0.5 rounded-full"
                          style={{
                            background: meta.bg,
                            border: `1px solid ${meta.border}`,
                            color: meta.fg,
                          }}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              meta.pulse ? "jjdr-dot-pulse" : ""
                            }`}
                            style={{ background: meta.fg }}
                          />
                          {meta.label}
                        </span>
                        <span
                          className="text-[10.5px] font-mono-code font-semibold"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {job.project_name} · PR #{job.pr_number}
                        </span>
                        <span
                          className="text-[10.5px] font-mono-code"
                          style={{ color: "var(--text-muted)" }}
                        >
                          by @{job.author_id}
                        </span>
                      </div>

                      <div
                        className="text-xs font-bold mt-1 truncate"
                        style={{ color: "var(--text-primary)" }}
                        title={job.pr_title}
                      >
                        {job.pr_title || `PR #${job.pr_number}`}
                      </div>

                      <div
                        className="text-[10.5px] font-mono-code flex items-center gap-2 flex-wrap mt-0.5"
                        style={{ color: "var(--text-faint)" }}
                      >
                        <span>
                          {job.agent_id}
                          {job.model ? ` (${job.model})` : ""}
                        </span>
                        <span>· {formatElapsed(Date.now() - job.created_ms)}</span>
                        {job.fallback_used && (
                          <span style={{ color: "var(--warn-fg)" }}>· Fallback</span>
                        )}
                      </div>

                      {job.last_error && (
                        <div
                          className="mt-1.5 text-[11px] font-mono-code px-2.5 py-1 rounded-lg"
                          style={{
                            background: "var(--action-soft)",
                            color: "var(--action-fg)",
                          }}
                        >
                          {job.last_error}
                        </div>
                      )}
                    </div>

                    {job.pr_url && (
                      <button
                        type="button"
                        onClick={() => void openExternalUrl(job.pr_url)}
                        title="GitHub에서 PR 열기"
                        className="jjdr-pill p-1.5 rounded-full cursor-pointer shrink-0"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {/* Quick Actions */}
                  <div className="flex items-center justify-end gap-1.5 flex-wrap pt-0.5">
                    {liveTerminalAddr && (
                      <button
                        type="button"
                        onClick={() => onPeekTerminal(liveTerminalAddr)}
                        className="jjdr-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold cursor-pointer"
                        style={{ color: "var(--run-fg)" }}
                      >
                        <Terminal className="w-3 h-3" />
                        <span>Peek</span>
                      </button>
                    )}
                    {job.report_path && (
                      <button
                        type="button"
                        onClick={() => handleOpenReport(job)}
                        className="jjdr-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold cursor-pointer"
                        style={{ color: "var(--accent)" }}
                      >
                        <FileText className="w-3 h-3" />
                        <span>Review MD</span>
                      </button>
                    )}
                    {job.phase === "ready_for_ack" && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleAck(job)}
                        className="jjdr-primary-btn inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-bold cursor-pointer disabled:opacity-40"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Ack & Cleanup</span>
                      </button>
                    )}
                    {(job.phase === "queued" ||
                      job.phase === "reviewing" ||
                      job.phase === "creating_wt" ||
                      job.phase === "failed") && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleCancel(job)}
                        className="jjdr-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold cursor-pointer disabled:opacity-40"
                        style={{ color: "var(--action-fg)" }}
                      >
                        <X className="w-3 h-3" />
                        <span>{job.phase === "failed" ? "Dismiss" : "Cancel"}</span>
                      </button>
                    )}
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
