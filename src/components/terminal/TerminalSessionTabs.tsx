import React from "react";
import { Bot, Plus, Terminal, X } from "lucide-react";
import type { EnrichedSession } from "../../types/domain";
import { StatusBadge } from "../shared/StatusBadge";
import { isPlainShellSession } from "../../utils/worktreeSessions";

interface TerminalSessionTabsProps {
  tabs: EnrichedSession[];
  activeAddress: string;
  canSpawnInWorktree: boolean;
  spawningShell: boolean;
  onSelectTab: (address: string) => void;
  onCloseTab: (address: string) => void;
  onAddShell: () => void;
  onAddAi: () => void;
}

export const TerminalSessionTabs = React.memo(function TerminalSessionTabs({
  tabs,
  activeAddress,
  canSpawnInWorktree,
  spawningShell,
  onSelectTab,
  onCloseTab,
  onAddShell,
  onAddAi,
}: TerminalSessionTabsProps) {
  if (!canSpawnInWorktree && tabs.length <= 1) return null;

  // Count duplicate labels so two shells or two agy sessions show their address suffix clearly
  const labelCounts = new Map<string, number>();
  for (const t of tabs) {
    const key = (t.agentLabel || "shell").toLowerCase();
    labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
  }

  return (
    <div
      className="px-3 py-1.5 flex items-center justify-between gap-2 shrink-0 select-none"
      style={{
        background: "rgba(255, 255, 255, 0.025)",
        borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
      }}
    >
      {/* Left: Scrollable Worktree Session Tabs */}
      <div className="flex-1 flex items-center gap-1.5 overflow-x-auto min-w-0">
        {tabs.map((tab) => {
          const isActive = tab.address === activeAddress;
          const isShell = isPlainShellSession(tab);
          const rawLabel = tab.agentLabel || (isShell ? "shell" : "AI");
          const hasDup = (labelCounts.get(rawLabel.toLowerCase()) ?? 0) > 1;

          return (
            <div
              key={tab.address}
              onClick={() => onSelectTab(tab.address)}
              title={`${rawLabel} (${tab.address}) · Ctrl+Tab으로 탭 전환`}
              className={`group inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full text-[11px] cursor-pointer shrink-0 transition-colors ${
                isActive
                  ? "bg-white/16 text-white font-semibold"
                  : "bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white"
              }`}
              style={
                isActive
                  ? { boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.18)" }
                  : undefined
              }
            >
              <StatusBadge
                bucket={tab.bucket}
                status={tab.terminal.status}
                compact
              />
              {isShell ? (
                <Terminal className="w-3 h-3 text-slate-300 shrink-0" />
              ) : (
                <Bot className="w-3 h-3 text-sky-300 shrink-0" />
              )}
              <span className="font-mono-code">
                {rawLabel}
                {hasDup ? ` · ${tab.address}` : ""}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.address);
                }}
                title="이 터미널 세션 종료"
                className={`p-0.5 rounded-full hover:bg-rose-500/30 hover:text-rose-200 transition-opacity cursor-pointer ${
                  isActive
                    ? "text-slate-300 opacity-75 hover:opacity-100"
                    : "text-slate-400 opacity-0 group-hover:opacity-100"
                }`}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          );
        })}

        {tabs.length > 1 && (
          <kbd className="hidden xl:inline-block ml-1 text-[10px] font-mono-code text-slate-500 shrink-0">
            Ctrl+Tab
          </kbd>
        )}
      </div>

      {/* Right: Instant + Shell / + AI Controls in Current Worktree */}
      {canSpawnInWorktree && (
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            disabled={spawningShell}
            onClick={onAddShell}
            title="이 Worktree에 PowerShell 탭 추가 (Ctrl+Shift+T)"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-white/7 hover:bg-white/15 text-slate-200 hover:text-white disabled:opacity-50 transition-colors cursor-pointer"
          >
            <Plus className="w-3 h-3" />
            <span>Shell</span>
          </button>
          <button
            type="button"
            onClick={onAddAi}
            title="이 Worktree에 AI CLI 탭 추가 (Ctrl+Shift+A)"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-indigo-500/25 hover:bg-indigo-500/40 text-indigo-200 hover:text-white transition-colors cursor-pointer"
          >
            <Plus className="w-3 h-3" />
            <span>AI</span>
          </button>
        </div>
      )}
    </div>
  );
});
