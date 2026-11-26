import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Columns3,
  FolderPlus,
  Rows3,
  X,
} from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import { ProjectTray } from "./ProjectTray";
import { ExternalShellTray } from "./ExternalShellTray";
import { StatusBadge } from "../shared/StatusBadge";
import { normalizePath } from "../../workers/dashboardLogic";
import { getRadarDensityPreset } from "../../utils/themes";
import { pickPreferredWorktreeSession } from "../../utils/worktreeSessions";
import {
  getRadarColumnWidthPx,
  getRadarFocusedColumnWidthPx,
  MAX_RADAR_COLUMN_WIDTH_PX,
  MIN_RADAR_COLUMN_WIDTH_PX,
  pickPreferredCellForLane,
  RADAR_COLUMN_WIDTH_STEP_PX,
  resolveFocusedRadarColumn,
  type RadarLayoutMode,
} from "../../utils/radarLayout";

const MIN_CARD_WIDTH_PX = 215;

export const RadarBoardView = React.memo(function RadarBoardView() {
  const matrixLanes = useAppStore((s) => s.computed.matrixLanes);
  const unassigned = useAppStore((s) => s.computed.unassignedSessions);
  const allSessions = useAppStore((s) => s.computed.allSessions);
  const projects = useAppStore((s) => s.projects);
  const worktreeMeta = useAppStore((s) => s.worktreeMeta);
  const radarDensity = useAppStore((s) => s.settings.radar_density);
  const rootCardMode = useAppStore(
    (s) => s.settings.root_card_mode ?? "header_chip"
  );

  const layoutMode = useUiStore((s) => s.radarLayoutMode);
  const setRadarLayoutMode = useUiStore((s) => s.setRadarLayoutMode);
  const radarColumnWidthPx = useUiStore((s) => s.radarColumnWidthPx);
  const setRadarColumnWidthPx = useUiStore((s) => s.setRadarColumnWidthPx);
  const setRadarFocusSlideDir = useUiStore((s) => s.setRadarFocusSlideDir);
  const selectedProjectId = useUiStore((s) => s.selectedProjectId);
  const selectedCardKey = useUiStore((s) => s.selectedCardKey);
  const attachedAddress = useUiStore((s) => s.attachedAddress);
  const searchQuery = useUiStore((s) => s.searchQuery);
  const activeGroup = useUiStore((s) => s.activeGroup);
  const terminalDrawerOpen = useUiStore((s) => s.terminalDrawerOpen);
  const terminalWidthPx = useUiStore((s) => s.terminalWidthPx);
  const clearFilters = useUiStore((s) => s.clearFilters);
  const setProjectModalProject = useUiStore((s) => s.setProjectModalProject);
  const setSelectedCardKey = useUiStore((s) => s.setSelectedCardKey);
  const setSelectedAddress = useUiStore((s) => s.setSelectedAddress);
  const setAttachedAddress = useUiStore((s) => s.setAttachedAddress);
  const detachToEmptyDrawer = useUiStore((s) => s.detachToEmptyDrawer);
  const closeTerminalDrawer = useUiStore((s) => s.closeTerminalDrawer);
  const rememberCardSession = useUiStore((s) => s.rememberCardSession);
  const requestTerminalFocus = useUiStore((s) => s.requestTerminalFocus);

  const boardRef = useRef<HTMLDivElement>(null);
  const columnsTrackRef = useRef<HTMLDivElement>(null);
  const [boardWidth, setBoardWidth] = useState<number>(1280);
  const [focusWidthSettled, setFocusWidthSettled] = useState(false);

  const isDrawerOpen = terminalDrawerOpen || Boolean(attachedAddress);
  const isColumns = layoutMode === "columns";
  const isColumnsFocusMode = isColumns && isDrawerOpen;

  const handleSetLayoutMode = useCallback(
    (next: RadarLayoutMode) => {
      setRadarLayoutMode(next);
    },
    [setRadarLayoutMode]
  );

  useEffect(() => {
    if (!isColumnsFocusMode) {
      setFocusWidthSettled(false);
      return;
    }
    const raf = requestAnimationFrame(() => setFocusWidthSettled(true));
    return () => cancelAnimationFrame(raf);
  }, [isColumnsFocusMode]);

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const update = () => {
      if (el.clientWidth > 0) setBoardWidth(el.clientWidth);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Auto-pan selected card into view horizontally/vertically whenever right terminal opens or layout switches
  useEffect(() => {
    if (!selectedCardKey) return;
    const rafId = requestAnimationFrame(() => {
      const cardEl = document.querySelector<HTMLElement>(
        `[data-jjdr-card="${CSS.escape(selectedCardKey)}"]`
      );
      cardEl?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: "smooth",
      });
    });
    return () => cancelAnimationFrame(rafId);
  }, [terminalDrawerOpen, layoutMode, selectedCardKey]);

  // Smooth horizontal wheel scrolling on the Columns track (Shift+Wheel anywhere, or plain Wheel on non-scrollable vertical area)
  const handleColumnsWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      const track = columnsTrackRef.current;
      if (!track || track.scrollWidth <= track.clientWidth) return;
      if (e.shiftKey && Math.abs(e.deltaY) > 0) {
        e.preventDefault();
        track.scrollLeft += e.deltaY;
        return;
      }
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        const target = e.target as HTMLElement | null;
        const verticalScroller = target?.closest<HTMLElement>(
          "[data-radar-col-scroll='true']"
        );
        const canScrollVert =
          verticalScroller &&
          verticalScroller.scrollHeight > verticalScroller.clientHeight + 2;
        if (!canScrollVert) {
          track.scrollLeft += e.deltaY;
        }
      }
    },
    []
  );

  const densityPreset = useMemo(
    () => getRadarDensityPreset(radarDensity),
    [radarDensity]
  );

  const desiredCols = terminalDrawerOpen
    ? densityPreset.terminalCols
    : densityPreset.normalCols;

  const innerWidth = Math.max(240, boardWidth - 68);
  const maxFitCols = Math.max(
    1,
    Math.floor((innerWidth + 12) / MIN_CARD_WIDTH_PX)
  );
  const activeCols = Math.min(desiredCols, maxFitCols);
  const columnWidthPx = useMemo(
    () => getRadarColumnWidthPx(radarDensity, radarColumnWidthPx),
    [radarDensity, radarColumnWidthPx]
  );
  const focusedColumnWidthPx = useMemo(
    () => getRadarFocusedColumnWidthPx(radarDensity, radarColumnWidthPx),
    [radarDensity, radarColumnWidthPx]
  );

  const focusedColumn = useMemo(
    () =>
      isColumnsFocusMode
        ? resolveFocusedRadarColumn({
            lanes: matrixLanes,
            unassigned,
            allSessions,
            attachedAddress,
            selectedCardKey,
            selectedProjectId,
          })
        : null,
    [
      isColumnsFocusMode,
      matrixLanes,
      unassigned,
      allSessions,
      attachedAddress,
      selectedCardKey,
      selectedProjectId,
    ]
  );

  const focusedLane = useMemo(() => {
    if (focusedColumn?.kind !== "project") return null;
    return (
      matrixLanes.find((lane) => lane.project.id === focusedColumn.projectId) ??
      null
    );
  }, [focusedColumn, matrixLanes]);

  const handleFocusProject = useCallback(
    (projectId: string) => {
      const lane = matrixLanes.find((l) => l.project.id === projectId);
      if (!lane) return;
      const cell = pickPreferredCellForLane(lane);
      if (!cell) return;
      const cardKey = `wt::${lane.project.id}::${normalizePath(cell.worktree.path)}`;
      const remembered =
        useUiStore.getState().lastSessionByCardKey[cardKey] ?? null;
      const target = pickPreferredWorktreeSession(cell.sessions, remembered);
      setSelectedCardKey(cardKey);
      setSelectedAddress(target?.address ?? null);
      if (target && target.terminal.state === "live") {
        setAttachedAddress(target.address);
        rememberCardSession(cardKey, target.address);
        requestTerminalFocus();
      } else {
        detachToEmptyDrawer();
      }
    },
    [
      matrixLanes,
      setSelectedCardKey,
      setSelectedAddress,
      setAttachedAddress,
      rememberCardSession,
      requestTerminalFocus,
      detachToEmptyDrawer,
    ]
  );

  const handleFocusExternal = useCallback(() => {
    if (unassigned.length === 0) return;
    const target =
      unassigned.find((s) => s.bucket === "needs_you") ??
      unassigned.find((s) => s.bucket === "ready") ??
      unassigned.find((s) => s.bucket === "running") ??
      unassigned[0];
    const cardKey = `ext::${target.address}`;
    setSelectedCardKey(cardKey);
    setSelectedAddress(target.address);
    if (target.terminal.state === "live") {
      setAttachedAddress(target.address);
      requestTerminalFocus();
    } else {
      detachToEmptyDrawer();
    }
  }, [
    unassigned,
    setSelectedCardKey,
    setSelectedAddress,
    setAttachedAddress,
    requestTerminalFocus,
    detachToEmptyDrawer,
  ]);

  const focusNavTargets = useMemo(
    () => [
      ...matrixLanes.map((l) => ({
        kind: "project" as const,
        projectId: l.project.id,
        label: l.project.name,
      })),
      ...(unassigned.length > 0
        ? [{ kind: "external" as const, label: "Shells & External" }]
        : []),
    ],
    [matrixLanes, unassigned.length]
  );

  const focusedNavIndex = useMemo(() => {
    if (!focusedColumn) return -1;
    return focusNavTargets.findIndex((t) => {
      if (t.kind !== focusedColumn.kind) return false;
      if (t.kind === "project" && focusedColumn.kind === "project") {
        return t.projectId === focusedColumn.projectId;
      }
      return true;
    });
  }, [focusNavTargets, focusedColumn]);

  const canCycleFocus = focusNavTargets.length > 1;
  const prevFocusTarget =
    canCycleFocus && focusedNavIndex >= 0
      ? focusNavTargets[
          (focusedNavIndex - 1 + focusNavTargets.length) % focusNavTargets.length
        ]
      : null;
  const nextFocusTarget =
    canCycleFocus && focusedNavIndex >= 0
      ? focusNavTargets[(focusedNavIndex + 1) % focusNavTargets.length]
      : null;

  const handleStepFocusedColumn = useCallback(
    (delta: -1 | 1) => {
      if (focusNavTargets.length <= 1) return;
      const curIdx = focusedNavIndex >= 0 ? focusedNavIndex : 0;
      const next =
        focusNavTargets[
          (curIdx + delta + focusNavTargets.length) % focusNavTargets.length
        ];
      if (!next) return;
      setRadarFocusSlideDir(delta > 0 ? "next" : "prev");
      if (next.kind === "project") {
        handleFocusProject(next.projectId);
      } else {
        handleFocusExternal();
      }
    },
    [
      focusNavTargets,
      focusedNavIndex,
      setRadarFocusSlideDir,
      handleFocusProject,
      handleFocusExternal,
    ]
  );

  const focusedColumnKey =
    focusedColumn?.kind === "project"
      ? `project:${focusedColumn.projectId}`
      : focusedColumn?.kind === "external"
      ? "external"
      : "";

  const prevFocusMetaRef = useRef<{ key: string; index: number } | null>(null);
  const activeSlideDirRef = useRef<"next" | "prev" | null>(null);

  if (!isColumnsFocusMode || !focusedColumnKey) {
    prevFocusMetaRef.current = null;
    activeSlideDirRef.current = null;
  } else if (prevFocusMetaRef.current === null) {
    prevFocusMetaRef.current = { key: focusedColumnKey, index: focusedNavIndex };
    activeSlideDirRef.current = null;
  } else if (prevFocusMetaRef.current.key !== focusedColumnKey) {
    const explicitDir = useUiStore.getState().radarFocusSlideDir;
    if (explicitDir) {
      activeSlideDirRef.current = explicitDir;
    } else if (focusedNavIndex >= 0 && prevFocusMetaRef.current.index >= 0) {
      activeSlideDirRef.current =
        focusedNavIndex > prevFocusMetaRef.current.index ? "next" : "prev";
    } else {
      activeSlideDirRef.current = "next";
    }
    prevFocusMetaRef.current = { key: focusedColumnKey, index: focusedNavIndex };
  }

  useEffect(() => {
    if (useUiStore.getState().radarFocusSlideDir !== null) {
      setRadarFocusSlideDir(null);
    }
  }, [focusedColumnKey, setRadarFocusSlideDir]);

  const focusSlideClass =
    activeSlideDirRef.current === "next"
      ? "jjdr-focus-slide-next"
      : activeSlideDirRef.current === "prev"
      ? "jjdr-focus-slide-prev"
      : "";

  // Derive "Needs Attention" ribbon strictly from visible Radar board cards (1:1 parity)
  const actionableCards = useMemo(() => {
    const items: Array<{
      cardKey: string;
      address: string;
      bucket: "needs_you" | "ready";
      projectName: string;
      label: string;
      isLive: boolean;
      status: import("../../types/domain").StatusInfo | null | undefined;
      isStuck: boolean;
      stuckMinutes: number;
    }> = [];

    for (const lane of matrixLanes) {
      for (const cell of lane.cells) {
        if (cell.topBucket !== "needs_you" && cell.topBucket !== "ready") {
          continue;
        }
        const primary =
          cell.sessions.find((s) => s.bucket === cell.topBucket) ??
          cell.sessions[0];
        if (!primary) continue;
        const normPath = normalizePath(cell.worktree.path);
        const customName = worktreeMeta[normPath]?.display_name?.trim();
        items.push({
          cardKey: `wt::${lane.project.id}::${normPath}`,
          address: primary.address,
          bucket: cell.topBucket,
          projectName: lane.project.name,
          label: customName || cell.worktree.branch || "(detached)",
          isLive: primary.terminal.state === "live",
          status: primary.terminal.status,
          isStuck: primary.isStuck,
          stuckMinutes: primary.stuckMinutes,
        });
      }
    }

    for (const s of unassigned) {
      if (s.bucket !== "needs_you" && s.bucket !== "ready") continue;
      items.push({
        cardKey: `ext::${s.address}`,
        address: s.address,
        bucket: s.bucket,
        projectName: s.projectName,
        label: s.terminal.name || s.branch,
        isLive: s.terminal.state === "live",
        status: s.terminal.status,
        isStuck: s.isStuck,
        stuckMinutes: s.stuckMinutes,
      });
    }

    items.sort((a, b) => {
      if (a.bucket !== b.bucket) return a.bucket === "needs_you" ? -1 : 1;
      return 0;
    });
    return items;
  }, [matrixLanes, unassigned, worktreeMeta]);

  const firstCardInfo = useMemo(() => {
    for (const lane of matrixLanes) {
      if (lane.cells.length > 0) {
        const nonRoot = lane.cells.find((item) => !item.worktree.is_main);
        const c =
          rootCardMode !== "card" && nonRoot ? nonRoot : lane.cells[0];
        return {
          key: `wt::${lane.project.id}::${normalizePath(c.worktree.path)}`,
          addr: c.sessions[0]?.address ?? null,
        };
      }
    }
    return null;
  }, [matrixLanes, rootCardMode]);

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
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4"
          style={{
            background: "var(--pill-bg)",
            border: "1px solid var(--pill-border)",
            color: "var(--text-secondary)",
          }}
        >
          <FolderPlus className="w-5 h-5" />
        </div>
        <h2
          className="text-sm font-bold"
          style={{ color: "var(--text-primary)" }}
        >
          No Projects Registered
        </h2>
        <p
          className="mt-1.5 text-xs max-w-sm leading-relaxed"
          style={{ color: "var(--text-muted)" }}
        >
          Add a Git repository to monitor all worktrees and AI sessions from one board.
        </p>
        <button
          onClick={() => setProjectModalProject("new")}
          className="jjdr-primary-btn mt-5 px-4 py-2 rounded-full text-xs font-semibold shadow-sm transition-opacity cursor-pointer"
        >
          + Add Git Project
        </button>
      </div>
    );
  }

  const isAutoFocusWidth = isColumnsFocusMode && terminalWidthPx === null;
  const focusExtraPx = canCycleFocus ? 84 : 32;
  const focusMaxRatio = focusedColumnWidthPx > 400 ? "54%" : "46%";
  const boardStyle: React.CSSProperties | undefined = isAutoFocusWidth
    ? {
        width: focusWidthSettled
          ? `min(${focusedColumnWidthPx + focusExtraPx}px, ${focusMaxRatio})`
          : `${columnWidthPx + focusExtraPx}px`,
      }
    : undefined;

  return (
    <div
      ref={boardRef}
      style={boardStyle}
      className={`${
        isAutoFocusWidth
          ? "shrink-0 min-w-[280px] transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]"
          : "flex-1 min-w-[280px]"
      } h-full min-h-0 flex flex-col ${
        isColumnsFocusMode
          ? "px-2.5 pt-3.5 pb-4 gap-2.5 overflow-hidden"
          : isColumns
          ? "px-5 pt-4 pb-4 gap-3 overflow-hidden"
          : "px-5 pt-4 pb-10 gap-3.5 overflow-y-auto"
      }`}
    >
      {/* Top Bar: Soft Attention Ribbon (left) + Columns/Rows Layout Switcher (right) */}
      <div
        className={`flex items-center justify-between gap-2 flex-wrap shrink-0 select-none ${
          isColumnsFocusMode ? "px-1.5" : ""
        }`}
      >
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {isColumnsFocusMode && (
            <button
              type="button"
              onClick={closeTerminalDrawer}
              className="jjdr-pill inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold shrink-0 cursor-pointer transition-colors"
              style={{ color: "var(--text-secondary)" }}
              title="Show all project columns (Esc)"
            >
              <ArrowLeft className="w-3 h-3" />
              <span>All</span>
            </button>
          )}
          {actionableCards.length > 0 ? (
            <>
              <span
                className="text-[11px] font-semibold mr-0.5"
                style={{ color: "var(--text-faint)" }}
              >
                Needs Attention ({actionableCards.length})
              </span>
              {actionableCards.map((item) => {
                const isAction = item.bucket === "needs_you";
                return (
                  <button
                    key={item.cardKey}
                    onClick={() => {
                      setSelectedCardKey(item.cardKey);
                      setSelectedAddress(item.address);
                      if (item.isLive) {
                        setAttachedAddress(item.address);
                        requestTerminalFocus();
                      }
                      const cardEl = document.querySelector<HTMLElement>(
                        `[data-jjdr-card="${CSS.escape(item.cardKey)}"]`
                      );
                      cardEl?.scrollIntoView({
                        block: "nearest",
                        inline: "nearest",
                        behavior: "smooth",
                      });
                    }}
                    className="jjdr-card-lift inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs cursor-pointer"
                    style={{
                      background: isAction
                        ? "var(--action-soft)"
                        : "var(--ready-soft)",
                      border: `1px solid ${
                        isAction ? "var(--action-border)" : "var(--ready-border)"
                      }`,
                      color: "var(--text-primary)",
                    }}
                  >
                    <StatusBadge
                      bucket={item.bucket}
                      status={item.status}
                      isStuck={item.isStuck}
                      stuckMinutes={item.stuckMinutes}
                      compact
                    />
                    <span style={{ color: "var(--text-secondary)" }}>
                      {item.projectName}
                    </span>
                    <span className="font-mono-code font-semibold">
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </>
          ) : (
            <span
              className="text-[11px] font-semibold font-mono-code tabular-nums"
              style={{ color: "var(--text-faint)" }}
            >
              {isColumnsFocusMode
                ? canCycleFocus && focusedNavIndex >= 0
                  ? `${focusedNavIndex + 1} / ${focusNavTargets.length}`
                  : "Focus"
                : `Radar · ${matrixLanes.length} ${
                    matrixLanes.length === 1 ? "Project" : "Projects"
                  }`}
            </span>
          )}
        </div>

        {/* Right Controls: Columns Width Slider (Overview) + Columns | Rows Switcher */}
        <div className="flex items-center gap-2 shrink-0">
          {isColumns && !isColumnsFocusMode && (
            <div
              className="jjdr-pill inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full text-[11px]"
              title="Adjust project column width (210px – 560px, saved locally)"
            >
              <span
                className="font-mono-code tabular-nums text-[10px]"
                style={{ color: "var(--text-muted)" }}
              >
                {columnWidthPx}px
              </span>
              <input
                type="range"
                min={MIN_RADAR_COLUMN_WIDTH_PX}
                max={MAX_RADAR_COLUMN_WIDTH_PX}
                step={RADAR_COLUMN_WIDTH_STEP_PX}
                value={columnWidthPx}
                onChange={(e) => setRadarColumnWidthPx(Number(e.target.value))}
                aria-label="Radar column width"
                className="w-24 h-1 cursor-pointer accent-[var(--accent)]"
              />
              {radarColumnWidthPx !== null && (
                <button
                  type="button"
                  onClick={() => setRadarColumnWidthPx(null)}
                  className="text-[10px] font-semibold hover:underline cursor-pointer"
                  style={{ color: "var(--accent)" }}
                  title="Reset to density preset width"
                >
                  Auto
                </button>
              )}
            </div>
          )}

          {/* Columns | Rows Layout Switcher (persisted in localStorage) */}
          <div
            className="jjdr-pill inline-flex items-center rounded-full p-0.5 text-[11px] shrink-0"
            title="Switch Radar layout (saved locally)"
          >
            <button
              type="button"
              onClick={() => handleSetLayoutMode("columns")}
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full cursor-pointer transition-colors ${
                isColumns ? "jjdr-pill-active font-semibold" : ""
              }`}
              style={isColumns ? undefined : { color: "var(--text-muted)" }}
              title="Vertical project columns (focuses single project when terminal opens)"
            >
              <Columns3 className="w-3 h-3" />
              <span>Columns</span>
            </button>
            <button
              type="button"
              onClick={() => handleSetLayoutMode("rows")}
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full cursor-pointer transition-colors ${
                !isColumns ? "jjdr-pill-active font-semibold" : ""
              }`}
              style={!isColumns ? undefined : { color: "var(--text-muted)" }}
              title="Horizontal stacked project rows"
            >
              <Rows3 className="w-3 h-3" />
              <span>Rows</span>
            </button>
          </div>
        </div>
      </div>

      {/* Active Filter Pill Banner */}
      {hasFilter && (
        <div
          className="flex items-center justify-between gap-2 px-4 py-2 rounded-full text-xs shrink-0"
          style={{
            background: "var(--pill-bg)",
            border: "1px solid var(--pill-border)",
          }}
        >
          <span style={{ color: "var(--text-secondary)" }}>
            Filtered
            {selectedProjectId
              ? ` · ${
                  projects.find((p) => p.id === selectedProjectId)?.name ?? ""
                }`
              : ""}
            {searchQuery.trim() ? ` · "${searchQuery.trim()}"` : ""}
            {activeGroup !== "All" ? ` · ${activeGroup}` : ""}
            <span className="ml-2 opacity-65">(Esc to clear)</span>
          </span>
          <button
            onClick={clearFilters}
            className="inline-flex items-center gap-1 hover:underline text-xs font-semibold cursor-pointer"
            style={{ color: "var(--accent)" }}
          >
            <X className="w-3 h-3" />
            Reset
          </button>
        </div>
      )}

      {/* Main Project Trays: Focus Single Column with Side Arrows | Vertical Kanban Columns | Horizontal Stacked Rows */}
      {isColumnsFocusMode ? (
        <div className="flex-1 min-h-0 flex items-stretch gap-1 overflow-hidden pb-0.5">
          {canCycleFocus && (
            <button
              type="button"
              onClick={() => handleStepFocusedColumn(-1)}
              title={`Previous: ${prevFocusTarget?.label ?? ""} (Ctrl+Left)`}
              aria-label={`Previous project: ${prevFocusTarget?.label ?? ""}`}
              className="group w-7 self-stretch shrink-0 flex items-center justify-center cursor-pointer select-none"
            >
              <span
                className="jjdr-pill w-6 h-14 rounded-full inline-flex items-center justify-center transition-transform duration-150 group-hover:scale-105 group-active:scale-95"
                style={{ color: "var(--text-secondary)" }}
              >
                <ChevronLeft className="w-4 h-4" />
              </span>
            </button>
          )}

          <div className="flex-1 min-w-0 h-full min-h-0 overflow-hidden flex">
            <div
              key={focusedColumnKey || "empty"}
              className={`flex-1 min-w-0 h-full min-h-0 flex ${focusSlideClass}`}
            >
              {focusedLane ? (
                <ProjectTray
                  key={focusedLane.project.id}
                  lane={focusedLane}
                  activeCols={1}
                  layout="columns"
                  columnWidthPx={focusedColumnWidthPx}
                  focusedMode
                />
              ) : focusedColumn?.kind === "external" ? (
                <ExternalShellTray
                  unassigned={unassigned}
                  activeCols={1}
                  layout="columns"
                  columnWidthPx={focusedColumnWidthPx}
                  focusedMode
                />
              ) : (
                <div
                  className="flex-1 flex items-center justify-center rounded-[22px] text-xs"
                  style={{
                    border: "1px dashed var(--divider)",
                    color: "var(--text-faint)",
                  }}
                >
                  No matching project cards
                </div>
              )}
            </div>
          </div>

          {canCycleFocus && (
            <button
              type="button"
              onClick={() => handleStepFocusedColumn(1)}
              title={`Next: ${nextFocusTarget?.label ?? ""} (Ctrl+Right)`}
              aria-label={`Next project: ${nextFocusTarget?.label ?? ""}`}
              className="group w-7 self-stretch shrink-0 flex items-center justify-center cursor-pointer select-none"
            >
              <span
                className="jjdr-pill w-6 h-14 rounded-full inline-flex items-center justify-center transition-transform duration-150 group-hover:scale-105 group-active:scale-95"
                style={{ color: "var(--text-secondary)" }}
              >
                <ChevronRight className="w-4 h-4" />
              </span>
            </button>
          )}
        </div>
      ) : isColumns ? (
        <div
          ref={columnsTrackRef}
          onWheel={handleColumnsWheel}
          className="flex-1 min-h-0 flex items-stretch gap-3.5 overflow-x-auto overflow-y-hidden pb-1.5"
        >
          {matrixLanes.map((lane) => (
            <ProjectTray
              key={lane.project.id}
              lane={lane}
              activeCols={1}
              layout="columns"
              columnWidthPx={columnWidthPx}
            />
          ))}

          <ExternalShellTray
            unassigned={unassigned}
            activeCols={1}
            layout="columns"
            columnWidthPx={columnWidthPx}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {matrixLanes.map((lane) => (
            <ProjectTray
              key={lane.project.id}
              lane={lane}
              activeCols={activeCols}
              layout="rows"
              columnWidthPx={columnWidthPx}
            />
          ))}

          <ExternalShellTray
            unassigned={unassigned}
            activeCols={activeCols}
            layout="rows"
            columnWidthPx={columnWidthPx}
          />
        </div>
      )}
    </div>
  );
});
