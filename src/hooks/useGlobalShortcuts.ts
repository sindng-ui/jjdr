import { useEffect } from "react";
import { useAppStore } from "../store/useAppStore";
import { useUiStore } from "../store/useUiStore";
import { launchSession } from "../services/tauriBridge";
import { normalizePath } from "../workers/dashboardLogic";
import {
  findNextCardInDirection,
  type CardRect,
  type NavDirection,
} from "../utils/spatialNav";

interface DomBoardCard extends CardRect {
  el: HTMLElement;
  addr: string | null;
  projectId: string | null;
  worktreePath: string | null;
  branch: string | null;
}

function readBoardCards(): DomBoardCard[] {
  const nodes = Array.from(
    document.querySelectorAll<HTMLElement>("[data-jjdr-card]")
  );
  return nodes
    .map((el) => {
      const r = el.getBoundingClientRect();
      return {
        key: el.dataset.jjdrCard || "",
        addr: el.dataset.jjdrSessionAddr || null,
        projectId: el.dataset.jjdrProjectId || null,
        worktreePath: el.dataset.jjdrWorktreePath || null,
        branch: el.dataset.jjdrBranch || null,
        el,
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
      };
    })
    .filter((c) => c.key && c.right > c.left && c.bottom > c.top);
}

async function openOrLaunchCard(card: DomBoardCard | null, fallbackAddr: string | null) {
  const ui = useUiStore.getState();
  const app = useAppStore.getState();

  const addr = card?.addr ?? fallbackAddr;
  if (addr) {
    const term = app.terminals[addr];
    if (term && term.state === "live") {
      ui.setSelectedAddress(addr);
      ui.setAttachedAddress(addr);
      return;
    }
  }

  // No live AI in this card yet -> auto-launch default AI (YOLO) & attach right pane immediately!
  if (card?.projectId && card.worktreePath) {
    const proj = app.projects.find((p) => p.id === card.projectId);
    if (!proj) return;
    try {
      const defaultCmd = proj.default_agent || "agy";
      const argv = defaultCmd.split(/\s+/).filter(Boolean);
      const newAddr = await launchSession({
        project_id: proj.id,
        cwd: card.worktreePath,
        branch: card.branch ?? undefined,
        argv,
        name: `${proj.name}-${(card.branch || "main").replace(/[/\\ ]/g, "-")}`,
        autonomous: true,
      });
      app.recordLastAgent(normalizePath(card.worktreePath), argv);
      if (newAddr) {
        ui.setSelectedCardKey(card.key);
        ui.setSelectedAddress(newAddr);
        ui.setAttachedAddress(newAddr);
      }
    } catch (err) {
      ui.showToast(`AI 시작 실패: ${String(err)}`, "error");
    }
  }
}

