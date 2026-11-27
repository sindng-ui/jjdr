import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { AutoMissionInfo, WorktreeCardMeta } from "../../types/domain";
import type { ZenDispatchWorker } from "../../utils/zenDispatch";
import { filterDispatchWorkers } from "../../utils/zenDispatchSearch";
import { getWorkerPersona } from "../../utils/workerPersona";
import { WorkerMonsterAvatar } from "./WorkerMonsterAvatar";
import { MissionBadges } from "../shared/MissionBadges";

interface ZenWorkerSearchBarProps {
  projectId: string;
  deck: ZenDispatchWorker[];
  activeIndex: number;
  worktreeMeta: Record<string, WorktreeCardMeta>;
  autoMissionByWorktree: Record<string, AutoMissionInfo>;
  onSelectDeckIndex: (deckIndex: number) => void;
  onReturnToTerminal: () => void;
}

/**
 * Compact 1-line Spotlight-lite worker finder inside Zen Dispatch Assign mode.
 * Keyboard flow: Ctrl+Up / Ctrl+F -> type -> Up/Down -> Enter (or Ctrl+Down / Esc) -> focus right terminal.
 */
export const ZenWorkerSearchBar = React.memo(function ZenWorkerSearchBar({
  projectId,
  deck,
  activeIndex,
  worktreeMeta,
  autoMissionByWorktree,
  onSelectDeckIndex,
  onReturnToTerminal,
}: ZenWorkerSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);

  // Reset search state whenever switching to a different project
  useEffect(() => {
    setQuery("");
    setOpen(false);
    setHighlightIdx(0);
  }, [projectId]);

  const matches = useMemo(
    () =>
      filterDispatchWorkers(deck, query, worktreeMeta, autoMissionByWorktree),
    [deck, query, worktreeMeta, autoMissionByWorktree]
  );

  // Keep highlight index clamped to current match list
  useEffect(() => {
    if (matches.length === 0) {
      setHighlightIdx(0);
      return;
    }
    if (!query.trim()) {
      const curPos = matches.findIndex((m) => m.deckIndex === activeIndex);
      setHighlightIdx(curPos >= 0 ? curPos : 0);
    } else {
      setHighlightIdx((prev) => (prev < matches.length ? prev : 0));
    }
  }, [matches, query, activeIndex]);

  // Keep highlighted dropdown row visible while navigating with Up/Down arrows
  useEffect(() => {
    if (!open) return;
    itemRefs.current[highlightIdx]?.scrollIntoView({ block: "nearest" });
  }, [open, highlightIdx]);

  // Listen for global Ctrl+Down / Escape close signal dispatched from useGlobalShortcuts
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onExternalClose = (ev: Event) => {
      const detail = (ev as CustomEvent<{ clear?: boolean }>).detail;
      if (detail?.clear) {
        setQuery("");
      }
      setOpen(false);
    };
    el.addEventListener("jjdr:dispatch-search-close", onExternalClose);
    return () => {
      el.removeEventListener("jjdr:dispatch-search-close", onExternalClose);
    };
  }, []);

  const commitSelection = (deckIdx: number) => {
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
    onSelectDeckIndex(deckIdx);
    onReturnToTerminal();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(true);
      if (matches.length > 0) {
        setHighlightIdx((prev) => (prev + 1) % matches.length);
      }
      return;
    }
    if (e.key === "ArrowUp" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(true);
      if (matches.length > 0) {
        setHighlightIdx((prev) => (prev - 1 + matches.length) % matches.length);
      }
      return;
    }
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      const picked = matches[highlightIdx] ?? matches[0];
      if (picked) {
        commitSelection(picked.deckIndex);
      } else {
        setOpen(false);
        inputRef.current?.blur();
        onReturnToTerminal();
      }
    }
  };

  return (
    <div className="flex-1 max-w-[320px] min-w-[160px]">
      <div
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-colors"
        style={{
          background: "var(--input-bg)",
          border: `1px solid ${open ? "var(--accent)" : "var(--input-border)"}`,
        }}
      >
        <Search
          className="w-3 h-3 shrink-0"
          style={{ color: open ? "var(--accent)" : "var(--text-faint)" }}
        />
        <input
          ref={inputRef}
          type="text"
          data-jjdr-dispatch-search="true"
          value={query}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlightIdx(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder={`Find worker (${deck.length}) · PR#, name…`}
          aria-label="Search standby workers"
          className="w-full bg-transparent outline-none text-[11px] font-mono-code"
          style={{ color: "var(--text-primary)" }}
        />
        {query ? (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="p-0.5 rounded-full cursor-pointer hover:bg-black/10 shrink-0"
            style={{ color: "var(--text-muted)" }}
            aria-label="Clear search"
          >
            <X className="w-3 h-3" />
          </button>
        ) : (
          <kbd
            className="text-[9px] font-mono-code px-1.5 py-0.2 rounded shrink-0 select-none"
            style={{
              background: "var(--pill-bg)",
              color: "var(--text-faint)",
            }}
          >
            Ctrl+↑
          </kbd>
        )}
      </div>

      {open && (
        <div
          className="absolute left-0 right-0 top-full mt-2 mx-auto w-full max-w-[540px] z-40 rounded-2xl overflow-hidden py-1.5"
          style={{
            background: "var(--modal-bg)",
            border: "1px solid var(--card-border)",
            boxShadow: "var(--stage-shadow)",
          }}
        >
          {matches.length === 0 ? (
            <div
              className="px-4 py-4 text-center text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              No matching workers for &ldquo;{query}&rdquo;
            </div>
          ) : (
            <div className="max-h-[340px] overflow-y-auto px-1.5 space-y-1">
              {matches.map((m, idx) => {
                const isHighlighted = idx === highlightIdx;
                const isCurrent = m.deckIndex === activeIndex;
                const persona = getWorkerPersona(m.worker.normWtPath);
                const hasAi = Boolean(m.worker.aiSession);
                const branchText = m.worker.worktree.branch || "(detached)";

                return (
                  <button
                    key={m.worker.cardKey}
                    ref={(el) => {
                      itemRefs.current[idx] = el;
                    }}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setHighlightIdx(idx)}
                    onClick={() => commitSelection(m.deckIndex)}
                    className="w-full text-left px-3 py-2.5 rounded-xl flex items-start gap-3 cursor-pointer transition-colors"
                    style={{
                      background: isHighlighted
                        ? "var(--accent-soft)"
                        : "transparent",
                      border: `1px solid ${
                        isHighlighted ? "var(--accent-border)" : "transparent"
                      }`,
                    }}
                  >
                    <WorkerMonsterAvatar
                      persona={persona}
                      mood={hasAi ? "ready" : "sleeping"}
                      size={28}
                      className="shrink-0 mt-0.5"
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      {/* Line 1: Clear Card Name / Branch + Status Pill */}
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <span
                          className="text-xs font-extrabold truncate"
                          style={{ color: "var(--text-primary)" }}
                          title={
                            m.displayName
                              ? `${m.displayName} (${branchText})`
                              : branchText
                          }
                        >
                          {m.displayName || branchText}
                        </span>
                        <span
                          className="text-[10px] font-mono-code font-bold px-2 py-0.5 rounded-full shrink-0"
                          style={{
                            background: isCurrent
                              ? "var(--accent-soft)"
                              : hasAi
                              ? "var(--ready-soft)"
                              : "var(--pill-bg)",
                            color: isCurrent
                              ? "var(--accent)"
                              : hasAi
                              ? "var(--ready-fg)"
                              : "var(--text-faint)",
                          }}
                        >
                          {isCurrent ? "ACTIVE" : hasAi ? "AI" : "ZZZ"}
                        </span>
                      </div>

                      {/* Line 2: Mission Badges + Persona + Project / Branch + Note */}
                      <div
                        className="flex items-center gap-1.5 flex-wrap text-[11px] font-mono-code leading-tight"
                        style={{ color: "var(--text-muted)" }}
                      >
                        <MissionBadges mission={m.mission} size="xs" />
                        <span
                          className="font-semibold shrink-0"
                          style={{ color: persona.palette.body }}
                        >
                          {persona.name}
                        </span>
                        <span className="opacity-60">·</span>
                        <span className="truncate max-w-[240px]">
                          {m.worker.project.name} / {branchText}
                        </span>
                        {m.note && (
                          <span
                            className="truncate max-w-[160px] px-1.5 py-0.2 rounded-full text-[10px]"
                            style={{
                              background: "var(--input-bg)",
                              border: "1px solid var(--divider)",
                              color: "var(--text-secondary)",
                            }}
                            title={m.note}
                          >
                            {m.note}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          <div
            className="px-3 pt-1.5 mt-1 flex items-center justify-between text-[10px] font-mono-code"
            style={{
              borderTop: "1px solid var(--divider)",
              color: "var(--text-faint)",
            }}
          >
            <span>
              {matches.length} / {deck.length} workers · ↑↓ Select · Enter Assign
            </span>
            <span>Ctrl+↓ / Esc Terminal</span>
          </div>
        </div>
      )}
    </div>
  );
});
