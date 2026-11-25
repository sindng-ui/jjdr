import React, { useCallback, useMemo, useRef } from "react";
import { ChevronDown, ChevronRight, Home, Plus } from "lucide-react";
import type { MatrixProjectLane } from "../../types/domain";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import { RadarTile } from "./RadarTile";
import { StatusBadge } from "../shared/StatusBadge";
import { normalizePath } from "../../workers/dashboardLogic";
import { usePointerReorder } from "../../hooks/usePointerReorder";
import { pickPreferredWorktreeSession } from "../../utils/worktreeSessions";
import { launchSession } from "../../services/tauriBridge";
import type { RadarLayoutMode } from "../../utils/radarLayout";

interface ProjectTrayProps {
  lane: MatrixProjectLane;
  activeCols: number;
  layout?: RadarLayoutMode;
  columnWidthPx?: number;
  focusedMode?: boolean;
}

export const ProjectTray = React.memo(function ProjectTray({
  lane,
  activeCols,
  layout = "rows",
  columnWidthPx = 276,
  focusedMode = false,
}: ProjectTrayProps) {
  const { project, cells } = lane;
  const collapsed = useUiStore((s) => Boolean(s.collapsedProjects[project.id]));
  const toggleProjectCollapsed = useUiStore((s) => s.toggleProjectCollapsed);
  const setCreateWorktreeProjectId = useUiStore(
    (s) => s.setCreateWorktreeProjectId
  );
  const setSelectedCardKey = useUiStore((s) => s.setSelectedCardKey);
  const setSelectedAddress = useUiStore((s) => s.setSelectedAddress);
  const setAttachedAddress = useUiStore((s) => s.setAttachedAddress);
  const detachToEmptyDrawer = useUiStore((s) => s.detachToEmptyDrawer);
  const rememberCardSession = useUiStore((s) => s.rememberCardSession);
  const setContextMenu = useUiStore((s) => s.setContextMenu);
  const requestTerminalFocus = useUiStore((s) => s.requestTerminalFocus);
  const showToast = useUiStore((s) => s.showToast);

  const rootCardMode = useAppStore(
    (s) => s.settings.root_card_mode ?? "header_chip"
  );
  const setProjectWorktreeOrder = useAppStore((s) => s.setProjectWorktreeOrder);

  const rootCell = useMemo(
    () => cells.find((c) => c.worktree.is_main) ?? null,
    [cells]
  );
  const nonRootCells = useMemo(
    () => cells.filter((c) => !c.worktree.is_main),
    [cells]
  );

  // When additional worktrees exist, collapse ROOT out of the grid into a compact header chip (or hide it)
  const collapseRootToHeader =
    rootCell !== null && nonRootCells.length > 0 && rootCardMode === "header_chip";
  const hideRootCompletely =
    rootCell !== null && nonRootCells.length > 0 && rootCardMode === "hidden";

  const gridCells = useMemo(
    () =>
      collapseRootToHeader || hideRootCompletely ? nonRootCells : cells,
    [collapseRootToHeader, hideRootCompletely, nonRootCells, cells]
  );

  const rootCardKey = rootCell
    ? `wt::${project.id}::${normalizePath(rootCell.worktree.path)}`
    : null;
  const isRootSelected = useUiStore((s) =>
    Boolean(rootCardKey && s.selectedCardKey === rootCardKey)
  );
  const rootRememberedAddr = useUiStore((s) =>
    rootCardKey ? s.lastSessionByCardKey[rootCardKey] ?? null : null
  );
  const rootAttachTarget = useMemo(
    () =>
      rootCell
        ? pickPreferredWorktreeSession(rootCell.sessions, rootRememberedAddr)
        : null,
    [rootCell, rootRememberedAddr]
  );

  const gridRef = useRef<HTMLDivElement>(null);
  const cellIds = useMemo(
    () => gridCells.map((c) => normalizePath(c.worktree.path)),
    [gridCells]
  );

  const handleReorder = useCallback(
    (nextNormPaths: string[]) => {
      if ((collapseRootToHeader || hideRootCompletely) && rootCell) {
        const rootNorm = normalizePath(rootCell.worktree.path);
        setProjectWorktreeOrder(project.id, [
          rootNorm,
          ...nextNormPaths.filter((p) => p !== rootNorm),
        ]);
      } else {
        setProjectWorktreeOrder(project.id, nextNormPaths);
      }
    },
    [
      collapseRootToHeader,
      hideRootCompletely,
      rootCell,
      project.id,
      setProjectWorktreeOrder,
    ]
  );

  const { draggingId, overId, startDrag, shouldSuppressClick } =
    usePointerReorder({
      ids: cellIds,
      containerRef: gridRef,
      onReorder: handleReorder,
      disabled: collapsed || gridCells.length <= 1,
      mode: "swap",
    });

  const handleClickRootChip = useCallback(() => {
    if (!rootCell || !rootCardKey) return;
    const target = pickPreferredWorktreeSession(
      rootCell.sessions,
      rootRememberedAddr
    );
    setSelectedCardKey(rootCardKey);
    setSelectedAddress(target?.address ?? null);
    const { terminalDrawerOpen, attachedAddress } = useUiStore.getState();
    if (terminalDrawerOpen || attachedAddress) {
      if (target && target.terminal.state === "live") {
        setAttachedAddress(target.address);
        rememberCardSession(rootCardKey, target.address);
        requestTerminalFocus();
      } else {
        detachToEmptyDrawer();
      }
    }
  }, [
    rootCell,
    rootCardKey,
    rootRememberedAddr,
    setSelectedCardKey,
    setSelectedAddress,
    setAttachedAddress,
    rememberCardSession,
    requestTerminalFocus,
    detachToEmptyDrawer,
  ]);

  const handleDoubleClickRootChip = useCallback(async () => {
    if (!rootCell || !rootCardKey) return;
    const target = pickPreferredWorktreeSession(
      rootCell.sessions,
      rootRememberedAddr
    );
    setSelectedCardKey(rootCardKey);
    if (target && target.terminal.state === "live") {
      setSelectedAddress(target.address);
      setAttachedAddress(target.address);
      rememberCardSession(rootCardKey, target.address);
      requestTerminalFocus();
      return;
    }
    try {
      const defaultCmd = project.default_agent || "agy";
      const argv = defaultCmd.split(/\s+/).filter(Boolean);
      const addr = await launchSession({
        project_id: project.id,
        cwd: rootCell.worktree.path,
        branch: rootCell.worktree.branch,
        argv,
        name: `${project.name}-${rootCell.worktree.branch || "main"}`,
        autonomous: true,
      });
      useAppStore
        .getState()
        .recordLastAgent(normalizePath(rootCell.worktree.path), argv);
      if (addr) {
        setSelectedAddress(addr);
        setAttachedAddress(addr);
        rememberCardSession(rootCardKey, addr);
        requestTerminalFocus();
      }
    } catch (err) {
      showToast(`Failed to start AI: ${String(err)}`, "error");
    }
  }, [
    rootCell,
    rootCardKey,
    rootRememberedAddr,
    project,
    setSelectedCardKey,
    setSelectedAddress,
    setAttachedAddress,
    rememberCardSession,
    requestTerminalFocus,
    showToast,
  ]);

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

  const isColumns = layout === "columns";

  // Slim vertical bar when a Kanban column is collapsed (never collapse when solo-focused)
  if (isColumns && collapsed && !focusedMode) {
    return (
      <section
        className="jjdr-tray w-14 shrink-0 h-full rounded-[22px] py-3.5 px-2 flex flex-col items-center justify-between gap-3 select-none"
        title={`${project.name} (${gridCells.length}) · Click to expand`}
      >
        <button
          type="button"
          onClick={() => toggleProjectCollapsed(project.id)}
          className="flex flex-col items-center gap-2.5 cursor-pointer min-h-0 flex-1"
        >
          <span
            className="w-7 h-7 rounded-[10px] flex items-center justify-center text-xs font-bold shrink-0"
            style={{
              backgroundColor: `${project.color}26`,
              color: project.color,
              border: `1px solid ${project.color}42`,
            }}
          >
            {project.name.slice(0, 1).toUpperCase()}
          </span>
          <span
            className="text-[11px] font-mono-code font-bold tabular-nums"
            style={{ color: "var(--text-muted)" }}
          >
            {gridCells.length}
          </span>
          {(needs > 0 || ready > 0 || running > 0) && (
            <div className="flex flex-col items-center gap-1">
              {needs > 0 && (
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: "var(--action-fg)" }}
                />
              )}
              {ready > 0 && (
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: "var(--ready-fg)" }}
                />
              )}
              {running > 0 && (
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: "var(--run-fg)" }}
                />
              )}
            </div>
          )}
          <span
            className="text-xs font-bold tracking-tight truncate max-h-40"
            style={{
              color: "var(--text-secondary)",
              writingMode: "vertical-rl",
            }}
          >
            {project.name}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setCreateWorktreeProjectId(project.id)}
          className="jjdr-pill w-7 h-7 rounded-full inline-flex items-center justify-center cursor-pointer shrink-0"
          style={{ color: "var(--text-secondary)" }}
          title="New Worktree"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </section>
    );
  }

  const rootChipEl =
    collapseRootToHeader && rootCell && rootCardKey ? (
      <button
        type="button"
        data-jjdr-card={rootCardKey}
        data-jjdr-session-addr={rootAttachTarget?.address ?? ""}
        data-jjdr-project-id={project.id}
        data-jjdr-worktree-path={rootCell.worktree.path}
        data-jjdr-branch={rootCell.worktree.branch || ""}
        data-jjdr-unreorderable="true"
        onClick={handleClickRootChip}
        onDoubleClick={() => void handleDoubleClickRootChip()}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const target = pickPreferredWorktreeSession(
            rootCell.sessions,
            rootRememberedAddr
          );
          setSelectedCardKey(rootCardKey);
          setSelectedAddress(target?.address ?? null);
          setContextMenu({
            x: e.clientX,
            y: e.clientY,
            cardKey: rootCardKey,
            project,
            worktree: rootCell.worktree,
            sessions: rootCell.sessions,
          });
        }}
        title={`Project ROOT (${rootCell.worktree.branch || "main"}) · Click or Ctrl+Arrow to focus / Double-click or Enter to launch / Right-click menu`}
        className="jjdr-pill inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono-code transition-colors shrink-0 cursor-pointer whitespace-nowrap"
        style={{
          color: isRootSelected ? "var(--accent)" : "var(--text-muted)",
          borderColor: isRootSelected ? "var(--accent-border)" : undefined,
          background: isRootSelected ? "var(--accent-soft)" : undefined,
          boxShadow: isRootSelected ? "var(--card-selected-shadow)" : undefined,
        }}
      >
        {rootCell.sessions.length > 0 ? (
          <StatusBadge
            bucket={rootCell.topBucket}
            status={rootCell.sessions[0]?.terminal.status}
            isStuck={rootCell.sessions[0]?.isStuck}
            stuckMinutes={rootCell.sessions[0]?.stuckMinutes}
            compact
          />
        ) : (
          <Home className="w-3 h-3 opacity-75" />
        )}
        <span>ROOT</span>
        <span className="opacity-70 max-w-[90px] truncate">
          {rootCell.worktree.branch || "main"}
        </span>
      </button>
    ) : null;

  const statusPillsEl = (
    <div className="flex items-center gap-1 font-mono-code text-[11px] tabular-nums shrink-0">
      {needs > 0 && (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full font-semibold"
          style={{
            background: "var(--action-soft)",
            color: "var(--action-fg)",
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: "var(--action-fg)" }}
          />
          {needs}
        </span>
      )}
      {ready > 0 && (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full font-semibold"
          style={{
            background: "var(--ready-soft)",
            color: "var(--ready-fg)",
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: "var(--ready-fg)" }}
          />
          {ready}
        </span>
      )}
      {running > 0 && (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full font-semibold"
          style={{
            background: "var(--run-soft)",
            color: "var(--run-fg)",
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: "var(--run-fg)" }}
          />
          {running}
        </span>
      )}
    </div>
  );

  if (isColumns) {
    const hasSubHeader = needs > 0 || ready > 0 || running > 0 || Boolean(rootChipEl);
    return (
      <section
        style={focusedMode ? { width: "100%" } : { width: `${columnWidthPx}px` }}
        className="jjdr-tray shrink-0 h-full min-h-0 rounded-[22px] p-3 flex flex-col gap-2.5 min-w-0 transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]"
      >
        {/* Compact 2-Row Sticky Column Header */}
        <div className="shrink-0 space-y-1.5 px-0.5">
          <div className="flex items-center justify-between gap-1.5">
            <button
              type="button"
              onClick={() => {
                if (!focusedMode) toggleProjectCollapsed(project.id);
              }}
              className={`group flex items-center gap-2 min-w-0 text-left ${
                focusedMode ? "cursor-default" : "cursor-pointer"
              }`}
              title={
                focusedMode
                  ? project.name
                  : `${project.name} · Click to collapse column`
              }
            >
              <span
                className="w-6 h-6 rounded-[9px] flex items-center justify-center text-[11px] font-bold shrink-0"
                style={{
                  backgroundColor: `${project.color}26`,
                  color: project.color,
                  border: `1px solid ${project.color}42`,
                }}
              >
                {project.name.slice(0, 1).toUpperCase()}
              </span>
              <span
                className="text-[13px] font-bold tracking-tight truncate"
                style={{ color: "var(--text-primary)" }}
              >
                {project.name}
              </span>
              <span
                className="text-xs font-mono-code tabular-nums shrink-0"
                style={{ color: "var(--text-faint)" }}
              >
                {gridCells.length}
              </span>
              {!focusedMode && (
                <ChevronDown
                  className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  style={{ color: "var(--text-faint)" }}
                />
              )}
            </button>

            <button
              type="button"
              onClick={() => setCreateWorktreeProjectId(project.id)}
              className="jjdr-pill inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium transition-colors shrink-0 cursor-pointer whitespace-nowrap"
              style={{ color: "var(--text-secondary)" }}
              title="New Worktree (based on current branch)"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>

          {hasSubHeader && (
            <div className="flex items-center justify-between gap-1.5 flex-wrap">
              {statusPillsEl}
              {rootChipEl}
            </div>
          )}
        </div>

        {/* Independent Vertical Scroll List (Zero Reflow, outer bleed prevents 2px focus ring clipping) */}
        <div
          ref={gridRef}
          data-radar-col-scroll="true"
          className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2.5 -mx-2 px-2 py-2"
        >
          {gridCells.map(({ worktree, sessions }) => {
            const normId = normalizePath(worktree.path);
            return (
              <RadarTile
                key={worktree.path}
                project={project}
                worktree={worktree}
                sessions={sessions}
                isDragging={draggingId === normId}
                isDropTarget={overId === normId && draggingId !== null}
                onStartDrag={startDrag}
                shouldSuppressClick={shouldSuppressClick}
              />
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <section className="jjdr-tray w-full rounded-[22px] p-3.5 space-y-3 min-w-0">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <button
          type="button"
          onClick={() => toggleProjectCollapsed(project.id)}
          className="group flex items-center gap-2 min-w-0 text-left cursor-pointer"
        >
          <span
            className="w-6 h-6 rounded-[9px] flex items-center justify-center text-[11px] font-bold shrink-0"
            style={{
              backgroundColor: `${project.color}26`,
              color: project.color,
              border: `1px solid ${project.color}42`,
            }}
          >
            {project.name.slice(0, 1).toUpperCase()}
          </span>
          <span
            className="text-[13px] font-bold tracking-tight truncate"
            style={{ color: "var(--text-primary)" }}
            title={project.name}
          >
            {project.name}
          </span>
          <span
            className="text-xs font-mono-code tabular-nums shrink-0"
            style={{ color: "var(--text-faint)" }}
          >
            {gridCells.length}
          </span>
          {collapsed ? (
            <ChevronRight
              className="w-3.5 h-3.5 shrink-0"
              style={{ color: "var(--text-faint)" }}
            />
          ) : (
            <ChevronDown
              className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              style={{ color: "var(--text-faint)" }}
            />
          )}

          {statusPillsEl}
        </button>

        <div className="flex items-center gap-1.5 shrink-0">
          {rootChipEl}

          <button
            onClick={() => setCreateWorktreeProjectId(project.id)}
            className="jjdr-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors shrink-0 cursor-pointer whitespace-nowrap"
            style={{ color: "var(--text-secondary)" }}
            title="New Worktree (based on current branch)"
          >
            <Plus className="w-3 h-3" />
            <span>Worktree</span>
          </button>
        </div>
      </div>

      {!collapsed && (
        <div
          ref={gridRef}
          className="grid gap-3"
          style={{
            gridTemplateColumns: `repeat(${activeCols}, minmax(0, 1fr))`,
          }}
        >
          {gridCells.map(({ worktree, sessions }) => {
            const normId = normalizePath(worktree.path);
            return (
              <RadarTile
                key={worktree.path}
                project={project}
                worktree={worktree}
                sessions={sessions}
                isDragging={draggingId === normId}
                isDropTarget={overId === normId && draggingId !== null}
                onStartDrag={startDrag}
                shouldSuppressClick={shouldSuppressClick}
              />
            );
          })}
        </div>
      )}
    </section>
  );
});
