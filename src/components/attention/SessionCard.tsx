import React from "react";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  FileDiff,
  OctagonX,
  Terminal,
  Trash2,
} from "lucide-react";
import type { EnrichedSession } from "../../types/domain";
import { StatusBadge } from "../shared/StatusBadge";
import { formatElapsed } from "../../utils/format";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import {
  interruptTerminal,
  killTerminal,
  popoutExternalTerminal,
  sendTerminalKeys,
} from "../../services/tauriBridge";

interface SessionCardProps {
  session: EnrichedSession;
  selected: boolean;
  attached: boolean;
}

export const SessionCard = React.memo(function SessionCard({
  session,
  selected,
  attached,
}: SessionCardProps) {
  const showOverlap = useAppStore((s) => s.settings.show_merge_overlap);

  const attachedAddress = useUiStore((s) => s.attachedAddress);
  const setSelectedAddress = useUiStore((s) => s.setSelectedAddress);
  const setAttachedAddress = useUiStore((s) => s.setAttachedAddress);
  const setDiffTarget = useUiStore((s) => s.setDiffTarget);
  const setTeardownTarget = useUiStore((s) => s.setTeardownTarget);
  const showToast = useUiStore((s) => s.showToast);

  const { terminal, worktree, bucket } = session;
  const isLive = terminal.state === "live";

  const lastSummary =
    terminal.status?.msg ||
    (session.previewLines.length > 0
      ? session.previewLines[session.previewLines.length - 1]
      : terminal.title || "Standby");

  const handleKill = async () => {
    try {
      await killTerminal(session.address, true);
      if (attached) setAttachedAddress(null);
      showToast(`Closed session ${session.address}`, "info");
    } catch (err) {
      showToast(`Failed to close session: ${String(err)}`, "error");
    }
  };

  const surfaceCls = attached
    ? "bg-[#181c24] border-[#e4e4e7]/50 ring-1 ring-[#e4e4e7]/20"
    : selected
    ? "bg-[#171a22] border-[#d4d4d8]/40 ring-1 ring-[#d4d4d8]/15"
    : bucket === "needs_you"
    ? "bg-[#151519] border-[#2c1f24] hover:border-[#3d282f]"
    : "bg-[#13161b] border-[#1e222a] hover:bg-[#161a21] hover:border-[#282d38]";

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
      onClick={() => {
        setSelectedAddress(session.address);
        if (attachedAddress && isLive) {
          setAttachedAddress(session.address);
        }
      }}
      onDoubleClick={() => isLive && setAttachedAddress(session.address)}
      className={`group relative rounded-lg border pl-4 pr-3.5 py-2.5 cursor-pointer transition-all select-none overflow-hidden ${surfaceCls}`}
    >
      {accentBarColor && (
        <div
          className={`absolute left-0 top-0 bottom-0 w-[3px] ${accentBarColor}`}
        />
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <StatusBadge
            bucket={bucket}
            status={terminal.status}
            isStuck={session.isStuck}
            stuckMinutes={session.stuckMinutes}
            compact
          />
          <span className="text-xs font-medium text-[#a1a1aa]">
            {session.projectName}
          </span>
          <span className="text-[#3f3f46]">/</span>
          <span className="text-xs font-mono-code font-semibold text-[#f4f4f5]">
            {session.branch}
          </span>
        </div>

        <div
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-2 shrink-0 text-[11px] font-mono-code tabular-nums"
        >
          {worktree &&
            (worktree.added_lines > 0 ||
              worktree.deleted_lines > 0 ||
              worktree.dirty_count > 0) && (
              <button
                onClick={() => {
                  if (session.projectId) {
                    setDiffTarget({
                      projectId: session.projectId,
                      worktreePath: worktree.path,
                      branch: worktree.branch,
                    });
                  }
                }}
                className="inline-flex items-center gap-1 hover:underline cursor-pointer"
                title="View Git Diff"
              >
                <span className="text-[#34d399]">+{worktree.added_lines}</span>
                <span className="text-[#f87171]">-{worktree.deleted_lines}</span>
              </button>
            )}

          {showOverlap && worktree && worktree.overlap_files.length > 0 && (
            <span
              title={`Potential merge overlap:\n${worktree.overlap_files.join("\n")}`}
              className="text-[#f59e0b]"
            >
              <AlertTriangle className="w-3 h-3 inline" />
            </span>
          )}

          <span className="text-[#6b7280]">
            {session.agentLabel} · {formatElapsed(session.elapsedMs)}
          </span>

          {bucket === "needs_you" && isLive && (
            <button
              onClick={() => void sendTerminalKeys(session.address, ["enter"])}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-sans font-medium bg-[#ef4444]/15 hover:bg-[#ef4444]/25 text-[#f87171] cursor-pointer"
            >
              <Check className="w-2.5 h-2.5" />
              Approve
            </button>
          )}

          <div className="hidden group-hover:inline-flex items-center gap-1">
            {worktree &&
              (worktree.added_lines > 0 ||
                worktree.deleted_lines > 0 ||
                worktree.dirty_count > 0) && (
                <button
                  onClick={() => {
                    if (session.projectId) {
                      setDiffTarget({
                        projectId: session.projectId,
                        worktreePath: worktree.path,
                        branch: worktree.branch,
                      });
                    }
                  }}
                  title="Git diff"
                  className="p-0.5 rounded hover:bg-[#232732] text-[#71717a] hover:text-[#e4e4e7] cursor-pointer"
                >
                  <FileDiff className="w-3 h-3" />
                </button>
              )}
            {isLive && (
              <button
                onClick={() => void interruptTerminal(session.address)}
                title="Interrupt"
                className="p-0.5 rounded hover:bg-[#232732] text-[#71717a] hover:text-[#f59e0b] cursor-pointer"
              >
                <OctagonX className="w-3 h-3" />
              </button>
            )}
            {isLive && (
              <button
                onClick={() => void popoutExternalTerminal(session.address)}
                title="Open in external terminal"
                className="p-0.5 rounded hover:bg-[#232732] text-[#71717a] hover:text-[#e4e4e7] cursor-pointer"
              >
                <ExternalLink className="w-3 h-3" />
              </button>
            )}
            {worktree && !worktree.is_main && session.projectId ? (
              <button
                onClick={() =>
                  setTeardownTarget({
                    projectId: session.projectId!,
                    worktreePath: worktree.path,
                    branch: worktree.branch,
                    isMerged: worktree.is_merged,
                    dirtyCount: worktree.dirty_count,
                    terminalAddresses: [session.address],
                  })
                }
                title="Teardown worktree"
                className="p-0.5 rounded hover:bg-[#2c191d] text-[#71717a] hover:text-[#f87171] cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            ) : (
              <button
                onClick={() => void handleKill()}
                title="Close session"
                className="p-0.5 rounded hover:bg-[#2c191d] text-[#71717a] hover:text-[#f87171] cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>

          {isLive && (
            <button
              onClick={() =>
                setAttachedAddress(attached ? null : session.address)
              }
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-sans font-medium transition-colors cursor-pointer ${
                attached
                  ? "bg-[#f4f4f5] text-[#0b0c0e]"
                  : "bg-[#1a1e26] hover:bg-[#242934] text-[#d4d4d8]"
              }`}
              title="Toggle terminal pane (Ctrl+`)"
            >
              <Terminal className="w-3 h-3" />
              {attached ? "Open" : "Term"}
            </button>
          )}
        </div>
      </div>

      <div className="mt-1.5 text-xs text-[#9ca3af] truncate">{lastSummary}</div>
    </div>
  );
});
