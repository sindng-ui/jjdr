import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { getRadarDensityPreset } from "../../utils/themes";
import { killTerminal, launchSession } from "../../services/tauriBridge";

const MIN_CARD_WIDTH_PX = 215;

export const RadarBoardView = React.memo(function RadarBoardView() {
  const matrixLanes = useAppStore((s) => s.computed.matrixLanes);
  const allSessions = useAppStore((s) => s.computed.allSessions);
  const unassigned = useAppStore((s) => s.computed.unassignedSessions);
  const projects = useAppStore((s) => s.projects);
  const radarDensity = useAppStore((s) => s.settings.radar_density);

  const selectedProjectId = useUiStore((s) => s.selectedProjectId);
  const selectedCardKey = useUiStore((s) => s.selectedCardKey);
  const searchQuery = useUiStore((s) => s.searchQuery);
  const activeGroup = useUiStore((s) => s.activeGroup);
  const attachedAddress = useUiStore((s) => s.attachedAddress);
  const collapsedProjects = useUiStore((s) => s.collapsedProjects);
  const toggleProjectCollapsed = useUiStore((s) => s.toggleProjectCollapsed);
  const clearFilters = useUiStore((s) => s.clearFilters);
  const setProjectModalProject = useUiStore((s) => s.setProjectModalProject);
  const setCreateWorktreeProjectId = useUiStore(
    (s) => s.setCreateWorktreeProjectId
  );
  const setSelectedCardKey = useUiStore((s) => s.setSelectedCardKey);
  const setSelectedAddress = useUiStore((s) => s.setSelectedAddress);
  const setAttachedAddress = useUiStore((s) => s.setAttachedAddress);
  const showToast = useUiStore((s) => s.showToast);

  const boardRef = useRef<HTMLDivElement>(null);
  const [boardWidth, setBoardWidth] = useState<number>(1280);

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

  const densityPreset = useMemo(
    () => getRadarDensityPreset(radarDensity),
    [radarDensity]
  );

  const desiredCols = attachedAddress
    ? densityPreset.terminalCols
    : densityPreset.normalCols;

  // Clamp gracefully only when the window itself is too narrow to prevent card clipping
  const innerWidth = Math.max(240, boardWidth - 48);
  const maxFitCols = Math.max(1, Math.floor((innerWidth + 14) / MIN_CARD_WIDTH_PX));
  const activeCols = Math.min(desiredCols, maxFitCols);
  const singleSlotWidth = (innerWidth - (activeCols - 1) * 14) / activeCols;
  const compactSingleHeader = singleSlotWidth < 310;

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
          등록된 프로젝트가 없습니다
        </h2>
        <p
          className="mt-1.5 text-xs max-w-sm leading-relaxed"
          style={{ color: "var(--text-muted)" }}
        >
          Git 저장소를 추가하면 모든 Worktree와 AI 세션을 한눈에 쾌적하게 관제할 수 있습니다.
        </p>
        <button
          onClick={() => setProjectModalProject("new")}
          className="jjdr-primary-btn mt-5 px-4 py-2 rounded-full text-xs font-semibold shadow-sm transition-opacity cursor-pointer"
        >
          + Git 프로젝트 추가
        </button>
      </div>
    );
  }

  const shellSpan = Math.max(1, Math.min(Math.max(1, unassigned.length), activeCols));

  return (
    <div
      ref={boardRef}
      className="flex-1 overflow-y-auto px-5 py-5 space-y-5 min-w-0"
    >
      {/* Floating Soft Attention Ribbon */}
      {actionable.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap px-0.5">
          <span
            className="text-[11px] font-semibold mr-1"
            style={{ color: "var(--text-faint)" }}
          >
            지금 확인
          </span>
          {actionable.map((s) => {
            const isAction = s.bucket === "needs_you";
            return (
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
                className="jjdr-card-lift inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs cursor-pointer"
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
                <StatusBadge bucket={s.bucket} compact />
                <span style={{ color: "var(--text-secondary)" }}>
                  {s.projectName}
                </span>
                <span className="font-mono-code font-semibold">{s.branch}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Active Filter Pill Banner */}
      {hasFilter && (
        <div
          className="flex items-center justify-between gap-2 px-4 py-2 rounded-full text-xs"
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

      {/* Concept A: Soft Bento Project Trays (Auto-packs single/small projects side-by-side!) */}
      <div
        className="grid gap-3.5 items-start"
        style={{
          gridTemplateColumns: `repeat(${activeCols}, minmax(0, 1fr))`,
        }}
      >
        {matrixLanes.map(({ project, cells }) => {
          const collapsed = Boolean(collapsedProjects[project.id]);
          const traySpan = collapsed
            ? 1
            : Math.max(1, Math.min(Math.max(1, cells.length), activeCols));
          const useShortBtn = traySpan === 1 && compactSingleHeader;

          const needs = cells.reduce(
            (n, c) =>
              n + c.sessions.filter((s) => s.bucket === "needs_you").length,
            0
          );
          const ready = cells.reduce(
            (n, c) => n + c.sessions.filter((s) => s.bucket === "ready").length,
            0
          );
          const running = cells.reduce(
            (n, c) =>
              n + c.sessions.filter((s) => s.bucket === "running").length,
            0
          );

          return (
            <section
              key={project.id}
              className="jjdr-tray rounded-[22px] p-3.5 space-y-3 min-w-0"
              style={{
                gridColumn: `span ${traySpan} / span ${traySpan}`,
              }}
            >
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
                    {cells.length}
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
                </button>

                <button
                  onClick={() => setCreateWorktreeProjectId(project.id)}
                  className="jjdr-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors shrink-0 cursor-pointer whitespace-nowrap"
                  style={{ color: "var(--text-secondary)" }}
                  title="새 Worktree 추가 (현재 브랜치 기준)"
                >
                  <Plus className="w-3 h-3" />
                  <span>{useShortBtn ? "WT" : "Worktree"}</span>
                </button>
              </div>

              {!collapsed && (
                <div
                  className="grid gap-3"
                  style={{
                    gridTemplateColumns: `repeat(${traySpan}, minmax(0, 1fr))`,
                  }}
                >
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

        {/* Standalone / External Shell Bento Tray */}
        <section
          className="jjdr-tray rounded-[22px] p-3.5 space-y-3 min-w-0"
          style={{
            gridColumn: `span ${shellSpan} / span ${shellSpan}`,
          }}
        >
          <div className="flex items-center justify-between gap-2 px-0.5">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="w-6 h-6 rounded-[9px] flex items-center justify-center shrink-0"
                style={{
                  background: "var(--pill-bg)",
                  border: "1px solid var(--pill-border)",
                  color: "var(--text-muted)",
                }}
              >
                <Terminal className="w-3 h-3" />
              </span>
              <span
                className="text-[13px] font-bold tracking-tight truncate"
                style={{ color: "var(--text-secondary)" }}
              >
                Shells & External
              </span>
              <span
                className="text-xs font-mono-code tabular-nums shrink-0"
                style={{ color: "var(--text-faint)" }}
              >
                {unassigned.length}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void handleLaunchStandaloneShell()}
              className="jjdr-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors shrink-0 cursor-pointer whitespace-nowrap"
              style={{ color: "var(--text-secondary)" }}
              title="새 PowerShell 터미널 열기"
            >
              <Plus className="w-3 h-3" />
              <span>Shell</span>
            </button>
          </div>

          {unassigned.length > 0 && (
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: `repeat(${shellSpan}, minmax(0, 1fr))`,
              }}
            >
              {unassigned.map((s) => {
                const extKey = `ext::${s.address}`;
                const isSelected = selectedCardKey === extKey;
                const isAttached = attachedAddress === s.address;

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
                    className="jjdr-card-lift group rounded-[18px] p-3.5 flex items-center justify-between gap-2 cursor-pointer select-none min-w-0"
                    style={{
                      background:
                        isSelected || isAttached
                          ? "var(--card-bg)"
                          : "var(--card-idle-bg)",
                      border:
                        isSelected || isAttached
                          ? "1px solid var(--accent-border)"
                          : "1px dashed var(--card-idle-border)",
                      boxShadow:
                        isSelected || isAttached
                          ? "var(--card-selected-shadow)"
                          : "var(--card-shadow)",
                    }}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <StatusBadge bucket={s.bucket} compact />
                        <span
                          className="text-[13px] font-mono-code font-bold truncate"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {s.terminal.name || s.address}
                        </span>
                      </div>
                      <div
                        className="mt-1.5 text-xs font-mono-code truncate"
                        style={{ color: "var(--text-muted)" }}
                      >
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
                        className="hidden group-hover:inline-flex p-1.5 rounded-full hover:bg-black/15 cursor-pointer"
                        style={{ color: "var(--action-fg)" }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
});
