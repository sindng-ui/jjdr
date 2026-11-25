import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  FileCode2,
  FileDiff,
  GitMerge,
  Home,
  Pencil,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { ZenCardStyle } from "../../utils/zenQueue";
import type { ZenDispatchWorker } from "../../utils/zenDispatch";
import { getWorkerPersona } from "../../utils/workerPersona";
import { formatElapsed } from "../../utils/format";
import { useAppStore } from "../../store/useAppStore";
import { WorkerMonsterAvatar } from "./WorkerMonsterAvatar";

interface ZenWorkerCardProps {
  worker: ZenDispatchWorker;
  styleMode: ZenCardStyle;
  index: number;
  total: number;
  deckWorkers: ZenDispatchWorker[];
  enterAnimClass: string;
  exitAnimClass: string;
  stampLabel: string | null;
  thumpActive: boolean;
  pullRatio: number;
  launchingAi: boolean;
  /** Solo mode for a newly hired worker (hides Prev/Next & deck dots) */
  soloMode?: boolean;
  /** True before the user clicks "Hire & Assign" (terminal pane stays hidden) */
  awaitingHireConfirm?: boolean;
  /** True while the AI CLI is showing a folder-trust / setup confirmation prompt */
  awaitingTrustSetup?: boolean;
  onConfirmHire?: () => void;
  onWakeAi: () => void;
  onPrevWorker: () => void;
  onNextWorker: () => void;
  onJumpToIndex: (index: number) => void;
  onEditCard: () => void;
  onOpenDiff?: () => void;
  onTeardown?: () => void;
}

function fileBasename(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || filePath;
}

