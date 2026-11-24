import React, { useCallback, useMemo, useRef } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import type { MatrixProjectLane } from "../../types/domain";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import { RadarTile } from "./RadarTile";
import { normalizePath } from "../../workers/dashboardLogic";
import { usePointerReorder } from "../../hooks/usePointerReorder";

interface ProjectTrayProps {
  lane: MatrixProjectLane;
  activeCols: number;
}

export const ProjectTray = React.memo(function ProjectTray({
  lane,
  activeCols,
}: ProjectTrayProps) {
  const { project, cells } = lane;
  const collapsed = useUiStore((s) => Boolean(s.collapsedProjects[project.id]));
  const toggleProjectCollapsed = useUiStore((s) => s.toggleProjectCollapsed);
  const setCreateWorktreeProjectId = useUiStore(
    (s) => s.setCreateWorktreeProjectId
  );
  const setProjectWorktreeOrder = useAppStore((s) => s.setProjectWorktreeOrder);

  const gridRef = useRef<HTMLDivElement>(null);
  const cellIds = useMemo(
    () => cells.map((c) => normalizePath(c.worktree.path)),
    [cells]
  );

  const handleReorder = useCallback(
    (nextNormPaths: string[]) => {
      setProjectWorktreeOrder(project.id, nextNormPaths);
    },
    [project.id, setProjectWorktreeOrder]
  );

  const { draggingId, overId, startDrag, shouldSuppressClick } =
    usePointerReorder({
      ids: cellIds,
      containerRef: gridRef,
      onReorder: handleReorder,
      disabled: collapsed || cells.length <= 1,
    });

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
          <span>Worktree</span>
        </button>
      </div>

      {!collapsed && (
        <div
          ref={gridRef}
          className="grid gap-3"
          style={{
            gridTemplateColumns: `repeat(${activeCols}, minmax(0, 1fr))`,
          }}
        >
          {cells.map(({ worktree, sessions }) => {
            const normId = normalizePath(worktree.path);
            return (
              <RadarTile
                key={worktree.path}
                project={project}
                worktree={worktree}
                sessions={sessions}
                isDragging={draggingId === normId}
                isDropTarget={overId === normId && draggingId !== null}
                onDragPointerDown={(e) => startDrag(normId, e)}
                shouldSuppressClick={shouldSuppressClick}
              />
            );
          })}
        </div>
      )}
    </section>
  );
});
