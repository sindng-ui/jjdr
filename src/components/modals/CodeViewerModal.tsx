import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore, type CodeViewerTarget } from "../../store/useUiStore";
import {
  getFileSymbolOutline,
  getSymbolIndexStatus,
  listenSymbolIndexProgress,
  lookupSymbolDefinitions,
  openInVsCode,
  openWithDefaultApp,
  readTextFile,
  resolveIncludePath,
  type TextFileContent,
} from "../../services/tauriBridge";
import type {
  OutlineSymbol,
  SymbolIndexStatus,
  SymbolMatch,
} from "../../types/domain";
import { detectCodeLanguage } from "../../utils/codeHighlighter";
import {
  extractSymbolClickTarget,
  resolveClickColumnInLineElement,
} from "../../utils/symbolClickTarget";
import {
  useCodeNavigationHistory,
  type CodeNavLocation,
} from "../../hooks/useCodeNavigationHistory";
import { useResizableModalWidth } from "../../hooks/useResizableModalWidth";
import { CodeViewerHeader } from "./codeViewer/CodeViewerHeader";
import { CodeViewerBody } from "./codeViewer/CodeViewerBody";
import { SymbolPickerPopover } from "./codeViewer/SymbolPickerPopover";
import { CodeOutlinePopover } from "./codeViewer/CodeOutlinePopover";
import "../../styles/codeViewer.css";

function joinFsPath(root: string, rel: string): string {
  const cleanRoot = root.replace(/[\\/]+$/, "");
  const cleanRel = rel.replace(/^[/\\]+/, "");
  const sep = cleanRoot.includes("\\") ? "\\" : "/";
  return `${cleanRoot}${sep}${cleanRel.replace(/\//g, sep)}`;
}