export function useGlobalShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      const inXterm = target?.closest(".xterm") !== null;
      const ui = useUiStore.getState();

      // 1. Ctrl+` (Backquote): toggle right terminal pane anywhere (including inside xterm!)
      const isTerminalToggle =
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        (e.code === "Backquote" || e.key === "`");
      if (isTerminalToggle) {
        e.preventDefault();
        e.stopPropagation();
        void toggleSelectedTerminal(inXterm);
        return;
      }

      // 2. Ctrl + Arrow keys: switch left card focus AND sync right terminal pane even while focused inside xterm!
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const ctrlDirMap: Record<string, NavDirection> = {
          ArrowUp: "up",
          ArrowDown: "down",
          ArrowLeft: "left",
          ArrowRight: "right",
        };
        const ctrlDir = ctrlDirMap[e.key];
        if (ctrlDir) {
          e.preventDefault();
          e.stopPropagation();
          if (ui.viewMode === "radar") {
            moveRadarSpatial(ctrlDir, true);
          } else {
            moveQueueSelection(
              ctrlDir === "down" || ctrlDir === "right" ? 1 : -1,
              true
            );
          }
          return;
        }
      }

      // 3. Secondary Detach shortcuts inside xterm: Ctrl+\ or Alt+Escape
      const isDetachCombo =
        (e.ctrlKey && !e.altKey && (e.key === "\\" || e.code === "Backslash")) ||
        (e.altKey && e.key === "Escape");
      if (isDetachCombo && ui.attachedAddress) {
        e.preventDefault();
        e.stopPropagation();
        ui.setAttachedAddress(null);
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }

      // 4. Global Ctrl shortcuts that work EVERYWHERE (including while right xterm terminal is open/focused, and under Korean IME)
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        const k = e.key.toLowerCase();
        if (k === "n" || e.code === "KeyN") {
          e.preventDefault();
          e.stopPropagation();
          jumpToNextActionable();
          return;
        }
        if (k === "k" || e.code === "KeyK") {
          e.preventDefault();
          e.stopPropagation();
          ui.setCommandPaletteOpen(!ui.commandPaletteOpen);
          return;
        }
        if (k === "m" || e.code === "KeyM") {
          e.preventDefault();
          e.stopPropagation();
          ui.toggleViewMode();
          return;
        }
        if (k === "1" || e.code === "Digit1") {
          e.preventDefault();
          e.stopPropagation();
          ui.setViewMode("radar");
          return;
        }
        if (k === "2" || e.code === "Digit2") {
          e.preventDefault();
          e.stopPropagation();
          ui.setViewMode("queue");
          return;
        }
        if (k === "b" || e.code === "KeyB") {
          e.preventDefault();
          e.stopPropagation();
          ui.toggleSidebar();
          return;
        }
      }

      // 6. Escape: close modals -> blur search input -> detach terminal (when outside xterm)
      if (e.key === "Escape") {
        if (ui.commandPaletteOpen) {
          ui.setCommandPaletteOpen(false);
          return;
        }
        if (ui.diffTarget) {
          ui.setDiffTarget(null);
          return;
        }
        if (ui.teardownTarget) {
          ui.setTeardownTarget(null);
          return;
        }
        if (ui.projectModalProject) {
          ui.setProjectModalProject(null);
          return;
        }
        if (ui.createWorktreeProjectId) {
          ui.setCreateWorktreeProjectId(null);
          return;
        }
        if (ui.launchTarget) {
          ui.setLaunchTarget(null);
          return;
        }
        if (ui.settingsOpen) {
          ui.setSettingsOpen(false);
          return;
        }
        if (inInput && target) {
          e.preventDefault();
          target.blur();
          return;
        }
        if (!inXterm && ui.attachedAddress) {
          e.preventDefault();
          ui.setAttachedAddress(null);
          return;
        }
      }

      if (inInput || inXterm) return;

      // 7. Plain navigation (when board/queue has focus)
      if (ui.viewMode === "radar") {
        const dirMap: Record<string, NavDirection> = {
          ArrowUp: "up",
          ArrowDown: "down",
          ArrowLeft: "left",
          ArrowRight: "right",
          k: "up",
          j: "down",
          h: "left",
          l: "right",
        };
        const dir = dirMap[e.key];
        if (dir) {
          e.preventDefault();
          moveRadarSpatial(dir, Boolean(ui.attachedAddress));
          return;
        }

        if (e.key === "Enter") {
          const cards = readBoardCards();
          const current =
            cards.find((c) => c.key === ui.selectedCardKey) ?? cards[0] ?? null;
          if (!current) return;
          e.preventDefault();
          ui.setSelectedCardKey(current.key);
          void openOrLaunchCard(current, current.addr);
          return;
        }
        return;
      }

      // Queue view: linear vertical navigation
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        moveQueueSelection(1, Boolean(ui.attachedAddress));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        moveQueueSelection(-1, Boolean(ui.attachedAddress));
      } else if (e.key === "Enter" && ui.selectedAddress) {
        e.preventDefault();
        void openOrLaunchCard(null, ui.selectedAddress);
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}

async function toggleSelectedTerminal(fromXterm: boolean) {
  const ui = useUiStore.getState();

  // Inside xterm -> Ctrl+` always detaches cleanly back to radar/queue
  if (fromXterm && ui.attachedAddress) {
    ui.setAttachedAddress(null);
    (document.activeElement as HTMLElement | null)?.blur();
    return;
  }

  let currentCard: DomBoardCard | null = null;
  let targetAddr: string | null = ui.selectedAddress;

  if (ui.viewMode === "radar") {
    const cards = readBoardCards();
    currentCard = cards.find((c) => c.key === ui.selectedCardKey) ?? cards[0] ?? null;
    if (currentCard) {
      ui.setSelectedCardKey(currentCard.key);
      targetAddr = currentCard.addr;
      ui.setSelectedAddress(targetAddr);
    }
  }

  // Pressing Ctrl+` again on the already-attached session detaches it
  if (ui.attachedAddress && (!targetAddr || ui.attachedAddress === targetAddr)) {
    ui.setAttachedAddress(null);
    (document.activeElement as HTMLElement | null)?.blur();
    return;
  }

  await openOrLaunchCard(currentCard, targetAddr);
}

