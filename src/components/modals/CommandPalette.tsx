import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FolderPlus,
  GitBranchPlus,
  Inbox,
  LayoutGrid,
  Play,
  Search,
  Settings,
  Terminal,
  Zap,
} from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import { jumpToNextActionable } from "../../hooks/useGlobalShortcuts";

interface PaletteItem {
  id: string;
  label: string;
  detail: string;
  icon: React.ReactNode;
  run: () => void;
}

export const CommandPalette = React.memo(function CommandPalette() {
  const open = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const projects = useAppStore((s) => s.projects);
  const sessions = useAppStore((s) => s.computed.allSessions);

  const [query, setQuery] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const ui = useUiStore.getState();
    const list: PaletteItem[] = [
      {
        id: "next-action",
        label: "Jump to Next Actionable Session",
        detail: "Ctrl+N · Needs You → Ready",
        icon: <Zap className="w-4 h-4 text-[#f85149]" />,
        run: () => jumpToNextActionable(),
      },
      {
        id: "add-project",
        label: "Add Git Project",
        detail: "Register a local repository",
        icon: <FolderPlus className="w-4 h-4 text-[#3fb950]" />,
        run: () => ui.setProjectModalProject("new"),
      },
      {
        id: "toggle-view",
        label: "Switch View (Radar ↔ Queue)",
        detail: "Ctrl+M / Ctrl+1,2",
        icon:
          ui.viewMode === "queue" ? (
            <LayoutGrid className="w-4 h-4 text-[#58a6ff]" />
          ) : (
            <Inbox className="w-4 h-4 text-[#58a6ff]" />
          ),
        run: () => ui.toggleViewMode(),
      },
      {
        id: "settings",
        label: "Open Settings & Prompt Presets",
        detail: "Stuck timer, notifications, presets",
        icon: <Settings className="w-4 h-4 text-[#9aa7b8]" />,
        run: () => ui.setSettingsOpen(true),
      },
    ];

    for (const p of projects) {
      list.push({
        id: `run-${p.id}`,
        label: `Launch AI in ${p.name} (Main Repo)`,
        detail: `No worktree needed · ${p.default_agent || "agy"}`,
        icon: <Play className="w-4 h-4 text-[#56d364]" />,
        run: () =>
          ui.setLaunchTarget({
            projectId: p.id,
            cwd: p.repo_path,
            branch: p.default_branch,
            defaultAgent: p.default_agent,
          }),
      });
      list.push({
        id: `nw-${p.id}`,
        label: `New Worktree in ${p.name}`,
        detail: `From current branch + launch ${p.default_agent || "agy"}`,
        icon: <GitBranchPlus className="w-4 h-4 text-[#58a6ff]" />,
        run: () => ui.setCreateWorktreeProjectId(p.id),
      });
    }

    for (const s of sessions) {
      list.push({
        id: `attach-${s.address}`,
        label: `Attach: ${s.projectName} / ${s.branch}`,
        detail: `${s.agentLabel} · ${s.address} · ${s.bucket}`,
        icon: <Terminal className="w-4 h-4 text-[#e3b341]" />,
        run: () => {
          ui.setSelectedAddress(s.address);
          if (s.terminal.state === "live") {
            ui.setAttachedAddress(s.address);
          }
        },
      });
    }

    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (i) =>
        i.label.toLowerCase().includes(q) || i.detail.toLowerCase().includes(q)
    );
  }, [projects, sessions, query]);

  if (!open) return null;

  const execute = (item: PaletteItem | undefined) => {
    if (!item) return;
    setOpen(false);
    item.run();
  };

  return (
    <div
      onClick={() => setOpen(false)}
      className="fixed inset-0 z-50 bg-[#05070a]/80 flex items-start justify-center pt-20 px-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-xl bg-[#111318] border border-[#252932] overflow-hidden"
      >
        <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-[#1c1f26]">
          <Search className="w-4 h-4 text-[#58a6ff]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIdx((v) => Math.min(items.length - 1, v + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIdx((v) => Math.max(0, v - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                execute(items[idx]);
              }
            }}
            placeholder="Type a command, project, branch, or session..."
            className="flex-1 bg-transparent text-sm text-[#e6edf3] placeholder-[#6c788a] focus:outline-none"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-[#0b0c0e] text-[#8b949e] border border-[#1c1f26]">
            Esc
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto p-1.5">
          {items.length === 0 ? (
            <div className="p-4 text-center text-xs text-[#6c788a]">
              No matching commands
            </div>
          ) : (
            items.map((item, i) => (
              <button
                key={item.id}
                onMouseEnter={() => setIdx(i)}
                onClick={() => execute(item)}
                className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded text-left text-xs cursor-pointer ${
                  i === idx
                    ? "bg-[#1f2a3d] text-[#e6edf3]"
                    : "text-[#c9d1d9] hover:bg-[#1a202c]"
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {item.icon}
                  <span className="font-medium truncate">{item.label}</span>
                </div>
                <span className="text-[11px] text-[#8b949e] truncate shrink-0">
                  {item.detail}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
});
