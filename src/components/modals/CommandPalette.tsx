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
        icon: <Zap className="w-4 h-4" style={{ color: "var(--action-fg)" }} />,
        run: () => jumpToNextActionable(),
      },
      {
        id: "add-project",
        label: "Add Git Project",
        detail: "Register a local repository",
        icon: (
          <FolderPlus className="w-4 h-4" style={{ color: "var(--ready-fg)" }} />
        ),
        run: () => ui.setProjectModalProject("new"),
      },
      {
        id: "toggle-view",
        label: "Switch View (Radar ↔ Queue)",
        detail: "Ctrl+M / Ctrl+1,2",
        icon:
          ui.viewMode === "queue" ? (
            <LayoutGrid
              className="w-4 h-4"
              style={{ color: "var(--accent)" }}
            />
          ) : (
            <Inbox className="w-4 h-4" style={{ color: "var(--accent)" }} />
          ),
        run: () => ui.toggleViewMode(),
      },
      {
        id: "settings",
        label: "Open Settings, Themes & Presets",
        detail: "4종 테마 전환, 알림, 프리셋",
        icon: (
          <Settings
            className="w-4 h-4"
            style={{ color: "var(--text-secondary)" }}
          />
        ),
        run: () => ui.setSettingsOpen(true),
      },
    ];

    for (const p of projects) {
      list.push({
        id: `run-${p.id}`,
        label: `Launch AI in ${p.name} (Main Repo)`,
        detail: `No worktree needed · ${p.default_agent || "agy"}`,
        icon: <Play className="w-4 h-4" style={{ color: "var(--ready-fg)" }} />,
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
        icon: (
          <GitBranchPlus
            className="w-4 h-4"
            style={{ color: "var(--accent)" }}
          />
        ),
        run: () => ui.setCreateWorktreeProjectId(p.id),
      });
    }

    for (const s of sessions) {
      list.push({
        id: `attach-${s.address}`,
        label: `Attach: ${s.projectName} / ${s.branch}`,
        detail: `${s.agentLabel} · ${s.address} · ${s.bucket}`,
        icon: (
          <Terminal className="w-4 h-4" style={{ color: "var(--run-fg)" }} />
        ),
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
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4"
      style={{ background: "var(--modal-overlay)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="jjdr-modal w-full max-w-xl rounded-[22px] overflow-hidden"
      >
        <div
          className="flex items-center gap-2.5 px-4 py-3.5"
          style={{ borderBottom: "1px solid var(--divider)" }}
        >
          <Search className="w-4 h-4" style={{ color: "var(--accent)" }} />
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
            placeholder="명령어, 프로젝트, 브랜치 또는 세션 검색..."
            className="flex-1 bg-transparent text-sm focus:outline-none"
            style={{ color: "var(--text-primary)" }}
          />
          <kbd
            className="text-[10px] px-2 py-0.5 rounded-full font-mono-code"
            style={{
              background: "var(--pill-bg)",
              border: "1px solid var(--pill-border)",
              color: "var(--text-muted)",
            }}
          >
            Esc
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto p-2 space-y-0.5">
          {items.length === 0 ? (
            <div
              className="p-6 text-center text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              일치하는 명령어가 없습니다
            </div>
          ) : (
            items.map((item, i) => (
              <button
                key={item.id}
                onMouseEnter={() => setIdx(i)}
                onClick={() => execute(item)}
                className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl text-left text-xs cursor-pointer transition-colors"
                style={{
                  background: i === idx ? "var(--accent-soft)" : "transparent",
                  color:
                    i === idx ? "var(--text-primary)" : "var(--text-secondary)",
                }}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {item.icon}
                  <span className="font-semibold truncate">{item.label}</span>
                </div>
                <span
                  className="text-[11px] truncate shrink-0"
                  style={{ color: "var(--text-muted)" }}
                >
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
