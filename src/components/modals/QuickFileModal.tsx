import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Code2,
  ExternalLink,
  FileCode2,
  FileJson,
  FileText,
  FolderGit2,
  Search,
  X,
} from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import {
  getSymbolIndexStatus,
  listenSymbolIndexProgress,
  openInVsCode,
  openWithDefaultApp,
  searchProjectFiles,
  warmProjectSymbolIndex,
  type FileMatchItem,
} from "../../services/tauriBridge";
import type { SymbolIndexStatus } from "../../types/domain";
import { SymbolIndexBadge } from "./codeViewer/SymbolIndexBadge";
import { normalizePath } from "../../workers/dashboardLogic";
import { isMarkdownFile } from "../../utils/markdownRenderer";

interface TargetScope {
  projectId: string;
  projectName: string;
  repoPath: string;
  worktreePath: string;
  branch: string;
}

function joinFsPath(root: string, rel: string): string {
  const cleanRoot = root.replace(/[\\/]+$/, "");
  const cleanRel = rel.replace(/^[/\\]+/, "");
  const sep = cleanRoot.includes("\\") ? "\\" : "/";
  return `${cleanRoot}${sep}${cleanRel.replace(/\//g, sep)}`;
}

function splitPathParts(relPath: string): { fileName: string; dirPath: string } {
  const idx = relPath.lastIndexOf("/");
  if (idx === -1) return { fileName: relPath, dirPath: "" };
  return {
    fileName: relPath.slice(idx + 1),
    dirPath: relPath.slice(0, idx),
  };
}

