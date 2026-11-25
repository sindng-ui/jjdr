import React from "react";
import { Radar, Terminal } from "lucide-react";
import type { EnrichedSession } from "../../types/domain";
import { formatElapsed } from "../../utils/format";
import { useAppStore } from "../../store/useAppStore";
import { normalizePath } from "../../workers/dashboardLogic";

interface ZenEmptyBriefingProps {
  runningCards: EnrichedSession[];
  idleCount: number;
  clearedToday: number;
  onPeekSession: (session: EnrichedSession) => void;
  onOpenRadar: () => void;
}

/**
 * Calm, joyful GUI briefing shown in Zen Mode when 0 actionable cards remain.
 * Zero-Blur SVG visuals + live briefing of Running vs All-Idle status.
 */
export const ZenEmptyBriefing = React.memo(function ZenEmptyBriefing({
  runningCards,
  idleCount,
  clearedToday,
  onPeekSession,
  onOpenRadar,
}: ZenEmptyBriefingProps) {
  const worktreeMeta = useAppStore((s) => s.worktreeMeta);
  const runningCount = runningCards.length;
  const hasRunning = runningCount > 0;

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

        {/* Hero SVG Visual (Zero-Blur) */}
        <div className="flex flex-col items-center gap-3">
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

          <div className="space-y-1.5">
            <h2
              className="text-xl font-black tracking-tight"
              style={{ color: "var(--text-primary)" }}
            >
              {hasRunning
                ? `지금은 쉴 시간 · AI ${runningCount}개가 열심히 작업 중입니다`
                : idleCount > 0
                ? `모든 세션(${idleCount}개)이 Idle 상태입니다`
                : "지금은 완전히 비어있어요"}
            </h2>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {hasRunning
                ? "작업이 완료되거나 승인이 필요해지면 자동으로 다음 카드가 올라옵니다."
                : idleCount > 0
                ? "쌓인 확인 요청 0건 · 편하게 쉬거나 Radar에서 새 작업을 지시해보세요."
                : "Radar 뷰에서 Worktree를 선택해 첫 AI 세션을 시작해보세요."}
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
              진행 중 (Running)
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
              대기 중 (Idle)
            </div>
            <div
              className="mt-1 text-lg font-black font-mono-code tabular-nums"
              style={{ color: "var(--text-primary)" }}
            >
              {idleCount}
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
              오늘 클리어 ✨
            </div>
            <div
              className="mt-1 text-lg font-black font-mono-code tabular-nums"
              style={{ color: "var(--ready-fg)" }}
            >
              {clearedToday}
            </div>
          </div>
        </div>

        {/* Live Running Mini Briefing Cards (click to peek right terminal) */}
        {hasRunning && (
          <div className="space-y-2 text-left">
            <div
              className="text-[11px] font-semibold px-1"
              style={{ color: "var(--text-faint)" }}
            >
              현재 진행 중인 작업 (클릭해서 터미널 엿보기)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {runningCards.slice(0, 6).map((s) => {
                const progress =
                  typeof s.terminal.status?.progress === "number"
                    ? Math.max(4, Math.min(100, s.terminal.status.progress))
                    : null;
                const cardMeta = worktreeMeta[normalizePath(s.worktreePath)];
                const cardDisplayName = cardMeta?.display_name?.trim() || "";
                const branchText = s.branch || "(detached)";
                return (
                  <button
                    key={`${s.projectId ?? "ext"}::${s.worktreePath}::${s.address}`}
                    type="button"
                    onClick={() => onPeekSession(s)}
                    title={
                      cardDisplayName
                        ? `${cardDisplayName} — ${s.projectName} / ${branchText}`
                        : `${s.projectName} / ${branchText}`
                    }
                    className="jjdr-card-lift text-left rounded-2xl p-3 space-y-1.5 cursor-pointer"
                    style={{
                      background: "var(--run-bg)",
                      border: "1px solid var(--run-border)",
                    }}
                  >
                    <div className="flex items-start justify-between gap-2 text-xs">
                      <div className="min-w-0 flex-1 space-y-0.5">
                        {cardDisplayName ? (
                          <>
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: s.projectColor }}
                              />
                              <span
                                className="font-bold truncate"
                                style={{ color: "var(--text-primary)" }}
                              >
                                {cardDisplayName}
                              </span>
                            </div>
                            <div
                              className="font-mono-code text-[11px] truncate pl-3.5"
                              style={{ color: "var(--text-secondary)" }}
                            >
                              {s.projectName} / {branchText}
                            </div>
                          </>
                        ) : (
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: s.projectColor }}
                            />
                            <span
                              className="font-mono-code font-bold truncate"
                              style={{ color: "var(--text-primary)" }}
                            >
                              {s.projectName} / {branchText}
                            </span>
                          </div>
                        )}
                      </div>
                      <span
                        className="font-mono-code text-[11px] shrink-0 pt-0.5"
                        style={{ color: "var(--run-fg)" }}
                      >
                        {progress !== null ? `${progress}%` : formatElapsed(s.elapsedMs)}
                      </span>
                    </div>
                    <div
                      className="h-1.5 rounded-full overflow-hidden"
                      style={{ background: "var(--run-soft)" }}
                    >
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${progress ?? 38}%`,
                          background: "var(--run-fg)",
                        }}
                      />
                    </div>
                    <div
                      className="flex items-center justify-between text-[11px]"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <span className="truncate">
                        {s.agentLabel} · {s.terminal.status?.msg || "작업 진행 중..."}
                      </span>
                      <Terminal className="w-3 h-3 shrink-0 ml-1 opacity-75" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="pt-1 flex items-center justify-center">
          <button
            type="button"
            onClick={onOpenRadar}
            className="jjdr-pill inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold cursor-pointer"
            style={{ color: "var(--text-secondary)" }}
          >
            <Radar className="w-3.5 h-3.5" />
            <span>Radar 전체 보드로 이동</span>
            <kbd className="text-[10px] font-mono-code opacity-70">Ctrl+1</kbd>
          </button>
        </div>
      </div>
    </div>
  );
});