const pendingShellLaunches = new Set<string>();

async function launchDefaultShellAndAttach(card: DomBoardCard) {
  if (!card.worktreePath || pendingShellLaunches.has(card.key)) return;
  pendingShellLaunches.add(card.key);
  const ui = useUiStore.getState();
  const app = useAppStore.getState();
  const proj = card.projectId
    ? app.projects.find((p) => p.id === card.projectId)
    : undefined;

  try {
    const newAddr = await launchSession({
      project_id: card.projectId ?? undefined,
      cwd: card.worktreePath,
      branch: card.branch ?? undefined,
      // Empty argv -> herdr-core spawns the OS default shell (PowerShell/pwsh on Windows)
      argv: [],
      name: proj
        ? `${proj.name}-${(card.branch || "main").replace(/[/\\ ]/g, "-")}-sh`
        : undefined,
    });
    if (newAddr) {
      // Only attach if the user is still focused on this card and pane is still open
      const latestUi = useUiStore.getState();
      if (latestUi.selectedCardKey === card.key && latestUi.attachedAddress !== null) {
        latestUi.setSelectedAddress(newAddr);
        latestUi.setAttachedAddress(newAddr);
      }
    }
  } catch (err) {
    ui.showToast(`PowerShell 실행 실패: ${String(err)}`, "error");
  } finally {
    pendingShellLaunches.delete(card.key);
  }
}

function moveRadarSpatial(dir: NavDirection, syncAttachedPane: boolean) {
  const cards = readBoardCards();
  if (cards.length === 0) return;

  const ui = useUiStore.getState();
  const nextKey = findNextCardInDirection(cards, ui.selectedCardKey, dir);
  if (!nextKey) return;

  const nextCard = cards.find((c) => c.key === nextKey);
  if (!nextCard) return;

  ui.setSelectedCardKey(nextCard.key);
  ui.setSelectedAddress(nextCard.addr);
  nextCard.el.scrollIntoView({ block: "nearest", behavior: "smooth" });

  if (syncAttachedPane && ui.attachedAddress) {
    if (nextCard.addr) {
      const term = useAppStore.getState().terminals[nextCard.addr];
      if (term && term.state === "live") {
        ui.setAttachedAddress(nextCard.addr);
        return;
      }
    }
    // Keep right pane open and launch default PowerShell at this project/worktree path!
    if (nextCard.worktreePath) {
      void launchDefaultShellAndAttach(nextCard);
    }
  }
}

export function jumpToNextActionable() {
  const { allSessions } = useAppStore.getState().computed;
  const actionable = allSessions.filter(
    (s) => s.bucket === "needs_you" || s.bucket === "ready"
  );
  if (actionable.length === 0) {
    useUiStore
      .getState()
      .showToast("확인할 작업이 없습니다!", "success");
    return;
  }
  const ui = useUiStore.getState();
  const curIdx = actionable.findIndex((s) => s.address === ui.selectedAddress);
  const next = actionable[(curIdx + 1) % actionable.length];
  if (ui.selectedProjectId && next.projectId !== ui.selectedProjectId) {
    ui.setSelectedProjectId(null);
  }
  ui.setSelectedAddress(next.address);
  if (ui.viewMode === "radar" && next.projectId) {
    const syncRadarCard = () => {
      const cards = readBoardCards();
      const match = cards.find((c) => c.addr === next.address);
      if (match) {
        useUiStore.getState().setSelectedCardKey(match.key);
        match.el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        return true;
      }
      return false;
    };
    if (!syncRadarCard()) {
      requestAnimationFrame(() => {
        syncRadarCard();
      });
    }
  }
  if (ui.attachedAddress && next.terminal.state === "live") {
    ui.setAttachedAddress(next.address);
  }
}

function moveQueueSelection(delta: number, syncAttachedPane: boolean) {
  const sessions = useAppStore.getState().computed.sessions;
  if (sessions.length === 0) return;
  const ui = useUiStore.getState();
  const curIdx = sessions.findIndex((s) => s.address === ui.selectedAddress);
  const nextIdx =
    curIdx === -1
      ? delta > 0
        ? 0
        : sessions.length - 1
      : (curIdx + delta + sessions.length) % sessions.length;
  const next = sessions[nextIdx];
  ui.setSelectedAddress(next.address);

  if (syncAttachedPane && ui.attachedAddress && next.terminal.state === "live") {
    ui.setAttachedAddress(next.address);
  }
}
