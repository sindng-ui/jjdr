import React from "react";
import type { Virtualizer } from "@tanstack/react-virtual";
import { ExternalLink } from "lucide-react";
import type { TextFileContent } from "../../../services/tauriBridge";
import { highlightCodeLine, type CodeLanguage } from "../../../utils/codeHighlighter";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

interface CodeViewerBodyProps {
  scrollParentRef: React.RefObject<HTMLDivElement | null>;
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>;
  fileData: TextFileContent | null;
  lines: string[];
  lang: CodeLanguage;
  wordWrap: boolean;
  loading: boolean;
  error: string | null;
  matchLineSet: Set<number>;
  activeMatchLine: number;
  landedLine: number | null;
  onCopyLineRef: (lineNo: number) => void;
  onLineClick: (
    e: React.MouseEvent<HTMLSpanElement>,
    idx: number,
    rawLine: string
  ) => void;
  onOpenDefaultApp: () => void;
}

export const CodeViewerBody = React.memo(function CodeViewerBody({
  scrollParentRef,
  rowVirtualizer,
  fileData,
  lines,
  lang,
  wordWrap,
  loading,
  error,
  matchLineSet,
  activeMatchLine,
  landedLine,
  onCopyLineRef,
  onLineClick,
  onOpenDefaultApp,
}: CodeViewerBodyProps) {
  const lineDigits = Math.max(3, String(lines.length).length);

  return (
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
            onClick={onOpenDefaultApp}
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
                const isLanded = idx === landedLine;
                return (
                  <div
                    key={idx}
                    data-code-line={idx}
                    className={`jjdr-code-row flex items-start px-3 ${
                      isActiveMatch
                        ? "jjdr-code-row-match-active"
                        : isMatch
                        ? "jjdr-code-row-match"
                        : isLanded
                        ? "jjdr-code-row-landed"
                        : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onCopyLineRef(idx + 1)}
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
                      onClick={(e) => onLineClick(e, idx, rawLine)}
                      className="jjdr-code-line-text flex-1 whitespace-pre-wrap break-all"
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
                const isLanded = idx === landedLine;
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
                        : isLanded
                        ? "jjdr-code-row-landed"
                        : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onCopyLineRef(idx + 1)}
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
                      onClick={(e) => onLineClick(e, idx, rawLine)}
                      className="jjdr-code-line-text whitespace-pre pr-6"
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
  );
});
