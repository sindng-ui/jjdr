import React from "react";
import {
  ArrowLeft,
  ArrowRight,
  Code2,
  Copy,
  ExternalLink,
  FileCode2,
  ListTree,
  RefreshCw,
  Search,
  WrapText,
  X,
} from "lucide-react";
import type { CodeViewerTarget } from "../../../store/useUiStore";
import type { SymbolIndexStatus } from "../../../types/domain";
import type { TextFileContent } from "../../../services/tauriBridge";
import { getLanguageLabel, type CodeLanguage } from "../../../utils/codeHighlighter";
import { SymbolIndexBadge } from "./SymbolIndexBadge";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

interface CodeViewerHeaderProps {
  target: CodeViewerTarget;
  lang: CodeLanguage;
  fileData: TextFileContent | null;
  lineCount: number;
  activeLine: number;
  loading: boolean;
  canBack: boolean;
  canForward: boolean;
  outlineOpen: boolean;
  findOpen: boolean;
  wordWrap: boolean;
  symbolIndexEnabled: boolean;
  symbolStatus: SymbolIndexStatus | null;
  onBack: () => void;
  onForward: () => void;
  onOpenOutline: () => void;
  onToggleFind: () => void;
  onToggleWordWrap: () => void;
  onReload: () => void;
  onCopyAll: () => void;
  onOpenDefaultApp: () => void;
  onOpenVsCode: () => void;
  onClose: () => void;
}

export const CodeViewerHeader = React.memo(function CodeViewerHeader({
  target,
  lang,
  fileData,
  lineCount,
  activeLine,
  loading,
  canBack,
  canForward,
  outlineOpen,
  findOpen,
  wordWrap,
  symbolIndexEnabled,
  symbolStatus,
  onBack,
  onForward,
  onOpenOutline,
  onToggleFind,
  onToggleWordWrap,
  onReload,
  onCopyAll,
  onOpenDefaultApp,
  onOpenVsCode,
  onClose,
}: CodeViewerHeaderProps) {
  return (
    <div
      className="px-5 py-3 flex items-center justify-between gap-3 shrink-0"
      style={{ borderBottom: "1px solid var(--divider)" }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            disabled={!canBack}
            onClick={onBack}
            title="이전 위치로 (Alt+←)"
            className="p-1 rounded-full hover:bg-black/15 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ color: "var(--text-secondary)" }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={!canForward}
            onClick={onForward}
            title="다음 위치로 (Alt+→)"
            className="p-1 rounded-full hover:bg-black/15 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ color: "var(--text-secondary)" }}
          >
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
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
                {lineCount.toLocaleString()}L · {formatBytes(fileData.size_bytes)}
              </span>
            )}
            <SymbolIndexBadge enabled={symbolIndexEnabled} status={symbolStatus} />
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
          onClick={onOpenOutline}
          title="파일 내 심볼 검색 (Ctrl+Shift+O)"
          className={`jjdr-pill p-1.5 rounded-full cursor-pointer ${
            outlineOpen ? "jjdr-pill-active" : ""
          }`}
          style={outlineOpen ? undefined : { color: "var(--text-secondary)" }}
        >
          <ListTree className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={onToggleFind}
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
          onClick={onToggleWordWrap}
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
          onClick={onReload}
          title="새로고침"
          className="jjdr-pill p-1.5 rounded-full cursor-pointer"
          style={{ color: "var(--text-secondary)" }}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
        {fileData && !fileData.is_binary && (
          <button
            type="button"
            onClick={onCopyAll}
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
          onClick={onOpenDefaultApp}
          title="기본 앱으로 열기 (Shift+Enter)"
          className="jjdr-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] cursor-pointer"
          style={{ color: "var(--text-secondary)" }}
        >
          <ExternalLink className="w-3 h-3" />
          <span>기본 앱</span>
        </button>
        <button
          type="button"
          onClick={onOpenVsCode}
          title={`VS Code에서 열기 (${activeLine}번 줄로 이동)`}
          className="jjdr-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] cursor-pointer"
          style={{ color: "var(--text-secondary)" }}
        >
          <Code2 className="w-3 h-3" />
          <span>VS Code</span>
        </button>
        <button
          type="button"
          onClick={onClose}
          title="닫기 (Esc)"
          className="p-1.5 rounded-full hover:bg-black/15 cursor-pointer"
          style={{ color: "var(--text-muted)" }}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
});
