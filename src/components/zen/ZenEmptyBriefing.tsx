import React, { useEffect, useState } from "react";
import { Radar, Send, Terminal } from "lucide-react";
import type { EnrichedSession } from "../../types/domain";
import type { ZenDispatchProjectSummary } from "../../utils/zenDispatch";
import { getWorkerPersona } from "../../utils/workerPersona";
import { WorkerMonsterAvatar } from "./WorkerMonsterAvatar";
import { formatElapsed } from "../../utils/format";
import { computeRunningProgressVisual } from "../../utils/zenQueue";
import { useAppStore } from "../../store/useAppStore";
import { normalizePath } from "../../workers/dashboardLogic";

const BURST_PARTICLES: ReadonlyArray<{
  bx: string;
  by: string;
  color: string;
  r: number;
}> = [
  { bx: "-46px", by: "-34px", color: "#34d399", r: 4 },
  { bx: "48px", by: "-32px", color: "#60a5fa", r: 4 },
  { bx: "-54px", by: "10px", color: "#facc15", r: 3.5 },
  { bx: "54px", by: "12px", color: "#f472b6", r: 3.5 },
  { bx: "-30px", by: "42px", color: "#a78bfa", r: 3.5 },
  { bx: "32px", by: "40px", color: "#2dd4bf", r: 4 },
  { bx: "0px", by: "-50px", color: "#fb923c", r: 4 },
  { bx: "0px", by: "48px", color: "#34d399", r: 3 },
];

interface ZenEmptyBriefingProps {
  runningCards: EnrichedSession[];
  idleCount: number;
  clearedToday: number;
  celebrateNonce: number;
  peekingAddress?: string | null;
  projectSummaries: ZenDispatchProjectSummary[];
  onPeekSession: (session: EnrichedSession) => void;
  onStartDispatch: (projectId?: string | null) => void;
  onOpenRecap: () => void;
  onOpenRadar: () => void;
}

/**
 * Calm, joyful GUI briefing shown in Zen Mode when 0 actionable cards remain.
 * Zero-Blur SVG visuals + live briefing of Running vs All-Idle status + one-click Worker Dispatch.
 */