export const ZenWorkerCard = React.memo(function ZenWorkerCard({
  worker,
  styleMode,
  index,
  total,
  deckWorkers,
  enterAnimClass,
  exitAnimClass,
  stampLabel,
  thumpActive,
  pullRatio,
  launchingAi,
  soloMode = false,
  awaitingHireConfirm = false,
  awaitingTrustSetup = false,
  onConfirmHire,
  onWakeAi,
  onPrevWorker,
  onNextWorker,
  onJumpToIndex,
  onEditCard,
  onOpenDiff,
  onTeardown,
}: ZenWorkerCardProps) {
  const worktreeMeta = useAppStore((s) => s.worktreeMeta);
  const cardMeta = worktreeMeta[worker.normWtPath];

  const cardRef = useRef<HTMLDivElement>(null);
  const sheenRef = useRef<HTMLDivElement>(null);
  const tiltRafRef = useRef<number | null>(null);

  const { project, worktree, aiSession, readiness } = worker;
  const persona = useMemo(
    () => getWorkerPersona(worker.normWtPath),
    [worker.normWtPath]
  );
  const displayName = cardMeta?.display_name?.trim() || "";
  const customNote = cardMeta?.note?.trim() || "";
  const branchText = worktree.branch || "(detached)";
  const hasAi = Boolean(aiSession);
  const hasDiff =
    worktree.added_lines > 0 ||
    worktree.deleted_lines > 0 ||
    worktree.dirty_count > 0;
  const changedFiles = worktree.changed_files ?? [];
  const remainingCount = soloMode ? 0 : Math.max(0, total - 1);
  const showDeckNav = !soloMode && total > 1;

  // Subtle vertical lift while dragging the right-side arcade lever
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

  // 60fps 3D Hologram tilt + sheen (direct DOM style via rAF -> 0 React re-renders)
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
        const ry = (px - 0.5) * 11;
        const rx = (0.5 - py) * 9;
        el.style.transform = `rotateX(${rx.toFixed(1)}deg) rotateY(${ry.toFixed(1)}deg) scale(1.01)`;
        const angle = Math.round(115 + (px - 0.5) * 56);
        sheen.style.background = `linear-gradient(${angle}deg, transparent 22%, rgba(255,255,255,0.12) 47%, rgba(129,140,248,0.16) 53%, transparent 74%)`;
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

  const badgeConfig =
    readiness === "fresh"
      ? {
          label: "Ready for New Task",
          bg: "var(--ready-soft)",
          fg: "var(--ready-fg)",
          border: "var(--ready-border)",
          cardBg: "var(--card-bg)",
          accentBorder: "var(--ready-border)",
        }
      : readiness === "continuing"
      ? {
          label: "Continuing Task",
          bg: "var(--warn-soft)",
          fg: "var(--warn-fg)",
          border: "var(--warn-border)",
          cardBg: "var(--card-bg)",
          accentBorder: "var(--warn-border)",
        }
      : {
          label: "Sleeping · No AI",
          bg: "var(--pill-bg)",
          fg: "var(--text-muted)",
          border: "var(--card-border)",
          cardBg: "var(--card-idle-bg)",
          accentBorder: "var(--card-border)",
        };

  const previewText = (() => {
    if (awaitingHireConfirm) {
      return `${persona.name} (${persona.role}) has arrived! Click "Hire & Assign" below to stamp the contract and open the mission terminal.`;
    }
    if (aiSession) {
      if (aiSession.terminal.status?.msg) return aiSession.terminal.status.msg;
      if (aiSession.previewLines.length > 0) {
        return aiSession.previewLines.slice(-4).join("\n");
      }
      return `${persona.name} is standing by. Type your instructions in the right terminal to deploy immediately.`;
    }
    return `${persona.name} is snoozing in an empty worktree. Wake up AI below (Ctrl+Enter) to assign a mission.`;
  })();

  return (
    <div className="zen-holo-stage relative w-full max-w-lg flex flex-col items-center justify-center py-3">
      <div className="relative w-full flex items-center justify-center">
        {/* Subtle Z-axis Deck Silhouettes */}
        {remainingCount >= 2 && (
          <div
            className="pointer-events-none absolute inset-x-7 top-0 bottom-0 rounded-[26px]"
            style={{
              transform: "translateY(18px) scale(0.92)",
              background: "var(--card-idle-bg)",
              border: "1px solid var(--tray-border)",
              opacity: 0.5,
            }}
          />
        )}
        {remainingCount >= 1 && (
          <div
            title={`${total} standby workers in ${project.name}`}
            className="pointer-events-none absolute inset-x-3.5 top-0 bottom-0 rounded-[26px]"
            style={{
              transform: "translateY(9px) scale(0.96)",
              background: "var(--card-bg)",
              border: "1px solid var(--card-border)",
              opacity: 0.8,
            }}
          />
        )}

        {/* Active Worker Character Sheet Card */}
        <div
          ref={cardRef}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          className={`zen-holo-card relative w-full rounded-[24px] p-6 flex flex-col gap-4 overflow-hidden select-none ${enterAnimClass} ${exitAnimClass} ${
            thumpActive ? "zen-anim-thump" : ""
          }`}
          style={{
            background: badgeConfig.cardBg,
            border:
              styleMode === "gacha_dial"
                ? `2px solid ${badgeConfig.accentBorder}`
                : `1.5px solid ${badgeConfig.accentBorder}`,
            boxShadow: "var(--card-selected-shadow), var(--stage-shadow)",
          }}
        >
          {/* Zero-Blur 3D Hologram Sheen Layer */}
          <div ref={sheenRef} className="zen-holo-sheen" />

          {/* Dispatched Stamp Slam Overlay */}
          {stampLabel && (
            <div
              className="zen-stamp-mark pointer-events-none absolute left-1/2 top-1/2 z-30 px-5 py-2.5 rounded-2xl font-black text-2xl tracking-widest whitespace-nowrap"
              style={{
                color: "#34d399",
                border: "4px solid #34d399",
                background: "var(--modal-bg)",
                boxShadow: "0 0 0 2px rgba(52, 211, 153, 0.28) inset",
              }}
            >
              {stampLabel}
            </div>
          )}

          {/* Row 1: Situation Banner ("ASSIGNING WORKER") + Readiness Badge + Elapsed */}
          <div
            className="relative z-10 flex items-center justify-between gap-2 pb-3"
            style={{ borderBottom: "1px dashed var(--divider)" }}
          >
            <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono-code font-bold tracking-wider uppercase"
                style={{
                  background: "var(--accent-soft)",
                  border: "1px solid var(--accent-border)",
                  color: "var(--accent)",
                }}
              >
                {soloMode ? (
                  <Sparkles className="w-2.5 h-2.5" />
                ) : (
                  <Send className="w-2.5 h-2.5" />
                )}
                {awaitingHireConfirm
                  ? "NEW RECRUIT"
                  : soloMode
                  ? "HIRED WORKER"
                  : "ASSIGN WORKER"}
              </span>
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold"
                style={{
                  background: badgeConfig.bg,
                  color: badgeConfig.fg,
                  border: `1px solid ${badgeConfig.border}`,
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: badgeConfig.fg }}
                />
                {badgeConfig.label}
              </span>
              {worktree.is_merged && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
                  style={{
                    background: "var(--accent-soft)",
                    border: "1px solid var(--accent-border)",
                    color: "var(--accent)",
                  }}
                  title="This worktree branch is already merged"
                >
                  <GitMerge className="w-2.5 h-2.5" />
                  MERGED
                </span>
              )}
            </div>

            <span
              className="text-xs font-mono-code tabular-nums shrink-0"
              style={{ color: "var(--text-muted)" }}
            >
              {aiSession
                ? `${aiSession.agentLabel} · ${formatElapsed(aiSession.elapsedMs)}`
                : "Empty Slot"}
            </span>
          </div>

          {/* Row 2: Monster Avatar Portrait + Character Name + Worktree Identity */}
          <div className="relative z-10 flex items-center gap-4 min-w-0">
            <div
              className="relative shrink-0 rounded-[20px] p-1.5 flex items-center justify-center"
              style={{
                background: "var(--input-bg)",
                border: `1.5px solid ${
                  hasAi ? persona.palette.body : "var(--divider)"
                }`,
              }}
            >
              <WorkerMonsterAvatar
                persona={persona}
                mood={hasAi ? "ready" : "sleeping"}
                size={68}
              />
              <span
                className="absolute -bottom-1.5 px-2 py-0.2 rounded-full text-[9px] font-mono-code font-black uppercase tracking-wide"
                style={{
                  background: hasAi ? persona.palette.shade : "var(--pill-bg)",
                  color: hasAi ? "#ffffff" : "var(--text-muted)",
                  border: "1px solid var(--modal-bg)",
                }}
              >
                {hasAi ? "STANDBY" : "ZZZ"}
              </span>
            </div>

            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                <h2
                  className="text-2xl font-black tracking-tight truncate"
                  style={{ color: "var(--text-primary)" }}
                >
                  {persona.name}
                </h2>
                <span
                  className="text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0"
                  style={{
                    background: "var(--pill-bg)",
                    border: "1px solid var(--pill-border)",
                    color: persona.palette.body,
                  }}
                >
                  {persona.role}
                </span>
              </div>

              <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: project.color }}
                />
                <span
                  className="text-xs font-semibold truncate"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {project.name}
                </span>
                <span style={{ color: "var(--text-faint)" }}>/</span>
                {worktree.is_main && (
                  <span
                    className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.2 rounded-full font-bold uppercase shrink-0"
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
                <span
                  className="text-xs font-mono-code font-bold truncate"
                  style={{ color: "var(--text-primary)" }}
                  title={
                    displayName
                      ? `${displayName} (${branchText})`
                      : branchText
                  }
                >
                  {displayName || branchText}
                </span>
                {displayName && (
                  <span
                    className="text-[10px] font-mono-code px-1.5 py-0.2 rounded-full truncate max-w-[130px]"
                    style={{
                      background: "var(--pill-bg)",
                      color: "var(--text-muted)",
                    }}
                    title={`branch: ${branchText}`}
                  >
                    {branchText}
                  </span>
                )}
                <button
                  type="button"
                  onClick={onEditCard}
                  title="Edit worker alias or note"
                  className="jjdr-pill p-1 rounded-full cursor-pointer shrink-0 transition-colors"
                  style={{ color: "var(--text-muted)" }}
                >
                  <Pencil className="w-3 h-3" />
                </button>
              </div>

              <div className="flex items-center justify-between gap-2 flex-wrap text-[11px] pt-0.5">
                <span
                  className="truncate max-w-[240px]"
                  style={{ color: "var(--text-muted)" }}
                >
                  {customNote || worktree.path}
                </span>

                <div className="flex items-center gap-1.5 shrink-0">
                  {hasDiff && onOpenDiff && (
                    <button
                      type="button"
                      onClick={onOpenDiff}
                      className="jjdr-pill inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono-code cursor-pointer"
                      style={{ color: "var(--text-secondary)" }}
                      title="Preview Git Diff"
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

                  {!worktree.is_main && onTeardown && (
                    <button
                      type="button"
                      onClick={onTeardown}
                      title="Dismiss worker and remove worktree"
                      className="jjdr-pill inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] cursor-pointer transition-colors"
                      style={{
                        color: worktree.is_merged
                          ? "var(--accent)"
                          : "var(--text-muted)",
                      }}
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>{worktree.is_merged ? "Dismiss" : "Clean"}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Changed Files Snapshot (0.5s visual context check) */}
          {changedFiles.length > 0 && (
            <div className="relative z-10 flex items-center gap-1.5 flex-wrap">
              <FileCode2
                className="w-3 h-3 shrink-0"
                style={{ color: "var(--text-faint)" }}
              />
              {changedFiles.slice(0, 3).map((fp) => (
                <span
                  key={fp}
                  title={fp}
                  className="px-2 py-0.5 rounded-full text-[10px] font-mono-code truncate max-w-[145px]"
                  style={{
                    background: "var(--input-bg)",
                    border: "1px solid var(--divider)",
                    color: "var(--text-secondary)",
                  }}
                >
                  {fileBasename(fp)}
                </span>
              ))}
              {changedFiles.length > 3 && (
                <span
                  className="text-[10px] font-mono-code"
                  style={{ color: "var(--text-faint)" }}
                >
                  +{changedFiles.length - 3}
                </span>
              )}
            </div>
          )}

          {/* Row 3: Latest Context / Output Digest */}
          <div
            className="relative z-10 rounded-2xl px-4 py-3 text-[13px] leading-relaxed font-mono-code whitespace-pre-wrap break-words max-h-32 overflow-y-auto"
            style={{
              background: "var(--input-bg)",
              border: "1px solid var(--divider)",
              color: hasAi ? "var(--text-primary)" : "var(--text-muted)",
            }}
          >
            {previewText}
          </div>

          {/* Row 4: Primary Action Row (No Prompt Presets!) */}
          <div className="relative z-10 pt-1 flex items-center gap-2">
            {showDeckNav && (
              <button
                type="button"
                onClick={onPrevWorker}
                title="Previous Worker (Ctrl+Left)"
                className="jjdr-pill px-3 py-2.5 rounded-2xl text-xs font-semibold cursor-pointer inline-flex items-center gap-1 shrink-0"
                style={{ color: "var(--text-secondary)" }}
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Prev</span>
              </button>
            )}

            {awaitingHireConfirm && onConfirmHire ? (
              <button
                type="button"
                onClick={onConfirmHire}
                title="Stamp HIRED! and open mission terminal (Enter / Ctrl+Enter)"
                className="flex-1 py-3 px-5 rounded-2xl text-xs font-extrabold cursor-pointer flex items-center justify-center gap-2 transition-transform active:scale-[0.98] hover:opacity-95 shadow-md"
                style={{
                  background:
                    "linear-gradient(135deg, #10b981 0%, #34d399 100%)",
                  color: "#072017",
                }}
              >
                <Sparkles className="w-4 h-4 stroke-[2.5]" />
                <span>Hire &amp; Assign {persona.name}</span>
                <kbd
                  className="ml-1 text-[10px] font-mono-code px-1.5 py-0.5 rounded opacity-80"
                  style={{ background: "rgba(0,0,0,0.14)" }}
                >
                  Enter
                </kbd>
              </button>
            ) : hasAi ? (
              <div
                className="flex-1 py-2.5 px-4 rounded-2xl text-xs font-semibold text-center flex items-center justify-center gap-2"
                style={{
                  background: awaitingTrustSetup
                    ? "var(--warn-soft)"
                    : "var(--ready-soft)",
                  border: `1px solid ${
                    awaitingTrustSetup
                      ? "var(--warn-border)"
                      : "var(--ready-border)"
                  }`,
                  color: awaitingTrustSetup
                    ? "var(--warn-fg)"
                    : "var(--ready-fg)",
                }}
              >
                <span>
                  {awaitingTrustSetup
                    ? `Confirm folder trust for ${persona.name} in right terminal first`
                    : `Assign ${persona.name} in right terminal → Auto-Dispatches`}
                </span>
              </div>
            ) : (
              <button
                type="button"
                disabled={launchingAi}
                onClick={onWakeAi}
                title="Start AI session in this worktree (Ctrl+Enter)"
                className="flex-1 py-2.5 px-4 rounded-2xl text-xs font-extrabold cursor-pointer flex items-center justify-center gap-2 transition-transform active:scale-[0.98] disabled:opacity-50 shadow-md"
                style={{
                  background:
                    "linear-gradient(135deg, var(--accent) 0%, #38bdf8 100%)",
                  color: "#ffffff",
                }}
              >
                <Bot className="w-4 h-4" />
                <span>
                  {launchingAi
                    ? `Waking ${persona.name}...`
                    : `Wake Up ${persona.name} (Start AI)`}
                </span>
                <kbd
                  className="text-[10px] font-mono-code px-1.5 py-0.5 rounded opacity-85"
                  style={{ background: "rgba(0,0,0,0.22)" }}
                >
                  Ctrl+Enter
                </kbd>
              </button>
            )}

            {showDeckNav && (
              <button
                type="button"
                onClick={onNextWorker}
                title="Next Worker (Ctrl+N / Ctrl+Right)"
                className="jjdr-pill px-3 py-2.5 rounded-2xl text-xs font-semibold cursor-pointer inline-flex items-center gap-1 shrink-0"
                style={{ color: "var(--text-primary)" }}
              >
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Mini Dot Index Strip (hidden in solo hire mode) */}
      {!soloMode && (
        <div className="mt-5 flex items-center justify-center gap-3 select-none">
          {total > 1 && (
            <div className="flex items-center gap-1.5">
              {deckWorkers.map((item, idx) => {
                const p = getWorkerPersona(item.normWtPath);
                const meta = worktreeMeta[item.normWtPath];
                const tip = meta?.display_name?.trim()
                  ? `${p.name} · ${meta.display_name.trim()} (${item.worktree.branch})`
                  : `${p.name} · ${item.worktree.branch}`;
                const isActive = idx === index;
                return (
                  <button
                    key={item.cardKey}
                    type="button"
                    onClick={() => onJumpToIndex(idx)}
                    title={`${idx + 1}. ${tip}${item.tier === 0 ? " · AI Standby" : " · Empty Slot"}`}
                    className="rounded-full transition-all cursor-pointer"
                    style={{
                      width: isActive ? "20px" : "8px",
                      height: "8px",
                      background: isActive
                        ? persona.palette.body
                        : item.tier === 0
                        ? "var(--ready-fg)"
                        : "var(--text-faint)",
                      opacity: isActive ? 1 : 0.45,
                    }}
                  />
                );
              })}
            </div>
          )}
          <span
            className="text-[11px] font-mono-code font-semibold tabular-nums"
            style={{ color: "var(--text-muted)" }}
          >
            {index + 1} / {total}
            {worker.tier === 0 ? " · AI Standby" : " · Sleeping"}
          </span>
        </div>
      )}
    </div>
  );
});
