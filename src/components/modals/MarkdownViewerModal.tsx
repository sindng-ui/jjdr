import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Code2,
  Copy,
  ExternalLink,
  FileText,
  RefreshCw,
  X,
} from "lucide-react";
import { useUiStore } from "../../store/useUiStore";
import {
  openInVsCode,
  openWithDefaultApp,
  readTextFile,
  type TextFileContent,
} from "../../services/tauriBridge";
import { renderMarkdownToHtml } from "../../utils/markdownRenderer";
import "../../styles/githubMarkdown.css";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const MarkdownViewerModal = React.memo(function MarkdownViewerModal() {
  const target = useUiStore((s) => s.markdownViewerTarget);
  const setTarget = useUiStore((s) => s.setMarkdownViewerTarget);
  const showToast = useUiStore((s) => s.showToast);

  const [fileData, setFileData] = useState<TextFileContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFile = useCallback(async (absPath: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await readTextFile(absPath);
      setFileData(data);
    } catch (err) {
      setError(String(err));
      setFileData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!target) {
      setFileData(null);
      return;
    }
    void loadFile(target.absolutePath);
  }, [target, loadFile]);

  const renderedHtml = useMemo(
    () => (fileData ? renderMarkdownToHtml(fileData.content) : ""),
    [fileData]
  );

  if (!target) return null;

  const handleBodyClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>(
      "[data-copy-code]"
    );
    if (!btn) return;
    const codeText =
      btn.closest(".md-code-block")?.querySelector("pre code")?.textContent ??
      "";
    if (!codeText) return;
    void navigator.clipboard.writeText(codeText).then(() => {
      const prev = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => {
        btn.textContent = prev || "Copy";
      }, 1200);
    });
  };

  return (
    <div
      onClick={() => setTarget(null)}
      className="fixed inset-0 z-50 flex items-center justify-center p-5"
      style={{ background: "var(--modal-overlay)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="jjdr-modal w-full max-w-4xl h-[86vh] rounded-[22px] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div
          className="px-5 py-3.5 flex items-center justify-between gap-3 shrink-0"
          style={{ borderBottom: "1px solid var(--divider)" }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <FileText
              className="w-4 h-4 shrink-0"
              style={{ color: "var(--accent)" }}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="text-sm font-bold font-mono-code truncate"
                  style={{ color: "var(--text-primary)" }}
                >
                  {target.relativePath}
                </span>
                {fileData && (
                  <span
                    className="text-[11px] font-mono-code px-2 py-0.5 rounded-full shrink-0"
                    style={{
                      background: "var(--pill-bg)",
                      color: "var(--text-muted)",
                    }}
                  >
                    {formatBytes(fileData.size_bytes)}
                  </span>
                )}
              </div>
              <div
                className="text-[11px] font-mono-code truncate"
                style={{ color: "var(--text-faint)" }}
              >
                {target.projectName} · {target.absolutePath}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => void loadFile(target.absolutePath)}
              title="새로고침"
              className="jjdr-pill p-1.5 rounded-full cursor-pointer"
              style={{ color: "var(--text-secondary)" }}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={() => {
                if (!fileData) return;
                void navigator.clipboard
                  .writeText(fileData.content)
                  .then(() => showToast("Markdown 원문이 복사되었습니다.", "success"));
              }}
              title="원문 복사"
              className="jjdr-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] cursor-pointer"
              style={{ color: "var(--text-secondary)" }}
            >
              <Copy className="w-3 h-3" />
              <span>복사</span>
            </button>
            <button
              type="button"
              onClick={() =>
                void openWithDefaultApp(target.absolutePath).catch((err) =>
                  showToast(String(err), "error")
                )
              }
              title="기본 앱으로 열기"
              className="jjdr-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] cursor-pointer"
              style={{ color: "var(--text-secondary)" }}
            >
              <ExternalLink className="w-3 h-3" />
              <span>기본 앱</span>
            </button>
            <button
              type="button"
              onClick={() =>
                void openInVsCode(target.absolutePath).catch((err) =>
                  showToast(String(err), "error")
                )
              }
              title="VS Code에서 열기"
              className="jjdr-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] cursor-pointer"
              style={{ color: "var(--text-secondary)" }}
            >
              <Code2 className="w-3 h-3" />
              <span>VS Code</span>
            </button>
            <button
              type="button"
              onClick={() => setTarget(null)}
              title="닫기 (Esc)"
              className="p-1.5 rounded-full hover:bg-black/15 cursor-pointer"
              style={{ color: "var(--text-muted)" }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Rendered GitHub-Style Markdown Body */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {error ? (
            <div
              className="p-4 rounded-2xl text-xs"
              style={{
                background: "var(--action-soft)",
                border: "1px solid var(--action-border)",
                color: "var(--action-fg)",
              }}
            >
              {error}
            </div>
          ) : loading && !fileData ? (
            <div
              className="py-12 text-center text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              불러오는 중...
            </div>
          ) : (
            <article className="max-w-3xl mx-auto">
              {fileData?.truncated && (
                <div
                  className="mb-4 px-3.5 py-2 rounded-xl text-xs"
                  style={{
                    background: "var(--warn-soft)",
                    border: "1px solid var(--warn-border)",
                    color: "var(--warn-fg)",
                  }}
                >
                  파일이 2MB를 초과하여 앞부분만 미리보기로 표시됩니다.
                </div>
              )}
              <div
                onClick={handleBodyClick}
                className="jjdr-md-body"
                dangerouslySetInnerHTML={{ __html: renderedHtml }}
              />
            </article>
          )}
        </div>
      </div>
    </div>
  );
});
