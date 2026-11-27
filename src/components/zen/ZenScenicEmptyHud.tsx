import React from "react";
import { Radar, Send, Sparkles } from "lucide-react";
import type { EnrichedSession } from "../../types/domain";
import type { ZenDispatchProjectSummary } from "../../utils/zenDispatch";
import { useAppStore } from "../../store/useAppStore";
import { normalizePath } from "../../workers/dashboardLogic";
import { ZenRunningMissionCard } from "./ZenRunningMissionCard";

interface ZenScenicEmptyHudProps {
  runningCards: EnrichedSession[];
  idleCount: number;
  clearedToday: number;
  nowMs: number;
  peekingAddress?: string | null;
  projectSummaries: ZenDispatchProjectSummary[];
  peekSceneryOnly: boolean;
  onPeekSession: (session: EnrichedSession) => void;
  onEditSession?: (session: EnrichedSession) => void;
  onStartDispatch: (projectId?: string | null) => void;
  onOpenRecap: () => void;
  onOpenRadar: () => void;
}

/**
 * Open Scenic Floating HUD used in Zen Inbox All Clear / Time to Chill whenever
 * a 2D pixel art backdrop is active. Keeps the central horizon completely open
 * while anchoring compact Zero-Blur translucent-solid controls at top & bottom.
 */
