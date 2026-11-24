import React, { useCallback, useMemo, useRef } from "react";
import {
  GitBranchPlus,
  GripVertical,
  Layers,
  Pencil,
  Plus,
  Terminal,
  Trash2,
} from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import { deleteProject, reorderProjects } from "../../services/tauriBridge";
import { usePointerReorder } from "../../hooks/usePointerReorder";

export const SidebarProjects = React.memo(function SidebarProjects() {
  const projects = useAppStore((s) => s.projects);
  const worktreesByProject = useAppStore((s) => s.worktreesByProject);
  const allSessions = useAppStore((s) => s.computed.allSessions);
  const unassignedCount = allSessions.filter((s) => !s.projectId).length;

  const selectedProjectId = useUiStore((s) => s.selectedProjectId);
  const toggleSelectedProjectId = useUiStore((s) => s.toggleSelectedProjectId);
  const setSelectedProjectId = useUiStore((s) => s.setSelectedProjectId);
  const setProjectModalProject = useUiStore((s) => s.setProjectModalProject);
  const setCreateWorktreeProjectId = useUiStore(
    (s) => s.setCreateWorktreeProjectId
  );
  const setSearchQuery = useUiStore((s) => s.setSearchQuery);
  const showToast = useUiStore((s) => s.showToast);

  const listRef = useRef<HTMLDivElement>(null);
  const projectIds = useMemo(() => projects.map((p) => p.id), [projects]);

  const handleReorderProjects = useCallback(
    async (nextIds: string[]) => {
      const prev = useAppStore.getState().projects;
      const byId = new Map(prev.map((p) => [p.id, p]));
      const optimistic = nextIds
        .map((id) => byId.get(id))
        .filter((p): p is NonNullable<typeof p> => Boolean(p));
      // Optimistic 0ms reorder in UI & RadarBoardView
      useAppStore.getState().setProjects(optimistic);
      try {
        const persisted = await reorderProjects(nextIds);
        useAppStore.getState().setProjects(persisted);
      } catch (e) {
        useAppStore.getState().setProjects(prev);
        showToast(`프로젝트 순서 저장 실패: ${String(e)}`, "error");
      }
    },
    [showToast]
  );

  const { draggingId, overId, startDrag, shouldSuppressClick } =
    usePointerReorder({
      ids: projectIds,
      containerRef: listRef,
      onReorder: (nextIds) => void handleReorderProjects(nextIds),
      disabled: projects.length <= 1,
    });

  const handleDelete = async (id: string, name: string) => {
    if (
      !window.confirm(
        `Remove project "${name}" from jjdr? (Git files and running terminals are untouched)`
      )
    ) {
      return;
    }
    try {
      const next = await deleteProject(id);
      useAppStore.getState().setProjects(next);
      if (selectedProjectId === id) setSelectedProjectId(null);
      showToast(`Removed project ${name}`, "info");
    } catch (e) {
      showToast(`Failed to remove project: ${String(e)}`, "error");
    }
  };

  return (
    <aside className="w-56 flex flex-col justify-between shrink-0 select-none py-1.5 px-1">
      <div className="flex-1 overflow-y-auto space-y-5 pr-0.5">
        {/* Top Overview Row */}
        <div className="space-y-1.5">
          <div
            className="px-3 text-[10px] font-semibold uppercase tracking-widest"
            style={{ color: "var(--text-faint)" }}
          >
            Workspace
          </div>
          <button
            onClick={() => {
              setSelectedProjectId(null);
              setSearchQuery("");
            }}
            className={`w-full flex items-center justify-between px-3.5 py-2 rounded-full text-xs transition-colors cursor-pointer ${
              selectedProjectId === null ? "jjdr-pill-active font-semibold" : ""
            }`}
            style={
              selectedProjectId === null
                ? undefined
                : { color: "var(--text-secondary)" }
            }
          >
            <span className="inline-flex items-center gap-2.5">
              <Layers className="w-3.5 h-3.5 opacity-80" />
              <span>All Projects</span>
            </span>
            <span className="font-mono-code text-[11px] opacity-75 tabular-nums">
              {allSessions.length}
            </span>
          </button>
        </div>

        {/* Drag-to-Reorder Project List (#3) */}
        <div className="space-y-1">
          <div className="px-3 pb-1 flex items-center justify-between">
            <span
              className="text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: "var(--text-faint)" }}
            >
              Projects ({projects.length})
            </span>
            <button
              onClick={() => setProjectModalProject("new")}
              className="inline-flex items-center gap-0.5 text-[11px] font-medium opacity-75 hover:opacity-100 transition-opacity cursor-pointer"
              style={{ color: "var(--text-secondary)" }}
              title="Add Git project"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          </div>

          {projects.length === 0 ? (
            <div
              className="px-3 py-3 text-xs space-y-2.5"
              style={{ color: "var(--text-muted)" }}
            >
              <p>등록된 프로젝트가 없습니다.</p>
              <button
                onClick={() => setProjectModalProject("new")}
                className="jjdr-primary-btn w-full py-2 rounded-full font-semibold cursor-pointer"
              >
                + Git 프로젝트 추가
              </button>
            </div>
          ) : (
            <div ref={listRef} className="space-y-1">
              {projects.map((proj) => {
                const wts = worktreesByProject[proj.id] ?? [];
                const projSessions = allSessions.filter(
                  (s) => s.projectId === proj.id
                );
                const needsCount = projSessions.filter(
                  (s) => s.bucket === "needs_you"
                ).length;
                const readyCount = projSessions.filter(
                  (s) => s.bucket === "ready"
                ).length;
                const runCount = projSessions.filter(
                  (s) => s.bucket === "running"
                ).length;
                const isSelected = selectedProjectId === proj.id;
                const isDragging = draggingId === proj.id;
                const isDropTarget =
                  overId === proj.id && draggingId !== null && !isDragging;

                return (
                  <div
                    key={proj.id}
                    data-reorder-id={proj.id}
                    onPointerDown={(e) => startDrag(proj.id, e)}
                    onClick={() => {
                      if (shouldSuppressClick()) return;
                      toggleSelectedProjectId(proj.id);
                    }}
                    title={`${proj.name} (${Math.max(1, wts.length)} worktrees) · 드래그하여 순서 변경`}
                    className={`group flex items-center justify-between gap-1.5 pl-2.5 pr-3 py-2 rounded-full text-xs transition-all cursor-pointer ${
                      isSelected
                        ? "jjdr-pill-active font-semibold"
                        : "hover:bg-white/5"
                    }`}
                    style={{
                      color: isSelected ? undefined : "var(--text-secondary)",
                      opacity: isDragging ? 0.45 : 1,
                      boxShadow: isDropTarget
                        ? "inset 0 0 0 1.5px var(--accent)"
                        : undefined,
                    }}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <GripVertical
                        className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-55 transition-opacity"
                        style={{ color: "var(--text-faint)" }}
                      />
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: proj.color }}
                      />
                      <span className="truncate">{proj.name}</span>
                    </div>

                    {/* Soft Status Count Pill */}
                    <div className="flex items-center gap-1.5 font-mono-code text-[11px] tabular-nums group-hover:hidden shrink-0">
                      {needsCount > 0 ? (
                        <span
                          className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
                          style={{
                            background: "var(--action-soft)",
                            color: "var(--action-fg)",
                          }}
                        >
                          {needsCount}
                        </span>
                      ) : readyCount > 0 ? (
                        <span
                          className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
                          style={{
                            background: "var(--ready-soft)",
                            color: "var(--ready-fg)",
                          }}
                        >
                          {readyCount}
                        </span>
                      ) : runCount > 0 ? (
                        <span
                          className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
                          style={{
                            background: "var(--run-soft)",
                            color: "var(--run-fg)",
                          }}
                        >
                          {runCount}
                        </span>
                      ) : (
                        <span
                          className="text-[11px]"
                          style={{ color: "var(--text-faint)" }}
                        >
                          {Math.max(1, wts.length)}
                        </span>
                      )}
                    </div>

                    {/* Hover Action Icons */}
                    <div
                      onClick={(e) => e.stopPropagation()}
                      data-no-drag="true"
                      className="hidden group-hover:flex items-center gap-0.5 shrink-0"
                    >
                      <button
                        onClick={() => setCreateWorktreeProjectId(proj.id)}
                        title="새 Worktree 추가"
                        className="p-1 rounded-full hover:bg-black/15 cursor-pointer"
                        style={{ color: "var(--text-primary)" }}
                      >
                        <GitBranchPlus className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => setProjectModalProject(proj)}
                        title="프로젝트 수정"
                        className="p-1 rounded-full hover:bg-black/15 cursor-pointer"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => void handleDelete(proj.id, proj.name)}
                        title="프로젝트 삭제"
                        className="p-1 rounded-full hover:bg-black/15 cursor-pointer"
                        style={{ color: "var(--action-fg)" }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {unassignedCount > 0 && (
            <button
              onClick={() => {
                setSelectedProjectId(null);
                setSearchQuery("External / hc");
              }}
              className="w-full flex items-center justify-between px-3.5 py-2 rounded-full text-xs hover:bg-white/5 transition-colors cursor-pointer"
              style={{ color: "var(--text-muted)" }}
            >
              <span className="inline-flex items-center gap-2.5">
                <Terminal className="w-3.5 h-3.5 opacity-75" />
                <span>Shells / hc</span>
              </span>
              <span className="font-mono-code text-[11px] tabular-nums opacity-75">
                {unassignedCount}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Soft Floating Shortcut Card */}
      <div
        className="mt-3 rounded-2xl p-3 text-[11px] space-y-1.5"
        style={{
          background: "var(--shortcut-bg)",
          border: "1px solid var(--pill-border)",
          color: "var(--text-muted)",
        }}
      >
        <div className="flex justify-between">
          <span>카드 이동</span>
          <kbd
            className="font-mono-code text-[10px]"
            style={{ color: "var(--text-secondary)" }}
          >
            Ctrl+↑↓←→
          </kbd>
        </div>
        <div className="flex justify-between">
          <span>카드 1:1 교환</span>
          <kbd
            className="font-mono-code text-[10px]"
            style={{ color: "var(--text-secondary)" }}
          >
            Ctrl+⇧+Alt+↑↓←→
          </kbd>
        </div>
        <div className="flex justify-between">
          <span>터미널 / 탭 전환</span>
          <kbd
            className="font-mono-code text-[10px]"
            style={{ color: "var(--text-secondary)" }}
          >
            Ctrl+` / Tab
          </kbd>
        </div>
        <div className="flex justify-between">
          <span>Shell / 세션 추가</span>
          <kbd
            className="font-mono-code text-[10px]"
            style={{ color: "var(--text-secondary)" }}
          >
            Ctrl+⇧+T / A
          </kbd>
        </div>
        <div className="flex justify-between">
          <span>파일 검색 / 해제</span>
          <kbd
            className="font-mono-code text-[10px]"
            style={{ color: "var(--text-secondary)" }}
          >
            Ctrl+P / Esc
          </kbd>
        </div>
      </div>
    </aside>
  );
});
