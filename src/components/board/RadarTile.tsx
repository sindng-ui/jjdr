import React from "react";
import {
  AlertTriangle,
  Check,
  FileDiff,
  Home,
  Pencil,
  Plus,
  Terminal,
  Trash2,
  Users,
} from "lucide-react";
import type {
  EnrichedSession,
  ProjectConfig,
  WorktreeInfo,
} from "../../types/domain";
import { StatusBadge } from "../shared/StatusBadge";
import { formatElapsed } from "../../utils/format";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import {
  isPermissionApprovalPending,
  normalizePath,
} from "../../workers/dashboardLogic";
import { pickPreferredWorktreeSession } from "../../utils/worktreeSessions";
import {
  inspectPrForReviewRequest,
  killTerminal,
  launchSession,
  sendTerminalKeys,
} from "../../services/tauriBridge";
import { findAuthoredReviewForCard } from "../../utils/teamReviews";
import { AuthorReviewStatusBar } from "../team/AuthorReviewStatusBar";

interface RadarTileProps {
  project: ProjectConfig;
  worktree: WorktreeInfo;
  sessions: EnrichedSession[];
  isDragging?: boolean;
  isDropTarget?: boolean;
  onStartDrag?: (id: string, e: React.PointerEvent<HTMLElement>) => void;
  shouldSuppressClick?: () => boolean;
}