export const ZenScenicEmptyHud = React.memo(function ZenScenicEmptyHud({
  runningCards,
  idleCount,
  clearedToday,
  nowMs,
  peekingAddress = null,
  projectSummaries,
  peekSceneryOnly,
  onPeekSession,
  onEditSession,
  onStartDispatch,
  onOpenRecap,
  onOpenRadar,
}: ZenScenicEmptyHudProps) {
  const worktreeMeta = useAppStore((s) => s.worktreeMeta);
  const autoMissionByWorktree = useAppStore((s) => s.autoMissionByWorktree);
  const runningCount = runningCards.length;
  const hasRunning = runningCount > 0;

  return (
    <div
      className="relative z-10 flex-1 min-h-0 flex flex-col justify-between py-3 transition-opacity duration-200"
      style={{
        opacity: peekSceneryOnly ? 0 : 1,
        pointerEvents: peekSceneryOnly ? "none" : "auto",
      }}
    >
      {/* Top Floating Greeting (sits high over sky so the sea/mountain horizon stays wide open) */}
      <div className="text-center space-y-1.5 pt-2 shrink-0 select-none">
        <div className="flex items-center justify-center">
          <span
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold font-mono-code tracking-wide"
            style={{
              background: "rgba(12, 20, 38, 0.74)",
              border: `1px solid ${
                hasRunning
                  ? "rgba(56, 189, 248, 0.48)"
                  : "rgba(52, 211, 153, 0.48)"
              }`,
              color: hasRunning ? "#bae6fd" : "#a7f3d0",
            }}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                hasRunning ? "jjdr-dot-pulse" : ""
              }`}
              style={{
                background: hasRunning ? "#38bdf8" : "#34d399",
              }}
            />
            ZEN · ALL CLEAR
          </span>
        </div>

        <h2
          className="text-2xl font-black tracking-tight text-white"
          style={{
            textShadow:
              "0 2px 12px rgba(8, 15, 32, 0.78), 0 1px 2px rgba(8, 15, 32, 0.92)",
          }}
        >
          {hasRunning
            ? `Time to chill · ${runningCount} AI ${
                runningCount === 1 ? "worker" : "workers"
              } on duty`
            : idleCount > 0
            ? `All ${idleCount} ${
                idleCount === 1 ? "worker is" : "workers are"
              } standing by`
            : "All clear · Time to chill"}
        </h2>

        <p
          className="text-xs font-medium text-white/90"
          style={{
            textShadow: "0 1px 6px rgba(8, 15, 32, 0.85)",
          }}
        >
          {hasRunning
            ? "New review cards will rise automatically when a worker finishes or asks for approval."
            : idleCount > 0
            ? "0 pending approvals · Pick a project below whenever you are ready to dispatch."
            : "0 pending approvals · Enjoy the view or dispatch a new worker below."}
        </p>
      </div>

      {/* Central Open Scenery Breathing Room */}
      <div className="flex-1 min-h-[48px]" />

      {/* Bottom Floating Zero-Blur Dock: 3-Col Ultra-Slim Active Missions + Quick Dispatch Strip */}
      <div className="w-full max-w-[940px] mx-auto space-y-2 shrink-0">
        {hasRunning && (
          <div className="space-y-1.5 text-left">
            <div className="flex items-center justify-between gap-2 px-1.5">
              <span
                className="text-[11px] font-semibold text-white/85"
                style={{ textShadow: "0 1px 5px rgba(8, 15, 32, 0.85)" }}
              >
                Active Missions · {runningCount} (Click or Ctrl+N to peek terminal)
              </span>
              <span
                className="text-[10px] font-mono-code text-white/75"
                style={{ textShadow: "0 1px 5px rgba(8, 15, 32, 0.85)" }}
              >
                Ctrl+N · Cycle
              </span>
            </div>
            <div
              className={`grid gap-2 max-h-[176px] overflow-y-auto pr-0.5 ${
                runningCount === 1
                  ? "grid-cols-1 max-w-[360px] mx-auto"
                  : runningCount === 2
                  ? "grid-cols-1 sm:grid-cols-2 max-w-[660px] mx-auto"
                  : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
              }`}
            >
              {runningCards.slice(0, 9).map((s) => {
                const normWt = normalizePath(s.worktreePath);
                return (
                  <ZenRunningMissionCard
                    key={`${s.projectId ?? "ext"}::${s.worktreePath}::${s.address}`}
                    session={s}
                    cardMeta={worktreeMeta[normWt]}
                    autoMission={autoMissionByWorktree[normWt]}
                    nowMs={nowMs}
                    isPeeking={peekingAddress === s.address}
                    compact
                    onPeek={onPeekSession}
                    onEdit={onEditSession}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Slim Bottom Control Dock */}
        <div
          className="rounded-2xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5"
          style={{
            background: "rgba(13, 20, 38, 0.86)",
            border: "1px solid rgba(255, 255, 255, 0.16)",
            boxShadow: "0 14px 32px -12px rgba(4, 8, 22, 0.72)",
          }}
        >
          {/* Left: Quick Project Dispatch Chips + Compact Stats */}
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            {projectSummaries.length > 0 ? (
              projectSummaries.slice(0, 5).map((sum) => (
                <button
                  key={sum.project.id}
                  type="button"
                  onClick={() => onStartDispatch(sum.project.id)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold text-slate-100 cursor-pointer transition-opacity hover:opacity-90"
                  style={{
                    background: "rgba(30, 41, 70, 0.9)",
                    border: "1px solid rgba(255, 255, 255, 0.14)",
                  }}
                  title={`${sum.project.name}: ${sum.idleAiCount} AI standby · ${sum.emptyWorktreeCount} empty`}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: sum.project.color }}
                  />
                  <span className="truncate max-w-[110px]">
                    {sum.project.name}
                  </span>
                  <span
                    className="text-[10px] font-mono-code"
                    style={{
                      color: sum.idleAiCount > 0 ? "#6ee7b7" : "#94a3b8",
                    }}
                  >
                    {sum.idleAiCount > 0
                      ? `${sum.idleAiCount} idle`
                      : sum.emptyWorktreeCount > 0
                      ? `${sum.emptyWorktreeCount} empty`
                      : "+"}
                  </span>
                </button>
              ))
            ) : (
              <span className="text-[11px] text-slate-300/80 px-1">
                Ready for next mission
              </span>
            )}
          </div>

          {/* Right: Recap + Dispatch Worker + Radar */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onOpenRecap}
              title="View Daily Work Recap & copy Standup Markdown"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-mono-code font-semibold cursor-pointer transition-opacity hover:opacity-90"
              style={{
                background: "rgba(30, 41, 70, 0.9)",
                border: "1px solid rgba(255, 255, 255, 0.14)",
                color: "#6ee7b7",
              }}
            >
              <Sparkles className="w-3 h-3" />
              <span>{clearedToday}</span>
            </button>

            <button
              type="button"
              onClick={() => onStartDispatch(null)}
              className="jjdr-primary-btn inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11px] font-bold cursor-pointer shadow-sm"
            >
              <Send className="w-3 h-3" />
              <span>Dispatch</span>
            </button>

            <button
              type="button"
              onClick={onOpenRadar}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold text-slate-200 cursor-pointer transition-opacity hover:opacity-90"
              style={{
                background: "rgba(30, 41, 70, 0.9)",
                border: "1px solid rgba(255, 255, 255, 0.14)",
              }}
            >
              <Radar className="w-3 h-3" />
              <span>Radar</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
