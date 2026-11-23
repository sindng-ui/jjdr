import React from "react";
import {
  GitBranchPlus,
  Layers,
  Pencil,
  Plus,
  Terminal,
  Trash2,
} from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import { deleteProject } from "../../services/tauriBridge";

export const SidebarProjects = React.memo(function SidebarProjects() {
  const projects = useAppStore((s) => s.projects);
  const worktreesByProject = useAppStore((s) => s.worktreesByProject);
  const allSessions = useAppStore((s) => s.computed.allSessions);
  const unassignedCount = allSessions.filter((s) => !s.projectId).length;

  const selectedProjectId = useUiStore((s) => s.selectedProjectId);
  const toggleSelectedProjectId = useUiStore((s) => s.toggleSelectedProjectId);
  const setSelectedProjectId = useUiStore((s) => s.setSelectedProjectId);
  const setProjectModalProject = useUiStore((s) => s.setProjectModalProject);
  const setCreateWorktreeProjectId = useUiStore((s) => s.setCreateWorktreeProjectId);
  const setSearchQuery = useUiStore((s) => s.setSearchQuery);
  const showToast = useUiStore((s) => s.showToast);

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
    <aside className="w-52 bg-[#0d0f13] border-r border-[#1c1f26] flex flex-col shrink-0 select-none">
      <div className="flex-1 overflow-y-auto px-2.5 py-3 space-y-4">
        {/* Top Overview Row */}
        <div className="space-y-0.5">
          <div className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-[#52525b]">
            Workspace
          </div>
          <button
            onClick={() => {
              setSelectedProjectId(null);
              setSearchQuery("");
            }}
            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs transition-colors cursor-pointer ${
              selectedProjectId === null
                ? "bg-[#181b22] text-[#f4f4f5] font-medium"
                : "text-[#a1a1aa] hover:bg-[#14171d] hover:text-[#e4e4e7]"
            }`}
          >
            <span className="inline-flex items-center gap-2">
              <Layers className="w-3.5 h-3.5 text-[#71717a]" />
              <span>All Projects</span>
            </span>
            <span className="font-mono-code text-[11px] text-[#71717a] tabular-nums">
              {allSessions.length}
            </span>
          </button>
        </div>

        {/* Flat Project List (No nested boxes!) */}
        <div className="space-y-0.5">
          <div className="px-2 pb-1 flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wider text-[#52525b]">
              Projects ({projects.length})
            </span>
            <button
              onClick={() => setProjectModalProject("new")}
              className="inline-flex items-center gap-0.5 text-[11px] text-[#71717a] hover:text-[#e4e4e7] transition-colors cursor-pointer"
              title="Add Git project"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          </div>

          {projects.length === 0 ? (
            <div className="px-2 py-3 text-xs text-[#6b7280] space-y-2">
              <p>등록된 프로젝트가 없습니다.</p>
              <button
                onClick={() => setProjectModalProject("new")}
                className="w-full py-1.5 rounded-md bg-[#181b22] hover:bg-[#222631] text-[#e4e4e7] border border-[#272b36] font-medium cursor-pointer"
              >
                + Git 프로젝트 추가
              </button>
            </div>
          ) : (
            projects.map((proj) => {
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

              return (
                <div
                  key={proj.id}
                  onClick={() => toggleSelectedProjectId(proj.id)}
                  title={`${proj.name} (${Math.max(1, wts.length)} worktrees)`}
                  className={`group flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors cursor-pointer ${
                    isSelected
                      ? "bg-[#181b22] text-[#f4f4f5] font-medium"
                      : "text-[#a1a1aa] hover:bg-[#14171d] hover:text-[#e4e4e7]"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: proj.color }}
                    />
                    <span className="truncate">{proj.name}</span>
                  </div>

                  {/* Calm Status Dots (Hidden on hover to reveal quick action icons) */}
                  <div className="flex items-center gap-1.5 font-mono-code text-[11px] tabular-nums group-hover:hidden shrink-0">
                    {needsCount > 0 ? (
                      <span className="inline-flex items-center gap-1 text-[#f87171] font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#ef4444]" />
                        {needsCount}
                      </span>
                    ) : readyCount > 0 ? (
                      <span className="inline-flex items-center gap-1 text-[#34d399]">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                        {readyCount}
                      </span>
                    ) : runCount > 0 ? (
                      <span className="inline-flex items-center gap-1 text-[#fbbf24]">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b]" />
                        {runCount}
                      </span>
                    ) : (
                      <span className="text-[10px] text-[#52525b]">
                        {Math.max(1, wts.length)}
                      </span>
                    )}
                  </div>

                  {/* Hover Action Icons */}
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="hidden group-hover:flex items-center gap-0.5 shrink-0"
                  >
                    <button
                      onClick={() => setCreateWorktreeProjectId(proj.id)}
                      title="새 Worktree 추가"
                      className="p-1 rounded hover:bg-[#222631] text-[#a1a1aa] hover:text-[#f4f4f5] cursor-pointer"
                    >
                      <GitBranchPlus className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => setProjectModalProject(proj)}
                      title="프로젝트 수정"
                      className="p-1 rounded hover:bg-[#222631] text-[#71717a] hover:text-[#e4e4e7] cursor-pointer"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => void handleDelete(proj.id, proj.name)}
                      title="프로젝트 삭제"
                      className="p-1 rounded hover:bg-[#2c191d] text-[#71717a] hover:text-[#f87171] cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })
          )}

          {unassignedCount > 0 && (
            <button
              onClick={() => {
                setSelectedProjectId(null);
                setSearchQuery("External / hc");
              }}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs text-[#71717a] hover:bg-[#14171d] hover:text-[#a1a1aa] transition-colors cursor-pointer"
            >
              <span className="inline-flex items-center gap-2">
                <Terminal className="w-3 h-3 text-[#52525b]" />
                <span>Shells / hc</span>
              </span>
              <span className="font-mono-code text-[11px] tabular-nums">
                {unassignedCount}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Minimal Keyboard Hints Footer */}
      <div className="px-3.5 py-2.5 border-t border-[#1c1f26] text-[10px] text-[#52525b] space-y-1">
        <div className="flex justify-between">
          <span>Navigate</span>
          <kbd className="text-[#71717a] font-mono-code">Ctrl+↑↓←→</kbd>
        </div>
        <div className="flex justify-between">
          <span>Terminal</span>
          <kbd className="text-[#71717a] font-mono-code">Ctrl+`</kbd>
        </div>
        <div className="flex justify-between">
          <span>Next / Palette</span>
          <kbd className="text-[#71717a] font-mono-code">Ctrl+N / K</kbd>
        </div>
      </div>
    </aside>
  );
});
