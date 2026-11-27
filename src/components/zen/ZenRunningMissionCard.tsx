import React from "react";
import { Pencil, Terminal } from "lucide-react";
import type { EnrichedSession, WorktreeCardMeta } from "../../types/domain";
import { getWorkerPersona } from "../../utils/workerPersona";
import { WorkerMonsterAvatar } from "./WorkerMonsterAvatar";
import { formatElapsed } from "../../utils/format";
import { computeRunningProgressVisual } from "../../utils/zenQueue";
import { normalizePath } from "../../workers/dashboardLogic";

interface ZenRunningMissionCardProps {
  session: EnrichedSession;
  cardMeta?: WorktreeCardMeta;
  nowMs: number;
  isPeeking: boolean;
  onPeek: (session: EnrichedSession) => void;
  onEdit?: (session: EnrichedSession) => void;
}

/**
 * Compact active-mission card displayed inside Zen Inbox's "Time to chill" briefing.
 * Supports clicking to peek the live terminal and one-click Edit for display name / PR# note / branch rename.
 */
export const ZenRunningMissionCard = React.memo(function ZenRunningMissionCard({
  session: s,
  cardMeta,
  nowMs,
  isPeeking,
  onPeek,
  onEdit,
}: ZenRunningMissionCardProps) {
  const explicitProgress =
    typeof s.terminal.status?.progress === "number"
      ? s.terminal.status.progress
      : null;
  const statusBaseMs = s.terminal.status_ms || s.terminal.created_ms;
  const liveElapsedMs = statusBaseMs
    ? Math.max(s.elapsedMs, Math.max(0, nowMs - statusBaseMs))
    : s.elapsedMs;
  const progressVis = computeRunningProgressVisual(
    liveElapsedMs,
    explicitProgress
  );
  const normPath = normalizePath(s.worktreePath);
  const persona = getWorkerPersona(normPath);
  const cardDisplayName = cardMeta?.display_name?.trim() || "";
  const cardNote = cardMeta?.note?.trim() || "";
  const branchText = s.branch || "(detached)";
  const canEdit = Boolean(s.projectId && onEdit);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onPeek(s)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPeek(s);
        }
      }}
      title={
        cardDisplayName
          ? `${persona.name} · ${cardDisplayName} — ${s.projectName} / ${branchText}`
          : `${persona.name} · ${s.projectName} / ${branchText}`
      }
      className="group jjdr-card-lift text-left rounded-2xl p-3 space-y-1.5 cursor-pointer outline-none"
      style={{
        background: "var(--run-bg)",
        border: `1px solid ${
          isPeeking ? "var(--accent-border)" : "var(--run-border)"
        }`,
        boxShadow: isPeeking ? "var(--card-selected-shadow)" : undefined,
      }}
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <WorkerMonsterAvatar
            persona={persona}
            mood="working"
            size={30}
            className="shrink-0"
          />
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className="font-extrabold truncate"
                style={{ color: persona.palette.body }}
              >
                {persona.name}
              </span>
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: s.projectColor }}
              />
              <span
                className="font-mono-code font-semibold truncate"
                style={{ color: "var(--text-primary)" }}
              >
                {cardDisplayName || branchText}
              </span>
            </div>
            <div
              className="flex items-center gap-1.5 font-mono-code text-[10px] min-w-0"
              style={{ color: "var(--text-secondary)" }}
            >
              <span className="truncate">
                {s.projectName} / {branchText}
              </span>
              {cardNote && (
                <span
                  className="shrink-0 max-w-[110px] truncate px-1.5 py-0.2 rounded-full text-[9px] font-semibold"
                  style={{
                    background: "var(--input-bg)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--divider)",
                  }}
                  title={cardNote}
                >
                  {cardNote}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isPeeking && (
            <span
              className="px-1.5 py-0.5 rounded-full text-[9px] font-bold font-mono-code uppercase"
              style={{
                background: "var(--accent-soft)",
                color: "var(--accent)",
              }}
            >
              Viewing
            </span>
          )}
          <span
            className="font-mono-code text-[11px] font-semibold tabular-nums"
            style={{ color: progressVis.color }}
          >
            {explicitProgress !== null
              ? `${progressVis.percent}%`
              : formatElapsed(liveElapsedMs)}
          </span>
          {canEdit && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEdit?.(s);
              }}
              onKeyDown={(e) => e.stopPropagation()}
              title="Edit card name, PR# note, or branch"
              aria-label="Edit card"
              className="p-1 rounded-full cursor-pointer transition-opacity opacity-60 group-hover:opacity-100 hover:bg-black/10"
              style={{ color: "var(--text-secondary)" }}
            >
              <Pencil className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
      <div
        className="h-1.5 rounded-full overflow-hidden"
        style={{ background: "var(--input-bg)" }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${progressVis.percent}%`,
            backgroundColor: progressVis.color,
            transition: "width 600ms ease, background-color 600ms ease",
          }}
        />
      </div>
      <div
        className="flex items-center justify-between text-[11px]"
        style={{ color: "var(--text-muted)" }}
      >
        <span className="truncate">
          {s.agentLabel} · {s.terminal.status?.msg || "Working..."}
        </span>
        <Terminal
          className="w-3 h-3 shrink-0 ml-1"
          style={{
            color: isPeeking ? "var(--accent)" : undefined,
            opacity: isPeeking ? 1 : 0.75,
          }}
        />
      </div>
    </div>
  );
});
