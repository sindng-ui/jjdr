import React from "react";
import {
  AlertTriangle,
  Check,
  FileDiff,
  Plus,
  Terminal,
  Trash2,
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
import { normalizePath } from "../../workers/dashboardLogic";
import {
  killTerminal,
  launchSession,
  sendTerminalKeys,
} from "../../services/tauriBridge";

interface RadarTileProps {
  project: ProjectConfig;
  worktree: WorktreeInfo;
  sessions: EnrichedSession[];
}

export const RadarTile = React.memo(function RadarTile({
  project,
  worktree,
  sessions,
}: RadarTileProps) {
  const cardKey = `wt::${project.id}::${normalizePath(worktree.path)}`;
  const session = sessions[0] ?? null;
  const isLive = session?.terminal.state === "live";

  const showOverlap = useAppStore((s) => s.settings.show_merge_overlap);
  const selectedCardKey = useUiStore((s) => s.selectedCardKey);
  const attachedAddress = useUiStore((s) => s.attachedAddress);
  const setSelectedCardKey = useUiStore((s) => s.setSelectedCardKey);
  const setSelectedAddress = useUiStore((s) => s.setSelectedAddress);
  const setAttachedAddress = useUiStore((s) => s.setAttachedAddress);
  const setLaunchTarget = useUiStore((s) => s.setLaunchTarget);
  const setDiffTarget = useUiStore((s) => s.setDiffTarget);
  const setTeardownTarget = useUiStore((s) => s.setTeardownTarget);
  const showToast = useUiStore((s) => s.showToast);

  const isSelected = selectedCardKey === cardKey;
  const isAttached = Boolean(session && attachedAddress === session.address);
  const bucket = session?.bucket ?? "idle";
  const isStandby = !session || bucket === "idle";

  const lastLine = (() => {
    if (!session) return "Standby · Press Ctrl+` to start";
    if (session.terminal.status?.msg) return session.terminal.status.msg;
    if (session.previewLines.length > 0) {
      return session.previewLines[session.previewLines.length - 1];
    }
    return bucket === "running" ? "Working..." : "Ready";
  })();

  const openOrLaunch = async () => {
    setSelectedCardKey(cardKey);
    if (session && isLive) {
      setSelectedAddress(session.address);
      setAttachedAddress(session.address);
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
        name: `${project.name}-${worktree.branch.replace(/[/\\ ]/g, "-")}`,
        autonomous: true,
      });
      useAppStore.getState().recordLastAgent(normalizePath(worktree.path), argv);
      if (addr) {
        setSelectedAddress(addr);
        setAttachedAddress(addr);
      }
    } catch (err) {
      showToast(`AI 시작 실패: ${String(err)}`, "error");
    }
  };

  // Uniform Obsidian surface + subtle left 3px accent bar + crisp silver focus ring
  const surfaceCls = isAttached
    ? "bg-[#181c24] border-[#e4e4e7]/50 ring-1 ring-[#e4e4e7]/20"
    : isSelected
    ? "bg-[#171a22] border-[#d4d4d8]/40 ring-1 ring-[#d4d4d8]/15"
    : bucket === "needs_you"
    ? "bg-[#151519] border-[#2c1f24] hover:border-[#3d282f]"
    : "bg-[#13161b] border-[#1e222a] hover:bg-[#161a21] hover:border-[#282d38]";

  const opacityCls =
    isStandby && !isSelected && !isAttached
      ? "opacity-65 hover:opacity-100"
      : "opacity-100";

  const accentBarColor =
    bucket === "needs_you"
      ? "bg-[#ef4444]"
      : bucket === "ready"
      ? "bg-[#10b981]"
      : bucket === "running"
      ? "bg-[#f59e0b]"
      : "";

  return (
    <div
      data-jjdr-card={cardKey}
      data-jjdr-session-addr={session?.address ?? ""}
      data-jjdr-project-id={project.id}
      data-jjdr-worktree-path={worktree.path}
      data-jjdr-branch={worktree.branch}
      onClick={() => {
        setSelectedCardKey(cardKey);
        setSelectedAddress(session?.address ?? null);
        if (attachedAddress) {
          if (session && isLive) {
            setAttachedAddress(session.address);
          } else {
            void launchSession({
              project_id: project.id,
              cwd: worktree.path,
              branch: worktree.branch,
              argv: [],
              name: `${project.name}-${(worktree.branch || "main").replace(/[/\\ ]/g, "-")}-sh`,
            })
              .then((addr) => {
                if (addr && useUiStore.getState().selectedCardKey === cardKey) {
                  setSelectedAddress(addr);
                  setAttachedAddress(addr);
                }
              })
              .catch((err) =>
                showToast(`PowerShell 실행 실패: ${String(err)}`, "error")
              );
          }
        }
      }}
      onDoubleClick={() => void openOrLaunch()}
      className={`group relative rounded-lg border pl-3.5 pr-3 py-2.5 cursor-pointer transition-all select-none overflow-hidden ${surfaceCls} ${opacityCls}`}
    >
      {/* Left 3px Semantic Accent Bar */}
      {accentBarColor && (
        <div
          className={`absolute left-0 top-0 bottom-0 w-[3px] ${accentBarColor}`}
        />
      )}

      {/* Row 1: Dot + Branch + Clean Metadata (No boxy badges) */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {session ? (
            <StatusBadge
              bucket={session.bucket}
              status={session.terminal.status}
              isStuck={session.isStuck}
              stuckMinutes={session.stuckMinutes}
              compact
            />
          ) : (
            <span className="w-1.5 h-1.5 rounded-full bg-[#3f3f46] shrink-0" />
          )}

          <span
            className={`text-xs font-mono-code truncate ${
              isSelected || isAttached || !isStandby
                ? "font-semibold text-[#f4f4f5]"
                : "font-medium text-[#a1a1aa]"
            }`}
          >
            {worktree.branch || "(detached)"}
          </span>

          {worktree.is_merged && (
            <span className="text-[10px] font-mono-code text-[#52525b] shrink-0">
              merged
            </span>
          )}
        </div>

        {/* Right Aligned Tabular Metrics & Hover Controls */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-2 shrink-0 text-[11px] font-mono-code tabular-nums"
        >
          {(worktree.added_lines > 0 || worktree.deleted_lines > 0) && (
            <button
              type="button"
              onClick={() =>
                setDiffTarget({
                  projectId: project.id,
                  worktreePath: worktree.path,
                  branch: worktree.branch,
                })
              }
              title="Inspect Git Diff"
              className="inline-flex items-center gap-1 hover:underline cursor-pointer"
            >
              <span className="text-[#34d399]">+{worktree.added_lines}</span>
              <span className="text-[#f87171]">-{worktree.deleted_lines}</span>
            </button>
          )}

          {showOverlap && worktree.overlap_files.length > 0 && (
            <span
              title={`Potential merge overlap:\n${worktree.overlap_files.join("\n")}`}
              className="text-[#f59e0b]"
            >
              <AlertTriangle className="w-3 h-3 inline" />
            </span>
          )}

          {session && isLive && bucket === "needs_you" ? (
            <button
              type="button"
              onClick={() => void sendTerminalKeys(session.address, ["enter"])}
              title="Approve (Enter)"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-sans font-medium bg-[#ef4444]/15 hover:bg-[#ef4444]/25 text-[#f87171] cursor-pointer transition-colors"
            >
              <Check className="w-2.5 h-2.5" />
              Approve
            </button>
          ) : (
            session && (
              <span className="text-[#6b7280] group-hover:hidden">
                {session.agentLabel}
                {sessions.length > 1 ? `+${sessions.length - 1}` : ""} ·{" "}
                {formatElapsed(session.elapsedMs)}
              </span>
            )
          )}

          {/* Hover Quick Actions */}
          <div className="hidden group-hover:inline-flex items-center gap-1">
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
                title="View Diff"
                className="p-0.5 rounded hover:bg-[#232732] text-[#71717a] hover:text-[#e4e4e7] cursor-pointer"
              >
                <FileDiff className="w-3 h-3" />
              </button>
            )}
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
              title="Launch AI CLI"
              className="p-0.5 rounded hover:bg-[#232732] text-[#71717a] hover:text-[#e4e4e7] cursor-pointer"
            >
              <Plus className="w-3 h-3" />
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
                title="Teardown worktree"
                className="p-0.5 rounded hover:bg-[#2c191d] text-[#71717a] hover:text-[#f87171] cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            ) : (
              session && (
                <button
                  type="button"
                  onClick={() => {
                    void killTerminal(session.address, true);
                    if (isAttached) setAttachedAddress(null);
                  }}
                  title="Close session"
                  className="p-0.5 rounded hover:bg-[#2c191d] text-[#71717a] hover:text-[#f87171] cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )
            )}
          </div>

          {isAttached && (
            <Terminal className="w-3 h-3 text-[#e4e4e7] shrink-0" />
          )}
        </div>
      </div>

      {/* Row 2: Calm Single-Line Digest aligned with branch name */}
      <div
        className={`mt-1.5 text-xs truncate ${
          bucket === "needs_you"
            ? "text-[#e4e4e7]"
            : session
            ? "text-[#9ca3af]"
            : "text-[#52525b]"
        }`}
      >
        {lastLine}
      </div>
    </div>
  );
});