export const CodeViewerModal = React.memo(function CodeViewerModal() {
  const target = useUiStore((s) => s.codeViewerTarget);
  const setTarget = useUiStore((s) => s.setCodeViewerTarget);
  const showToast = useUiStore((s) => s.showToast);
  const symbolIndexEnabled = useAppStore(
    (s) => s.settings.symbol_index_enabled ?? false
  );

  const { widthPx, resizing, startResize, resetWidth } = useResizableModalWidth();
  const navHistory = useCodeNavigationHistory();

  const [fileData, setFileData] = useState<TextFileContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wordWrap, setWordWrap] = useState(false);
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const [activeLine, setActiveLine] = useState<number>(1);
  const [landedLine, setLandedLine] = useState<number | null>(null);

  // In-file fast search (Ctrl+F)
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findCursor, setFindCursor] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);
  const scrollParentRef = useRef<HTMLDivElement>(null);

  // Symbol jump & Outline (Ctrl+Shift+O)
  const [symbolStatus, setSymbolStatus] = useState<SymbolIndexStatus | null>(null);
  const [pickerState, setPickerState] = useState<{
    token: string;
    matches: SymbolMatch[];
  } | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [outlineSymbols, setOutlineSymbols] = useState<OutlineSymbol[]>([]);
  const [outlineLoading, setOutlineLoading] = useState(false);

  const lastLoadedPathRef = useRef<string | null>(null);

  const loadFile = useCallback(async (absPath: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await readTextFile(absPath);
      setFileData(data);
      lastLoadedPathRef.current = absPath;
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
      lastLoadedPathRef.current = null;
      setFindOpen(false);
      setFindQuery("");
      setFindCursor(0);
      setPickerState(null);
      setOutlineOpen(false);
      setLandedLine(null);
      setCtrlHeld(false);
      navHistory.reset();
      return;
    }
    if (lastLoadedPathRef.current !== target.absolutePath) {
      setOutlineSymbols([]);
      void loadFile(target.absolutePath);
    }
  }, [target, loadFile, navHistory]);

  // Subscribe to background symbol index status for current project (only when enabled)
  useEffect(() => {
    if (!target || !target.projectId || !symbolIndexEnabled) {
      setSymbolStatus(null);
      return;
    }
    const pid = target.projectId;
    let cancelled = false;
    void getSymbolIndexStatus(pid)
      .then((st) => {
        if (!cancelled && st) setSymbolStatus(st);
      })
      .catch(() => {});

    let unlisten: (() => void) | null = null;
    void listenSymbolIndexProgress((ev) => {
      if (!cancelled && ev.project_id === pid) {
        setSymbolStatus(ev);
      }
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [target?.projectId, target, symbolIndexEnabled]);

  const lang = useMemo(
    () => (target ? detectCodeLanguage(target.relativePath) : "plain"),
    [target]
  );

  const lines = useMemo(() => {
    if (!fileData || fileData.is_binary) return [];
    return fileData.content.replace(/\r\n/g, "\n").split("\n");
  }, [fileData]);

  const matchLineIndices = useMemo(() => {
    const q = findQuery.trim().toLowerCase();
    if (!q || lines.length === 0) return [];
    const out: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(q)) out.push(i);
    }
    return out;
  }, [lines, findQuery]);

  const matchLineSet = useMemo(() => new Set(matchLineIndices), [matchLineIndices]);

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

  const scrollToLineNumber = useCallback(
    (lineNo: number) => {
      if (lineNo < 1 || lines.length === 0) return;
      const idx = Math.min(Math.max(0, lineNo - 1), lines.length - 1);
      setActiveLine(idx + 1);
      setLandedLine(idx);
      if (wordWrap) {
        const el = scrollParentRef.current?.querySelector<HTMLElement>(
          `[data-code-line="${idx}"]`
        );
        el?.scrollIntoView({ block: "center" });
      } else {
        rowVirtualizer.scrollToIndex(idx, { align: "center" });
      }
    },
    [lines.length, wordWrap, rowVirtualizer]
  );

  useEffect(() => {
    if (!target?.initialLine || loading || lines.length === 0) return;
    if (lastLoadedPathRef.current !== target.absolutePath) return;
    const raf = requestAnimationFrame(() => scrollToLineNumber(target.initialLine!));
    return () => cancelAnimationFrame(raf);
  }, [target?.absolutePath, target?.initialLine, loading, lines.length, scrollToLineNumber]);

  useEffect(() => {
    setFindCursor(0);
    if (matchLineIndices.length > 0) {
      rowVirtualizer.scrollToIndex(matchLineIndices[0], { align: "center" });
    }
  }, [findQuery, matchLineIndices, rowVirtualizer]);

  const makeCurrentNavLocation = useCallback((): CodeNavLocation | null => {
    if (!target) return null;
    return {
      absolutePath: target.absolutePath,
      relativePath: target.relativePath,
      projectName: target.projectName,
      rootPath: target.rootPath,
      projectId: target.projectId,
      repoPath: target.repoPath,
      line: activeLine,
    };
  }, [target, activeLine]);

  const navigateToLocation = useCallback(
    (next: CodeNavLocation, recordHistory: boolean) => {
      if (!target) return;
      if (recordHistory) {
        const cur = makeCurrentNavLocation();
        if (cur) navHistory.pushLocation(cur, next);
      }
      if (next.absolutePath === target.absolutePath) {
        scrollToLineNumber(next.line);
        return;
      }
      const nextTarget: CodeViewerTarget = {
        absolutePath: next.absolutePath,
        relativePath: next.relativePath,
        projectName: next.projectName,
        rootPath: next.rootPath,
        projectId: next.projectId,
        repoPath: next.repoPath,
        initialLine: next.line,
        initialCol: next.col,
      };
      setTarget(nextTarget);
    },
    [target, makeCurrentNavLocation, navHistory, scrollToLineNumber, setTarget]
  );

  const handleGoBack = useCallback(() => {
    const cur = makeCurrentNavLocation();
    if (!cur) return;
    const prev = navHistory.goBack(cur);
    if (prev) navigateToLocation(prev, false);
  }, [makeCurrentNavLocation, navHistory, navigateToLocation]);

  const handleGoForward = useCallback(() => {
    const cur = makeCurrentNavLocation();
    if (!cur) return;
    const next = navHistory.goForward(cur);
    if (next) navigateToLocation(next, false);
  }, [makeCurrentNavLocation, navHistory, navigateToLocation]);

  const openOutline = useCallback(() => {
    if (!target) return;
    setPickerState(null);
    setOutlineOpen(true);
    setOutlineLoading(true);
    void getFileSymbolOutline(target.absolutePath, target.relativePath)
      .then((syms) => setOutlineSymbols(syms))
      .catch(() => setOutlineSymbols([]))
      .finally(() => setOutlineLoading(false));
  }, [target]);

  const triggerSymbolOrIncludeJump = useCallback(
    async (lineNo: number, rawLine: string, col: number) => {
      if (!target) return;
      const extracted = extractSymbolClickTarget(rawLine, col);
      if (!extracted) return;

      if (extracted.kind === "include") {
        const resolved = await resolveIncludePath(
          target.rootPath,
          target.relativePath,
          extracted.token
        ).catch(() => null);
        if (!resolved) {
          showToast(`헤더 파일을 찾지 못했습니다: ${extracted.token}`, "info", 1800);
          return;
        }
        navigateToLocation(
          {
            absolutePath: resolved.absolute_path,
            relativePath: resolved.relative_path,
            projectName: target.projectName,
            rootPath: target.rootPath,
            projectId: target.projectId,
            repoPath: target.repoPath,
            line: 1,
          },
          true
        );
        return;
      }

      if (!symbolIndexEnabled) {
        showToast(
          "심볼 점프는 꺼져 있습니다. Settings → General에서 심볼 인덱싱을 켜주세요.",
          "info",
          2400
        );
        return;
      }
      if (!target.projectId) {
        showToast("프로젝트 컨텍스트가 없어 심볼을 조회할 수 없습니다.", "info", 1800);
        return;
      }

      const matches = await lookupSymbolDefinitions({
        projectId: target.projectId,
        worktreePath: target.rootPath,
        currentRelPath: target.relativePath,
        currentLine: lineNo,
        symbolName: extracted.token,
        qualifier: extracted.qualifier,
        limit: 25,
      }).catch(() => [] as SymbolMatch[]);

      if (matches.length === 0) {
        if (symbolStatus && (symbolStatus.state === "indexing" || symbolStatus.state === "loading_cache")) {
          showToast(
            `심볼 인덱싱 진행 중 (${symbolStatus.indexed_files.toLocaleString()}/${symbolStatus.total_files.toLocaleString()})`,
            "info",
            1800
          );
        } else {
          showToast(`정의를 찾지 못했습니다: ${extracted.token}`, "info", 1600);
        }
        return;
      }

      if (matches.length === 1) {
        const m = matches[0];
        navigateToLocation(
          {
            absolutePath: joinFsPath(target.rootPath, m.relative_path),
            relativePath: m.relative_path,
            projectName: target.projectName,
            rootPath: target.rootPath,
            projectId: target.projectId,
            repoPath: target.repoPath,
            line: m.line,
            col: m.col,
          },
          true
        );
        return;
      }

      setPickerState({ token: extracted.token, matches });
    },
    [target, symbolIndexEnabled, symbolStatus, navigateToLocation, showToast]
  );

  // Keyboard shortcuts inside CodeViewerModal
  useEffect(() => {
    if (!target) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // Yield to top-level WorkspaceSearchModal / QuickFileModal when layered above
      const uiState = useUiStore.getState();
      if (uiState.workspaceSearchOpen || uiState.quickFileOpen) return;

      if (e.key === "Control" || e.key === "Meta") setCtrlHeld(true);

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && (e.key.toLowerCase() === "o" || e.code === "KeyO")) {
        e.preventDefault();
        e.stopPropagation();
        openOutline();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key.toLowerCase() === "f" || e.code === "KeyF")) {
        e.preventDefault();
        e.stopPropagation();
        setFindOpen(true);
        requestAnimationFrame(() => {
          findInputRef.current?.focus();
          findInputRef.current?.select();
        });
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        handleGoBack();
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        handleGoForward();
        return;
      }
      if (e.key === "F12" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        const sel = window.getSelection()?.toString().trim() ?? "";
        if (sel && /^[A-Za-z_][A-Za-z0-9_]*$/.test(sel)) {
          void triggerSymbolOrIncludeJump(activeLine, sel, 0);
        } else {
          const lineText = lines[activeLine - 1] ?? "";
          const m = /[A-Za-z_][A-Za-z0-9_]*/.exec(lineText);
          if (m) void triggerSymbolOrIncludeJump(activeLine, lineText, m.index);
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Control" || e.key === "Meta") setCtrlHeld(false);
    };
    const onBlur = () => setCtrlHeld(false);

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [
    target,
    openOutline,
    handleGoBack,
    handleGoForward,
    triggerSymbolOrIncludeJump,
    activeLine,
    lines,
  ]);

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
      setActiveLine(lineNo);
      const ref = `${target.relativePath}:${lineNo}`;
      void navigator.clipboard
        .writeText(ref)
        .then(() => showToast(`복사됨: ${ref}`, "success", 1400));
    },
    [target, showToast]
  );

  const handleLineClick = useCallback(
    (e: React.MouseEvent<HTMLSpanElement>, idx: number, rawLine: string) => {
      const lineNo = idx + 1;
      setActiveLine(lineNo);
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const col = resolveClickColumnInLineElement(e.currentTarget, e.clientX, e.clientY);
      if (col !== null) {
        void triggerSymbolOrIncludeJump(lineNo, rawLine, col);
      }
    },
    [triggerSymbolOrIncludeJump]
  );

  const handleSelectPickerMatch = useCallback(
    (m: SymbolMatch) => {
      if (!target) return;
      setPickerState(null);
      navigateToLocation(
        {
          absolutePath: joinFsPath(target.rootPath, m.relative_path),
          relativePath: m.relative_path,
          projectName: target.projectName,
          rootPath: target.rootPath,
          projectId: target.projectId,
          repoPath: target.repoPath,
          line: m.line,
          col: m.col,
        },
        true
      );
    },
    [target, navigateToLocation]
  );

  if (!target) return null;

  const fileBaseName = target.relativePath.split("/").pop() ?? target.relativePath;

  return (
    <div
      onClick={() => setTarget(null)}
      onMouseUp={(e) => {
        if (e.button === 3) {
          e.preventDefault();
          handleGoBack();
        } else if (e.button === 4) {
          e.preventDefault();
          handleGoForward();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "var(--modal-overlay)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: `${widthPx}px`, maxWidth: "96vw" }}
        className={`jjdr-modal jjdr-code-viewer ${
          ctrlHeld ? "ctrl-jump-ready" : ""
        } relative h-[88vh] rounded-[22px] overflow-hidden flex flex-col`}
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

        <CodeViewerHeader
          target={target}
          lang={lang}
          fileData={fileData}
          lineCount={lines.length}
          activeLine={activeLine}
          loading={loading}
          canBack={navHistory.canBack}
          canForward={navHistory.canForward}
          outlineOpen={outlineOpen}
          findOpen={findOpen}
          wordWrap={wordWrap}
          symbolIndexEnabled={symbolIndexEnabled}
          symbolStatus={symbolStatus}
          onBack={handleGoBack}
          onForward={handleGoForward}
          onOpenOutline={openOutline}
          onToggleFind={() => {
            setFindOpen((v) => !v);
            requestAnimationFrame(() => findInputRef.current?.focus());
          }}
          onToggleWordWrap={() => setWordWrap((w) => !w)}
          onReload={() => void loadFile(target.absolutePath)}
          onCopyAll={() => {
            if (!fileData) return;
            void navigator.clipboard
              .writeText(fileData.content)
              .then(() => showToast("코드 원문이 복사되었습니다.", "success", 1600));
          }}
          onOpenDefaultApp={() =>
            void openWithDefaultApp(target.absolutePath).catch((err) =>
              showToast(String(err), "error")
            )
          }
          onOpenVsCode={() =>
            void openInVsCode(target.absolutePath, activeLine).catch((err) =>
              showToast(String(err), "error")
            )
          }
          onClose={() => setTarget(null)}
        />

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

        <CodeViewerBody
          scrollParentRef={scrollParentRef}
          rowVirtualizer={rowVirtualizer}
          fileData={fileData}
          lines={lines}
          lang={lang}
          wordWrap={wordWrap}
          loading={loading}
          error={error}
          matchLineSet={matchLineSet}
          activeMatchLine={activeMatchLine}
          landedLine={landedLine}
          onCopyLineRef={handleCopyLineRef}
          onLineClick={handleLineClick}
          onOpenDefaultApp={() =>
            void openWithDefaultApp(target.absolutePath).catch((err) =>
              showToast(String(err), "error")
            )
          }
        />

        <div
          className="px-5 py-1.5 flex items-center justify-between gap-2 text-[10.5px] font-mono-code shrink-0"
          style={{
            background: "var(--modal-footer)",
            borderTop: "1px solid var(--divider)",
            color: "var(--text-faint)",
          }}
        >
          <span>
            Ctrl+Click/F12 정의점프 · Ctrl+Shift+O 파일심볼 · Ctrl+F 파일내 검색 · Alt+←/→ 히스토리
          </span>
          <span className="tabular-nums shrink-0">Ln {activeLine}</span>
        </div>

        {pickerState && (
          <SymbolPickerPopover
            queryToken={pickerState.token}
            matches={pickerState.matches}
            onSelect={handleSelectPickerMatch}
            onClose={() => setPickerState(null)}
          />
        )}
        {outlineOpen && (
          <CodeOutlinePopover
            fileName={fileBaseName}
            symbols={outlineSymbols}
            loading={outlineLoading}
            onJumpLine={(line) => {
              const cur = makeCurrentNavLocation();
              if (cur && cur.line !== line) {
                navHistory.pushLocation(cur, { ...cur, line });
              }
              scrollToLineNumber(line);
            }}
            onClose={() => setOutlineOpen(false)}
          />
        )}
      </div>
    </div>
  );
});
