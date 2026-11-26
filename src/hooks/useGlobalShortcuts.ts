import { useEffect } from "react";
import { useAppStore } from "../store/useAppStore";
import { useUiStore } from "../store/useUiStore";
import type { NavDirection } from "../utils/spatialNav";
import {
  cancelKeyboardCardGrab,
  commitKeyboardCardGrab,
  cycleCurrentWorktreeTab,
  jumpToNextActionable,
  moveQueueSelection,
  moveRadarSpatial,
  openAiLauncherForAttachedWorktree,
  openContextMenuForSelectedCard,
  openOrLaunchCard,
  readBoardCards,
  spawnShellTabInAttachedWorktree,
  stepKeyboardCardGrab,
  toggleSelectedTerminal,
} from "../utils/shortcutActions";

export { jumpToNextActionable };

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

      // 1. Ctrl+` (Backquote): toggle right terminal pane anywhere
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

      // 1b. Ctrl + Shift + Alt + Arrow keys: grab selected worktree card and move target slot (commits 1:1 swap on modifier release)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.altKey) {
        const grabDirMap: Record<string, NavDirection> = {
          ArrowUp: "up",
          ArrowDown: "down",
          ArrowLeft: "left",
          ArrowRight: "right",
        };
        const grabDir = grabDirMap[e.key];
        if (grabDir) {
          e.preventDefault();
          e.stopPropagation();
          stepKeyboardCardGrab(grabDir);
          return;
        }
      }

      // 2. Ctrl + Arrow keys (without Shift/Alt): switch card focus, sync right terminal pane, and focus prompt
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
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
            moveRadarSpatial(ctrlDir, true, true);
          } else if (ui.viewMode === "queue") {
            moveQueueSelection(
              ctrlDir === "down" || ctrlDir === "right" ? 1 : -1,
              true,
              true
            );
          } else if (ui.viewMode === "zen") {
            if (ctrlDir === "right" || ctrlDir === "down") {
              ui.requestZenSkip();
            } else if (ctrlDir === "left" || ctrlDir === "up") {
              ui.requestZenPrev();
            }
          }
          return;
        }
      }

      // 3. Secondary Detach shortcuts inside xterm: Ctrl+\ or Alt+Escape
      const isDetachCombo =
        (e.ctrlKey && !e.altKey && (e.key === "\\" || e.code === "Backslash")) ||
        (e.altKey && e.key === "Escape");
      if (isDetachCombo && (ui.terminalDrawerOpen || ui.attachedAddress)) {
        e.preventDefault();
        e.stopPropagation();
        ui.closeTerminalDrawer();
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }

      // 3a. Alt+Enter: open keyboard-navigable context menu (works inside xterm terminal pane too!)
      if (
        e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey &&
        e.key === "Enter" &&
        (!inInput || inXterm) &&
        !ui.commandPaletteOpen &&
        !ui.quickFileOpen &&
        !ui.markdownViewerTarget &&
        !ui.codeViewerTarget &&
        !ui.projectModalProject &&
        !ui.createWorktreeProjectId &&
        !ui.editWorktreeTarget &&
        !ui.launchTarget &&
        !ui.teardownTarget &&
        !ui.diffTarget &&
        !ui.settingsOpen &&
        !ui.updateModalOpen
      ) {
        if (openContextMenuForSelectedCard()) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }

      // 3b. Ctrl+Tab / Ctrl+Shift+Tab: Cycle between AI & Shell tabs inside current worktree
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        (e.key === "Tab" || e.code === "Tab")
      ) {
        if (ui.attachedAddress) {
          e.preventDefault();
          e.stopPropagation();
          cycleCurrentWorktreeTab(e.shiftKey ? -1 : 1);
          return;
        }
      }

      // 3c. Ctrl+Shift+T (+Shell tab) / Ctrl+Shift+A (+Session modal)
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        !e.altKey &&
        (ui.terminalDrawerOpen || ui.attachedAddress)
      ) {
        const k = e.key.toLowerCase();
        if (k === "t" || e.code === "KeyT") {
          e.preventDefault();
          e.stopPropagation();
          void spawnShellTabInAttachedWorktree();
          return;
        }
        if (k === "a" || e.code === "KeyA") {
          e.preventDefault();
          e.stopPropagation();
          openAiLauncherForAttachedWorktree();
          return;
        }
      }

      // 3d. Ctrl+Shift+D: Toggle Zen Worker Dispatch (safe inside xterm; never intercepts Ctrl+D EOF)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "d" || e.code === "KeyD") {
          e.preventDefault();
          e.stopPropagation();
          if (ui.viewMode === "zen" && ui.zenModeTab === "dispatch") {
            ui.returnToZenInbox();
          } else {
            ui.openZenDispatch();
          }
          return;
        }
      }

      // 4. Global Ctrl shortcuts (IME-independent via e.code)
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        const k = e.key.toLowerCase();
        if (k === "n" || e.code === "KeyN") {
          e.preventDefault();
          e.stopPropagation();
          if (ui.viewMode === "zen") {
            ui.requestZenSkip();
          } else {
            jumpToNextActionable();
          }
          return;
        }
        if (e.key === "Enter" && ui.viewMode === "zen") {
          e.preventDefault();
          e.stopPropagation();
          ui.requestZenApprove();
          return;
        }
        if (k === "f" || e.code === "KeyF") {
          e.preventDefault();
          e.stopPropagation();
          const searchEl = document.querySelector<HTMLInputElement>(
            "[data-jjdr-search-input]"
          );
          if (searchEl) {
            searchEl.focus();
            searchEl.select();
          }
          return;
        }
        if (k === "k" || e.code === "KeyK") {
          e.preventDefault();
          e.stopPropagation();
          ui.setCommandPaletteOpen(!ui.commandPaletteOpen);
          return;
        }
        if (k === "p" || e.code === "KeyP") {
          e.preventDefault();
          e.stopPropagation();
          ui.setQuickFileOpen(!ui.quickFileOpen);
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
        if (k === "3" || e.code === "Digit3") {
          e.preventDefault();
          e.stopPropagation();
          ui.setViewMode("zen");
          return;
        }
        if (k === "b" || e.code === "KeyB") {
          e.preventDefault();
          e.stopPropagation();
          ui.toggleSidebar();
          return;
        }
      }

      // 5. Escape: card grab -> context menu -> modals -> input blur -> close terminal -> clear search -> clear project filter (#9)
      if (e.key === "Escape") {
        if (ui.cardGrabState) {
          e.preventDefault();
          cancelKeyboardCardGrab();
          return;
        }
        if (ui.contextMenu) {
          ui.setContextMenu(null);
          return;
        }
        if (ui.quickFileOpen) {
          ui.setQuickFileOpen(false);
          return;
        }
        if (ui.markdownViewerTarget) {
          ui.setMarkdownViewerTarget(null);
          return;
        }
        if (ui.codeViewerTarget) {
          ui.setCodeViewerTarget(null);
          return;
        }
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
        if (ui.editWorktreeTarget) {
          ui.setEditWorktreeTarget(null);
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
        if (ui.updateModalOpen) {
          ui.setUpdateModalOpen(false);
          return;
        }
        if (inInput && target) {
          e.preventDefault();
          if (target.dataset.jjdrSearchInput === "true") {
            ui.setSearchQuery("");
            target.blur();
            requestAnimationFrame(() => {
              const latestUi = useUiStore.getState();
              if (latestUi.viewMode === "radar") {
                const cards = readBoardCards();
                const targetCard =
                  cards.find((c) => c.key === latestUi.selectedCardKey) ??
                  cards[0] ??
                  null;
                if (targetCard) {
                  latestUi.setSelectedCardKey(targetCard.key);
                  latestUi.setSelectedAddress(targetCard.addr);
                  targetCard.el.scrollIntoView({
                    block: "nearest",
                    behavior: "smooth",
                  });
                }
              } else {
                const sessions = useAppStore.getState().computed.sessions;
                const match =
                  sessions.find(
                    (s) => s.address === latestUi.selectedAddress
                  ) ??
                  sessions[0] ??
                  null;
                if (match) latestUi.setSelectedAddress(match.address);
              }
            });
            return;
          }
          target.blur();
          return;
        }
        if (!inXterm && ui.viewMode === "zen" && ui.zenModeTab === "dispatch") {
          e.preventDefault();
          if (ui.zenDispatchStep === "browse_worker") {
            ui.closeTerminalDrawer();
            ui.setZenDispatchStep("pick_action");
          } else if (ui.zenDispatchStep === "pick_action") {
            ui.setZenDispatchStep("pick_project");
            ui.setZenDispatchProjectId(null);
          } else {
            ui.returnToZenInbox();
          }
          return;
        }
        if (!inXterm && (ui.terminalDrawerOpen || ui.attachedAddress)) {
          e.preventDefault();
          ui.closeTerminalDrawer();
          return;
        }
        if (!inXterm && ui.searchQuery.trim().length > 0) {
          e.preventDefault();
          ui.setSearchQuery("");
          return;
        }
        // #9: Press Esc to clear single-project filter and show all projects again
        if (!inXterm && ui.selectedProjectId !== null) {
          e.preventDefault();
          ui.setSelectedProjectId(null);
          return;
        }
      }

      if (inInput || inXterm || ui.contextMenu) return;

      // 6. Plain navigation (when board/queue has focus)
      const drawerActive = ui.terminalDrawerOpen || Boolean(ui.attachedAddress);
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
          moveRadarSpatial(dir, drawerActive);
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

      if (ui.viewMode === "zen") {
        return;
      }

      // Queue view: linear vertical navigation
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        moveQueueSelection(1, drawerActive);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        moveQueueSelection(-1, drawerActive);
      } else if (e.key === "Enter" && ui.selectedAddress) {
        e.preventDefault();
        void openOrLaunchCard(null, ui.selectedAddress);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!useUiStore.getState().cardGrabState) return;
      if (
        e.key === "Control" ||
        e.key === "Shift" ||
        e.key === "Alt" ||
        e.key === "Meta"
      ) {
        commitKeyboardCardGrab();
      }
    };

    const onWindowBlur = () => {
      cancelKeyboardCardGrab();
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, []);
}
