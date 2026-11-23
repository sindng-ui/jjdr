import { useEffect, useRef } from "react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import {
  getInitialState,
  isTauriRuntime,
  listAllWorktrees,
  listTemplates,
  listenStateBatch,
  loadPersistedBundle,
  saveUiState,
  updateTraySummary,
} from "../services/tauriBridge";
import { useAppStore } from "../store/useAppStore";
import { useUiStore } from "../store/useUiStore";
import type { DashboardWorkerResult, StateBatchPayload } from "../types/domain";
import type { DashboardComputeInput } from "../workers/dashboardLogic";
import { getWorktreeLiveSessions } from "../utils/worktreeSessions";

export function useHerdrSync() {
  const workerRef = useRef<Worker | null>(null);
  const reqIdRef = useRef(0);
  const notifiedBlockedRef = useRef<Set<string>>(new Set());
  const rehydratedAttachRef = useRef(false);

  // 1. Initialize Web Worker once
  useEffect(() => {
    const worker = new Worker(
      new URL("../workers/dashboardWorker.ts", import.meta.url),
      { type: "module" }
    );
    worker.onmessage = (e: MessageEvent<{ id: number; result: DashboardWorkerResult }>) => {
      if (e.data.id !== reqIdRef.current) return;
      useAppStore.getState().setComputed(e.data.result);
    };
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // 2. Initial hydration & live Tauri event subscription
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let active = true;
    let unlisten: (() => void) | null = null;

    const pendingAttachedRef = { current: null as string | null };

    const tryRehydrateAttach = (terminalsList: StateBatchPayload["terminals"]) => {
      if (rehydratedAttachRef.current || !pendingAttachedRef.current) return;
      const target = pendingAttachedRef.current;
      const match = terminalsList.find((t) => t.address === target);
      if (match) {
        rehydratedAttachRef.current = true;
        if (match.state === "live") {
          useUiStore.getState().setAttachedAddress(target);
        } else {
          useUiStore.getState().setAttachedAddress(null);
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
        if ((st === "done" || t.state === "finished") && prevSt === "working") {
          shouldRefreshWorktrees = true;
        }
        if (st === "blocked" || st === "error") {
          const key = `${t.address}:${t.status_ms ?? t.turn}`;
          if (!notifiedBlockedRef.current.has(key) && settings.notify_on_blocked) {
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
        });

        const ui = useUiStore.getState();
        if (bundle.ui_state.view_mode === "queue" || bundle.ui_state.view_mode === "radar") {
          ui.setViewMode(bundle.ui_state.view_mode);
        } else {
          ui.setViewMode("radar");
        }
        if (bundle.ui_state.active_group) {
          ui.setActiveGroup(bundle.ui_state.active_group);
        }
        if (bundle.ui_state.selected_terminal) {
          ui.setSelectedAddress(bundle.ui_state.selected_terminal);
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
        useAppStore.getState().setWorktreesByProject(wts);
        useAppStore.getState().setTemplates(templates);
      } catch (err) {
        console.error("Failed to bootstrap jjdr state:", err);
      }
    };

    void bootstrap();

    // Periodic lightweight Git worktree refresh (15s) in Rust background worker
    const gitTimer = setInterval(() => {
      if (!active || document.hidden) return;
      void listAllWorktrees()
        .then((map) => {
          if (active) useAppStore.getState().setWorktreesByProject(map);
        })
        .catch(() => {});
    }, 15_000);

    return () => {
      active = false;
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
  const queuedPrompts = useAppStore((s) => s.queuedPrompts);
  const stuckMinutes = useAppStore((s) => s.settings.stuck_minutes);
  const searchQuery = useUiStore((s) => s.searchQuery);
  const activeGroup = useUiStore((s) => s.activeGroup);
  const selectedProjectId = useUiStore((s) => s.selectedProjectId);

  useEffect(() => {
    const dispatch = () => {
      if (!workerRef.current) return;
      const id = ++reqIdRef.current;
      const payload: DashboardComputeInput = {
        terminals: Object.values(terminals),
        previews,
        projects,
        worktreesByProject,
        ackTurns,
        queuedPrompts,
        stuckMinutesThreshold: stuckMinutes,
        searchQuery,
        activeGroup,
        selectedProjectId,
        nowMs: Date.now(),
      };
      workerRef.current.postMessage({ id, payload });
    };

    dispatch();
    // Refresh elapsed / stuck classification every 30s
    const tick = setInterval(dispatch, 30_000);
    return () => clearInterval(tick);
  }, [
    terminals,
    previews,
    projects,
    worktreesByProject,
    ackTurns,
    queuedPrompts,
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

  // 5. Persist UI state (debounced 800ms) for zero-loss session restoration across restarts
  const hydrated = useAppStore((s) => s.hydrated);
  const lastAgentByWorktree = useAppStore((s) => s.lastAgentByWorktree);
  const viewMode = useUiStore((s) => s.viewMode);
  const selectedAddress = useUiStore((s) => s.selectedAddress);
  const attachedAddress = useUiStore((s) => s.attachedAddress);

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
      }).catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [
    hydrated,
    viewMode,
    selectedAddress,
    attachedAddress,
    activeGroup,
    ackTurns,
    queuedPrompts,
    lastAgentByWorktree,
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
