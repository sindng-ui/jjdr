import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  SkipForward,
  Sparkles,
  X,
} from "lucide-react";
import { useUiStore } from "../../store/useUiStore";
import {
  downloadAndInstallUpdate,
  isTauriRuntime,
  listenUpdateProgress,
  openExternalUrl,
} from "../../services/tauriBridge";
import { skipUpdateVersion } from "../../hooks/useUpdateChecker";
import { renderMarkdownToHtml } from "../../utils/markdownRenderer";
import {
  formatBytes,
  formatReleaseDate,
  resolveReleaseNotesMarkdown,
} from "../../utils/updatePolicy";
import type { UpdateProgressEvent } from "../../types/domain";
import "../../styles/githubMarkdown.css";

type UpdatePhase = "idle" | "downloading" | "launching" | "done" | "error";

export const UpdateModal = React.memo(function UpdateModal() {
  const open = useUiStore((s) => s.updateModalOpen);
  const info = useUiStore((s) => s.updateInfo);
  const setOpen = useUiStore((s) => s.setUpdateModalOpen);
  const setModalBusy = useUiStore((s) => s.setUpdateModalBusy);
  const showToast = useUiStore((s) => s.showToast);

  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [progress, setProgress] = useState<UpdateProgressEvent | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dryRunPath, setDryRunPath] = useState<string | null>(null);

  const busy = phase === "downloading" || phase === "launching";

  useEffect(() => {
    setModalBusy(open && busy);
    return () => {
      setModalBusy(false);
    };
  }, [open, busy, setModalBusy]);

  useEffect(() => {
    if (!open) {
      setPhase("idle");
      setProgress(null);
      setErrorMsg(null);
      setDryRunPath(null);
      return;
    }
    if (!isTauriRuntime()) return;

    let active = true;
    let unlisten: (() => void) | null = null;
    void listenUpdateProgress((ev) => {
      if (!active) return;
      setProgress(ev);
      if (ev.stage === "downloading") setPhase("downloading");
      else if (ev.stage === "launching") setPhase("launching");
      else if (ev.stage === "done") setPhase("done");
      else if (ev.stage === "error") {
        setPhase("error");
        setErrorMsg(ev.message ?? "다운로드 중 오류가 발생했습니다.");
      }
    }).then((fn) => {
      if (active) unlisten = fn;
      else fn();
    });

    return () => {
      active = false;
      if (unlisten) unlisten();
    };
  }, [open]);

  const renderedNotesHtml = useMemo(() => {
    if (!info) return "";
    const md = resolveReleaseNotesMarkdown(
      info.release_notes,
      info.latest_version
    );
    return renderMarkdownToHtml(md);
  }, [info]);

  if (!open || !info) return null;

  const hasDirectInstaller = Boolean(
    info.asset_download_url && info.asset_name
  );
  const releaseDate = formatReleaseDate(info.published_at);
  const assetSizeLabel = formatBytes(info.asset_size_bytes);

  const handleClose = () => {
    if (busy) return;
    setOpen(false);
  };

  const handleSkip = () => {
    if (busy) return;
    void skipUpdateVersion(info.latest_version);
  };

  const handleOpenReleasePage = () => {
    void openExternalUrl(info.release_url).catch((err) =>
      showToast(`브라우저 열기 실패: ${String(err)}`, "error")
    );
  };

  const handleStartUpdate = async () => {
    if (busy) return;

    if (!hasDirectInstaller || !isTauriRuntime()) {
      handleOpenReleasePage();
      return;
    }

    setPhase("downloading");
    setErrorMsg(null);
    setDryRunPath(null);
    setProgress({
      stage: "downloading",
      downloaded_bytes: 0,
      total_bytes: info.asset_size_bytes ?? null,
      percent: 0,
      message: null,
    });

    try {
      const outcome = await downloadAndInstallUpdate(
        info.asset_download_url!,
        info.asset_name!
      );
      if (outcome.dry_run) {
        setPhase("done");
        setDryRunPath(outcome.file_path);
        showToast("Dry-run 다운로드 완료 (인스톨러 미실행)", "success");
      } else {
        setPhase("launching");
      }
    } catch (err) {
      setPhase("error");
      setErrorMsg(String(err));
    }
  };

  const handleMarkdownClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    const copyBtn = target?.closest<HTMLButtonElement>("[data-copy-code]");
    if (copyBtn) {
      const codeText =
        copyBtn.closest(".md-code-block")?.querySelector("pre code")
          ?.textContent ?? "";
      if (codeText) {
        void navigator.clipboard.writeText(codeText).then(() => {
          const prev = copyBtn.textContent;
          copyBtn.textContent = "Copied!";
          setTimeout(() => {
            copyBtn.textContent = prev || "Copy";
          }, 1200);
        });
      }
      return;
    }

    const link = target?.closest<HTMLAnchorElement>("a[href]");
    if (link) {
      const href = link.getAttribute("href") ?? "";
      if (href.startsWith("http://") || href.startsWith("https://")) {
        e.preventDefault();
        void openExternalUrl(href).catch(() => {});
      }
    }
  };

  const percent = progress?.percent ?? null;
  const downloadedLabel = formatBytes(progress?.downloaded_bytes);
  const totalLabel = formatBytes(
    progress?.total_bytes ?? info.asset_size_bytes
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="새 버전 업데이트 가능"
      onClick={(e) => e.stopPropagation()}
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ background: "var(--modal-overlay)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="jjdr-modal w-full max-w-2xl max-h-[84vh] rounded-[22px] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div
          className="px-5 py-4 flex items-start justify-between gap-3 shrink-0"
          style={{ borderBottom: "1px solid var(--divider)" }}
        >
          <div className="flex items-start gap-3 min-w-0">
            <div
              className="w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 mt-0.5"
              style={{
                background: "var(--accent-soft)",
                color: "var(--accent)",
              }}
            >
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3
                  className="text-sm font-bold"
                  style={{ color: "var(--text-primary)" }}
                >
                  새 버전 업데이트 가능
                </h3>
                <span
                  className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono-code font-semibold"
                  style={{
                    background: "var(--accent-soft)",
                    color: "var(--accent)",
                  }}
                >
                  <span>v{info.current_version}</span>
                  <ArrowRight className="w-3 h-3" />
                  <span>v{info.latest_version}</span>
                </span>
              </div>
              <p
                className="text-[11px] mt-1 truncate"
                style={{ color: "var(--text-muted)" }}
              >
                {info.release_name}
                {releaseDate ? ` · ${releaseDate}` : ""}
                {assetSizeLabel ? ` · ${assetSizeLabel}` : ""}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            title="이번만 닫기"
            className="p-1.5 rounded-full hover:bg-black/15 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ color: "var(--text-muted)" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* What's New Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <span
              className="text-[11px] font-bold uppercase tracking-wider"
              style={{ color: "var(--text-muted)" }}
            >
              What&apos;s New
            </span>
            <button
              type="button"
              onClick={handleOpenReleasePage}
              className="inline-flex items-center gap-1 text-[11px] font-medium hover:underline cursor-pointer"
              style={{ color: "var(--accent)" }}
            >
              <span>GitHub 릴리즈 페이지</span>
              <ExternalLink className="w-3 h-3" />
            </button>
          </div>

          <div
            className="rounded-2xl p-4"
            style={{
              background: "var(--input-bg)",
              border: "1px solid var(--input-border)",
            }}
          >
            <div
              onClick={handleMarkdownClick}
              className="jjdr-md-body text-xs"
              dangerouslySetInnerHTML={{ __html: renderedNotesHtml }}
            />
          </div>

          {/* Session safety note */}
          <div
            className="px-3.5 py-2.5 rounded-xl text-[11px] flex items-center gap-2"
            style={{
              background: "var(--pill-bg)",
              color: "var(--text-secondary)",
            }}
          >
            <CheckCircle2
              className="w-3.5 h-3.5 shrink-0"
              style={{ color: "var(--ready-fg)" }}
            />
            <span>
              업데이트를 진행해도{" "}
              <code className="font-mono-code">herdr-core</code>에서 실행 중인
              AI 세션은 종료되지 않고 그대로 유지됩니다.
            </span>
          </div>

          {/* Progress / Status Box */}
          {phase !== "idle" && (
            <div
              className="rounded-2xl p-3.5 space-y-2 text-xs"
              style={{
                background:
                  phase === "error"
                    ? "var(--action-soft)"
                    : "var(--accent-soft)",
                border: `1px solid ${
                  phase === "error"
                    ? "var(--action-border)"
                    : "var(--accent)"
                }`,
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className="font-semibold inline-flex items-center gap-1.5"
                  style={{
                    color:
                      phase === "error"
                        ? "var(--action-fg)"
                        : "var(--text-primary)",
                  }}
                >
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {phase === "downloading" &&
                    `다운로드 중... ${info.asset_name ?? ""}`}
                  {phase === "launching" &&
                    "인스톨러를 실행하고 앱을 종료합니다..."}
                  {phase === "done" && "다운로드 완료 (Dry-run 테스트 모드)"}
                  {phase === "error" && "자동 다운로드에 실패했습니다"}
                </span>
                {percent !== null && phase !== "error" && (
                  <span
                    className="font-mono-code font-bold text-[11px]"
                    style={{ color: "var(--accent)" }}
                  >
                    {percent}%
                  </span>
                )}
              </div>

              {phase !== "error" && (
                <>
                  <div
                    className="w-full h-2 rounded-full overflow-hidden"
                    style={{ background: "var(--pill-bg)" }}
                  >
                    <div
                      className="h-full rounded-full transition-all duration-150"
                      style={{
                        width: `${percent ?? 100}%`,
                        background: "var(--accent)",
                      }}
                    />
                  </div>
                  <div
                    className="text-[11px] font-mono-code flex items-center justify-between"
                    style={{ color: "var(--text-muted)" }}
                  >
                    <span>
                      {downloadedLabel}
                      {totalLabel ? ` / ${totalLabel}` : ""}
                    </span>
                    {dryRunPath && (
                      <span className="truncate max-w-[65%]" title={dryRunPath}>
                        {dryRunPath}
                      </span>
                    )}
                  </div>
                </>
              )}

              {phase === "error" && (
                <div className="space-y-2">
                  <p
                    className="text-[11px] break-all"
                    style={{ color: "var(--action-fg)" }}
                  >
                    {errorMsg}
                  </p>
                  <button
                    type="button"
                    onClick={handleOpenReleasePage}
                    className="jjdr-pill inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold cursor-pointer"
                    style={{ color: "var(--text-primary)" }}
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span>GitHub에서 직접 다운로드</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-5 py-3.5 flex items-center justify-between gap-2 shrink-0"
          style={{
            background: "var(--modal-footer)",
            borderTop: "1px solid var(--divider)",
          }}
        >
          <button
            type="button"
            onClick={handleSkip}
            disabled={busy}
            className="jjdr-pill inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ color: "var(--text-secondary)" }}
            title={`이 버전(v${info.latest_version}) 알림을 다시 띄우지 않습니다`}
          >
            <SkipForward className="w-3.5 h-3.5" />
            <span>이 버전 건너뛰기 (Skip)</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={busy}
              className="px-3.5 py-1.5 rounded-full text-xs font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ color: "var(--text-muted)" }}
            >
              나중에
            </button>
            <button
              type="button"
              onClick={() => void handleStartUpdate()}
              disabled={busy}
              className="jjdr-primary-btn inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {busy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : hasDirectInstaller ? (
                <Download className="w-3.5 h-3.5" />
              ) : (
                <ExternalLink className="w-3.5 h-3.5" />
              )}
              <span>
                {phase === "error"
                  ? "다시 시도"
                  : busy
                  ? "업데이트 중..."
                  : "업데이트"}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
