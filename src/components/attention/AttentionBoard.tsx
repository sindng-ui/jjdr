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
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4"
          style={{
            background: "var(--pill-bg)",
            border: "1px solid var(--pill-border)",
            color: "var(--text-secondary)",
          }}
        >
          <Sparkles className="w-5 h-5" />
        </div>
        <h2
          className="text-sm font-bold"
          style={{ color: "var(--text-primary)" }}
        >
          {globalTotal > 0
            ? `No matching sessions (${globalTotal} active)`
            : "Queue is clear"}
        </h2>
        <p
          className="mt-1.5 text-xs max-w-sm leading-relaxed"
          style={{ color: "var(--text-muted)" }}
        >
          {globalTotal > 0
            ? "필터를 초기화하면 모든 활성 세션을 볼 수 있습니다."
            : "Radar 뷰에서 카드에 Ctrl+`를 누르면 바로 AI 세션을 시작할 수 있습니다."}
        </p>
        <div className="mt-5 flex items-center gap-2">
          {globalTotal > 0 ? (
            <button
              onClick={clearFilters}
              className="jjdr-primary-btn px-4 py-2 rounded-full text-xs font-semibold cursor-pointer"
            >
              Reset Filters ({globalTotal})
            </button>
          ) : projects.length === 0 ? (
            <button
              onClick={() => setProjectModalProject("new")}
              className="jjdr-primary-btn px-4 py-2 rounded-full text-xs font-semibold cursor-pointer"
            >
              + Add Git Project
            </button>
          ) : (
            <button
              onClick={() => setViewMode("radar")}
              className="jjdr-primary-btn px-4 py-2 rounded-full text-xs font-semibold cursor-pointer"
            >
              Open Radar View
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-7 min-w-0">
      <Section
        title="Action Required"
        dotColor="var(--action-fg)"
        items={byBucket.needs_you}
        selectedAddress={selectedAddress}
        attachedAddress={attachedAddress}
      />

      <Section
        title="Ready"
        dotColor="var(--ready-fg)"
        items={byBucket.ready}
        selectedAddress={selectedAddress}
        attachedAddress={attachedAddress}
      />

      <Section
        title="Running"
        dotColor="var(--run-fg)"
        items={byBucket.running}
        selectedAddress={selectedAddress}
        attachedAddress={attachedAddress}
      />

      {byBucket.idle.length > 0 && (
        <section className="space-y-3">
          <button
            onClick={toggleIdleCollapsed}
            className="flex items-center gap-2 text-xs font-semibold cursor-pointer"
            style={{ color: "var(--text-muted)" }}
          >
            {idleCollapsed ? (
              <ChevronRight className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
            <span>Standby ({byBucket.idle.length})</span>
          </button>
          {!idleCollapsed && (
            <div className="space-y-3">
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
  dotColor: string;
  items: EnrichedSession[];
  selectedAddress: string | null;
  attachedAddress: string | null;
}

const Section = React.memo(function Section({
  title,
  dotColor,
  items,
  selectedAddress,
  attachedAddress,
}: SectionProps) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <span
          className="w-2 h-2 rounded-full"
          style={{ background: dotColor }}
        />
        <h2
          className="text-xs font-bold tracking-tight"
          style={{ color: "var(--text-primary)" }}
        >
          {title}
        </h2>
        <span
          className="text-xs font-mono-code tabular-nums"
          style={{ color: "var(--text-faint)" }}
        >
          {items.length}
        </span>
      </div>
      <div className="space-y-3">
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