export const RadarTile = React.memo(function RadarTile({
  project,
  worktree,
  sessions,
  isDragging = false,
  isDropTarget = false,
  onStartDrag,
  shouldSuppressClick,
}: RadarTileProps) {
  const normWtPath = normalizePath(worktree.path);
  const cardKey = `wt::${project.id}::${normWtPath}`;
  const session = sessions[0] ?? null;

  // Atomic boolean selectors so moving focus or grabbing cards only re-renders the 2 affected cards (#13)
  const isSelected = useUiStore((s) => s.selectedCardKey === cardKey);
  const isGrabSource = useUiStore(
    (s) => s.cardGrabState?.sourceKey === cardKey
  );
  const isGrabTarget = useUiStore(
    (s) =>
      s.cardGrabState?.targetKey === cardKey &&
      s.cardGrabState?.sourceKey !== cardKey
  );
  const isAttached = useUiStore((s) =>
    Boolean(
      s.attachedAddress && sessions.some((item) => item.address === s.attachedAddress)
    )
  );
  const rememberedAddr = useUiStore(
    (s) => s.lastSessionByCardKey[cardKey] ?? null
  );
  const attachTarget = pickPreferredWorktreeSession(sessions, rememberedAddr);
  const isTargetLive = attachTarget?.terminal.state === "live";
  const isLive = session?.terminal.state === "live";

  const showOverlap = useAppStore((s) => s.settings.show_merge_overlap);
  const teamEnabled = useAppStore((s) => s.settings.team?.enabled ?? false);
  const cardMeta = useAppStore((s) => s.worktreeMeta[normWtPath]);
  const autoMission = useAppStore((s) => s.autoMissionByWorktree[normWtPath]);
  const isAutoReviewWt = useAppStore((s) =>
    Boolean(s.autoReviewJobsByWorktree[normWtPath])
  );
  const authoredReviews = useAppStore((s) => s.authoredReviews);

  const prNumber = cardMeta?.pr_number ?? autoMission?.prNumber ?? null;
  const prUrl = cardMeta?.pr_url ?? autoMission?.prUrl ?? null;
  const authoredReview =
    teamEnabled && !isAutoReviewWt && authoredReviews.length > 0
      ? findAuthoredReviewForCard(authoredReviews, {
          prNumber,
          prUrl,
          branch: worktree.branch,
        })
      : null;

  const setReviewPickerTarget = useUiStore((s) => s.setReviewPickerTarget);

  const setSelectedCardKey = useUiStore((s) => s.setSelectedCardKey);
  const setSelectedAddress = useUiStore((s) => s.setSelectedAddress);
  const setAttachedAddress = useUiStore((s) => s.setAttachedAddress);
  const detachToEmptyDrawer = useUiStore((s) => s.detachToEmptyDrawer);
  const rememberCardSession = useUiStore((s) => s.rememberCardSession);
  const setLaunchTarget = useUiStore((s) => s.setLaunchTarget);
  const setEditWorktreeTarget = useUiStore((s) => s.setEditWorktreeTarget);
  const setContextMenu = useUiStore((s) => s.setContextMenu);
  const setDiffTarget = useUiStore((s) => s.setDiffTarget);
  const setTeardownTarget = useUiStore((s) => s.setTeardownTarget);
  const showToast = useUiStore((s) => s.showToast);

  const bucket = session?.bucket ?? "idle";
  const isStandby = !session || bucket === "idle";
  const displayName = cardMeta?.display_name?.trim() || "";
  const customNote = cardMeta?.note?.trim() || "";
  const branchText = worktree.branch || "(detached)";

  const lastLine = (() => {
    if (!session) {
      return customNote || "Standby · Ctrl+` or double-click to launch";
    }
    if (session.terminal.status?.msg) return session.terminal.status.msg;
    if (session.previewLines.length > 0) {
      return session.previewLines[session.previewLines.length - 1];
    }
    return bucket === "running" ? "Working..." : "Ready for review";
  })();

  const openOrLaunch = async () => {
    setSelectedCardKey(cardKey);
    if (attachTarget && isTargetLive) {
      setSelectedAddress(attachTarget.address);
      setAttachedAddress(attachTarget.address);
      rememberCardSession(cardKey, attachTarget.address);
      return;
    }
    try {
      const defaultCmd = project.default_agent || "agy";
      const argv = defaultCmd.split(/\s+/).filter(Boolean);
      const addr = await launchSession({
        project_id: project.id,
        cwd: worktree.path,
        branch: worktree.branch,
        argv,
        name: `${project.name}-${worktree.branch || "main"}`,
        autonomous: true,
      });
      useAppStore.getState().recordLastAgent(normWtPath, argv);
      if (addr) {
        setSelectedAddress(addr);
        setAttachedAddress(addr);
        rememberCardSession(cardKey, addr);
      }
    } catch (err) {
      showToast(`Failed to start AI: ${String(err)}`, "error");
    }
  };

  const showSwapTargetHighlight =
    (isDropTarget && !isDragging) || isGrabTarget;

  // Focus ring is strictly exclusive to `isSelected` (#11) — never highlights two cards at once.
  const tileStyle: React.CSSProperties = (() => {
    let background = "var(--card-bg)";
    let border = "1px solid var(--card-border)";

    if (bucket === "needs_you") {
      background = "var(--action-bg)";
      border = "1px solid var(--action-border)";
    } else if (bucket === "ready") {
      background = "var(--ready-bg)";
      border = "1px solid var(--ready-border)";
    } else if (bucket === "running") {
      background = "var(--run-bg)";
      border = "1px solid var(--run-border)";
    } else if (isStandby) {
      background = isSelected ? "var(--card-bg)" : "var(--card-idle-bg)";
      border = isSelected
        ? "1px solid var(--accent-border)"
        : "1px dashed var(--card-idle-border)";
    }

    if (isGrabSource) {
      border = "1.5px dashed var(--accent)";
    } else if (showSwapTargetHighlight) {
      border = "1.5px solid var(--accent)";
    }

    return {
      background,
      border,
      opacity: isDragging ? 0.48 : isGrabSource ? 0.72 : 1,
      boxShadow: showSwapTargetHighlight
        ? "0 0 0 2px var(--accent), var(--card-shadow)"
        : isSelected
        ? "var(--card-selected-shadow)"
        : "var(--card-shadow)",
    };
  })();

  return (
    <div
      data-jjdr-card={cardKey}
      data-reorder-id={normWtPath}
      data-jjdr-session-addr={attachTarget?.address ?? session?.address ?? ""}
      data-jjdr-project-id={project.id}
      data-jjdr-worktree-path={worktree.path}
      data-jjdr-branch={worktree.branch}
      onPointerDown={onStartDrag ? (e) => onStartDrag(normWtPath, e) : undefined}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setSelectedCardKey(cardKey);
        setSelectedAddress(attachTarget?.address ?? session?.address ?? null);
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          cardKey,
          project,
          worktree,
          sessions,
        });
      }}
      onClick={(e) => {
        if (shouldSuppressClick?.()) return;
        setSelectedCardKey(cardKey);
        setSelectedAddress(attachTarget?.address ?? session?.address ?? null);
        e.currentTarget.scrollIntoView({
          block: "nearest",
          inline: "nearest",
          behavior: "smooth",
        });
        const { terminalDrawerOpen, attachedAddress } = useUiStore.getState();
        if (terminalDrawerOpen || attachedAddress) {
          if (attachTarget && isTargetLive) {
            setAttachedAddress(attachTarget.address);
            rememberCardSession(cardKey, attachTarget.address);
          } else {
            // Instant 0ms switch to empty standby drawer — no unwanted shell spam or double focus!
            detachToEmptyDrawer();
          }
        }
      }}
      onDoubleClick={() => {
        if (shouldSuppressClick?.()) return;
        void openOrLaunch();
      }}
      style={tileStyle}
      className="jjdr-card-lift group relative rounded-[18px] p-3.5 cursor-pointer select-none flex flex-col justify-between gap-2 min-w-0"
    >
      {(isGrabSource || showSwapTargetHighlight) && (
        <span
          className="pointer-events-none absolute -top-2 right-3 z-10 px-2 py-0.5 rounded-full text-[10px] font-bold shadow-sm"
          style={{
            background: "var(--accent)",
            color: "#ffffff",
          }}
        >
          {isGrabSource ? "Grabbed · Arrows" : "⇄ Swap"}
        </span>
      )}
      {/* Row 1: Status Pill + ROOT Badge + Name/Branch + Hover Actions */}
      <div className="flex items-center justify-between gap-1.5 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          {session ? (
            <StatusBadge
              bucket={session.bucket}
              status={session.terminal.status}
              isStuck={session.isStuck}
              stuckMinutes={session.stuckMinutes}
              compact
            />
          ) : (
            <StatusBadge bucket="idle" compact />
          )}

          {worktree.is_main && (
            <span
              title="Project Root (main repository)"
              className="inline-flex items-center gap-0.5 text-[9.5px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide shrink-0"
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
            className="text-[13px] font-mono-code font-bold truncate"
            title={
              displayName
                ? `${displayName} (${branchText})${customNote ? `\n${customNote}` : ""}`
                : customNote
                ? `${branchText}\n${customNote}`
                : branchText
            }
            style={{
              color:
                isStandby && !isSelected
                  ? "var(--text-secondary)"
                  : "var(--text-primary)",
            }}
          >
            {displayName || branchText}
          </span>

          {displayName && (
            <span
              className="text-[10px] font-mono-code px-1.5 py-0.5 rounded-full truncate max-w-[96px] shrink-0"
              style={{
                background: "var(--pill-bg)",
                color: "var(--text-muted)",
              }}
              title={`Git branch: ${branchText}`}
            >
              {branchText}
            </span>
          )}

          {worktree.is_merged && (
            <span
              className="text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0"
              style={{
                background: "var(--pill-bg)",
                color: "var(--text-muted)",
              }}
            >
              merged
            </span>
          )}
        </div>

        {/* Right Aligned Metrics & Hover Pill Actions (#7: removed glaring +N -M diff counts) */}
        <div
          onClick={(e) => e.stopPropagation()}
          data-no-drag="true"
          className="flex items-center gap-1.5 shrink-0 text-[11px] font-mono-code tabular-nums"
        >
          {showOverlap && worktree.overlap_files.length > 0 && (
            <span
              title={`Potential merge overlap:\n${worktree.overlap_files.join(
                "\n"
              )}`}
              style={{ color: "var(--warn-fg)" }}
            >
              <AlertTriangle className="w-3.5 h-3.5 inline" />
            </span>
          )}

          {session && (
            <span
              className="group-hover:hidden"
              style={{ color: "var(--text-muted)" }}
            >
              {session.agentLabel}
              {sessions.length > 1 ? `+${sessions.length - 1}` : ""} ·{" "}
              {formatElapsed(session.elapsedMs)}
            </span>
          )}

          {/* Hover Quick Action Pills */}
          <div className="hidden group-hover:inline-flex items-center gap-0.5">
            {teamEnabled && !isAutoReviewWt && prNumber !== null && (
              <button
                type="button"
                onClick={() => {
                  void inspectPrForReviewRequest({
                    projectId: project.id,
                    worktreePath: worktree.path,
                    prNumber,
                    prUrlHint: prUrl,
                    manual: true,
                  })
                    .then((candidate) => {
                      if (!candidate.eligible_for_auto_prompt) {
                        showToast(
                          `PR #${prNumber} cannot be reviewed (${candidate.skip_reason ?? "not open"}).`,
                          "info"
                        );
                        return;
                      }
                      setReviewPickerTarget({ candidate, maxReviewers: 2 });
                    })
                    .catch((err) => {
                      showToast(
                        `Failed to inspect PR #${prNumber}: ${String(err)}`,
                        "error"
                      );
                    });
                }}
                title={`Request Team Auto-Review for PR #${prNumber}`}
                className="p-1 rounded-full hover:bg-black/15 cursor-pointer"
                style={{ color: "var(--accent)" }}
              >
                <Users className="w-3.5 h-3.5" />
              </button>
            )}
            {(worktree.added_lines > 0 ||
              worktree.deleted_lines > 0 ||
              worktree.dirty_count > 0) && (
              <button
                type="button"
                onClick={() =>
                  setDiffTarget({
                    projectId: project.id,
                    worktreePath: worktree.path,
                    branch: worktree.branch,
                  })
                }
                title="Preview Git Diff"
                className="p-1 rounded-full hover:bg-black/15 cursor-pointer"
                style={{ color: "var(--text-secondary)" }}
              >
                <FileDiff className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                setEditWorktreeTarget({
                  projectId: project.id,
                  worktreePath: worktree.path,
                  branch: worktree.branch,
                  isMain: worktree.is_main,
                })
              }
              title="Edit card alias / note"
              className="p-1 rounded-full hover:bg-black/15 cursor-pointer"
              style={{ color: "var(--text-secondary)" }}
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() =>
                setLaunchTarget({
                  projectId: project.id,
                  cwd: worktree.path,
                  branch: worktree.branch,
                  defaultAgent: project.default_agent,
                })
              }
              title="Add session (AI / Terminal)"
              className="p-1 rounded-full hover:bg-black/15 cursor-pointer"
              style={{ color: "var(--text-secondary)" }}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            {!worktree.is_main ? (
              <button
                type="button"
                onClick={() =>
                  setTeardownTarget({
                    projectId: project.id,
                    worktreePath: worktree.path,
                    branch: worktree.branch,
                    isMerged: worktree.is_merged,
                    dirtyCount: worktree.dirty_count,
                    terminalAddresses: sessions.map((s) => s.address),
                  })
                }
                title="Remove worktree"
                className="p-1 rounded-full hover:bg-black/15 cursor-pointer"
                style={{ color: "var(--action-fg)" }}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            ) : (
              session && (
                <button
                  type="button"
                  onClick={() => {
                    void killTerminal(session.address, true);
                    if (isAttached) detachToEmptyDrawer();
                  }}
                  title="Close session"
                  className="p-1 rounded-full hover:bg-black/15 cursor-pointer"
                  style={{ color: "var(--action-fg)" }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )
            )}
          </div>

          {isAttached && (
            <Terminal
              className="w-3.5 h-3.5 shrink-0"
              style={{ color: "var(--accent)" }}
            />
          )}
        </div>
      </div>

      {/* Row 2: Calm Single-Line Digest + One-Click Approve Pill */}
      <div className="flex items-center justify-between gap-3">
        <p
          className="text-[12.5px] leading-snug truncate"
          style={{
            color:
              bucket === "needs_you"
                ? "var(--text-primary)"
                : isStandby
                ? "var(--text-faint)"
                : "var(--text-secondary)",
          }}
        >
          {lastLine}
        </p>

        {session && isLive && isPermissionApprovalPending(session.terminal) && (
          <button
            type="button"
            data-no-drag="true"
            onClick={(e) => {
              e.stopPropagation();
              void sendTerminalKeys(session.address, ["enter"]);
            }}
            title={
              session.terminal.status?.msg
                ? `Approve (Enter) · ${session.terminal.status.msg}`
                : "Approve (Enter)"
            }
            className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-semibold shrink-0 cursor-pointer transition-opacity hover:opacity-90"
            style={{
              background: "var(--action-fg)",
              color: "#ffffff",
            }}
          >
            <Check className="w-3 h-3" />
            Approve
          </button>
        )}
      </div>

      {authoredReview && (
        <AuthorReviewStatusBar
          review={authoredReview}
          projectId={project.id}
          projectName={project.name}
          worktreePath={worktree.path}
          compact
        />
      )}
    </div>
  );
});
