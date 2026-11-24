import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Bot,
  Copy,
  FileDiff,
  FolderOpen,
  Pencil,
  Plus,
  Terminal,
  Trash2,
} from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import {
  killTerminal,
  launchSession,
  openInExplorer,
} from "../../services/tauriBridge";
import { normalizePath } from "../../workers/dashboardLogic";
import {
  countWorktreeLiveShells,
  MAX_SHELLS_PER_WORKTREE,
  pickPreferredWorktreeSession,
} from "../../utils/worktreeSessions";

interface MenuActionItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
  danger?: boolean;
  dividerBefore?: boolean;
  onSelect: () => void;
}

export const WorktreeContextMenu = React.memo(function WorktreeContextMenu() {
  const menu = useUiStore((s) => s.contextMenu);
  const setContextMenu = useUiStore((s) => s.setContextMenu);
  const setSelectedAddress = useUiStore((s) => s.setSelectedAddress);
  const setAttachedAddress = useUiStore((s) => s.setAttachedAddress);
  const detachToEmptyDrawer = useUiStore((s) => s.detachToEmptyDrawer);
  const rememberCardSession = useUiStore((s) => s.rememberCardSession);
  const setLaunchTarget = useUiStore((s) => s.setLaunchTarget);
  const setEditWorktreeTarget = useUiStore((s) => s.setEditWorktreeTarget);
  const setDiffTarget = useUiStore((s) => s.setDiffTarget);
  const setTeardownTarget = useUiStore((s) => s.setTeardownTarget);
  const showToast = useUiStore((s) => s.showToast);

  const menuRef = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number }>({
    left: 0,
    top: 0,
  });

  const close = useCallback(() => setContextMenu(null), [setContextMenu]);

  const items = useMemo<MenuActionItem[]>(() => {
    if (!menu) return [];
    const { project, worktree, sessions, cardKey } = menu;
    const normWtPath = normalizePath(worktree.path);
    const rememberedAddr =
      useUiStore.getState().lastSessionByCardKey[cardKey] ?? null;
    const attachTarget = pickPreferredWorktreeSession(sessions, rememberedAddr);
    const isTargetLive = attachTarget?.terminal.state === "live";
    const primarySession = sessions[0] ?? null;
    const liveShellCount = countWorktreeLiveShells(
      sessions,
      worktree.path,
      project.id
    );
    const shellLimitReached = liveShellCount >= MAX_SHELLS_PER_WORKTREE;

    const handleOpenOrStartAi = async () => {
      close();
      if (attachTarget && isTargetLive) {
        setSelectedAddress(attachTarget.address);
        setAttachedAddress(attachTarget.address);
        rememberCardSession(cardKey, attachTarget.address);
        return;
      }
      try {
        const defaultCmd = project.default_agent || "agy";
        const argv = defaultCmd.split(/\s+/).filter(Boolean);
        const addr = await launchSession({
          project_id: project.id,
          cwd: worktree.path,
          branch: worktree.branch,
          argv,
          name: `${project.name}-${worktree.branch || "main"}`,
          autonomous: true,
        });
        useAppStore.getState().recordLastAgent(normWtPath, argv);
        if (addr) {
          setSelectedAddress(addr);
          setAttachedAddress(addr);
          rememberCardSession(cardKey, addr);
        }
      } catch (err) {
        showToast(`AI 시작 실패: ${String(err)}`, "error");
      }
    };

    const handleLaunchPowerShell = async () => {
      close();
      try {
        const addr = await launchSession({
          project_id: project.id,
          cwd: worktree.path,
          branch: worktree.branch,
          argv: [],
          name: `${project.name}-${worktree.branch || "main"}-sh`,
        });
        if (addr) {
          setSelectedAddress(addr);
          setAttachedAddress(addr);
          rememberCardSession(cardKey, addr);
        }
      } catch (err) {
        showToast(`PowerShell 실행 실패: ${String(err)}`, "error");
      }
    };

    const handleCopyPath = async () => {
      close();
      try {
        await navigator.clipboard.writeText(worktree.path);
        showToast("경로가 클립보드에 복사되었습니다.", "success");
      } catch {
        showToast("클립보드 복사에 실패했습니다.", "error");
      }
    };

    const handleOpenExplorer = async () => {
      close();
      try {
        await openInExplorer(worktree.path);
      } catch (err) {
        showToast(`폴더 열기 실패: ${String(err)}`, "error");
      }
    };

    const handleCloseSession = async () => {
      close();
      if (!primarySession) return;
      try {
        await killTerminal(primarySession.address, true);
        if (useUiStore.getState().attachedAddress === primarySession.address) {
          detachToEmptyDrawer();
        }
        showToast("세션을 종료했습니다.", "info");
      } catch (err) {
        showToast(`세션 종료 실패: ${String(err)}`, "error");
      }
    };

    const list: MenuActionItem[] = [
      {
        id: "open-ai",
        label: isTargetLive
          ? "터미널 열기"
          : `기본 AI 시작 (${project.default_agent || "agy"})`,
        icon: (
          <Bot
            className="w-3.5 h-3.5 shrink-0"
            style={{ color: "var(--accent)" }}
          />
        ),
        onSelect: () => void handleOpenOrStartAi(),
      },
      {
        id: "add-session",
        label: "새 세션 추가 (AI / 터미널)…",
        icon: (
          <Plus
            className="w-3.5 h-3.5 shrink-0"
            style={{ color: "var(--ready-fg)" }}
          />
        ),
        onSelect: () => {
          close();
          setLaunchTarget({
            projectId: project.id,
            cwd: worktree.path,
            branch: worktree.branch,
            defaultAgent: project.default_agent,
          });
        },
      },
      {
        id: "add-shell",
        label: `PowerShell 바로 열기 (${liveShellCount}/${MAX_SHELLS_PER_WORKTREE})`,
        icon: <Terminal className="w-3.5 h-3.5 shrink-0" />,
        disabled: shellLimitReached,
        onSelect: () => void handleLaunchPowerShell(),
      },
      {
        id: "edit-card",
        label: "카드 이름 / 정보 편집…",
        icon: <Pencil className="w-3.5 h-3.5 shrink-0" />,
        dividerBefore: true,
        onSelect: () => {
          close();
          setEditWorktreeTarget({
            projectId: project.id,
            worktreePath: worktree.path,
            branch: worktree.branch,
            isMain: worktree.is_main,
          });
        },
      },
      {
        id: "view-diff",
        label: "Git Diff 보기",
        icon: <FileDiff className="w-3.5 h-3.5 shrink-0" />,
        onSelect: () => {
          close();
          setDiffTarget({
            projectId: project.id,
            worktreePath: worktree.path,
            branch: worktree.branch,
          });
        },
      },
      {
        id: "open-explorer",
        label: "탐색기에서 폴더 열기",
        icon: <FolderOpen className="w-3.5 h-3.5 shrink-0" />,
        onSelect: () => void handleOpenExplorer(),
      },
      {
        id: "copy-path",
        label: "경로 복사",
        icon: <Copy className="w-3.5 h-3.5 shrink-0" />,
        onSelect: () => void handleCopyPath(),
      },
    ];

    if (!worktree.is_main) {
      list.push({
        id: "teardown",
        label: "Worktree 삭제…",
        icon: <Trash2 className="w-3.5 h-3.5 shrink-0" />,
        danger: true,
        dividerBefore: true,
        onSelect: () => {
          close();
          setTeardownTarget({
            projectId: project.id,
            worktreePath: worktree.path,
            branch: worktree.branch,
            isMerged: worktree.is_merged,
            dirtyCount: worktree.dirty_count,
            terminalAddresses: sessions.map((s) => s.address),
          });
        },
      });
    } else if (primarySession) {
      list.push({
        id: "close-session",
        label: "실행 중인 세션 종료",
        icon: <Trash2 className="w-3.5 h-3.5 shrink-0" />,
        danger: true,
        dividerBefore: true,
        onSelect: () => void handleCloseSession(),
      });
    }

    return list;
  }, [
    menu,
    close,
    setSelectedAddress,
    setAttachedAddress,
    detachToEmptyDrawer,
    rememberCardSession,
    setLaunchTarget,
    setEditWorktreeTarget,
    setDiffTarget,
    setTeardownTarget,
    showToast,
  ]);

  // Auto-position inside viewport & grab keyboard focus when menu opens
  useLayoutEffect(() => {
    if (!menu) return;
    setActiveIdx(0);
    const el = menuRef.current;
    const pad = 10;
    const width = el?.offsetWidth ?? 240;
    const height = el?.offsetHeight ?? 320;
    const maxLeft = Math.max(pad, window.innerWidth - width - pad);
    const maxTop = Math.max(pad, window.innerHeight - height - pad);
    setPos({
      left: Math.min(Math.max(pad, menu.x), maxLeft),
      top: Math.min(Math.max(pad, menu.y), maxTop),
    });
    el?.focus();
  }, [menu]);

  // Close on outside click, scroll, or window resize
  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        close();
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menu, close]);

  const moveActive = useCallback(
    (delta: 1 | -1) => {
      if (items.length === 0) return;
      setActiveIdx((prev) => {
        let next = prev;
        for (let step = 0; step < items.length; step++) {
          next = (next + delta + items.length) % items.length;
          if (!items[next]?.disabled) return next;
        }
        return prev;
      });
    },
    [items]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      e.stopPropagation();
      moveActive(1);
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      e.stopPropagation();
      moveActive(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      e.stopPropagation();
      const first = items.findIndex((it) => !it.disabled);
      if (first !== -1) setActiveIdx(first);
    } else if (e.key === "End") {
      e.preventDefault();
      e.stopPropagation();
      for (let i = items.length - 1; i >= 0; i--) {
        if (!items[i].disabled) {
          setActiveIdx(i);
          break;
        }
      }
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      const target = items[activeIdx];
      if (target && !target.disabled) {
        target.onSelect();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  if (!menu) return null;

  return (
    <div
      ref={menuRef}
      tabIndex={-1}
      role="menu"
      onKeyDown={handleKeyDown}
      style={{
        left: `${pos.left}px`,
        top: `${pos.top}px`,
        background: "var(--modal-bg)",
        border: "1px solid var(--modal-border)",
        boxShadow: "0 20px 50px -12px rgba(0, 0, 0, 0.6)",
      }}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-50 min-w-[232px] rounded-2xl p-1.5 select-none outline-none"
    >
      <div
        className="px-3 py-1.5 mb-1 text-[11px] font-mono-code truncate"
        style={{
          color: "var(--text-faint)",
          borderBottom: "1px solid var(--divider)",
        }}
      >
        {menu.project.name} / {menu.worktree.branch || "(detached)"}
      </div>

      {items.map((item, idx) => {
        const isActive = idx === activeIdx && !item.disabled;
        return (
          <React.Fragment key={item.id}>
            {item.dividerBefore && (
              <div
                className="my-1"
                style={{ borderTop: "1px solid var(--divider)" }}
              />
            )}
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onMouseEnter={() => {
                if (!item.disabled) setActiveIdx(idx);
              }}
              onClick={() => {
                if (!item.disabled) item.onSelect();
              }}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-xl text-xs text-left transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: isActive ? "var(--accent-soft)" : "transparent",
                color: item.danger
                  ? "var(--action-fg)"
                  : isActive
                  ? "var(--text-primary)"
                  : "var(--text-secondary)",
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          </React.Fragment>
        );
      })}

      <div
        className="mt-1 pt-1 px-3 text-[10px] font-mono-code flex items-center justify-between"
        style={{
          borderTop: "1px solid var(--divider)",
          color: "var(--text-faint)",
        }}
      >
        <span>↑↓ 이동 · Enter 실행</span>
        <span>Esc</span>
      </div>
    </div>
  );
});
