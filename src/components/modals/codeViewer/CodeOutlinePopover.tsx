import React, { useEffect, useMemo, useRef, useState } from "react";
import { ListTree, Search, X } from "lucide-react";
import type { OutlineSymbol, SymbolKind } from "../../../types/domain";

interface CodeOutlinePopoverProps {
  fileName: string;
  symbols: OutlineSymbol[];
  loading: boolean;
  onJumpLine: (line: number) => void;
  onClose: () => void;
}

const KIND_COLOR: Partial<Record<SymbolKind, string>> = {
  class: "#38bdf8",
  struct: "#38bdf8",
  interface: "#34d399",
  record: "#38bdf8",
  enum: "#fbbf24",
  trait: "#34d399",
  namespace: "#a78bfa",
  module: "#a78bfa",
  method: "#c084fc",
  function: "#93c5fd",
  constructor: "#c084fc",
  property: "#7dd3fc",
  macro: "#f472b6",
};

export const CodeOutlinePopover = React.memo(function CodeOutlinePopover({
  fileName,
  symbols,
  loading,
  onJumpLine,
  onClose,
}: CodeOutlinePopoverProps) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return symbols;
    return symbols.filter((s) => {
      const hay = s.scope ? `${s.scope}.${s.name}`.toLowerCase() : s.name.toLowerCase();
      return hay.includes(q);
    });
  }, [symbols, query]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query, symbols]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-outline-idx="${activeIdx}"]`
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const picked = filtered[activeIdx];
      if (picked) {
        onJumpLine(picked.line);
        onClose();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      className="absolute inset-0 z-30 flex items-start justify-center pt-14 px-4"
      style={{ background: "rgba(0, 0, 0, 0.35)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="jjdr-modal w-full max-w-[540px] rounded-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: "62vh" }}
      >
        <div
          className="px-4 py-2.5 flex items-center gap-2 shrink-0"
          style={{ borderBottom: "1px solid var(--divider)" }}
        >
          <ListTree className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--accent)" }} />
          <Search className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--text-muted)" }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`${fileName} 내 심볼 검색 (Ctrl+Shift+O)...`}
            className="flex-1 bg-transparent outline-none font-mono-code text-xs"
            style={{ color: "var(--text-primary)" }}
          />
          <span
            className="text-[10.5px] font-mono-code shrink-0"
            style={{ color: "var(--text-muted)" }}
          >
            {filtered.length}/{symbols.length}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full hover:bg-black/15 cursor-pointer"
            style={{ color: "var(--text-muted)" }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div ref={listRef} className="overflow-y-auto py-1">
          {loading ? (
            <div
              className="py-8 text-center text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              파일 심볼 분석 중...
            </div>
          ) : filtered.length === 0 ? (
            <div
              className="py-8 text-center text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              {symbols.length === 0
                ? "이 파일에서 추출된 심볼이 없습니다. (C#/C++/TS/JS/Rust 지원)"
                : "일치하는 심볼이 없습니다."}
            </div>
          ) : (
            filtered.map((sym, idx) => {
              const active = idx === activeIdx;
              const color = KIND_COLOR[sym.kind] ?? "#93c5fd";
              return (
                <button
                  key={`${sym.name}:${sym.line}:${idx}`}
                  type="button"
                  data-outline-idx={idx}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => {
                    onJumpLine(sym.line);
                    onClose();
                  }}
                  className="w-full text-left px-4 py-1.5 flex items-center justify-between gap-2 cursor-pointer"
                  style={{
                    background: active ? "var(--accent-soft)" : "transparent",
                  }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="text-[10px] font-mono-code font-bold px-1.5 py-0.5 rounded shrink-0"
                      style={{
                        background: "var(--pill-bg)",
                        color,
                      }}
                    >
                      {sym.kind}
                    </span>
                    <span
                      className="text-xs font-mono-code truncate"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {sym.scope ? (
                        <>
                          <span style={{ color: "var(--text-muted)" }}>
                            {sym.scope}.
                          </span>
                          {sym.name}
                        </>
                      ) : (
                        sym.name
                      )}
                    </span>
                  </div>
                  <span
                    className="text-[11px] font-mono-code tabular-nums shrink-0"
                    style={{ color: "var(--text-muted)" }}
                  >
                    :{sym.line}
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
