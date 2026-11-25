import React from "react";
import {
  Command,
  FileSearch,
  Inbox,
  Minus,
  PanelLeft,
  Radar,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Square,
  X,
  Zap,
} from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import { BrandMascotIcon } from "../shared/StartupSplash";
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
  const setQuickFileOpen = useUiStore((s) => s.setQuickFileOpen);
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

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    e.currentTarget.blur();

    const ui = useUiStore.getState();
    const app = useAppStore.getState();

    if (ui.viewMode === "radar") {
      const firstCard =
        document.querySelector<HTMLElement>("[data-jjdr-card]");
      if (!firstCard) return;
      const cardKey = firstCard.dataset.jjdrCard || "";
      const addr = firstCard.dataset.jjdrSessionAddr || null;
      if (cardKey) ui.setSelectedCardKey(cardKey);
      ui.setSelectedAddress(addr);
      firstCard.scrollIntoView({ block: "nearest", behavior: "smooth" });
      if (ui.attachedAddress && addr && app.terminals[addr]?.state === "live") {
        ui.setAttachedAddress(addr);
      }
      return;
    }

    const firstSession = app.computed.sessions[0] ?? null;
    if (firstSession) {
      ui.setSelectedAddress(firstSession.address);
      if (ui.attachedAddress && firstSession.terminal.state === "live") {
        ui.setAttachedAddress(firstSession.address);
      }
    }
  };

  const hasActionable = counts.needsYou > 0 || counts.ready > 0;

  const handleHeaderMouseDown = (e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const target = e.target as Element | null;
    if (
      target?.closest(
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
      onMouseDown={handleHeaderMouseDown}
      className="h-14 pl-3.5 pr-2.5 flex items-center justify-between gap-3 shrink-0 select-none"
    >
      {/* Left: Sidebar Toggle + Squircle Brand + Floating Status Capsule */}
      <div className="flex items-center gap-2.5 min-w-0">
        <button
          onClick={toggleSidebar}
          title="사이드바 토글 (Ctrl+B)"
          className="jjdr-pill w-8 h-8 rounded-full inline-flex items-center justify-center transition-colors cursor-pointer shrink-0"
          style={{
            color: sidebarOpen ? "var(--text-primary)" : "var(--text-muted)",
          }}
        >
          <PanelLeft className="w-3.5 h-3.5" />
        </button>

        <div className="flex items-center gap-2 pr-1.5">
          <div
            className="w-7 h-7 rounded-[10px] flex items-center justify-center shadow-sm shrink-0"
            style={{
              background: "var(--brand-bg)",
            }}
          >
            <BrandMascotIcon size={21} />
          </div>
          <div className="flex flex-col leading-none">
            <span
              className="font-bold text-[13px] tracking-tight"
              style={{ color: "var(--text-primary)" }}
            >
              jjdr
            </span>
            <span
              title={
                health.connected
                  ? `Connected to herdr-core ${health.version ?? ""}`
                  : "Disconnected"
              }
              className="text-[10px] mt-0.5 inline-flex items-center gap-1"
              style={{ color: "var(--text-muted)" }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  background: health.connected
                    ? "var(--ready-fg)"
                    : "var(--action-fg)",
                }}
              />
              <span>{health.connected ? "live" : "offline"}</span>
            </span>
          </div>
        </div>

        {/* Floating Pill Status Capsule */}
        <button
          onClick={() =>
            viewMode === "zen"
              ? useUiStore.getState().requestZenSkip()
              : jumpToNextActionable()
          }
          title="다음 확인 필요한 세션으로 점프 (Ctrl+N)"
          className="jjdr-pill flex items-center gap-2.5 px-3.5 py-1.5 rounded-full text-xs tabular-nums transition-colors cursor-pointer"
        >
          <span
            className="inline-flex items-center gap-1.5"
            style={{
              color:
                counts.needsYou > 0 ? "var(--action-fg)" : "var(--text-faint)",
              fontWeight: counts.needsYou > 0 ? 600 : 400,
            }}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                counts.needsYou > 0 ? "jjdr-dot-pulse" : ""
              }`}
              style={{
                background:
                  counts.needsYou > 0 ? "var(--action-fg)" : "var(--text-faint)",
              }}
            />
            <span>{counts.needsYou}</span>
            <span className="hidden sm:inline text-[11px] opacity-85">
              Action
            </span>
          </span>

          <span style={{ color: "var(--text-faint)", opacity: 0.4 }}>·</span>

          <span
            className="inline-flex items-center gap-1.5"
            style={{
              color:
                counts.ready > 0 ? "var(--ready-fg)" : "var(--text-faint)",
              fontWeight: counts.ready > 0 ? 600 : 400,
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background:
                  counts.ready > 0 ? "var(--ready-fg)" : "var(--text-faint)",
              }}
            />
            <span>{counts.ready}</span>
            <span className="hidden sm:inline text-[11px] opacity-85">
              Ready
            </span>
          </span>

          <span style={{ color: "var(--text-faint)", opacity: 0.4 }}>·</span>

          <span
            className="inline-flex items-center gap-1.5"
            style={{
              color:
                counts.running > 0 ? "var(--run-fg)" : "var(--text-faint)",
              fontWeight: counts.running > 0 ? 500 : 400,
            }}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                counts.running > 0 ? "jjdr-dot-pulse" : ""
              }`}
              style={{
                background:
                  counts.running > 0 ? "var(--run-fg)" : "var(--text-faint)",
              }}
            />
            <span>{counts.running}</span>
            <span className="hidden sm:inline text-[11px] opacity-85">Run</span>
          </span>
        </button>

        {hasActionable && (
          <button
            onClick={() =>
              viewMode === "zen"
                ? useUiStore.getState().requestZenSkip()
                : jumpToNextActionable()
            }
            className="jjdr-primary-btn hidden lg:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold shadow-sm transition-colors cursor-pointer"
            title="다음 확인 필요한 세션으로 점프 (Ctrl+N)"
          >
            <Zap className="w-3 h-3" />
            <span>Next</span>
            <kbd className="text-[10px] opacity-80 font-mono-code">Ctrl+N</kbd>
          </button>
        )}
      </div>

      {/* Center: Group Filter Pill + Organic Search Pill + Quick File Search Button */}
      <div className="flex items-center gap-2 flex-1 max-w-lg">
        {groups.length > 1 && (
          <div className="jjdr-pill flex items-center rounded-full p-0.5 text-xs">
            {groups.map((g) => (
              <button
                key={g}
                onClick={() => setActiveGroup(g)}
                className={`px-2.5 py-1 rounded-full transition-colors cursor-pointer ${
                  activeGroup === g ? "jjdr-pill-active font-semibold" : ""
                }`}
                style={
                  activeGroup === g ? undefined : { color: "var(--text-muted)" }
                }
              >
                {g}
              </button>
            ))}
          </div>
        )}

        <div className="relative flex-1">
          <Search
            className="w-3.5 h-3.5 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: "var(--text-muted)" }}
          />
          <input
            data-jjdr-search-input="true"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search projects, branches, agents..."
            className="jjdr-pill w-full h-9 pl-9 pr-14 text-xs rounded-full focus:outline-none transition-colors"
            style={{ color: "var(--text-primary)" }}
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              title="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer"
              style={{ color: "var(--text-muted)" }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            <kbd
              className="hidden sm:inline-block absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono-code pointer-events-none opacity-55"
              style={{ color: "var(--text-muted)" }}
            >
              Ctrl+F
            </kbd>
          )}
        </div>

        <button
          type="button"
          onClick={() => setQuickFileOpen(true)}
          title="Quick File Search (Ctrl+P)"
          className="jjdr-pill inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-xs font-medium transition-colors cursor-pointer shrink-0"
          style={{ color: "var(--text-secondary)" }}
        >
          <FileSearch className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Files</span>
          <kbd className="text-[10px] font-mono-code opacity-75">Ctrl+P</kbd>
        </button>
      </div>

      {/* Right: Pill View Switch + Circular Controls + Soft Frameless Window Controls */}
      <div data-no-drag="true" className="flex items-center gap-1.5">
        <div className="jjdr-pill flex items-center rounded-full p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setViewMode("radar")}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full transition-colors cursor-pointer ${
              viewMode === "radar" ? "jjdr-pill-active font-semibold" : ""
            }`}
            style={
              viewMode === "radar" ? undefined : { color: "var(--text-muted)" }
            }
            title="전체 프로젝트·Worktree 레이더 (Ctrl+1)"
          >
            <Radar className="w-3.5 h-3.5" />
            Radar
          </button>
          <button
            type="button"
            onClick={() => setViewMode("queue")}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full transition-colors cursor-pointer ${
              viewMode === "queue" ? "jjdr-pill-active font-semibold" : ""
            }`}
            style={
              viewMode === "queue" ? undefined : { color: "var(--text-muted)" }
            }
            title="할 일 우선순위 인박스 (Ctrl+2)"
          >
            <Inbox className="w-3.5 h-3.5" />
            Queue
          </button>
          <button
            type="button"
            onClick={() => setViewMode("zen")}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full transition-colors cursor-pointer ${
              viewMode === "zen" ? "jjdr-pill-active font-semibold" : ""
            }`}
            style={
              viewMode === "zen" ? undefined : { color: "var(--text-muted)" }
            }
            title="Zen 모드 · 최상단 1장만 집중 (Ctrl+3)"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Zen
          </button>
        </div>

        <button
          type="button"
          onClick={() => setCommandPaletteOpen(true)}
          className="jjdr-pill inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium transition-colors cursor-pointer"
          style={{ color: "var(--text-secondary)" }}
          title="Command Palette (Ctrl+K)"
        >
          <Command className="w-3.5 h-3.5" />
          <kbd className="text-[10px] font-mono-code opacity-75">Ctrl+K</kbd>
        </button>

        <button
          type="button"
          onClick={() => void handleRefreshGit()}
          title="Refresh Git worktrees & diff stats"
          className="jjdr-pill h-8 w-8 inline-flex items-center justify-center rounded-full transition-colors cursor-pointer"
          style={{ color: "var(--text-secondary)" }}
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          title="Settings, Themes & Prompt Presets"
          className="jjdr-pill h-8 w-8 inline-flex items-center justify-center rounded-full transition-colors cursor-pointer"
          style={{ color: "var(--text-secondary)" }}
        >
          <Settings className="w-3.5 h-3.5" />
        </button>

        {/* Subtle divider + Soft Circular Frameless Window Controls */}
        <div
          className="w-px h-4 mx-1"
          style={{ background: "var(--divider)" }}
        />

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => void windowMinimize()}
            title="Minimize"
            className="h-7 w-7 inline-flex items-center justify-center rounded-full hover:bg-black/15 transition-colors cursor-pointer"
            style={{ color: "var(--text-muted)" }}
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void windowToggleMaximize()}
            title="Maximize / Restore"
            className="h-7 w-7 inline-flex items-center justify-center rounded-full hover:bg-black/15 transition-colors cursor-pointer"
            style={{ color: "var(--text-muted)" }}
          >
            <Square className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => void windowClose()}
            title="Close"
            className="h-7 w-7 inline-flex items-center justify-center rounded-full hover:bg-[#e11d48] hover:text-white transition-colors cursor-pointer"
            style={{ color: "var(--text-muted)" }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
});
