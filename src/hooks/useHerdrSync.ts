import { useEffect, useRef, useState } from "react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import {
  getInitialState,
  hideBgOverlay,
  isTauriRuntime,
  listAllWorktrees,
  listTemplates,
  listenMainBgChanged,
  listenOverlayDismissed,
  listenOverlayOpenCard,
  listenStateBatch,
  listenWorktreeTeardownResult,
  loadPersistedBundle,
  saveUiState,
  showBgOverlay,
  updateTraySummary,
} from "../services/tauriBridge";
import { useAppStore } from "../store/useAppStore";
import { useUiStore } from "../store/useUiStore";
import type { DashboardWorkerResult, StateBatchPayload } from "../types/domain";
import { normalizePath, type DashboardComputeInput } from "../workers/dashboardLogic";
import { getWorktreeLiveSessions } from "../utils/worktreeSessions";
import {
  buildBgOverlayPayload,
  normalizeBgOverlayPosition,
  selectTopBgOverlayCandidate,
} from "../utils/bgOverlay";

export function useHerdrSync() {
  const workerRef = useRef<Worker | null>(null);
  const reqIdRef = useRef(0);
  const notifiedBlockedRef = useRef<Set<string>>(new Set());
  const rehydratedAttachRef = useRef(false);
  const worktreesLoadedRef = useRef(false);
  const startupZenRoutedRef = useRef(false);
  const dismissedOverlayStampRef = useRef<string | null>(null);
  const lastOverlaySignatureRef = useRef<string | null>(null);
  const isMainInBackgroundRef = useRef<boolean>(false);
  const lastWorktreesJsonRef = useRef<string>("");
  const lastWorkerDispatchMsRef = useRef<number>(0);
  const workerThrottleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isMainInBackground, setIsMainInBackground] = useState<boolean>(false);

  // 1. Initialize Web Worker once
  useEffect(() => {
    const worker = new Worker(
      new URL("../workers/dashboardWorker.ts", import.meta.url),
      { type: "module" }
    );
    worker.onmessage = (e: MessageEvent<{ id: number; result: DashboardWorkerResult }>) => {
      if (e.data.id !== reqIdRef.current) return;
      const app = useAppStore.getState();
      app.setComputed(e.data.result);

      // One-time startup Zen routing after initial hydration + worktrees + herdr-core snapshot:
      // All Clear (0 actionable) -> Zen Dispatch; otherwise -> Zen Inbox.
      if (
        !startupZenRoutedRef.current &&
        app.hydrated &&
        app.health.connected &&
        worktreesLoadedRef.current
      ) {
        startupZenRoutedRef.current = true;
        const actionable =
          e.data.result.byBucket.needs_you.length +
          e.data.result.byBucket.ready.length;
        useUiStore
          .getState()
          .completeStartupRouting(actionable === 0 ? "dispatch" : "inbox");
      }
    };
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // 2. Initial hydration & live Tauri event subscription
  useEffect(() => {
    if (!isTauriRuntime()) {
      startupZenRoutedRef.current = true;
      useUiStore.getState().completeStartupRouting("dispatch");
      return;
    }
    let active = true;
    let unlisten: (() => void) | null = null;

    // Safety fallback: never stay on splash > 1.8s even if herdr-core daemon is offline
    const splashFallbackTimer = setTimeout(() => {
      if (!active || startupZenRoutedRef.current) return;
      startupZenRoutedRef.current = true;
      const computed = useAppStore.getState().computed;
      const actionable =
        computed.byBucket.needs_you.length + computed.byBucket.ready.length;
      useUiStore
        .getState()
        .completeStartupRouting(actionable === 0 ? "dispatch" : "inbox");
    }, 1800);

    const pendingAttachedRef = { current: null as string | null };

    const tryRehydrateAttach = (terminalsList: StateBatchPayload["terminals"]) => {
      if (rehydratedAttachRef.current || !pendingAttachedRef.current) return;
      const target = pendingAttachedRef.current;
      const match = terminalsList.find((t) => t.address === target);
      if (match) {
        rehydratedAttachRef.current = true;
        const ui = useUiStore.getState();
        // In Zen Mode, let Zen Inbox / Dispatch own terminal attach so Dispatch starts clean
        if (ui.viewMode === "zen") {
          return;
        }
        if (match.state === "live") {
          ui.setAttachedAddress(target);
        } else {
          ui.setAttachedAddress(null);
        }
      }
    };

    const handleBatch = (batch: StateBatchPayload) => {
      if (!active) return;
      const store = useAppStore.getState();
      const prevTerminals = store.terminals;
      store.applyBatch(batch);

      // Only restore attached terminal if it is verified live (prevents "tX has finished" errors)
      if (batch.health.connected) {
        tryRehydrateAttach(batch.terminals);
        // If connected full sync arrived and saved attached terminal is no longer live, clear it
        if (batch.full_sync && pendingAttachedRef.current && !rehydratedAttachRef.current) {
          rehydratedAttachRef.current = true;
          useUiStore.getState().setAttachedAddress(null);
        }
      }

      // If currently attached terminal just finished (e.g. user ran `exit` in PowerShell tab),
      // switch gracefully to another live tab in the same worktree before closing the drawer.
      const curAttached = useUiStore.getState().attachedAddress;
      if (curAttached) {
        const updated = batch.terminals.find((t) => t.address === curAttached);
        if (updated && updated.state !== "live") {
          const allSessions = useAppStore.getState().computed.allSessions;
          const current =
            allSessions.find((s) => s.address === curAttached) ?? null;
          const siblings = getWorktreeLiveSessions(allSessions, current).filter(
            (s) => s.address !== curAttached
          );
          if (siblings.length > 0) {
            useUiStore.getState().setSelectedAddress(siblings[0].address);
            useUiStore.getState().setAttachedAddress(siblings[0].address);
          } else {
            useUiStore.getState().setAttachedAddress(null);
          }
        }
      }

      // Calm notifications: notify once on newly blocked/error terminals
      const { settings } = useAppStore.getState();
      let shouldRefreshWorktrees = false;
      for (const t of batch.terminals) {
        const st = t.status?.state;
        const prevSt = prevTerminals[t.address]?.status?.state;
        if (st === "working") {
          store.clearAckedSnapshot(t.address);
        }
        if ((st === "done" || t.state === "finished") && prevSt === "working") {
          shouldRefreshWorktrees = true;
        }
        if (st === "blocked" || st === "error") {
          const key = `${t.address}:${t.status_ms ?? t.turn}`;
          // Only send OS notification when app is in background (never interrupt active foreground use)
          if (
            isMainInBackgroundRef.current &&
            !notifiedBlockedRef.current.has(key) &&
            settings.notify_on_blocked
          ) {
            notifiedBlockedRef.current.add(key);
            void triggerCalmNotification(
              `jjdr: ${t.name || t.address} needs attention`,
              t.status?.msg || t.status?.kind || st
            );
          }
        }
      }

      if (shouldRefreshWorktrees) {
        void listAllWorktrees()
          .then((map) => {
            if (active) useAppStore.getState().setWorktreesByProject(map);
          })
          .catch(() => {});
      }
    };

    const bootstrap = async () => {
      try {
        // Subscribe to state batches FIRST so we never miss the supervisor's initial connect event!
        unlisten = await listenStateBatch(handleBatch);
        if (!active) {
          unlisten();
          return;
        }

        const [initialBatch, bundle] = await Promise.all([
          getInitialState(),
          loadPersistedBundle(),
        ]);
        if (!active) return;

        useAppStore.getState().setHydratedData({
          projects: bundle.projects,
          settings: bundle.settings,
          ackTurns: bundle.ui_state.ack_turns ?? {},
          queuedPrompts: bundle.ui_state.queued_prompts ?? {},
          lastAgentByWorktree: bundle.ui_state.last_agent_by_worktree ?? {},
          worktreeMeta: bundle.ui_state.worktree_meta ?? {},
          worktreeOrderByProject: bundle.ui_state.worktree_order_by_project ?? {},
        });

        const ui = useUiStore.getState();
        // Keep Splash visible until the first connected snapshot computes and routes to Dispatch or Inbox.
        if (bundle.ui_state.active_group) {
          ui.setActiveGroup(bundle.ui_state.active_group);
        }
        if (bundle.ui_state.selected_terminal) {
          ui.setSelectedAddress(bundle.ui_state.selected_terminal);
        }
        if (
          typeof bundle.ui_state.terminal_width_px === "number" &&
          bundle.ui_state.terminal_width_px >= 320
        ) {
          ui.setTerminalWidthPx(bundle.ui_state.terminal_width_px);
        }
        // Defer restoring attached_terminal until verified `live` in snapshot
        if (bundle.ui_state.attached_terminal) {
          pendingAttachedRef.current = bundle.ui_state.attached_terminal;
        }

        handleBatch(initialBatch);

        // If supervisor was still handshaking during initial call, re-pull snapshot once after 800ms
        if (!initialBatch.health.connected) {
          setTimeout(() => {
            if (!active) return;
            void getInitialState()
              .then((snap) => {
                if (active) handleBatch(snap);
              })
              .catch(() => {});
          }, 800);
        }

        const [wts, templates] = await Promise.all([
          listAllWorktrees().catch(() => ({})),
          listTemplates().catch(() => []),
        ]);
        if (!active) return;
        worktreesLoadedRef.current = true;
        useAppStore.getState().setWorktreesByProject(wts);
        useAppStore.getState().setTemplates(templates);
      } catch (err) {
        console.error("Failed to bootstrap jjdr state:", err);
      }
    };

    void bootstrap();

    // Periodic lightweight Git worktree refresh (45s) in Rust background worker;
    // skips Zustand state updates when nothing changed to avoid unnecessary re-renders.
    const gitTimer = setInterval(() => {
      if (!active || document.hidden || isMainInBackgroundRef.current) return;
      void listAllWorktrees()
        .then((map) => {
          if (!active) return;
          const sig = JSON.stringify(map);
          if (sig === lastWorktreesJsonRef.current) return;
          lastWorktreesJsonRef.current = sig;
          useAppStore.getState().setWorktreesByProject(map);
        })
        .catch(() => {});
    }, 45_000);

    return () => {
      active = false;
      clearTimeout(splashFallbackTimer);
      clearInterval(gitTimer);
      if (unlisten) unlisten();
    };
  }, []);

  // 3. Dispatch recomputation to Web Worker whenever inputs change
  const terminals = useAppStore((s) => s.terminals);
  const previews = useAppStore((s) => s.previews);
  const projects = useAppStore((s) => s.projects);
  const worktreesByProject = useAppStore((s) => s.worktreesByProject);
  const ackTurns = useAppStore((s) => s.ackTurns);
  const ackedSnapshots = useAppStore((s) => s.ackedSnapshots);
  const queuedPrompts = useAppStore((s) => s.queuedPrompts);
  const worktreeMeta = useAppStore((s) => s.worktreeMeta);
  const worktreeOrderByProject = useAppStore((s) => s.worktreeOrderByProject);
  const stuckMinutes = useAppStore((s) => s.settings.stuck_minutes);
  const searchQuery = useUiStore((s) => s.searchQuery);
  const activeGroup = useUiStore((s) => s.activeGroup);
  const selectedProjectId = useUiStore((s) => s.selectedProjectId);

  useEffect(() => {
    const dispatch = () => {
      if (!workerRef.current) return;
      lastWorkerDispatchMsRef.current = Date.now();
      const id = ++reqIdRef.current;
      const payload: DashboardComputeInput = {
        terminals: Object.values(terminals),
        previews,
        projects,
        worktreesByProject,
        ackTurns,
        ackedSnapshots,
        queuedPrompts,
        worktreeMeta,
        worktreeOrderByProject,
        stuckMinutesThreshold: stuckMinutes,
        searchQuery,
        activeGroup,
        selectedProjectId,
        nowMs: Date.now(),
      };
      workerRef.current.postMessage({ id, payload });
    };

    // Leading + trailing 80ms throttle prevents postMessage / full-board re-render storms during bursts
    const elapsed = Date.now() - lastWorkerDispatchMsRef.current;
    if (workerThrottleTimerRef.current) {
      clearTimeout(workerThrottleTimerRef.current);
      workerThrottleTimerRef.current = null;
    }
    if (elapsed >= 80) {
      dispatch();
    } else {
      workerThrottleTimerRef.current = setTimeout(() => {
        workerThrottleTimerRef.current = null;
        dispatch();
      }, 80 - elapsed);
    }

    // Refresh elapsed / stuck classification every 30s
    const tick = setInterval(dispatch, 30_000);
    return () => {
      clearInterval(tick);
      if (workerThrottleTimerRef.current) {
        clearTimeout(workerThrottleTimerRef.current);
        workerThrottleTimerRef.current = null;
      }
    };
  }, [
    terminals,
    previews,
    projects,
    worktreesByProject,
    ackTurns,
    ackedSnapshots,
    queuedPrompts,
    worktreeMeta,
    worktreeOrderByProject,
    stuckMinutes,
    searchQuery,
    activeGroup,
    selectedProjectId,
  ]);

  // 4. Keep system tray summary in sync with global (unfiltered) counts
  const globalCounts = useAppStore((s) => s.computed.globalCounts);
  useEffect(() => {
    void updateTraySummary(
      globalCounts.needsYou,
      globalCounts.ready,
      globalCounts.running
    ).catch(() => {});
  }, [globalCounts.needsYou, globalCounts.ready, globalCounts.running]);

  // 4b. Track foreground/background state & overlay interaction events
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let active = true;
    const unlisteners: Array<() => void> = [];

    let bgDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    const markBg = (inBg: boolean) => {
      if (!active) return;
      if (bgDebounceTimer) {
        clearTimeout(bgDebounceTimer);
        bgDebounceTimer = null;
      }
      if (!inBg) {
        isMainInBackgroundRef.current = false;
        dismissedOverlayStampRef.current = null;
        lastOverlaySignatureRef.current = null;
        setIsMainInBackground(false);
        return;
      }
      // Small debounce prevents false notifications during brief internal focus flickers
      bgDebounceTimer = setTimeout(() => {
        bgDebounceTimer = null;
        if (!active) return;
        isMainInBackgroundRef.current = true;
        setIsMainInBackground(true);
      }, 300);
    };

    const onWindowBlur = () => markBg(true);
    const onWindowFocus = () => markBg(false);
    const onVisibilityChange = () => {
      if (document.hidden) markBg(true);
    };

    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("focus", onWindowFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    void Promise.all([
      listenMainBgChanged((inBg) => markBg(inBg)),
      listenOverlayDismissed((stamp) => {
        dismissedOverlayStampRef.current = stamp;
        lastOverlaySignatureRef.current = null;
      }),
      listenOverlayOpenCard(({ card_key, address }) => {
        const ui = useUiStore.getState();
        if (card_key && card_key !== "__preview__") {
          ui.setSelectedCardKey(card_key);
        }
        if (address) {
          ui.setSelectedAddress(address);
          ui.setAttachedAddress(address);
          ui.requestTerminalFocus();
        }
      }),
      listenWorktreeTeardownResult((ev) => {
        const normWt = normalizePath(ev.worktree_path);
        useAppStore
          .getState()
          .finishWorktreeRemoving(ev.project_id, normWt, ev.worktrees ?? null);
        if (ev.ok) {
          useUiStore
            .getState()
            .showToast(`Worktree '${ev.branch_name}' 삭제 완료`, "success");
        } else {
          useUiStore
            .getState()
            .showToast(
              `Worktree '${ev.branch_name}' 삭제 실패: ${ev.error ?? "알 수 없는 오류"}`,
              "error",
              6000
            );
        }
      }),
    ])
      .then((fns) => {
        if (!active) {
          fns.forEach((fn) => fn());
        } else {
          unlisteners.push(...fns);
        }
      })
      .catch(() => {});

    return () => {
      active = false;
      if (bgDebounceTimer) clearTimeout(bgDebounceTimer);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("focus", onWindowFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      unlisteners.forEach((fn) => fn());
    };
  }, []);

  // 4c. Background Top-Priority Card HUD Notification sync
  const allSessions = useAppStore((s) => s.computed.allSessions);
  const bgOverlayEnabled = useAppStore((s) => s.settings.bg_overlay_enabled ?? false);
  const bgOverlayPosition = useAppStore((s) =>
    normalizeBgOverlayPosition(s.settings.bg_overlay_position)
  );
  const theme = useAppStore((s) => s.settings.theme);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    if (!bgOverlayEnabled) {
      lastOverlaySignatureRef.current = null;
      // Destroy overlay webview when disabled so it consumes 0 MB RAM / 0 GPU
      void hideBgOverlay(true).catch(() => {});
      return;
    }

    if (!isMainInBackground) {
      // Foreground hides real alerts (Rust Focused(true) already hides immediately,
      // and leaving settings preview untouched if SettingsModal triggered one)
      lastOverlaySignatureRef.current = null;
      return;
    }

    const { top, pendingCount } = selectTopBgOverlayCandidate(allSessions);
    if (!top) {
      lastOverlaySignatureRef.current = null;
      void hideBgOverlay().catch(() => {});
      return;
    }

    const payload = buildBgOverlayPayload(
      top,
      pendingCount,
      bgOverlayPosition,
      theme,
      false,
      worktreeMeta
    );

    if (dismissedOverlayStampRef.current === payload.stamp) {
      return;
    }

    const sig = `${payload.stamp}|${payload.position}|${payload.theme}|${payload.pending_count}`;
    if (lastOverlaySignatureRef.current === sig) {
      return;
    }
    lastOverlaySignatureRef.current = sig;

    void showBgOverlay(payload, false).catch(() => {});
  }, [
    allSessions,
    worktreeMeta,
    bgOverlayEnabled,
    bgOverlayPosition,
    theme,
    isMainInBackground,
  ]);

  // 5. Persist UI state (debounced 800ms) for zero-loss session restoration across restarts
  const hydrated = useAppStore((s) => s.hydrated);
  const lastAgentByWorktree = useAppStore((s) => s.lastAgentByWorktree);
  const viewMode = useUiStore((s) => s.viewMode);
  const selectedAddress = useUiStore((s) => s.selectedAddress);
  const attachedAddress = useUiStore((s) => s.attachedAddress);
  const terminalWidthPx = useUiStore((s) => s.terminalWidthPx);

  useEffect(() => {
    if (!hydrated || !isTauriRuntime()) return;
    const timer = setTimeout(() => {
      void saveUiState({
        view_mode: viewMode,
        selected_terminal: selectedAddress,
        attached_terminal: attachedAddress,
        active_group: activeGroup,
        ack_turns: ackTurns,
        queued_prompts: queuedPrompts,
        last_agent_by_worktree: lastAgentByWorktree,
        terminal_width_px: terminalWidthPx,
        worktree_meta: worktreeMeta,
        worktree_order_by_project: worktreeOrderByProject,
      }).catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [
    hydrated,
    viewMode,
    selectedAddress,
    attachedAddress,
    terminalWidthPx,
    activeGroup,
    ackTurns,
    queuedPrompts,
    lastAgentByWorktree,
    worktreeMeta,
    worktreeOrderByProject,
  ]);
}

async function triggerCalmNotification(title: string, body: string) {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const perm = await requestPermission();
      granted = perm === "granted";
    }
    if (granted) {
      sendNotification({ title, body });
    }
  } catch {
    // Notification plugin optional on desktop
  }
}
