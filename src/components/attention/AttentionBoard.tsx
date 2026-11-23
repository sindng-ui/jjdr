import React from "react";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import { SessionCard } from "./SessionCard";
import type { EnrichedSession } from "../../types/domain";

export const AttentionBoard = React.memo(function AttentionBoard() {
  const byBucket = useAppStore((s) => s.computed.byBucket);
  const total = useAppStore((s) => s.computed.counts.total);
  const globalTotal = useAppStore((s) => s.computed.globalCounts.total);
  const projects = useAppStore((s) => s.projects);

  const selectedAddress = useUiStore((s) => s.selectedAddress);
  const attachedAddress = useUiStore((s) => s.attachedAddress);
  const idleCollapsed = useUiStore((s) => s.idleCollapsed);
  const toggleIdleCollapsed = useUiStore((s) => s.toggleIdleCollapsed);
  const setProjectModalProject = useUiStore((s) => s.setProjectModalProject);
  const setViewMode = useUiStore((s) => s.setViewMode);
  const clearFilters = useUiStore((s) => s.clearFilters);

  if (total === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-11 h-11 rounded-xl bg-[#13161b] border border-[#1e222a] flex items-center justify-center mb-4">
          <Sparkles className="w-5 h-5 text-[#a1a1aa]" />
        </div>
        <h2 className="text-sm font-semibold text-[#f4f4f5]">
          {globalTotal > 0
            ? `No matching sessions (${globalTotal} active)`
            : "Queue is clear"}
        </h2>
        <p className="mt-1.5 text-xs text-[#71717a] max-w-sm leading-relaxed">
          {globalTotal > 0
            ? "Reset filters to view all active sessions."
            : "Switch to Radar view and press Ctrl+` on any tile to start an AI session."}
        </p>
        <div className="mt-5 flex items-center gap-2">
          {globalTotal > 0 ? (
            <button
              onClick={clearFilters}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-[#f4f4f5] hover:bg-white text-[#0b0c0e] cursor-pointer"
            >
              Reset Filters ({globalTotal})
            </button>
          ) : projects.length === 0 ? (
            <button
              onClick={() => setProjectModalProject("new")}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-[#f4f4f5] hover:bg-white text-[#0b0c0e] cursor-pointer"
            >
              + Add Git Project
            </button>
          ) : (
            <button
              onClick={() => setViewMode("radar")}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-[#f4f4f5] hover:bg-white text-[#0b0c0e] cursor-pointer"
            >
              Open Radar View
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
      <Section
        title="Action Required"
        accent="bg-[#ef4444]"
        items={byBucket.needs_you}
        selectedAddress={selectedAddress}
        attachedAddress={attachedAddress}
      />

      <Section
        title="Ready"
        accent="bg-[#10b981]"
        items={byBucket.ready}
        selectedAddress={selectedAddress}
        attachedAddress={attachedAddress}
      />

      <Section
        title="Working"
        accent="bg-[#f59e0b]"
        items={byBucket.running}
        selectedAddress={selectedAddress}
        attachedAddress={attachedAddress}
      />

      {byBucket.idle.length > 0 && (
        <section className="space-y-2">
          <button
            onClick={toggleIdleCollapsed}
            className="flex items-center gap-2 text-xs font-medium text-[#71717a] hover:text-[#d4d4d8] cursor-pointer"
          >
            {idleCollapsed ? (
              <ChevronRight className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
            <span>Idle ({byBucket.idle.length})</span>
          </button>
          {!idleCollapsed && (
            <div className="space-y-2 opacity-75">
              {byBucket.idle.map((s) => (
                <SessionCard
                  key={s.address}
                  session={s}
                  selected={selectedAddress === s.address}
                  attached={attachedAddress === s.address}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
});

interface SectionProps {
  title: string;
  accent: string;
  items: EnrichedSession[];
  selectedAddress: string | null;
  attachedAddress: string | null;
}

const Section = React.memo(function Section({
  title,
  accent,
  items,
  selectedAddress,
  attachedAddress,
}: SectionProps) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 px-0.5">
        <span className={`w-1.5 h-1.5 rounded-full ${accent}`} />
        <h2 className="text-xs font-semibold text-[#e4e4e7] tracking-tight">
          {title}
        </h2>
        <span className="text-xs text-[#52525b] tabular-nums">
          {items.length}
        </span>
      </div>
      <div className="space-y-2">
        {items.map((s) => (
          <SessionCard
            key={s.address}
            session={s}
            selected={selectedAddress === s.address}
            attached={attachedAddress === s.address}
          />
        ))}
      </div>
    </section>
  );
});
