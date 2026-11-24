import React from "react";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  FileDiff,
  Home,
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
  isPermissionApprovalPending,
  normalizePath,
} from "../../workers/dashboardLogic";
import {
  cardKeyForSession,
  getWorktreeLiveSessions,
} from "../../utils/worktreeSessions";
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
  const cardMeta = useAppStore(
    (s) => s.worktreeMeta[normalizePath(session.worktreePath)]
  );

  const attachedAddress = useUiStore((s) => s.attachedAddress);
  const setSelectedCardKey = useUiStore((s) => s.setSelectedCardKey);
  const setSelectedAddress = useUiStore((s) => s.setSelectedAddress);
  const setAttachedAddress = useUiStore((s) => s.setAttachedAddress);
  const closeTerminalDrawer = useUiStore((s) => s.closeTerminalDrawer);
  const requestTerminalFocus = useUiStore((s) => s.requestTerminalFocus);
  const setDiffTarget = useUiStore((s) => s.setDiffTarget);
  const setTeardownTarget = useUiStore((s) => s.setTeardownTarget);
  const showToast = useUiStore((s) => s.showToast);

  const { terminal, worktree, bucket } = session;
  const isLive = terminal.state === "live";
  const displayName = cardMeta?.display_name?.trim() || "";
  const cardKey = cardKeyForSession(session);
  const tabCount = session.worktreeSessionCount ?? 1;

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

  const cardStyle: React.CSSProperties = (() => {
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
    } else {
      background = selected ? "var(--card-bg)" : "var(--card-idle-bg)";
      border = selected
        ? "1px solid var(--accent-border)"
        : "1px dashed var(--card-idle-border)";
    }

    return {
      background,
      border,
      boxShadow: selected
        ? "var(--card-selected-shadow)"
        : "var(--card-shadow)",
    };
  })();

  return (
    <div
      onClick={() => {
        setSelectedCardKey(cardKey);
        setSelectedAddress(session.address);
        if (attachedAddress && isLive) {
          setAttachedAddress(session.address);
          requestTerminalFocus();
        }
      }}
      onDoubleClick={() => {
        setSelectedCardKey(cardKey);
        setSelectedAddress(session.address);
        if (isLive) {
          setAttachedAddress(session.address);
          requestTerminalFocus();
        }
      }}
      style={cardStyle}
      className="jjdr-card-lift group relative rounded-[18px] p-4 cursor-pointer select-none flex flex-col gap-2.5"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <StatusBadge
            bucket={bucket}
            status={terminal.status}
            isStuck={session.isStuck}
            stuckMinutes={session.stuckMinutes}
          />
          <span
            className="text-xs font-medium"
            style={{ color: "var(--text-secondary)" }}
          >
            {session.projectName}
          </span>
          <span style={{ color: "var(--text-faint)" }}>/</span>
          {worktree?.is_main && (
            <span
              className="inline-flex items-center gap-0.5 text-[9.5px] px-1.5 py-0.5 rounded-full font-bold uppercase"
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
            className="text-[13px] font-mono-code font-bold"
            style={{ color: "var(--text-primary)" }}
          >
            {displayName || session.branch}
          </span>
        </div>

        <div
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-2 shrink-0 text-[11px] font-mono-code tabular-nums"
        >
          {showOverlap && worktree && worktree.overlap_files.length > 0 && (
            <span
              title={`Potential merge overlap:\n${worktree.overlap_files.join(
                "\n"
              )}`}
              style={{ color: "var(--warn-fg)" }}
            >
              <AlertTriangle className="w-3.5 h-3.5 inline" />
            </span>
          )}

          <span style={{ color: "var(--text-muted)" }}>
            {session.agentLabel}
            {tabCount > 1 ? `+${tabCount - 1}` : ""} ·{" "}
            {formatElapsed(session.elapsedMs)}
          </span>

          {isLive && isPermissionApprovalPending(terminal) && (
            <button
              onClick={() => void sendTerminalKeys(session.address, ["enter"])}
              title={
                terminal.status?.msg
                  ? `Approve (Enter) · ${terminal.status.msg}`
                  : "Approve (Enter)"
              }
              className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-sans font-semibold cursor-pointer transition-opacity hover:opacity-90"
              style={{
                background: "var(--action-fg)",
                color: "#ffffff",
              }}
            >
              <Check className="w-3 h-3" />
              승인
            </button>
          )}

          <div className="hidden group-hover:inline-flex items-center gap-0.5">
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
                  className="p-1 rounded-full hover:bg-black/15 cursor-pointer"
                  style={{ color: "var(--text-secondary)" }}
                >
                  <FileDiff className="w-3.5 h-3.5" />
                </button>
              )}
            {isLive && (
              <button
                onClick={() => void interruptTerminal(session.address)}
                title="Interrupt"
                className="p-1 rounded-full hover:bg-black/15 cursor-pointer"
                style={{ color: "var(--warn-fg)" }}
              >
                <OctagonX className="w-3.5 h-3.5" />
              </button>
            )}
            {isLive && (
              <button
                onClick={() => void popoutExternalTerminal(session.address)}
                title="Open in external terminal"
                className="p-1 rounded-full hover:bg-black/15 cursor-pointer"
                style={{ color: "var(--text-secondary)" }}
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            )}
            {worktree && !worktree.is_main && session.projectId ? (
              <button
                onClick={() => {
                  const siblings = getWorktreeLiveSessions(
                    useAppStore.getState().computed.allSessions,
                    session
                  );
                  setTeardownTarget({
                    projectId: session.projectId!,
                    worktreePath: worktree.path,
                    branch: worktree.branch,
                    isMerged: worktree.is_merged,
                    dirtyCount: worktree.dirty_count,
                    terminalAddresses:
                      siblings.length > 0
                        ? siblings.map((s) => s.address)
                        : [session.address],
                  });
                }}
                title="Teardown worktree"
                className="p-1 rounded-full hover:bg-black/15 cursor-pointer"
                style={{ color: "var(--action-fg)" }}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                onClick={() => void handleKill()}
                title="Close session"
                className="p-1 rounded-full hover:bg-black/15 cursor-pointer"
                style={{ color: "var(--action-fg)" }}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {isLive && (
            <button
              onClick={() => {
                if (attached) {
                  closeTerminalDrawer();
                } else {
                  setSelectedCardKey(cardKey);
                  setSelectedAddress(session.address);
                  setAttachedAddress(session.address);
                  requestTerminalFocus();
                }
              }}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-sans font-semibold transition-colors cursor-pointer ${
                attached ? "jjdr-primary-btn" : "jjdr-pill"
              }`}
              title="Toggle terminal pane (Ctrl+`)"
            >
              <Terminal className="w-3 h-3" />
              {attached ? "Open" : "Term"}
            </button>
          )}
        </div>
      </div>

      <div
        className="text-[12.5px] leading-snug truncate"
        style={{
          color:
            bucket === "needs_you"
              ? "var(--text-primary)"
              : "var(--text-secondary)",
        }}
      >
        {lastSummary}
      </div>
    </div>
  );
});