export const ZenEmptyBriefing = React.memo(function ZenEmptyBriefing({
  runningCards,
  idleCount,
  clearedToday,
  celebrateNonce,
  peekingAddress = null,
  projectSummaries,
  onPeekSession,
  onStartDispatch,
  onOpenRecap,
  onOpenRadar,
}: ZenEmptyBriefingProps) {
  const worktreeMeta = useAppStore((s) => s.worktreeMeta);
  const runningCount = runningCards.length;
  const hasRunning = runningCount > 0;
  const [celebrating, setCelebrating] = useState(false);
  // Lightweight 15s tick only while workers are actively running so progress bars & color stages advance cleanly
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!hasRunning) return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [hasRunning]);

  useEffect(() => {
    if (celebrateNonce <= 0) return;
    setCelebrating(true);
    const id = setTimeout(() => setCelebrating(false), 680);
    return () => clearTimeout(id);
  }, [celebrateNonce]);

  return (
    <div className="flex-1 h-full min-h-0 overflow-y-auto flex items-center justify-center p-8">
      <div
        className="zen-anim-rise w-full max-w-2xl rounded-[26px] p-8 text-center space-y-6"
        style={{
          background: "var(--card-bg)",
          border: "1px solid var(--card-border)",
          boxShadow: "var(--stage-shadow)",
        }}
      >
        <div className="flex items-center justify-center">
          <span
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold font-mono-code tracking-wide"
            style={{
              background: hasRunning ? "var(--run-soft)" : "var(--ready-soft)",
              color: hasRunning ? "var(--run-fg)" : "var(--ready-fg)",
            }}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                hasRunning ? "jjdr-dot-pulse" : ""
              }`}
              style={{
                background: hasRunning ? "var(--run-fg)" : "var(--ready-fg)",
              }}
            />
            ZEN · ALL CLEAR
          </span>
        </div>

        {/* Hero SVG Visual (Zero-Blur) + Ephemeral 650ms Celebration Burst */}
        <div className="flex flex-col items-center gap-3">
          <div className="relative flex items-center justify-center">
            {celebrating && (
              <svg
                key={celebrateNonce}
                width="140"
                height="140"
                viewBox="-70 -70 140 140"
                aria-hidden="true"
                className="pointer-events-none absolute overflow-visible"
              >
                {BURST_PARTICLES.map((p, idx) => (
                  <circle
                    key={idx}
                    cx="0"
                    cy="0"
                    r={p.r}
                    fill={p.color}
                    className="zen-burst-dot"
                    style={
                      {
                        "--bx": p.bx,
                        "--by": p.by,
                      } as React.CSSProperties
                    }
                  />
                ))}
              </svg>
            )}
            {hasRunning ? (
            <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true">
              <circle
                cx="36"
                cy="36"
                r="28"
                fill="none"
                stroke="var(--run-border)"
                strokeWidth="2.5"
              />
              <circle
                cx="36"
                cy="36"
                r="18"
                fill="none"
                stroke="var(--divider)"
                strokeWidth="1.5"
                strokeDasharray="4 4"
              />
              <g className="zen-orbit-spin">
                <circle cx="36" cy="8" r="5" fill="var(--run-fg)" />
                <circle cx="64" cy="36" r="3" fill="var(--accent)" />
              </g>
              <circle
                cx="36"
                cy="36"
                r="9"
                fill="var(--run-soft)"
                stroke="var(--run-fg)"
                strokeWidth="2"
              />
            </svg>
          ) : (
            <svg width="68" height="68" viewBox="0 0 68 68" aria-hidden="true">
              <circle
                cx="34"
                cy="34"
                r="28"
                fill="var(--ready-soft)"
                stroke="var(--ready-border)"
                strokeWidth="2"
              />
              <path
                d="M22 34.5l8 8L46.5 26"
                fill="none"
                stroke="var(--ready-fg)"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
          </div>

          <div className="space-y-1.5">
            <h2
              className="text-xl font-black tracking-tight"
              style={{ color: "var(--text-primary)" }}
            >
              {hasRunning
                ? `Time to chill · ${runningCount} AI ${
                    runningCount === 1 ? "worker" : "workers"
                  } on duty`
                : idleCount > 0
                ? `All ${idleCount} ${
                    idleCount === 1 ? "worker is" : "workers are"
                  } standing by`
                : "All clear · No active workers yet"}
            </h2>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {hasRunning
                ? "New review cards will rise automatically when a worker finishes or asks for approval."
                : idleCount > 0
                ? "0 pending approvals · Pick a project below to dispatch a standby worker."
                : "Hire a worker below or switch to Radar to start your first AI session."}
            </p>
          </div>
        </div>

        {/* Summary Metric Tiles */}
        <div className="grid grid-cols-3 gap-3">
          <div
            className="rounded-2xl py-3 px-4"
            style={{
              background: "var(--input-bg)",
              border: "1px solid var(--divider)",
            }}
          >
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              Running
            </div>
            <div
              className="mt-1 text-lg font-black font-mono-code tabular-nums"
              style={{
                color: hasRunning ? "var(--run-fg)" : "var(--text-faint)",
              }}
            >
              {runningCount}
            </div>
          </div>

          <div
            className="rounded-2xl py-3 px-4"
            style={{
              background: "var(--input-bg)",
              border: "1px solid var(--divider)",
            }}
          >
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              Standby (Idle)
            </div>
            <div
              className="mt-1 text-lg font-black font-mono-code tabular-nums"
              style={{ color: "var(--text-primary)" }}
            >
              {idleCount}
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenRecap}
            title="View Daily Work Recap & copy Standup Markdown"
            className="jjdr-card-lift rounded-2xl py-3 px-4 cursor-pointer text-center"
            style={{
              background: "var(--input-bg)",
              border: "1px solid var(--divider)",
            }}
          >
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              Cleared Today · Recap
            </div>
            <div
              className="mt-1 text-lg font-black font-mono-code tabular-nums"
              style={{ color: "var(--ready-fg)" }}
            >
              {clearedToday}
            </div>
          </button>
        </div>

        {/* Live Running Mini Briefing Cards (click or Ctrl+N to peek right terminal) */}
        {hasRunning && (
          <div className="space-y-2 text-left">
            <div className="flex items-center justify-between gap-2 px-1">
              <span
                className="text-[11px] font-semibold"
                style={{ color: "var(--text-faint)" }}
              >
                Active Missions (Click or Ctrl+N to peek terminal)
              </span>
              <span
                className="text-[10px] font-mono-code"
                style={{ color: "var(--text-faint)" }}
              >
                Ctrl+N · Cycle
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {runningCards.slice(0, 6).map((s) => {
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
                const isPeeking = peekingAddress === s.address;
                const normPath = normalizePath(s.worktreePath);
                const cardMeta = worktreeMeta[normPath];
                const persona = getWorkerPersona(normPath);
                const cardDisplayName = cardMeta?.display_name?.trim() || "";
                const branchText = s.branch || "(detached)";
                return (
                  <button
                    key={`${s.projectId ?? "ext"}::${s.worktreePath}::${s.address}`}
                    type="button"
                    onClick={() => onPeekSession(s)}
                    title={
                      cardDisplayName
                        ? `${persona.name} · ${cardDisplayName} — ${s.projectName} / ${branchText}`
                        : `${persona.name} · ${s.projectName} / ${branchText}`
                    }
                    className="jjdr-card-lift text-left rounded-2xl p-3 space-y-1.5 cursor-pointer"
                    style={{
                      background: "var(--run-bg)",
                      border: `1px solid ${
                        isPeeking ? "var(--accent-border)" : "var(--run-border)"
                      }`,
                      boxShadow: isPeeking
                        ? "var(--card-selected-shadow)"
                        : undefined,
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
                            className="font-mono-code text-[10px] truncate"
                            style={{ color: "var(--text-secondary)" }}
                          >
                            {s.projectName} / {branchText}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
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
                          transition:
                            "width 600ms ease, background-color 600ms ease",
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
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Quick Project Dispatch Strip (Zero Radar switching!) */}
        {projectSummaries.length > 0 && (
          <div className="space-y-2.5 text-left">
            <div
              className="text-[11px] font-semibold px-1"
              style={{ color: "var(--text-faint)" }}
            >
              Quick Dispatch · Pick a Project
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {projectSummaries.map((sum) => (
                <button
                  key={sum.project.id}
                  type="button"
                  onClick={() => onStartDispatch(sum.project.id)}
                  className="jjdr-pill jjdr-card-lift inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-semibold cursor-pointer"
                  style={{ color: "var(--text-primary)" }}
                  title={`${sum.project.name}: ${sum.idleAiCount} AI standby · ${sum.emptyWorktreeCount} empty`}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: sum.project.color }}
                  />
                  <span className="truncate max-w-[140px]">
                    {sum.project.name}
                  </span>
                  <span
                    className="text-[10px] font-mono-code px-1.5 py-0.5 rounded-full"
                    style={{
                      background:
                        sum.idleAiCount > 0
                          ? "var(--ready-soft)"
                          : "var(--input-bg)",
                      color:
                        sum.idleAiCount > 0
                          ? "var(--ready-fg)"
                          : "var(--text-muted)",
                    }}
                  >
                    {sum.idleAiCount > 0
                      ? `${sum.idleAiCount} idle`
                      : sum.emptyWorktreeCount > 0
                      ? `${sum.emptyWorktreeCount} empty`
                      : "+ Hire"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="pt-1 flex items-center justify-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={() => onStartDispatch(null)}
            className="jjdr-primary-btn inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-bold cursor-pointer shadow-sm"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Dispatch Worker</span>
            <kbd className="text-[10px] font-mono-code opacity-80">
              Ctrl+Shift+D
            </kbd>
          </button>
          <button
            type="button"
            onClick={onOpenRadar}
            className="jjdr-pill inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-xs font-semibold cursor-pointer"
            style={{ color: "var(--text-secondary)" }}
          >
            <Radar className="w-3.5 h-3.5" />
            <span>Radar Board</span>
            <kbd className="text-[10px] font-mono-code opacity-70">Ctrl+1</kbd>
          </button>
        </div>
      </div>
    </div>
  );
});
