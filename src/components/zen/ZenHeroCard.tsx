import React, { useCallback, useEffect, useRef } from "react";
import { Check, FileDiff, Home, Sparkles } from "lucide-react";
import type { EnrichedSession, PromptPreset } from "../../types/domain";
import type { ZenCardStyle } from "../../utils/zenQueue";
import { StatusBadge } from "../shared/StatusBadge";
import { formatElapsed } from "../../utils/format";
import {
  isPermissionApprovalPending,
  normalizePath,
} from "../../workers/dashboardLogic";
import { useAppStore } from "../../store/useAppStore";

interface ZenHeroCardProps {
  session: EnrichedSession;
  styleMode: ZenCardStyle;
  remainingCount: number;
  enterAnimClass: string;
  exitAnimClass: string;
  stampLabel: string | null;
  thumpActive: boolean;
  pullRatio: number;
  presets: PromptPreset[];
  onPrimaryAction: () => void;
  onOpenDiff?: () => void;
  onSendPreset: (prompt: string) => void;
}

export const ZenHeroCard = React.memo(function ZenHeroCard({
  session,
  styleMode,
  remainingCount,
  enterAnimClass,
  exitAnimClass,
  stampLabel,
  thumpActive,
  pullRatio,
  presets,
  onPrimaryAction,
  onOpenDiff,
  onSendPreset,
}: ZenHeroCardProps) {
  const normWtPath = normalizePath(session.worktreePath);
  const cardMeta = useAppStore((s) => s.worktreeMeta[normWtPath]);

  const cardRef = useRef<HTMLDivElement>(null);
  const sheenRef = useRef<HTMLDivElement>(null);
  const tiltRafRef = useRef<number | null>(null);

  const { terminal, worktree, bucket } = session;
  const isApproval = isPermissionApprovalPending(terminal);
  const isAction = bucket === "needs_you";
  const displayName = cardMeta?.display_name?.trim() || "";
  const customNote = cardMeta?.note?.trim() || "";
  const branchText = session.branch || "(detached)";
  const tabCount = session.worktreeSessionCount ?? 1;

  // Apply subtle lift when dragging the right-side Arcade Ball Lever
  useEffect(() => {
    const el = cardRef.current;
    if (!el || exitAnimClass) return;
    if (pullRatio > 0) {
      el.style.transform = `translateY(${-(pullRatio * 22).toFixed(1)}px) scale(${(
        1 -
        pullRatio * 0.03
      ).toFixed(3)})`;
    } else {
      el.style.transform = "";
    }
  }, [pullRatio, exitAnimClass]);

  // 60fps 3D Hologram tilt + sheen (direct DOM style update via rAF -> 0 React re-renders)
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (exitAnimClass || stampLabel || pullRatio > 0) return;
      const el = cardRef.current;
      const sheen = sheenRef.current;
      if (!el || !sheen) return;

      const clientX = e.clientX;
      const clientY = e.clientY;
      if (tiltRafRef.current !== null) return;

      tiltRafRef.current = requestAnimationFrame(() => {
        tiltRafRef.current = null;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        const px = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
        const py = Math.max(0, Math.min(1, (clientY - r.top) / r.height));
        const ry = (px - 0.5) * 12;
        const rx = (0.5 - py) * 10;
        el.style.transform = `rotateX(${rx.toFixed(1)}deg) rotateY(${ry.toFixed(1)}deg) scale(1.01)`;
        const angle = Math.round(115 + (px - 0.5) * 56);
        sheen.style.background = `linear-gradient(${angle}deg, transparent 22%, rgba(255,255,255,0.13) 47%, rgba(129,140,248,0.18) 53%, transparent 74%)`;
      });
    },
    [exitAnimClass, stampLabel, pullRatio]
  );

  const handlePointerLeave = useCallback(() => {
    if (tiltRafRef.current !== null) {
      cancelAnimationFrame(tiltRafRef.current);
      tiltRafRef.current = null;
    }
    const el = cardRef.current;
    if (el && !exitAnimClass) {
      el.style.transform = "";
    }
  }, [exitAnimClass]);

  const previewText = (() => {
    if (terminal.status?.msg) return terminal.status.msg;
    if (session.previewLines.length > 0) {
      return session.previewLines.slice(-4).join("\n");
    }
    return isAction
      ? "우측 터미널에서 확인이 필요합니다."
      : "AI가 작업을 마치고 다음 지시를 기다리고 있습니다.";
  })();

  const hasDiff =
    worktree &&
    (worktree.added_lines > 0 ||
      worktree.deleted_lines > 0 ||
      worktree.dirty_count > 0);

  const primaryCtaText = isApproval
    ? "도장 쾅! 승인하고 다음으로"
    : isAction
    ? "도장 쾅! 확인 완료 · 다음으로"
    : "도장 쾅! 결재 완료 · 다음으로";

  const accentColor = isAction ? "var(--action-fg)" : "var(--ready-fg)";
  const accentBorder = isAction ? "var(--action-border)" : "var(--ready-border)";
  const cardBg = isAction ? "var(--action-bg)" : "var(--ready-bg)";

  return (
    <div className="zen-holo-stage relative w-full max-w-lg flex items-center justify-center py-4">
      {/* Subtle Z-axis Deck Silhouettes (depth hint without overwhelming counts) */}
      {remainingCount >= 2 && (
        <div
          className="pointer-events-none absolute inset-x-7 top-4 bottom-0 rounded-[26px]"
          style={{
            transform: "translateY(18px) scale(0.92)",
            background: "var(--card-idle-bg)",
            border: "1px solid var(--tray-border)",
            opacity: 0.55,
          }}
        />
      )}
      {remainingCount >= 1 && (
        <div
          title={`아래에 ${remainingCount}건 대기 중`}
          className="pointer-events-none absolute inset-x-3.5 top-4 bottom-0 rounded-[26px]"
          style={{
            transform: "translateY(9px) scale(0.96)",
            background: "var(--card-bg)",
            border: "1px solid var(--card-border)",
            opacity: 0.82,
          }}
        />
      )}

      {/* Active Top-of-Stack Hero Card */}
      <div
        ref={cardRef}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        className={`zen-holo-card relative w-full rounded-[24px] p-6 flex flex-col gap-4 overflow-hidden select-none ${enterAnimClass} ${exitAnimClass} ${
          thumpActive ? "zen-anim-thump" : ""
        }`}
        style={{
          background: cardBg,
          border:
            styleMode === "gacha_dial"
              ? `2px solid ${accentBorder}`
              : `1.5px solid ${accentBorder}`,
          boxShadow: "var(--card-selected-shadow), var(--stage-shadow)",
        }}
      >
        {/* Zero-Blur 3D Hologram Sheen Layer */}
        <div ref={sheenRef} className="zen-holo-sheen" />

        {/* Boss Approval Stamp Slam Overlay */}
        {stampLabel && (
          <div
            className="zen-stamp-mark pointer-events-none absolute left-1/2 top-1/2 z-30 px-5 py-2.5 rounded-2xl font-black text-2xl tracking-widest whitespace-nowrap"
            style={{
              color: "#fb7185",
              border: "4px solid #fb7185",
              background: "var(--modal-bg)",
              boxShadow: "0 0 0 2px rgba(251, 113, 133, 0.28) inset",
            }}
          >
            {stampLabel}
          </div>
        )}

        {/* Row 1: Status Badge + Agent & Elapsed */}
        <div
          className="relative z-10 flex items-center justify-between gap-2 pb-3"
          style={{ borderBottom: "1px dashed var(--divider)" }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <StatusBadge
              bucket={bucket}
              status={terminal.status}
              isStuck={session.isStuck}
              stuckMinutes={session.stuckMinutes}
            />
            <span
              className="text-xs font-semibold truncate"
              style={{ color: "var(--text-secondary)" }}
            >
              {session.projectName}
            </span>
          </div>
          <span
            className="text-xs font-mono-code tabular-nums shrink-0"
            style={{ color: "var(--text-muted)" }}
          >
            {session.agentLabel}
            {tabCount > 1 ? `+${tabCount - 1}` : ""} ·{" "}
            {formatElapsed(session.elapsedMs)}
          </span>
        </div>

        {/* Row 2: Large Project/Branch Hero Title */}
        <div className="relative z-10 space-y-1.5 min-w-0">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: session.projectColor }}
            />
            {worktree?.is_main && (
              <span
                className="inline-flex items-center gap-0.5 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase shrink-0"
                style={{
                  background: "var(--accent-soft)",
                  border: "1px solid var(--accent-border)",
                  color: "var(--accent)",
                }}
              >
                <Home className="w-2.5 h-2.5" />
                ROOT
              </span>
            )}
            <h2
              className="text-2xl font-black font-mono-code tracking-tight truncate"
              style={{ color: "var(--text-primary)" }}
              title={displayName ? `${displayName} (${branchText})` : branchText}
            >
              {displayName || branchText}
            </h2>
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
            <span
              className="truncate"
              style={{ color: "var(--text-muted)" }}
            >
              {customNote ||
                (displayName ? `branch: ${branchText}` : session.worktreePath)}
            </span>

            {hasDiff && worktree && onOpenDiff && (
              <button
                type="button"
                onClick={onOpenDiff}
                className="jjdr-pill inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono-code cursor-pointer shrink-0"
                style={{ color: "var(--text-secondary)" }}
                title="Git Diff 미리보기"
              >
                <FileDiff className="w-3 h-3" />
                <span style={{ color: "var(--ready-fg)" }}>
                  +{worktree.added_lines}
                </span>
                <span style={{ color: "var(--action-fg)" }}>
                  -{worktree.deleted_lines}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Row 3: AI Latest Output / Status Digest Box */}
        <div
          className="relative z-10 rounded-2xl px-4 py-3.5 text-[13px] leading-relaxed font-mono-code whitespace-pre-wrap break-words max-h-36 overflow-y-auto"
          style={{
            background: "var(--input-bg)",
            border: "1px solid var(--divider)",
            color: "var(--text-primary)",
          }}
        >
          {previewText}
        </div>

        {/* Row 4: Quick One-Click Prompt Presets */}
        {presets.length > 0 && (
          <div className="relative z-10 flex items-center gap-1.5 flex-wrap">
            <Sparkles
              className="w-3.5 h-3.5 shrink-0"
              style={{ color: "var(--text-faint)" }}
            />
            {presets.slice(0, 4).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onSendPreset(p.prompt)}
                title={p.prompt}
                className="jjdr-pill px-2.5 py-1 rounded-full text-[11px] font-medium cursor-pointer transition-colors"
                style={{ color: "var(--text-secondary)" }}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        {/* Row 5: Primary Boss Stamp CTA */}
        <div className="relative z-10 pt-1 flex items-center gap-2">
          <button
            type="button"
            onClick={onPrimaryAction}
            title="처리 완료하고 다음 우선순위 카드로 넘기기 (Ctrl+Enter)"
            className="flex-1 py-3 px-5 rounded-2xl text-xs font-extrabold cursor-pointer flex items-center justify-center gap-2 transition-transform active:scale-[0.98] hover:opacity-95 shadow-md"
            style={{
              background: isAction
                ? "linear-gradient(135deg, #f43f5e 0%, #fb7185 100%)"
                : "linear-gradient(135deg, #10b981 0%, #34d399 100%)",
              color: isAction ? "#ffffff" : "#072017",
            }}
          >
            <Check className="w-4 h-4 stroke-[2.5]" />
            <span>{primaryCtaText}</span>
            <kbd
              className="ml-1 text-[10px] font-mono-code px-1.5 py-0.5 rounded opacity-80"
              style={{
                background: isAction
                  ? "rgba(0,0,0,0.22)"
                  : "rgba(0,0,0,0.12)",
              }}
            >
              Ctrl+Enter
            </kbd>
          </button>
        </div>

        {/* Bottom Subtle Hint */}
        <div
          className="relative z-10 flex items-center justify-between text-[11px]"
          style={{ color: "var(--text-faint)" }}
        >
          <span>우측 터미널에 바로 입력하면 자동으로 다음 카드로 넘어갑니다</span>
          <span style={{ color: accentColor }} className="font-mono-code font-semibold">
            Ctrl+N 다음 장
          </span>
        </div>
      </div>
    </div>
  );
});
