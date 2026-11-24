import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  ExternalLink,
  FileCode2,
  RefreshCw,
  Search,
  WrapText,
  X,
} from "lucide-react";
import { useUiStore } from "../../store/useUiStore";
import {
  openInVsCode,
  openWithDefaultApp,
  readTextFile,
  type TextFileContent,
} from "../../services/tauriBridge";
import {
  detectCodeLanguage,
  getLanguageLabel,
  highlightCodeLine,
} from "../../utils/codeHighlighter";
import { useResizableModalWidth } from "../../hooks/useResizableModalWidth";
import "../../styles/codeViewer.css";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const CodeViewerModal = React.memo(function CodeViewerModal() {
  const target = useUiStore((s) => s.codeViewerTarget);
  const setTarget = useUiStore((s) => s.setCodeViewerTarget);
  const showToast = useUiStore((s) => s.showToast);

  const { widthPx, resizing, startResize, resetWidth } = useResizableModalWidth();

  const [fileData, setFileData] = useState<TextFileContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wordWrap, setWordWrap] = useState(false);

  // In-file fast search (Ctrl+F inside viewer)
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findCursor, setFindCursor] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);
  const scrollParentRef = useRef<HTMLDivElement>(null);

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
      setFindOpen(false);
      setFindQuery("");
      setFindCursor(0);
      return;
    }
    void loadFile(target.absolutePath);
  }, [target, loadFile]);

  // Capture Ctrl+F inside CodeViewerModal for instant in-file find
  useEffect(() => {
    if (!target) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key.toLowerCase() === "f" || e.code === "KeyF")) {
        e.preventDefault();
        e.stopPropagation();
        setFindOpen(true);
        requestAnimationFrame(() => {
          findInputRef.current?.focus();
          findInputRef.current?.select();
        });
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [target]);

  const lang = useMemo(
    () => (target ? detectCodeLanguage(target.relativePath) : "plain"),
    [target]
  );

  const lines = useMemo(() => {
    if (!fileData || fileData.is_binary) return [];
    return fileData.content.replace(/\r\n/g, "\n").split("\n");
  }, [fileData]);

  // Match line indices for in-file search
  const matchLineIndices = useMemo(() => {
    const q = findQuery.trim().toLowerCase();
    if (!q || lines.length === 0) return [];
    const out: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(q)) {
        out.push(i);
      }
    }
    return out;
  }, [lines, findQuery]);

  const matchLineSet = useMemo(
    () => new Set(matchLineIndices),
    [matchLineIndices]
  );

  const activeMatchLine =
    matchLineIndices.length > 0
      ? matchLineIndices[findCursor % matchLineIndices.length]
      : -1;

  const rowVirtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => 22,
    overscan: 20,
  });

  useEffect(() => {
    setFindCursor(0);
    if (matchLineIndices.length > 0) {
      rowVirtualizer.scrollToIndex(matchLineIndices[0], { align: "center" });
    }
  }, [findQuery, matchLineIndices, rowVirtualizer]);

  const jumpFind = useCallback(
    (delta: 1 | -1) => {
      if (matchLineIndices.length === 0) return;
      setFindCursor((prev) => {
        const next = (prev + delta + matchLineIndices.length) % matchLineIndices.length;
        rowVirtualizer.scrollToIndex(matchLineIndices[next], { align: "center" });
        return next;
      });
    },
    [matchLineIndices, rowVirtualizer]
  );

  const handleCopyLineRef = useCallback(
    (lineNo: number) => {
      if (!target) return;
      const ref = `${target.relativePath}:${lineNo}`;
      void navigator.clipboard
        .writeText(ref)
        .then(() => showToast(`복사됨: ${ref}`, "success", 1400));
    },
    [target, showToast]
  );

  if (!target) return null;

  const lineDigits = Math.max(3, String(lines.length).length);

  return (
    <div
      onClick={() => setTarget(null)}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "var(--modal-overlay)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: `${widthPx}px`, maxWidth: "96vw" }}
        className="jjdr-modal jjdr-code-viewer relative h-[88vh] rounded-[22px] overflow-hidden flex flex-col"
      >
        {/* Left & Right Drag-to-Resize Handles */}
        <div
          onPointerDown={(e) => startResize("left", e)}
          onDoubleClick={resetWidth}
          title="드래그하여 뷰어 너비 조절 · 더블클릭으로 기본 너비 복원"
          className="absolute left-0 top-12 bottom-4 w-2 z-20 cursor-col-resize group flex items-center justify-center"
        >
          <div
            className="w-0.5 h-16 rounded-full transition-all group-hover:w-1 group-hover:h-24"
            style={{
              background: resizing ? "var(--accent)" : "var(--pill-border)",
              opacity: resizing ? 1 : 0.45,
            }}
          />
        </div>
        <div
          onPointerDown={(e) => startResize("right", e)}
          onDoubleClick={resetWidth}
          title="드래그하여 뷰어 너비 조절 · 더블클릭으로 기본 너비 복원"
          className="absolute right-0 top-12 bottom-4 w-2 z-20 cursor-col-resize group flex items-center justify-center"
        >
          <div
            className="w-0.5 h-16 rounded-full transition-all group-hover:w-1 group-hover:h-24"
            style={{
              background: resizing ? "var(--accent)" : "var(--pill-border)",
              opacity: resizing ? 1 : 0.45,
            }}
          />
        </div>

        {/* Header */}
        <div
          className="px-5 py-3 flex items-center justify-between gap-3 shrink-0"
          style={{ borderBottom: "1px solid var(--divider)" }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <FileCode2
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
                <span
                  className="text-[10px] font-mono-code font-semibold px-2 py-0.5 rounded-full shrink-0"
                  style={{
                    background: "var(--accent-soft)",
                    color: "var(--accent)",
                  }}
                >
                  {getLanguageLabel(lang)}
                </span>
                {fileData && !fileData.is_binary && (
                  <span
                    className="text-[11px] font-mono-code px-2 py-0.5 rounded-full shrink-0"
                    style={{
                      background: "var(--pill-bg)",
                      color: "var(--text-muted)",
                    }}
                  >
                    {lines.length.toLocaleString()}L · {formatBytes(fileData.size_bytes)}
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
              onClick={() => {
                setFindOpen((v) => !v);
                requestAnimationFrame(() => findInputRef.current?.focus());
              }}
              title="파일 내 검색 (Ctrl+F)"
              className={`jjdr-pill p-1.5 rounded-full cursor-pointer ${
                findOpen ? "jjdr-pill-active" : ""
              }`}
              style={findOpen ? undefined : { color: "var(--text-secondary)" }}
            >
              <Search className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setWordWrap((w) => !w)}
              title="자동 줄바꿈 토글"
              className={`jjdr-pill p-1.5 rounded-full cursor-pointer ${
                wordWrap ? "jjdr-pill-active" : ""
              }`}
              style={wordWrap ? undefined : { color: "var(--text-secondary)" }}
            >
              <WrapText className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => void loadFile(target.absolutePath)}
              title="새로고침"
              className="jjdr-pill p-1.5 rounded-full cursor-pointer"
              style={{ color: "var(--text-secondary)" }}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
            {fileData && !fileData.is_binary && (
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(fileData.content)
                    .then(() => showToast("코드 원문이 복사되었습니다.", "success", 1600));
                }}
                title="전체 코드 복사"
                className="jjdr-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] cursor-pointer"
                style={{ color: "var(--text-secondary)" }}
              >
                <Copy className="w-3 h-3" />
                <span>복사</span>
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                void openWithDefaultApp(target.absolutePath).catch((err) =>
                  showToast(String(err), "error")
                )
              }
              title="기본 앱으로 열기 (Shift+Enter)"
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

        {/* Optional In-File Search Strip */}
        {findOpen && (
          <div
            className="px-5 py-2 flex items-center gap-2 text-xs shrink-0"
            style={{
              background: "var(--modal-footer)",
              borderBottom: "1px solid var(--divider)",
            }}
          >
            <Search className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--text-muted)" }} />
            <input
              ref={findInputRef}
              type="text"
              value={findQuery}
              onChange={(e) => setFindQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  jumpFind(e.shiftKey ? -1 : 1);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setFindOpen(false);
                }
              }}
              placeholder="파일 내 검색 (Enter 다음 · Shift+Enter 이전)..."
              className="flex-1 bg-transparent outline-none font-mono-code text-xs"
              style={{ color: "var(--text-primary)" }}
            />
            <span
              className="font-mono-code text-[11px] tabular-nums shrink-0"
              style={{ color: "var(--text-muted)" }}
            >
              {findQuery.trim()
                ? matchLineIndices.length > 0
                  ? `${(findCursor % matchLineIndices.length) + 1} / ${matchLineIndices.length}`
                  : "0 matches"
                : ""}
            </span>
            <button
              type="button"
              onClick={() => jumpFind(-1)}
              className="p-1 rounded-full hover:bg-black/15 cursor-pointer"
              style={{ color: "var(--text-secondary)" }}
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => jumpFind(1)}
              className="p-1 rounded-full hover:bg-black/15 cursor-pointer"
              style={{ color: "var(--text-secondary)" }}
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setFindOpen(false)}
              className="p-1 rounded-full hover:bg-black/15 cursor-pointer"
              style={{ color: "var(--text-muted)" }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Code Body (Virtualized for instant open even on 10k+ line files) */}
        <div
          ref={scrollParentRef}
          className="flex-1 min-h-0 overflow-auto font-mono-code text-[12.5px] leading-[22px]"
          style={{ background: "var(--input-bg)" }}
        >
          {error ? (
            <div className="p-6">
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
            </div>
          ) : loading && !fileData ? (
            <div
              className="py-12 text-center text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              불러오는 중...
            </div>
          ) : fileData?.is_binary ? (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center gap-3">
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                바이너리 파일은 코드뷰어로 표시할 수 없습니다.
              </p>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                파일 크기: {formatBytes(fileData.size_bytes)}
              </p>
              <button
                type="button"
                onClick={() =>
                  void openWithDefaultApp(target.absolutePath).catch((err) =>
                    showToast(String(err), "error")
                  )
                }
                className="jjdr-primary-btn inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                기본 앱으로 열기
              </button>
            </div>
          ) : (
            <>
              {fileData?.truncated && (
                <div
                  className="mx-4 mt-3 px-3.5 py-2 rounded-xl text-xs font-sans"
                  style={{
                    background: "var(--warn-soft)",
                    border: "1px solid var(--warn-border)",
                    color: "var(--warn-fg)",
                  }}
                >
                  파일이 2MB를 초과하여 앞부분만 미리보기로 표시됩니다.
                </div>
              )}

              {wordWrap ? (
                <div className="py-3">
                  {lines.map((rawLine, idx) => {
                    const isMatch = matchLineSet.has(idx);
                    const isActiveMatch = idx === activeMatchLine;
                    return (
                      <div
                        key={idx}
                        className={`jjdr-code-row flex items-start px-3 ${
                          isActiveMatch
                            ? "jjdr-code-row-match-active"
                            : isMatch
                            ? "jjdr-code-row-match"
                            : ""
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleCopyLineRef(idx + 1)}
                          title="클릭하여 파일경로:줄번호 복사"
                          style={{
                            width: `${lineDigits + 2}ch`,
                            color: "var(--text-faint)",
                          }}
                          className="shrink-0 pr-3 text-right select-none cursor-pointer hover:underline"
                        >
                          {idx + 1}
                        </button>
                        <span
                          className="flex-1 whitespace-pre-wrap break-all"
                          style={{ color: "var(--text-primary)" }}
                          dangerouslySetInnerHTML={{
                            __html: highlightCodeLine(rawLine, lang),
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div
                  style={{
                    height: `${rowVirtualizer.getTotalSize() + 24}px`,
                    position: "relative",
                    minWidth: "100%",
                    width: "max-content",
                  }}
                  className="py-3"
                >
                  {rowVirtualizer.getVirtualItems().map((vRow) => {
                    const idx = vRow.index;
                    const rawLine = lines[idx] ?? "";
                    const isMatch = matchLineSet.has(idx);
                    const isActiveMatch = idx === activeMatchLine;
                    return (
                      <div
                        key={vRow.key}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          minWidth: "100%",
                          height: `${vRow.size}px`,
                          transform: `translateY(${vRow.start + 12}px)`,
                        }}
                        className={`jjdr-code-row flex items-center px-3 ${
                          isActiveMatch
                            ? "jjdr-code-row-match-active"
                            : isMatch
                            ? "jjdr-code-row-match"
                            : ""
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleCopyLineRef(idx + 1)}
                          title="클릭하여 파일경로:줄번호 복사"
                          style={{
                            width: `${lineDigits + 2}ch`,
                            color: "var(--text-faint)",
                          }}
                          className="shrink-0 pr-3 text-right select-none cursor-pointer hover:underline"
                        >
                          {idx + 1}
                        </button>
                        <span
                          className="whitespace-pre pr-6"
                          style={{ color: "var(--text-primary)" }}
                          dangerouslySetInnerHTML={{
                            __html: highlightCodeLine(rawLine, lang),
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
});
