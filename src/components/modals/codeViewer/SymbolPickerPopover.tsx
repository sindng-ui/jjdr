import React, { useEffect, useRef, useState } from "react";
import { CornerDownLeft, Crosshair, X } from "lucide-react";
import type { SymbolKind, SymbolMatch } from "../../../types/domain";

interface SymbolPickerPopoverProps {
  queryToken: string;
  matches: SymbolMatch[];
  onSelect: (match: SymbolMatch) => void;
  onClose: () => void;
}

const KIND_BADGE: Record<SymbolKind, { label: string; color: string }> = {
  class: { label: "C", color: "#38bdf8" },
  struct: { label: "S", color: "#38bdf8" },
  interface: { label: "I", color: "#34d399" },
  record: { label: "R", color: "#38bdf8" },
  enum: { label: "E", color: "#fbbf24" },
  trait: { label: "T", color: "#34d399" },
  namespace: { label: "N", color: "#a78bfa" },
  module: { label: "M", color: "#a78bfa" },
  method: { label: "m", color: "#c084fc" },
  function: { label: "f", color: "#93c5fd" },
  constructor: { label: "ctor", color: "#c084fc" },
  property: { label: "P", color: "#7dd3fc" },
  delegate: { label: "D", color: "#f472b6" },
  event: { label: "ev", color: "#fb923c" },
  type_alias: { label: "ty", color: "#38bdf8" },
  macro: { label: "#", color: "#f472b6" },
  constant: { label: "K", color: "#fbbf24" },
};

export const SymbolPickerPopover = React.memo(function SymbolPickerPopover({
  queryToken,
  matches,
  onSelect,
  onClose,
}: SymbolPickerPopoverProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setActiveIdx(0);
  }, [matches, queryToken]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setActiveIdx((i) => Math.min(i + 1, Math.max(0, matches.length - 1)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setActiveIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const picked = matches[activeIdx];
        if (picked) onSelect(picked);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [matches, activeIdx, onSelect, onClose]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-sym-idx="${activeIdx}"]`
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  return (
    <div
      className="absolute inset-0 z-30 flex items-start justify-center pt-16 px-4"
      style={{ background: "rgba(0, 0, 0, 0.35)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="jjdr-modal w-full max-w-[680px] rounded-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: "62vh" }}
      >
        <div
          className="px-4 py-2.5 flex items-center justify-between gap-2 shrink-0"
          style={{ borderBottom: "1px solid var(--divider)" }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Crosshair className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--accent)" }} />
            <span className="text-xs font-bold truncate" style={{ color: "var(--text-primary)" }}>
              정의 선택: <span className="font-mono-code">{queryToken}</span>
            </span>
            <span
              className="text-[10.5px] font-mono-code px-2 py-0.5 rounded-full"
              style={{ background: "var(--pill-bg)", color: "var(--text-muted)" }}
            >
              {matches.length}개 후보
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full hover:bg-black/15 cursor-pointer"
            style={{ color: "var(--text-muted)" }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div ref={listRef} className="overflow-y-auto divide-y divide-white/5">
          {matches.map((m, idx) => {
            const active = idx === activeIdx;
            const badge = KIND_BADGE[m.kind] ?? { label: "S", color: "#93c5fd" };
            return (
              <button
                key={`${m.relative_path}:${m.line}:${m.col}:${idx}`}
                type="button"
                data-sym-idx={idx}
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={() => onSelect(m)}
                className="w-full text-left px-4 py-2 flex flex-col gap-0.5 cursor-pointer transition-colors"
                style={{
                  background: active ? "var(--accent-soft)" : "transparent",
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-5 h-5 rounded-md inline-flex items-center justify-center font-mono-code text-[10px] font-bold shrink-0"
                      style={{
                        background: "var(--pill-bg)",
                        color: badge.color,
                        border: "1px solid var(--pill-border)",
                      }}
                    >
                      {badge.label}
                    </span>
                    <span
                      className="text-xs font-mono-code font-semibold truncate"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {m.scope ? `${m.scope}::${m.name}` : m.name}
                    </span>
                    <span
                      className="text-[10px] font-mono-code px-1.5 py-0.5 rounded shrink-0"
                      style={{
                        background: m.is_definition
                          ? "var(--ready-soft)"
                          : "var(--pill-bg)",
                        color: m.is_definition
                          ? "var(--ready-fg)"
                          : "var(--text-muted)",
                      }}
                    >
                      {m.is_partial ? "partial" : m.is_definition ? "def" : "decl"}
                    </span>
                  </div>
                  <span
                    className="text-[11px] font-mono-code truncate shrink-0"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {m.relative_path}:{m.line}
                  </span>
                </div>
                {m.preview && (
                  <div
                    className="pl-7 text-[11px] font-mono-code truncate"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {m.preview}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div
          className="px-4 py-1.5 flex items-center justify-between text-[10.5px] shrink-0"
          style={{
            background: "var(--modal-footer)",
            borderTop: "1px solid var(--divider)",
            color: "var(--text-muted)",
          }}
        >
          <span>↑↓ 이동 · Enter 점프 · Esc 닫기</span>
          <span className="inline-flex items-center gap-1">
            <CornerDownLeft className="w-3 h-3" />
            <span>Alt+← 되돌아가기</span>
          </span>
        </div>
      </div>
    </div>
  );
});
