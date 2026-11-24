import React, { useEffect, useMemo, useRef, useState } from "react";
import { FolderPlus, X } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import { ProjectTray } from "./ProjectTray";
import { ExternalShellTray } from "./ExternalShellTray";
import { StatusBadge } from "../shared/StatusBadge";
import { normalizePath } from "../../workers/dashboardLogic";
import { getRadarDensityPreset } from "../../utils/themes";

const MIN_CARD_WIDTH_PX = 215;

export const RadarBoardView = React.memo(function RadarBoardView() {
  const matrixLanes = useAppStore((s) => s.computed.matrixLanes);
  const unassigned = useAppStore((s) => s.computed.unassignedSessions);
  const projects = useAppStore((s) => s.projects);
  const worktreeMeta = useAppStore((s) => s.worktreeMeta);
  const radarDensity = useAppStore((s) => s.settings.radar_density);
  const rootCardMode = useAppStore((s) => s.settings.root_card_mode ?? "header_chip");

  const selectedProjectId = useUiStore((s) => s.selectedProjectId);
  const selectedCardKey = useUiStore((s) => s.selectedCardKey);
  const searchQuery = useUiStore((s) => s.searchQuery);
  const activeGroup = useUiStore((s) => s.activeGroup);
  const terminalDrawerOpen = useUiStore((s) => s.terminalDrawerOpen);
  const clearFilters = useUiStore((s) => s.clearFilters);
  const setProjectModalProject = useUiStore((s) => s.setProjectModalProject);
  const setSelectedCardKey = useUiStore((s) => s.setSelectedCardKey);
  const setSelectedAddress = useUiStore((s) => s.setSelectedAddress);
  const setAttachedAddress = useUiStore((s) => s.setAttachedAddress);
  const requestTerminalFocus = useUiStore((s) => s.requestTerminalFocus);

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

  const desiredCols = terminalDrawerOpen
    ? densityPreset.terminalCols
    : densityPreset.normalCols;

  const innerWidth = Math.max(240, boardWidth - 68);
  const maxFitCols = Math.max(
    1,
    Math.floor((innerWidth + 12) / MIN_CARD_WIDTH_PX)
  );
  const activeCols = Math.min(desiredCols, maxFitCols);

  // Derive "지금 확인" strictly from the actual Radar board cards (1:1 card count parity)
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

  return (
    <div
      ref={boardRef}
      className="flex-1 h-full min-h-0 overflow-y-auto px-5 pt-5 pb-10 space-y-4 min-w-0"
    >
      {/* Floating Soft Attention Ribbon (1:1 synced with visible Radar cards) */}
      {actionableCards.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap px-0.5">
          <span
            className="text-[11px] font-semibold mr-1"
            style={{ color: "var(--text-faint)" }}
          >
            지금 확인 ({actionableCards.length})
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
                  cardEl?.scrollIntoView({ block: "nearest", behavior: "smooth" });
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
                <span className="font-mono-code font-semibold">{item.label}</span>
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
            <span className="ml-2 opacity-65">(Esc로 해제)</span>
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

      {/* Vertical Stacked Project Trays (#8: every project occupies its own full-width row) */}
      <div className="flex flex-col gap-4">
        {matrixLanes.map((lane) => (
          <ProjectTray
            key={lane.project.id}
            lane={lane}
            activeCols={activeCols}
          />
        ))}

        <ExternalShellTray unassigned={unassigned} activeCols={activeCols} />
      </div>
    </div>
  );
});
