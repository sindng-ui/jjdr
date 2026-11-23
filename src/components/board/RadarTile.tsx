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
import { pickPreferredWorktreeSession } from "../../utils/worktreeSessions";
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
  // Card visual summary always reflects highest-priority session (`sessions[0]`),
  // while opening/attaching restores the last active tab (or prefers AI) for this worktree.
  const session = sessions[0] ?? null;
  const rememberedAddr = useUiStore(
    (s) => s.lastSessionByCardKey[cardKey] ?? null
  );
  const attachTarget = pickPreferredWorktreeSession(sessions, rememberedAddr);
  const isTargetLive = attachTarget?.terminal.state === "live";
  const isLive = session?.terminal.state === "live";

  const showOverlap = useAppStore((s) => s.settings.show_merge_overlap);
  const selectedCardKey = useUiStore((s) => s.selectedCardKey);
  const attachedAddress = useUiStore((s) => s.attachedAddress);
  const setSelectedCardKey = useUiStore((s) => s.setSelectedCardKey);
  const setSelectedAddress = useUiStore((s) => s.setSelectedAddress);
  const setAttachedAddress = useUiStore((s) => s.setAttachedAddress);
  const rememberCardSession = useUiStore((s) => s.rememberCardSession);
  const setLaunchTarget = useUiStore((s) => s.setLaunchTarget);
  const setDiffTarget = useUiStore((s) => s.setDiffTarget);
  const setTeardownTarget = useUiStore((s) => s.setTeardownTarget);
  const showToast = useUiStore((s) => s.showToast);

  const isSelected = selectedCardKey === cardKey;
  const isAttached = Boolean(
    attachedAddress && sessions.some((s) => s.address === attachedAddress)
  );
  const bucket = session?.bucket ?? "idle";
  const isStandby = !session || bucket === "idle";

  const lastLine = (() => {
    if (!session) return "대기 중 · Ctrl+` 또는 더블클릭으로 시작";
    if (session.terminal.status?.msg) return session.terminal.status.msg;
    if (session.previewLines.length > 0) {
      return session.previewLines[session.previewLines.length - 1];
    }
    return bucket === "running" ? "작업 진행 중..." : "응답 준비 완료";
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
        name: `${project.name}-${worktree.branch.replace(/[/\\ ]/g, "-")}`,
        autonomous: true,
      });
      useAppStore
        .getState()
        .recordLastAgent(normalizePath(worktree.path), argv);
      if (addr) {
        setSelectedAddress(addr);
        setAttachedAddress(addr);
      }
    } catch (err) {
      showToast(`AI 시작 실패: ${String(err)}`, "error");
    }
  };

  // Organic 18px squircle surface driven purely by theme CSS tokens (No rigid vertical bar, Zero-Blur!)
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
      background =
        isSelected || isAttached ? "var(--card-bg)" : "var(--card-idle-bg)";
      border =
        isSelected || isAttached
          ? "1px solid var(--accent-border)"
          : "1px dashed var(--card-idle-border)";
    }

    return {
      background,
      border,
      boxShadow:
        isSelected || isAttached
          ? "var(--card-selected-shadow)"
          : "var(--card-shadow)",
    };
  })();

  return (
    <div
      data-jjdr-card={cardKey}
      data-jjdr-session-addr={attachTarget?.address ?? session?.address ?? ""}
      data-jjdr-project-id={project.id}
      data-jjdr-worktree-path={worktree.path}
      data-jjdr-branch={worktree.branch}
      onClick={() => {
        setSelectedCardKey(cardKey);
        setSelectedAddress(attachTarget?.address ?? session?.address ?? null);
        if (attachedAddress) {
          if (attachTarget && isTargetLive) {
            setAttachedAddress(attachTarget.address);
            rememberCardSession(cardKey, attachTarget.address);
          } else {
            void launchSession({
              project_id: project.id,
              cwd: worktree.path,
              branch: worktree.branch,
              argv: [],
              name: `${project.name}-${(worktree.branch || "main").replace(
                /[/\\ ]/g,
                "-"
              )}-sh`,
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
      style={tileStyle}
      className="jjdr-card-lift group relative rounded-[18px] p-3.5 cursor-pointer select-none flex flex-col justify-between gap-2 min-w-0"
    >
      {/* Row 1: Organic Status Pill + Branch + Soft Metadata */}
      <div className="flex items-center justify-between gap-1.5 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          {session ? (
            <StatusBadge
              bucket={session.bucket}
              status={session.terminal.status}
              isStuck={session.isStuck}
              stuckMinutes={session.stuckMinutes}
            />
          ) : (
            <StatusBadge bucket="idle" />
          )}

          <span
            className="text-[13px] font-mono-code font-bold truncate"
            style={{
              color:
                isStandby && !isSelected && !isAttached
                  ? "var(--text-secondary)"
                  : "var(--text-primary)",
            }}
          >
            {worktree.branch || "(detached)"}
          </span>

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

        {/* Right Aligned Metrics & Hover Pill Actions */}
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
              className="inline-flex items-center gap-1 font-semibold hover:underline cursor-pointer"
            >
              <span style={{ color: "var(--ready-fg)" }}>
                +{worktree.added_lines}
              </span>
              <span style={{ color: "var(--action-fg)" }}>
                -{worktree.deleted_lines}
              </span>
            </button>
          )}

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
                className="p-1 rounded-full hover:bg-black/15 cursor-pointer"
                style={{ color: "var(--text-secondary)" }}
              >
                <FileDiff className="w-3.5 h-3.5" />
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
                title="Teardown worktree"
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
                    if (isAttached) setAttachedAddress(null);
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

        {session && isLive && bucket === "needs_you" && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void sendTerminalKeys(session.address, ["enter"]);
            }}
            title="Approve (Enter)"
            className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-semibold shrink-0 cursor-pointer transition-opacity hover:opacity-90"
            style={{
              background: "var(--action-fg)",
              color: "#ffffff",
            }}
          >
            <Check className="w-3 h-3" />
            승인
          </button>
        )}
      </div>
    </div>
  );
});
