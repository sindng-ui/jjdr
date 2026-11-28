import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FolderGit2,
  GitPullRequest,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import {
  inspectPrForReviewRequest,
  listMyOpenPrs,
} from "../../services/tauriBridge";
import type { MyOpenPrItem } from "../../types/domain";
import { parsePrNumberOrUrl } from "../../utils/zenReviews";

interface ManualPrReviewModalProps {
  onClose: () => void;
}

export const ManualPrReviewModal = React.memo(function ManualPrReviewModal({
  onClose,
}: ManualPrReviewModalProps) {
  const projects = useAppStore((s) => s.projects);
  const selectedProjectId = useUiStore((s) => s.selectedProjectId);
  const setReviewPickerTarget = useUiStore((s) => s.setReviewPickerTarget);
  const showToast = useUiStore((s) => s.showToast);

  const [projectId, setProjectId] = useState<string>(
    () =>
      (selectedProjectId &&
        projects.some((p) => p.id === selectedProjectId) &&
        selectedProjectId) ||
      projects[0]?.id ||
      ""
  );
  const [manualInput, setManualInput] = useState("");
  const [openPrs, setOpenPrs] = useState<MyOpenPrItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [submittingPr, setSubmittingPr] = useState<number | null>(null);

  const reqGenRef = useRef(0);

  const loadOpenPrs = useCallback(
    async (pid: string, forceRefresh = false) => {
      if (!pid) {
        setOpenPrs([]);
        return;
      }
      const gen = ++reqGenRef.current;
      setLoadingList(true);
      setListError(null);
      try {
        const items = await listMyOpenPrs(pid, forceRefresh);
        if (gen !== reqGenRef.current) return;
        setOpenPrs(items);
      } catch (err) {
        if (gen !== reqGenRef.current) return;
        setOpenPrs([]);
        setListError(String(err));
      } finally {
        if (gen === reqGenRef.current) setLoadingList(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadOpenPrs(projectId, false);
  }, [projectId, loadOpenPrs]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const openPickerForPr = useCallback(
    async (prNumber: number, prUrlHint?: string | null) => {
      const proj = projects.find((p) => p.id === projectId);
      if (!proj) {
        showToast("프로젝트를 먼저 선택해주세요.", "error");
        return;
      }
      setSubmittingPr(prNumber);
      try {
        const candidate = await inspectPrForReviewRequest({
          projectId: proj.id,
          worktreePath: proj.repo_path,
          prNumber,
          prUrlHint: prUrlHint ?? null,
          manual: true,
        });
        onClose();
        setReviewPickerTarget({ candidate, maxReviewers: 2 });
      } catch (err) {
        showToast(`PR #${prNumber} 조회 실패: ${String(err)}`, "error");
      } finally {
        setSubmittingPr(null);
      }
    },
    [projects, projectId, onClose, setReviewPickerTarget, showToast]
  );

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const prNumber = parsePrNumberOrUrl(manualInput);
    if (!prNumber) {
      showToast("PR 번호(예: 3) 또는 GitHub PR URL을 입력해주세요.", "error");
      return;
    }
    const urlHint = manualInput.trim().startsWith("http")
      ? manualInput.trim()
      : null;
    void openPickerForPr(prNumber, urlHint);
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: "var(--modal-overlay)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="jjdr-modal w-full max-w-[600px] rounded-[22px] overflow-hidden flex flex-col"
        style={{ maxHeight: "76vh" }}
      >
        {/* Header */}
        <div
          className="px-5 py-3.5 flex items-center justify-between gap-2 shrink-0"
          style={{ borderBottom: "1px solid var(--divider)" }}
        >
          <div className="flex items-center gap-2">
            <GitPullRequest className="w-4 h-4" style={{ color: "var(--accent)" }} />
            <h3 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              수동 팀 리뷰 요청 (PR 선택)
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-black/15 cursor-pointer"
            style={{ color: "var(--text-muted)" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Project Picker + Direct PR# / URL Input */}
        <div
          className="px-5 py-3 space-y-2.5 shrink-0"
          style={{
            background: "var(--modal-footer)",
            borderBottom: "1px solid var(--divider)",
          }}
        >
          <div className="flex items-center gap-2">
            <FolderGit2
              className="w-3.5 h-3.5 shrink-0"
              style={{ color: "var(--accent)" }}
            />
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="jjdr-input flex-1 px-3 py-1.5 rounded-full text-xs font-mono-code cursor-pointer"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.repo_path})
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={loadingList || !projectId}
              onClick={() => void loadOpenPrs(projectId, true)}
              title="내 오픈 PR 목록 새로고침 (20초 캐시 무시)"
              className="jjdr-pill p-1.5 rounded-full cursor-pointer disabled:opacity-40"
              style={{ color: "var(--text-secondary)" }}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingList ? "animate-spin" : ""}`} />
            </button>
          </div>

          <form onSubmit={handleManualSubmit} className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search
                className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: "var(--text-muted)" }}
              />
              <input
                type="text"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder="PR 번호(예: 3) 또는 PR URL 직접 입력 후 Enter..."
                className="jjdr-input w-full pl-8 pr-3 py-1.5 rounded-full text-xs font-mono-code"
              />
            </div>
            <button
              type="submit"
              disabled={submittingPr !== null || !manualInput.trim()}
              className="jjdr-primary-btn px-3.5 py-1.5 rounded-full text-xs font-bold cursor-pointer disabled:opacity-40 shrink-0"
            >
              조회
            </button>
          </form>
        </div>

        {/* Auto-loaded My Open PRs (20s cached) */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2">
          <div className="flex items-center justify-between text-[11px] px-1">
            <span className="font-semibold" style={{ color: "var(--text-secondary)" }}>
              내가 열어둔 오픈 PR (`gh pr list --author @me`)
            </span>
            <span className="font-mono-code" style={{ color: "var(--text-faint)" }}>
              20초 캐시
            </span>
          </div>

          {loadingList ? (
            <div
              className="py-10 flex items-center justify-center gap-2 text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>오픈 PR 목록을 불러오는 중...</span>
            </div>
          ) : listError ? (
            <div
              className="p-3 rounded-xl text-xs font-mono-code"
              style={{
                background: "var(--action-soft)",
                border: "1px solid var(--action-border)",
                color: "var(--action-fg)",
              }}
            >
              {listError}
            </div>
          ) : openPrs.length === 0 ? (
            <div
              className="py-10 text-center text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              이 프로젝트에 내가 열어둔 오픈 PR이 없습니다. 위 입력칸에 PR 번호를 직접
              입력할 수도 있습니다.
            </div>
          ) : (
            openPrs.map((pr) => {
              const busy = submittingPr === pr.pr_number;
              return (
                <button
                  key={pr.pr_number}
                  type="button"
                  disabled={submittingPr !== null}
                  onClick={() => void openPickerForPr(pr.pr_number, pr.pr_url)}
                  className="w-full text-left rounded-2xl p-3 flex items-center justify-between gap-3 cursor-pointer jjdr-card-lift disabled:opacity-50"
                  style={{
                    background: "var(--card-bg)",
                    border: "1px solid var(--card-border)",
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className="text-[11px] font-mono-code font-bold px-2 py-0.5 rounded-full"
                        style={{
                          background: "var(--accent-soft)",
                          color: "var(--accent)",
                        }}
                      >
                        #{pr.pr_number}
                      </span>
                      {pr.is_draft && (
                        <span
                          className="text-[10px] font-mono-code px-1.5 py-0.5 rounded-full"
                          style={{
                            background: "var(--warn-soft)",
                            color: "var(--warn-fg)",
                          }}
                        >
                          Draft
                        </span>
                      )}
                      <span
                        className="text-xs font-bold truncate"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {pr.pr_title}
                      </span>
                    </div>
                    <div
                      className="text-[10.5px] font-mono-code truncate mt-0.5"
                      style={{ color: "var(--text-faint)" }}
                    >
                      {pr.head_branch} → {pr.base_branch}
                      {pr.already_requested_reviewers.length > 0 &&
                        ` · 요청됨: ${pr.already_requested_reviewers
                          .map((r) => `@${r}`)
                          .join(", ")}`}
                    </div>
                  </div>
                  <span
                    className="text-[11px] font-bold shrink-0"
                    style={{ color: "var(--accent)" }}
                  >
                    {busy ? "조회 중..." : "선택 →"}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
});
