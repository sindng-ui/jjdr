import React, { useEffect, useMemo } from "react";
import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Plus,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import { RadarTile } from "./RadarTile";
import { StatusBadge } from "../shared/StatusBadge";
import { normalizePath } from "../../workers/dashboardLogic";
import { shortPath } from "../../utils/format";
import { killTerminal, launchSession } from "../../services/tauriBridge";

export const RadarBoardView = React.memo(function RadarBoardView() {
  const matrixLanes = useAppStore((s) => s.computed.matrixLanes);
  const allSessions = useAppStore((s) => s.computed.allSessions);
  const unassigned = useAppStore((s) => s.computed.unassignedSessions);
  const projects = useAppStore((s) => s.projects);

  const selectedProjectId = useUiStore((s) => s.selectedProjectId);
  const selectedCardKey = useUiStore((s) => s.selectedCardKey);
  const searchQuery = useUiStore((s) => s.searchQuery);
  const activeGroup = useUiStore((s) => s.activeGroup);
  const attachedAddress = useUiStore((s) => s.attachedAddress);
  const collapsedProjects = useUiStore((s) => s.collapsedProjects);
  const toggleProjectCollapsed = useUiStore((s) => s.toggleProjectCollapsed);
  const clearFilters = useUiStore((s) => s.clearFilters);
  const setProjectModalProject = useUiStore((s) => s.setProjectModalProject);
  const setCreateWorktreeProjectId = useUiStore((s) => s.setCreateWorktreeProjectId);
  const setSelectedCardKey = useUiStore((s) => s.setSelectedCardKey);
  const setSelectedAddress = useUiStore((s) => s.setSelectedAddress);
  const setAttachedAddress = useUiStore((s) => s.setAttachedAddress);
  const showToast = useUiStore((s) => s.showToast);

  const handleLaunchStandaloneShell = async () => {
    try {
      const addr = await launchSession({
        cwd: "",
        argv: [],
      });
      if (addr) {
        setSelectedCardKey(`ext::${addr}`);
        setSelectedAddress(addr);
        setAttachedAddress(addr);
      }
    } catch (err) {
      showToast(`쉘 실행 실패: ${String(err)}`, "error");
    }
  };

  const actionable = useMemo(
    () =>
      allSessions.filter(
        (s) => s.bucket === "needs_you" || s.bucket === "ready"
      ),
    [allSessions]
  );

  const firstCardInfo = useMemo(() => {
    for (const lane of matrixLanes) {
      if (lane.cells.length > 0) {
        const c = lane.cells[0];
        return {
          key: `wt::${lane.project.id}::${normalizePath(c.worktree.path)}`,
          addr: c.sessions[0]?.address ?? null,
        };
      }
    }
    return null;
  }, [matrixLanes]);

  useEffect(() => {
    if (!selectedCardKey && firstCardInfo) {
      setSelectedCardKey(firstCardInfo.key);
      setSelectedAddress(firstCardInfo.addr);
    }
  }, [selectedCardKey, firstCardInfo, setSelectedCardKey, setSelectedAddress]);

  const hasFilter =
    Boolean(selectedProjectId) ||
    searchQuery.trim().length > 0 ||
    (activeGroup !== "" && activeGroup !== "All");

  if (projects.length === 0 && unassigned.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-11 h-11 rounded-xl bg-[#13161b] border border-[#1e222a] flex items-center justify-center mb-4">
          <FolderPlus className="w-5 h-5 text-[#a1a1aa]" />
        </div>
        <h2 className="text-sm font-semibold text-[#f4f4f5]">
          No projects registered
        </h2>
        <p className="mt-1.5 text-xs text-[#71717a] max-w-sm leading-relaxed">
          Add a Git repository to monitor all worktrees and AI sessions in a calm, unified radar.
        </p>
        <button
          onClick={() => setProjectModalProject("new")}
          className="mt-5 px-4 py-2 rounded-lg text-xs font-medium bg-[#f4f4f5] hover:bg-white text-[#0b0c0e] transition-colors cursor-pointer"
        >
          + Add Git Project
        </button>
      </div>
    );
  }

  const tileGridCls = attachedAddress
    ? "grid-cols-1 xl:grid-cols-2"
    : "grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4";

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
      {/* Subtle Action Pill Strip (only when sessions need attention) */}
      {actionable.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap pb-1">
          <span className="text-[11px] font-medium text-[#71717a] mr-1">
            Attention
          </span>
          {actionable.map((s) => (
            <button
              key={s.address}
              onClick={() => {
                setSelectedAddress(s.address);
                if (s.projectId) {
                  setSelectedCardKey(
                    `wt::${s.projectId}::${normalizePath(s.worktreePath)}`
                  );
                }
                if (s.terminal.state === "live") {
                  setAttachedAddress(s.address);
                }
              }}
              className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#13161b] hover:bg-[#191d24] border border-[#222630] text-xs transition-colors cursor-pointer"
            >
              <StatusBadge bucket={s.bucket} compact />
              <span className="text-[#a1a1aa]">{s.projectName}</span>
              <span className="font-mono-code font-medium text-[#f4f4f5]">
                {s.branch}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Active filter indicator */}
      {hasFilter && (
        <div className="flex items-center justify-between gap-2 px-3.5 py-1.5 rounded-lg bg-[#13161b] border border-[#232731] text-xs">
          <span className="text-[#a1a1aa]">
            Filtered
            {selectedProjectId
              ? ` · ${projects.find((p) => p.id === selectedProjectId)?.name ?? ""}`
              : ""}
            {searchQuery.trim() ? ` · "${searchQuery.trim()}"` : ""}
            {activeGroup !== "All" ? ` · ${activeGroup}` : ""}
          </span>
          <button
            onClick={clearFilters}
            className="inline-flex items-center gap-1 text-[#e4e4e7] hover:underline text-xs font-medium cursor-pointer"
          >
            <X className="w-3 h-3" />
            Reset
          </button>
        </div>
      )}

      {/* Borderless Project Sections (Whitespace + Clean Typography instead of outer boxes!) */}
      {matrixLanes.map(({ project, cells }) => {
        const collapsed = Boolean(collapsedProjects[project.id]);
        const needs = cells.reduce(
          (n, c) => n + c.sessions.filter((s) => s.bucket === "needs_you").length,
          0
        );
        const ready = cells.reduce(
          (n, c) => n + c.sessions.filter((s) => s.bucket === "ready").length,
          0
        );
        const running = cells.reduce(
          (n, c) => n + c.sessions.filter((s) => s.bucket === "running").length,
          0
        );

        return (
          <section key={project.id} className="space-y-2.5">
            <div className="flex items-center justify-between gap-2 px-0.5">
              <button
                type="button"
                onClick={() => toggleProjectCollapsed(project.id)}
                className="group flex items-center gap-2 min-w-0 text-left cursor-pointer"
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: project.color }}
                />
                <span className="text-[13px] font-semibold tracking-tight text-[#f4f4f5] group-hover:text-white">
                  {project.name}
                </span>
                <span className="text-xs text-[#52525b] tabular-nums">
                  {cells.length}
                </span>
                {collapsed ? (
                  <ChevronRight className="w-3.5 h-3.5 text-[#52525b]" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-[#52525b] opacity-0 group-hover:opacity-100 transition-opacity" />
                )}

                <div className="flex items-center gap-2 ml-1 font-mono-code text-[11px] tabular-nums">
                  {needs > 0 && (
                    <span className="inline-flex items-center gap-1 text-[#f87171]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#ef4444]" />
                      {needs}
                    </span>
                  )}
                  {ready > 0 && (
                    <span className="inline-flex items-center gap-1 text-[#34d399]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                      {ready}
                    </span>
                  )}
                  {running > 0 && (
                    <span className="inline-flex items-center gap-1 text-[#fbbf24]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b]" />
                      {running}
                    </span>
                  )}
                </div>
              </button>

              <button
                onClick={() => setCreateWorktreeProjectId(project.id)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-[#71717a] hover:text-[#e4e4e7] hover:bg-[#14171d] transition-colors shrink-0 cursor-pointer"
                title="Create new worktree from current branch"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Worktree</span>
              </button>
            </div>

            {!collapsed && (
              <div className={`grid gap-2.5 ${tileGridCls}`}>
                {cells.map(({ worktree, sessions }) => (
                  <RadarTile
                    key={worktree.path}
                    project={project}
                    worktree={worktree}
                    sessions={sessions}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}

      {/* Borderless Standalone / External Shell Section */}
      <section className="space-y-2.5 pt-2 border-t border-[#161920]">
        <div className="flex items-center justify-between gap-2 px-0.5">
          <div className="flex items-center gap-2 text-xs text-[#71717a]">
            <Terminal className="w-3.5 h-3.5 text-[#52525b]" />
            <span className="font-medium text-[#a1a1aa]">Shells & External</span>
            <span className="text-[#52525b] tabular-nums">
              {unassigned.length}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void handleLaunchStandaloneShell()}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-[#71717a] hover:text-[#e4e4e7] hover:bg-[#14171d] transition-colors cursor-pointer"
            title="Launch new PowerShell terminal"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Shell</span>
          </button>
        </div>

        {unassigned.length > 0 && (
          <div className={`grid gap-2.5 ${tileGridCls}`}>
            {unassigned.map((s) => {
              const extKey = `ext::${s.address}`;
              const isSelected = selectedCardKey === extKey;
              const isAttached = attachedAddress === s.address;
              const surfaceCls = isAttached
                ? "bg-[#181c24] border-[#e4e4e7]/50 ring-1 ring-[#e4e4e7]/20"
                : isSelected
                ? "bg-[#171a22] border-[#d4d4d8]/40 ring-1 ring-[#d4d4d8]/15"
                : "bg-[#13161b] border-[#1e222a] hover:bg-[#161a21] hover:border-[#282d38] opacity-75 hover:opacity-100";

              return (
                <div
                  key={s.address}
                  data-jjdr-card={extKey}
                  data-jjdr-session-addr={s.address}
                  onClick={() => {
                    setSelectedCardKey(extKey);
                    setSelectedAddress(s.address);
                    if (attachedAddress && s.terminal.state === "live") {
                      setAttachedAddress(s.address);
                    }
                  }}
                  onDoubleClick={() => {
                    setSelectedCardKey(extKey);
                    setSelectedAddress(s.address);
                    if (s.terminal.state === "live") {
                      setAttachedAddress(s.address);
                    }
                  }}
                  className={`group rounded-lg border px-3.5 py-2.5 flex items-center justify-between gap-2 cursor-pointer select-none transition-all ${surfaceCls}`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <StatusBadge bucket={s.bucket} compact />
                      <span className="text-xs font-mono-code font-medium text-[#e4e4e7] truncate">
                        {s.terminal.name || s.address}
                      </span>
                    </div>
                    <div className="mt-1 text-xs font-mono-code text-[#6b7280] truncate">
                      {s.agentLabel} · {shortPath(s.worktreePath)}
                    </div>
                  </div>
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1 shrink-0"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        void killTerminal(s.address, true);
                        if (isAttached) setAttachedAddress(null);
                      }}
                      title="Close terminal"
                      className="hidden group-hover:inline-flex p-1 rounded hover:bg-[#2c191d] text-[#71717a] hover:text-[#f87171] cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
});
