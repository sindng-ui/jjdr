import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Code2,
  ExternalLink,
  FileSearch,
  FolderGit2,
  Loader2,
  Regex,
  X,
} from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import {
  openInVsCode,
  openWithDefaultApp,
  searchWorkspaceText,
} from "../../services/tauriBridge";
import type { WorkspaceTextMatch } from "../../types/domain";
import { normalizePath } from "../../workers/dashboardLogic";

interface SearchScope {
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

export const WorkspaceSearchModal = React.memo(function WorkspaceSearchModal() {
  const open = useUiStore((s) => s.workspaceSearchOpen);
  const setOpen = useUiStore((s) => s.setWorkspaceSearchOpen);
  const selectedCardKey = useUiStore((s) => s.selectedCardKey);
  const selectedProjectId = useUiStore((s) => s.selectedProjectId);
  const attachedAddress = useUiStore((s) => s.attachedAddress);
  const codeViewerTarget = useUiStore((s) => s.codeViewerTarget);
  const setCodeViewerTarget = useUiStore((s) => s.setCodeViewerTarget);
  const showToast = useUiStore((s) => s.showToast);

  const projects = useAppStore((s) => s.projects);
  const worktreesByProject = useAppStore((s) => s.worktreesByProject);
  const allSessions = useAppStore((s) => s.computed.allSessions);

  const scopes = useMemo<SearchScope[]>(() => {
    const out: SearchScope[] = [];
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

  const defaultScope = useMemo<SearchScope | null>(() => {
    if (scopes.length === 0) return null;
    if (codeViewerTarget?.rootPath) {
      const normOpen = normalizePath(codeViewerTarget.rootPath);
      const fromOpen = scopes.find(
        (sc) => normalizePath(sc.worktreePath) === normOpen
      );
      if (fromOpen) return fromOpen;
    }
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
  }, [scopes, codeViewerTarget, attachedAddress, allSessions, selectedCardKey, selectedProjectId]);

  const [scopeKey, setScopeKey] = useState("");
  const [query, setQuery] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);

  const [matches, setMatches] = useState<WorkspaceTextMatch[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [regexError, setRegexError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const reqGenRef = useRef(0);

  const activeScope = useMemo<SearchScope | null>(() => {
    if (!scopeKey) return defaultScope;
    return (
      scopes.find(
        (sc) =>
          `${sc.projectId}::${normalizePath(sc.worktreePath)}` === scopeKey
      ) ?? defaultScope
    );
  }, [scopeKey, scopes, defaultScope]);

  // Reset scope & focus input on open (pre-fill single-line selection if any)
  useEffect(() => {
    if (!open) return;
    if (defaultScope) {
      setScopeKey(
        `${defaultScope.projectId}::${normalizePath(defaultScope.worktreePath)}`
      );
    } else {
      setScopeKey("");
    }
    const sel = window.getSelection()?.toString().trim() ?? "";
    if (sel && !sel.includes("\n") && sel.length <= 80) {
      setQuery(sel);
    }
    setRegexError(null);
    setActiveIdx(0);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [open, defaultScope]);

  // Debounced native git grep search
  useEffect(() => {
    if (!open || !activeScope) return;
    const trimmed = query.trim();
    const gen = ++reqGenRef.current;
    if (!trimmed) {
      setMatches([]);
      setTruncated(false);
      setRegexError(null);
      setLoading(false);
      return;
    }

    const delay = trimmed.length < 2 ? 320 : 160;
    const timer = setTimeout(() => {
      setLoading(true);
      void searchWorkspaceText({
        rootPath: activeScope.worktreePath,
        query: trimmed,
        useRegex,
        caseSensitive,
        wholeWord,
        maxResults: 400,
      })
        .then((res) => {
          if (gen !== reqGenRef.current) return;
          setMatches(res.matches);
          setTruncated(res.truncated);
          setElapsedMs(res.elapsed_ms);
          setRegexError(res.regex_error ?? null);
          setActiveIdx(0);
        })
        .catch((err) => {
          if (gen !== reqGenRef.current) return;
          setMatches([]);
          setRegexError(String(err));
        })
        .finally(() => {
          if (gen === reqGenRef.current) setLoading(false);
        });
    }, delay);

    return () => clearTimeout(timer);
  }, [open, activeScope, query, useRegex, caseSensitive, wholeWord]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-ws-idx="${activeIdx}"]`
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  const openMatch = useCallback(
    async (match: WorkspaceTextMatch, isShift: boolean) => {
      if (!activeScope) return;
      const absPath = joinFsPath(activeScope.worktreePath, match.relative_path);
      setOpen(false);
      if (isShift) {
        try {
          await openWithDefaultApp(absPath);
        } catch (err) {
          showToast(`기본 앱 열기 실패: ${String(err)}`, "error");
        }
        return;
      }
      setCodeViewerTarget({
        absolutePath: absPath,
        relativePath: match.relative_path,
        projectName: `${activeScope.projectName} / ${activeScope.branch}`,
        rootPath: activeScope.worktreePath,
        projectId: activeScope.projectId,
        repoPath: activeScope.repoPath,
        initialLine: match.line,
        initialCol: match.col,
      });
    },
    [activeScope, setOpen, setCodeViewerTarget, showToast]
  );

  const openMatchInVsCode = useCallback(
    async (match: WorkspaceTextMatch) => {
      if (!activeScope) return;
      const absPath = joinFsPath(activeScope.worktreePath, match.relative_path);
      setOpen(false);
      try {
        await openInVsCode(absPath, match.line);
      } catch (err) {
        showToast(`VS Code 열기 실패: ${String(err)}`, "error");
      }
    },
    [activeScope, setOpen, showToast]
  );

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, Math.max(0, matches.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const picked = matches[activeIdx];
      if (picked) {
        void openMatch(picked, e.shiftKey);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.altKey && (e.key.toLowerCase() === "r" || e.code === "KeyR")) {
      e.preventDefault();
      setUseRegex((v) => !v);
    } else if (e.altKey && (e.key.toLowerCase() === "c" || e.code === "KeyC")) {
      e.preventDefault();
      setCaseSensitive((v) => !v);
    } else if (e.altKey && (e.key.toLowerCase() === "w" || e.code === "KeyW")) {
      e.preventDefault();
      setWholeWord((v) => !v);
    }
  };

  return (
    <div
      onClick={() => setOpen(false)}
      className="fixed inset-0 z-[60] flex items-start justify-center pt-16 px-4"
      style={{ background: "var(--modal-overlay)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="jjdr-modal w-full max-w-3xl rounded-[22px] overflow-hidden flex flex-col"
        style={{ maxHeight: "76vh" }}
      >
        {/* Top Scope Strip (same UX grammar as Ctrl+P QuickFileModal) */}
        <div
          className="px-4 py-2 flex items-center justify-between gap-2 text-[11px] shrink-0"
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
          <span
            className="font-mono-code tabular-nums shrink-0"
            style={{ color: "var(--text-faint)" }}
          >
            {loading
              ? "검색 중..."
              : matches.length > 0
              ? `${matches.length.toLocaleString()}건${truncated ? "+" : ""} · ${elapsedMs}ms`
              : "Ctrl+Shift+F 전체 단어/정규식 찾기"}
          </span>
        </div>

        {/* Search Input + Option Toggles */}
        <div
          className="flex items-center gap-2 px-4 py-3 shrink-0"
          style={{ borderBottom: "1px solid var(--divider)" }}
        >
          <FileSearch
            className="w-4 h-4 shrink-0"
            style={{ color: "var(--accent)" }}
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="프로젝트 전체에서 단어 또는 정규식 검색..."
            className="flex-1 bg-transparent outline-none font-mono-code text-sm"
            style={{ color: "var(--text-primary)" }}
          />
          {loading && (
            <Loader2
              className="w-4 h-4 animate-spin shrink-0"
              style={{ color: "var(--accent)" }}
            />
          )}
          <button
            type="button"
            onClick={() => setCaseSensitive((v) => !v)}
            title="대소문자 구분 (Alt+C)"
            className={`jjdr-pill px-2 py-0.5 rounded-md font-mono-code text-[11px] font-bold cursor-pointer ${
              caseSensitive ? "jjdr-pill-active" : ""
            }`}
            style={caseSensitive ? undefined : { color: "var(--text-muted)" }}
          >
            Aa
          </button>
          <button
            type="button"
            onClick={() => setWholeWord((v) => !v)}
            title="단어 단위 일치 (Alt+W)"
            className={`jjdr-pill px-2 py-0.5 rounded-md font-mono-code text-[11px] font-bold cursor-pointer ${
              wholeWord ? "jjdr-pill-active" : ""
            }`}
            style={wholeWord ? undefined : { color: "var(--text-muted)" }}
          >
            ab
          </button>
          <button
            type="button"
            onClick={() => setUseRegex((v) => !v)}
            title="정규식 사용 (Alt+R)"
            className={`jjdr-pill inline-flex items-center px-2 py-0.5 rounded-md font-mono-code text-[11px] font-bold cursor-pointer ${
              useRegex ? "jjdr-pill-active" : ""
            }`}
            style={useRegex ? undefined : { color: "var(--text-muted)" }}
          >
            <Regex className="w-3.5 h-3.5" />
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

        {/* Regex Error */}
        {regexError && (
          <div
            className="px-4 py-1.5 text-[11px] font-mono-code shrink-0"
            style={{
              background: "var(--action-soft)",
              color: "var(--action-fg)",
              borderBottom: "1px solid var(--action-border)",
            }}
          >
            정규식 오류: {regexError}
          </div>
        )}

        {/* Results */}
        <div
          ref={listRef}
          className="flex-1 min-h-0 overflow-y-auto divide-y divide-white/5"
        >
          {!activeScope ? (
            <div
              className="py-12 text-center text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              등록된 프로젝트가 없습니다.
            </div>
          ) : !query.trim() ? (
            <div
              className="py-12 text-center text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              선택된 프로젝트/워크트리 전체에서 텍스트 또는 정규식을 검색합니다.
            </div>
          ) : matches.length === 0 && !loading && !regexError ? (
            <div
              className="py-12 text-center text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              일치하는 결과가 없습니다.
            </div>
          ) : (
            matches.map((m, idx) => {
              const active = idx === activeIdx;
              return (
                <div
                  key={`${m.relative_path}:${m.line}:${m.col}:${idx}`}
                  data-ws-idx={idx}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => void openMatch(m, false)}
                  className="px-4 py-2 flex items-center justify-between gap-3 cursor-pointer"
                  style={{
                    background: active ? "var(--accent-soft)" : "transparent",
                  }}
                >
                  <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="text-xs font-mono-code font-semibold truncate"
                        style={{ color: "var(--accent)" }}
                      >
                        {m.relative_path}
                      </span>
                      <span
                        className="text-[11px] font-mono-code tabular-nums shrink-0"
                        style={{ color: "var(--text-muted)" }}
                      >
                        :{m.line}
                      </span>
                    </div>
                    <div
                      className="text-[11.5px] font-mono-code truncate"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {m.line_text}
                    </div>
                  </div>
                  <div
                    className="flex items-center gap-1 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => void openMatchInVsCode(m)}
                      title={`VS Code에서 열기 (${m.line}번 줄)`}
                      className="jjdr-pill p-1.5 rounded-full cursor-pointer"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      <Code2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void openMatch(m, true)}
                      title="기본 앱으로 열기 (Shift+Enter)"
                      className="jjdr-pill p-1.5 rounded-full cursor-pointer"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div
          className="px-4 py-2 flex items-center justify-between text-[10.5px] font-mono-code shrink-0"
          style={{
            background: "var(--modal-footer)",
            borderTop: "1px solid var(--divider)",
            color: "var(--text-muted)",
          }}
        >
          <span>
            {truncated
              ? "최대 400건까지 표시됨 · 검색어를 더 구체적으로 입력하세요"
              : "git grep 고속 검색 (.gitignore 자동 제외)"}
          </span>
          <span>Enter 코드뷰어 점프 · Shift+Enter 기본 앱 · Alt+R 정규식 · Esc 닫기</span>
        </div>
      </div>
    </div>
  );
});
