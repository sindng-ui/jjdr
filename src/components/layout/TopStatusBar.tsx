import React from "react";
import {
  Command,
  Inbox,
  Minus,
  PanelLeft,
  Radar,
  RefreshCw,
  Search,
  Settings,
  Square,
  X,
  Zap,
} from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import { jumpToNextActionable } from "../../hooks/useGlobalShortcuts";
import {
  listAllWorktrees,
  windowClose,
  windowMinimize,
  windowStartDragging,
  windowToggleMaximize,
} from "../../services/tauriBridge";

export const TopStatusBar = React.memo(function TopStatusBar() {
  const counts = useAppStore((s) => s.computed.globalCounts);
  const groups = useAppStore((s) => s.computed.groups);
  const health = useAppStore((s) => s.health);

  const viewMode = useUiStore((s) => s.viewMode);
  const setViewMode = useUiStore((s) => s.setViewMode);
  const activeGroup = useUiStore((s) => s.activeGroup);
  const setActiveGroup = useUiStore((s) => s.setActiveGroup);
  const searchQuery = useUiStore((s) => s.searchQuery);
  const setSearchQuery = useUiStore((s) => s.setSearchQuery);
  const setCommandPaletteOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const showToast = useUiStore((s) => s.showToast);

  const handleRefreshGit = async () => {
    try {
      const map = await listAllWorktrees();
      useAppStore.getState().setWorktreesByProject(map);
      showToast("Git worktrees & diff stats refreshed", "info");
    } catch {
      showToast("Failed to refresh Git worktrees", "error");
    }
  };

  const hasActionable = counts.needsYou > 0 || counts.ready > 0;

  const handleHeaderMouseDown = (e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (
      target.closest(
        "button, input, a, select, textarea, [data-no-drag='true']"
      )
    ) {
      return;
    }
    if (e.detail === 2) {
      void windowToggleMaximize();
    } else if (e.detail === 1) {
      void windowStartDragging();
    }
  };

  return (
    <header
      data-tauri-drag-region
      onMouseDown={handleHeaderMouseDown}
      className="h-11 pl-3.5 pr-1 bg-[#0e1013] border-b border-[#1c1f26] flex items-center justify-between gap-3 shrink-0 select-none"
    >
      {/* Left: Sidebar toggle + Brand + Unified Status Capsule */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2">
          <button
            onClick={toggleSidebar}
            title="사이드바 토글 (Ctrl+B)"
            className={`p-1.5 rounded-md transition-colors cursor-pointer ${
              sidebarOpen
                ? "text-[#e4e4e7] hover:bg-[#181b22]"
                : "text-[#71717a] hover:text-[#e4e4e7] hover:bg-[#181b22]"
            }`}
          >
            <PanelLeft className="w-3.5 h-3.5" />
          </button>

          <div className="flex items-center gap-2 pl-0.5">
            <span
              title={
                health.connected
                  ? `Connected to herdr-core ${health.version ?? ""}`
                  : "Disconnected"
              }
              className={`w-2 h-2 rounded-full ${
                health.connected ? "bg-[#10b981]" : "bg-[#ef4444]"
              }`}
            />
            <span className="font-semibold text-[13px] tracking-tight text-[#f4f4f5]">
              jjdr
            </span>
          </div>
        </div>

        {/* Unified Segmented Status Capsule (No rainbow boxes) */}
        <button
          onClick={jumpToNextActionable}
          title="다음 확인 필요한 세션으로 점프 (Ctrl+N)"
          className="flex items-center gap-2.5 px-3 py-1 rounded-full bg-[#13161b] hover:bg-[#181c23] border border-[#1f232c] text-xs tabular-nums transition-colors cursor-pointer"
        >
          <span
            className={`inline-flex items-center gap-1.5 ${
              counts.needsYou > 0
                ? "font-semibold text-[#f87171]"
                : "text-[#52525b]"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                counts.needsYou > 0 ? "bg-[#ef4444]" : "bg-[#3f3f46]"
              }`}
            />
            <span>{counts.needsYou}</span>
            <span className="hidden sm:inline text-[11px] font-normal">
              Action
            </span>
          </span>

          <span className="text-[#272a33]">·</span>

          <span
            className={`inline-flex items-center gap-1.5 ${
              counts.ready > 0
                ? "font-semibold text-[#34d399]"
                : "text-[#52525b]"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                counts.ready > 0 ? "bg-[#10b981]" : "bg-[#3f3f46]"
              }`}
            />
            <span>{counts.ready}</span>
            <span className="hidden sm:inline text-[11px] font-normal">
              Ready
            </span>
          </span>

          <span className="text-[#272a33]">·</span>

          <span
            className={`inline-flex items-center gap-1.5 ${
              counts.running > 0
                ? "font-medium text-[#fbbf24]"
                : "text-[#52525b]"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                counts.running > 0 ? "bg-[#f59e0b]" : "bg-[#3f3f46]"
              }`}
            />
            <span>{counts.running}</span>
            <span className="hidden sm:inline text-[11px] font-normal">
              Run
            </span>
          </span>
        </button>

        {hasActionable && (
          <button
            onClick={jumpToNextActionable}
            className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-[#181b22] hover:bg-[#20242d] text-[#e4e4e7] border border-[#272b36] transition-colors cursor-pointer"
            title="Jump to next Needs You / Ready session (Ctrl+N)"
          >
            <Zap className="w-3 h-3 text-[#f59e0b]" />
            <span>Next</span>
            <kbd className="text-[10px] px-1 rounded bg-[#0e1013] text-[#71717a] font-mono-code">
              Ctrl+N
            </kbd>
          </button>
        )}
      </div>

      {/* Center: Group filter + Minimal Search */}
      <div className="flex items-center gap-2 flex-1 max-w-md">
        {groups.length > 1 && (
          <div className="flex items-center bg-[#13161b] border border-[#1f232c] rounded-md p-0.5 text-xs">
            {groups.map((g) => (
              <button
                key={g}
                onClick={() => setActiveGroup(g)}
                className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                  activeGroup === g
                    ? "bg-[#222631] text-[#f4f4f5] font-medium"
                    : "text-[#71717a] hover:text-[#d4d4d8]"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        )}

        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-[#52525b] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search projects, branches, agents..."
            className="w-full h-7 pl-8 pr-7 text-xs rounded-md bg-[#13161b] border border-[#1f232c] focus:border-[#52525b] focus:outline-none text-[#f4f4f5] placeholder-[#52525b] transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              title="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#71717a] hover:text-[#e4e4e7] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Right: View Segment + Command Palette + Git Refresh + Settings */}
      <div className="flex items-center gap-1.5">
        <div className="flex items-center bg-[#13161b] border border-[#1f232c] rounded-md p-0.5 text-xs">
          <button
            onClick={() => setViewMode("radar")}
            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded transition-colors cursor-pointer ${
              viewMode === "radar"
                ? "bg-[#222631] text-[#f4f4f5] font-medium"
                : "text-[#71717a] hover:text-[#d4d4d8]"
            }`}
            title="전체 프로젝트·Worktree 초슬림 레이더 (Ctrl+1)"
          >
            <Radar className="w-3.5 h-3.5" />
            Radar
          </button>
          <button
            onClick={() => setViewMode("queue")}
            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded transition-colors cursor-pointer ${
              viewMode === "queue"
                ? "bg-[#222631] text-[#f4f4f5] font-medium"
                : "text-[#71717a] hover:text-[#d4d4d8]"
            }`}
            title="할 일 우선순위 인박스 (Ctrl+2)"
          >
            <Inbox className="w-3.5 h-3.5" />
            Queue
          </button>
        </div>

        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium bg-[#13161b] hover:bg-[#1a1e26] text-[#a1a1aa] hover:text-[#f4f4f5] border border-[#1f232c] transition-colors cursor-pointer"
          title="Command Palette (Ctrl+K)"
        >
          <Command className="w-3.5 h-3.5 text-[#71717a]" />
          <kbd className="text-[10px] text-[#71717a] font-mono-code">
            Ctrl+K
          </kbd>
        </button>

        <button
          onClick={() => void handleRefreshGit()}
          title="Refresh Git worktrees & diff stats"
          className="h-7 w-7 inline-flex items-center justify-center rounded-md bg-[#13161b] hover:bg-[#1a1e26] text-[#71717a] hover:text-[#e4e4e7] border border-[#1f232c] transition-colors cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => setSettingsOpen(true)}
          title="Settings & Prompt Presets"
          className="h-7 w-7 inline-flex items-center justify-center rounded-md bg-[#13161b] hover:bg-[#1a1e26] text-[#71717a] hover:text-[#e4e4e7] border border-[#1f232c] transition-colors cursor-pointer"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>

        {/* Integrated Frameless Window Controls */}
        <div className="w-px h-4 bg-[#1f232c] mx-1" />

        <div className="flex items-center">
          <button
            type="button"
            onClick={() => void windowMinimize()}
            title="Minimize"
            className="h-8 w-9 inline-flex items-center justify-center rounded text-[#71717a] hover:text-[#e4e4e7] hover:bg-[#181b22] transition-colors cursor-pointer"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void windowToggleMaximize()}
            title="Maximize / Restore"
            className="h-8 w-9 inline-flex items-center justify-center rounded text-[#71717a] hover:text-[#e4e4e7] hover:bg-[#181b22] transition-colors cursor-pointer"
          >
            <Square className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => void windowClose()}
            title="Close"
            className="h-8 w-9 inline-flex items-center justify-center rounded text-[#71717a] hover:text-white hover:bg-[#e11d48] transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
});