export const QuickFileModal = React.memo(function QuickFileModal() {
  const open = useUiStore((s) => s.quickFileOpen);
  const setOpen = useUiStore((s) => s.setQuickFileOpen);
  const selectedCardKey = useUiStore((s) => s.selectedCardKey);
  const selectedProjectId = useUiStore((s) => s.selectedProjectId);
  const attachedAddress = useUiStore((s) => s.attachedAddress);
  const setMarkdownViewerTarget = useUiStore((s) => s.setMarkdownViewerTarget);
  const setCodeViewerTarget = useUiStore((s) => s.setCodeViewerTarget);
  const showToast = useUiStore((s) => s.showToast);

  const projects = useAppStore((s) => s.projects);
  const worktreesByProject = useAppStore((s) => s.worktreesByProject);
  const allSessions = useAppStore((s) => s.computed.allSessions);
  const symbolIndexEnabled = useAppStore(
    (s) => s.settings.symbol_index_enabled ?? false
  );
  const [symbolStatus, setSymbolStatus] = useState<SymbolIndexStatus | null>(null);

  // Build available scopes (project + worktree) so user defaults to focused card but can switch easily
  const scopes = useMemo<TargetScope[]>(() => {
    const out: TargetScope[] = [];
    for (const p of projects) {
      const wts = worktreesByProject[p.id] ?? [];
      if (wts.length > 0) {
        for (const wt of wts) {
          out.push({
            projectId: p.id,
            projectName: p.name,
            repoPath: p.repo_path,
            worktreePath: wt.path,
            branch: wt.branch || (wt.is_main ? p.default_branch || "main" : "wt"),
          });
        }
      } else {
        out.push({
          projectId: p.id,
          projectName: p.name,
          repoPath: p.repo_path,
          worktreePath: p.repo_path,
          branch: p.default_branch || "main",
        });
      }
    }
    return out;
  }, [projects, worktreesByProject]);

  const defaultScope = useMemo<TargetScope | null>(() => {
    if (scopes.length === 0) return null;
    // 1. If a terminal is actively attached (e.g. Zen Time to chill right pane), prefer its project/worktree
    if (attachedAddress) {
      const liveSess = allSessions.find((s) => s.address === attachedAddress);
      if (liveSess?.projectId) {
        const normWt = normalizePath(liveSess.worktreePath);
        const byAttached =
          scopes.find(
            (sc) =>
              sc.projectId === liveSess.projectId &&
              normalizePath(sc.worktreePath) === normWt
          ) ?? scopes.find((sc) => sc.projectId === liveSess.projectId);
        if (byAttached) return byAttached;
      }
    }
    if (selectedCardKey && selectedCardKey.startsWith("wt::")) {
      const rest = selectedCardKey.slice(4);
      const sepIdx = rest.indexOf("::");
      if (sepIdx > 0) {
        const pid = rest.slice(0, sepIdx);
        const normWt = rest.slice(sepIdx + 2);
        const exact = scopes.find(
          (sc) =>
            sc.projectId === pid && normalizePath(sc.worktreePath) === normWt
        );
        if (exact) return exact;
      }
    }
    if (selectedProjectId) {
      const byProj = scopes.find((sc) => sc.projectId === selectedProjectId);
      if (byProj) return byProj;
    }
    return scopes[0];
  }, [scopes, attachedAddress, allSessions, selectedCardKey, selectedProjectId]);

  const [scopeKey, setScopeKey] = useState<string>("");
  const [query, setQuery] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [matchMode, setMatchMode] = useState<string>("fuzzy");
  const [regexError, setRegexError] = useState<string | null>(null);
  const [matches, setMatches] = useState<FileMatchItem[]>([]);
  const [totalIndexed, setTotalIndexed] = useState(0);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const reqGenRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  const activeScope = useMemo<TargetScope | null>(() => {
    if (!scopeKey) return defaultScope;
    return (
      scopes.find(
        (sc) =>
          `${sc.projectId}::${normalizePath(sc.worktreePath)}` === scopeKey
      ) ?? defaultScope
    );
  }, [scopeKey, scopes, defaultScope]);

  // Reset modal state on open
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setRegexError(null);
    setMatchMode("fuzzy");
    setActiveIdx(0);
    if (defaultScope) {
      setScopeKey(
        `${defaultScope.projectId}::${normalizePath(defaultScope.worktreePath)}`
      );
    } else {
      setScopeKey("");
    }
  }, [open, defaultScope]);

  // Run native Rust search with race-safe generation token (zero UI-thread file scanning)
  useEffect(() => {
    if (!open || !activeScope) return;
    const gen = ++reqGenRef.current;
    const delayMs = query.trim().length === 0 ? 0 : 35;

    const timer = setTimeout(() => {
      setLoading(true);
      void searchProjectFiles(
        activeScope.projectId,
        activeScope.worktreePath,
        query,
        80,
        useRegex
      )
        .then((res) => {
          if (gen !== reqGenRef.current) return;
          setMatches(res.matches);
          setTotalIndexed(res.total_indexed);
          setMatchMode(res.match_mode || "fuzzy");
          setRegexError(res.regex_error ?? null);
          setActiveIdx(0);
        })
        .catch((err) => {
          if (gen !== reqGenRef.current) return;
          setMatches([]);
          setRegexError(null);
          showToast(`파일 검색 실패: ${String(err)}`, "error");
        })
        .finally(() => {
          if (gen === reqGenRef.current) setLoading(false);
        });
    }, delayMs);

    return () => clearTimeout(timer);
  }, [open, activeScope, query, useRegex, showToast]);

  // 1) Subscribe to symbol index status & progress events (no churn when typing query)
  useEffect(() => {
    if (!open || !activeScope || !symbolIndexEnabled) {
      setSymbolStatus(null);
      return;
    }
    let cancelled = false;
    const pid = activeScope.projectId;

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
  }, [open, activeScope, symbolIndexEnabled]);

  // 2) Lazy per-project symbol warm trigger: 800ms debounce on initial open/scope switch,
  //    or immediate once user starts typing a query.
  const hasTypedQuery = query.trim().length > 0;
  useEffect(() => {
    if (!open || !activeScope || !symbolIndexEnabled) return;
    let cancelled = false;
    const pid = activeScope.projectId;
    const wtPath = activeScope.worktreePath;
    const delayMs = hasTypedQuery ? 0 : 800;

    const warmTimer = setTimeout(() => {
      if (cancelled) return;
      void warmProjectSymbolIndex(pid, wtPath)
        .then((st) => {
          if (!cancelled && st) setSymbolStatus(st);
        })
        .catch(() => {});
    }, delayMs);

    return () => {
      cancelled = true;
      clearTimeout(warmTimer);
    };
  }, [open, activeScope, symbolIndexEnabled, hasTypedQuery]);

  // Keep active row scrolled into view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-file-idx="${activeIdx}"]`
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  const executeAction = useCallback(
    async (relPath: string, isShift: boolean) => {
      if (!activeScope) return;
      const absPath = joinFsPath(activeScope.worktreePath, relPath);
      const isMd = isMarkdownFile(relPath);
      setOpen(false);

      // Shift+Enter -> OS default app for all files
      if (isShift) {
        try {
          await openWithDefaultApp(absPath);
        } catch (err) {
          showToast(`기본 앱 열기 실패: ${String(err)}`, "error");
        }
        return;
      }

      // Enter -> Built-in fast Markdown viewer (.md) or Built-in fast Code viewer (all other files)
      const viewerTarget = {
        absolutePath: absPath,
        relativePath: relPath,
        projectName: `${activeScope.projectName} / ${activeScope.branch}`,
        rootPath: activeScope.worktreePath,
        projectId: activeScope.projectId,
        repoPath: activeScope.repoPath,
      };
      if (isMd) {
        setMarkdownViewerTarget(viewerTarget);
      } else {
        if (symbolIndexEnabled) {
          void warmProjectSymbolIndex(
            activeScope.projectId,
            activeScope.worktreePath
          ).catch(() => {});
        }
        setCodeViewerTarget(viewerTarget);
      }
    },
    [
      activeScope,
      symbolIndexEnabled,
      setOpen,
      setMarkdownViewerTarget,
      setCodeViewerTarget,
      showToast,
    ]
  );

  const openVsCodeDirect = useCallback(
    async (relPath: string) => {
      if (!activeScope) return;
      const absPath = joinFsPath(activeScope.worktreePath, relPath);
      setOpen(false);
      try {
        await openInVsCode(absPath);
      } catch (err) {
        showToast(`VS Code 열기 실패: ${String(err)}`, "error");
      }
    },
    [activeScope, setOpen, showToast]
  );

  if (!open) return null;

  const activeItem = matches[activeIdx] ?? null;
  const activeIsMd = activeItem ? isMarkdownFile(activeItem.path) : false;

  const renderFileIcon = (relPath: string) => {
    const lower = relPath.toLowerCase();
    if (isMarkdownFile(lower)) {
      return (
        <FileText
          className="w-4 h-4 shrink-0"
          style={{ color: "var(--accent)" }}
        />
      );
    }
    if (lower.endsWith(".json") || lower.endsWith(".toml") || lower.endsWith(".yaml") || lower.endsWith(".yml")) {
      return (
        <FileJson
          className="w-4 h-4 shrink-0"
          style={{ color: "var(--warn-fg)" }}
        />
      );
    }
    return (
      <FileCode2
        className="w-4 h-4 shrink-0"
        style={{ color: "var(--text-muted)" }}
      />
    );
  };

  return (
    <div
      onClick={() => setOpen(false)}
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4"
      style={{ background: "var(--modal-overlay)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="jjdr-modal w-full max-w-2xl rounded-[22px] overflow-hidden flex flex-col"
      >
        {/* Top Scope Strip */}
        <div
          className="px-4 py-2 flex items-center justify-between gap-2 text-[11px]"
          style={{
            background: "var(--modal-footer)",
            borderBottom: "1px solid var(--divider)",
          }}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <FolderGit2
              className="w-3.5 h-3.5 shrink-0"
              style={{ color: "var(--accent)" }}
            />
            {scopes.length > 0 ? (
              <select
                value={
                  activeScope
                    ? `${activeScope.projectId}::${normalizePath(activeScope.worktreePath)}`
                    : ""
                }
                onChange={(e) => setScopeKey(e.target.value)}
                className="bg-transparent font-mono-code font-semibold text-xs outline-none truncate cursor-pointer"
                style={{ color: "var(--text-primary)" }}
              >
                {scopes.map((sc) => {
                  const key = `${sc.projectId}::${normalizePath(sc.worktreePath)}`;
                  return (
                    <option
                      key={key}
                      value={key}
                      style={{
                        background: "var(--modal-bg)",
                        color: "var(--text-primary)",
                      }}
                    >
                      {sc.projectName} / {sc.branch}
                    </option>
                  );
                })}
              </select>
            ) : (
              <span style={{ color: "var(--text-muted)" }}>
                등록된 프로젝트 없음
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <SymbolIndexBadge enabled={symbolIndexEnabled} status={symbolStatus} />
            <span
              className="font-mono-code tabular-nums shrink-0"
              style={{ color: "var(--text-faint)" }}
            >
              {loading
                ? "검색 중..."
                : `${matches.length} / ${totalIndexed.toLocaleString()} files`}
            </span>
          </div>
        </div>

        {/* Search Input */}
        <div
          className="flex items-center gap-2.5 px-4 py-3"
          style={{ borderBottom: "1px solid var(--divider)" }}
        >
          <Search
            className="w-4 h-4 shrink-0"
            style={{ color: "var(--text-muted)" }}
          />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key.toLowerCase() === "r" || e.code === "KeyR")) {
                e.preventDefault();
                setUseRegex((v) => !v);
                return;
              }
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIdx((i) =>
                  matches.length > 0 ? (i + 1) % matches.length : 0
                );
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIdx((i) =>
                  matches.length > 0
                    ? (i - 1 + matches.length) % matches.length
                    : 0
                );
              } else if (e.key === "Enter" && activeItem) {
                e.preventDefault();
                void executeAction(activeItem.path, e.shiftKey);
              }
            }}
            placeholder="파일 찾기 (예: readme, *.cpp, src/**/*.ts, /radar.*tile/)..."
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: "var(--text-primary)" }}
          />
          {query.trim().length > 0 && matchMode !== "fuzzy" && (
            <span
              className="text-[10px] font-mono-code font-semibold px-2 py-0.5 rounded-full uppercase shrink-0"
              style={{
                background: regexError ? "var(--action-soft)" : "var(--accent-soft)",
                color: regexError ? "var(--action-fg)" : "var(--accent)",
              }}
            >
              {matchMode}
            </span>
          )}
          <button
            type="button"
            onClick={() => setUseRegex((v) => !v)}
            title="정규식(Regex) 모드 토글 (Alt+R)"
            className={`px-2 py-1 rounded-lg font-mono-code text-xs font-bold transition-colors cursor-pointer shrink-0 ${
              useRegex ? "jjdr-pill-active" : "jjdr-pill"
            }`}
            style={
              useRegex
                ? { border: "1px solid var(--accent-border)" }
                : { color: "var(--text-muted)" }
            }
          >
            .*
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="p-1 rounded-full hover:bg-black/15 cursor-pointer"
            style={{ color: "var(--text-muted)" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {regexError && (
          <div
            className="px-4 py-1.5 text-[11px] font-mono-code"
            style={{
              background: "var(--action-soft)",
              color: "var(--action-fg)",
              borderBottom: "1px solid var(--divider)",
            }}
          >
            정규식 문법 오류: {regexError}
          </div>
        )}

        {/* File List */}
        <div
          ref={listRef}
          className="max-h-[52vh] overflow-y-auto p-1.5 space-y-0.5"
        >
          {!activeScope ? (
            <div
              className="py-10 text-center text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              먼저 Git 프로젝트를 등록해주세요.
            </div>
          ) : matches.length === 0 && !loading ? (
            <div
              className="py-10 text-center text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              일치하는 파일이 없습니다.
            </div>
          ) : (
            matches.map((item, idx) => {
              const isActive = idx === activeIdx;
              const isMd = isMarkdownFile(item.path);
              const { fileName, dirPath } = splitPathParts(item.path);

              return (
                <div
                  key={item.path}
                  data-file-idx={idx}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={(e) => void executeAction(item.path, e.shiftKey)}
                  className="group flex items-center justify-between gap-3 px-3 py-2 rounded-xl cursor-pointer transition-colors"
                  style={
                    isActive
                      ? {
                          background: "var(--accent-soft)",
                          color: "var(--text-primary)",
                        }
                      : { color: "var(--text-secondary)" }
                  }
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    {renderFileIcon(item.path)}
                    <span
                      className="text-xs font-mono-code font-semibold shrink-0"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {fileName}
                    </span>
                    {dirPath && (
                      <span
                        className="text-[11px] font-mono-code truncate"
                        style={{ color: "var(--text-faint)" }}
                      >
                        {dirPath}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {isMd && (
                      <span
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{
                          background: "var(--accent-soft)",
                          color: "var(--accent)",
                        }}
                      >
                        MD 뷰어
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void executeAction(item.path, true);
                      }}
                      title="기본 앱으로 열기 (Shift+Enter)"
                      className="opacity-0 group-hover:opacity-100 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] hover:bg-black/15 transition-opacity cursor-pointer"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>기본 앱</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void openVsCodeDirect(item.path);
                      }}
                      title="VS Code에서 열기"
                      className="opacity-0 group-hover:opacity-100 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] hover:bg-black/15 transition-opacity cursor-pointer"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      <Code2 className="w-3 h-3" />
                      <span>VS Code</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Dynamic Footer Shortcut Hints */}
        <div
          className="px-4 py-2 flex items-center justify-between gap-2 text-[11px] select-none"
          style={{
            background: "var(--modal-footer)",
            borderTop: "1px solid var(--divider)",
            color: "var(--text-muted)",
          }}
        >
          <div className="flex items-center gap-3">
            <span>
              <kbd className="font-mono-code font-semibold" style={{ color: "var(--text-primary)" }}>
                Enter
              </kbd>{" "}
              {activeIsMd ? "내장 MD 뷰어" : "내장 코드뷰어"}
            </span>
            <span>
              <kbd className="font-mono-code font-semibold" style={{ color: "var(--text-primary)" }}>
                Shift+Enter
              </kbd>{" "}
              기본 앱으로 열기
            </span>
            <span>
              <kbd className="font-mono-code font-semibold" style={{ color: "var(--text-primary)" }}>
                Alt+R
              </kbd>{" "}
              Regex
            </span>
          </div>
          <span className="font-mono-code text-[10px] opacity-75">
            ↑↓ 이동 · Esc 닫기
          </span>
        </div>
      </div>
    </div>
  );
});
