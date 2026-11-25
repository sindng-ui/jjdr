import { useEffect, useMemo, useRef, useState } from "react";
import type {
  MatrixProjectLane,
  TerminalInfo,
  TerminalPreview,
} from "../types/domain";
import type { ZenDispatchStep, ZenHiredSoloState } from "../store/useUiStore";
import {
  isTrustOrSetupPrompt,
  type ZenDispatchWorker,
} from "../utils/zenDispatch";
import { isPlainShellTerminal, normalizePath } from "../workers/dashboardLogic";

interface UseZenDispatchMonitorParams {
  step: ZenDispatchStep;
  hasHiringState: boolean;
  isAwaitingHireConfirm: boolean;
  isAnimatingOrLaunching: boolean;
  selectedLane: MatrixProjectLane | null;
  deck: ZenDispatchWorker[];
  effectiveWorker: ZenDispatchWorker | null;
  hiredSolo: ZenHiredSoloState | null;
  attachedAddress: string | null;
  terminals: Record<string, TerminalInfo>;
  previews: Record<string, TerminalPreview>;
}

export interface ZenDispatchMonitorResult {
  isAwaitingTrustSetup: boolean;
  dispatchedWorkerPending: ZenDispatchWorker | null;
  resetTracking: (nextWorker?: ZenDispatchWorker | null) => void;
}

/**
 * Monitors the active Zen Dispatch worker to detect genuine task deployment
 * while protecting interactive Folder Trust / setup confirmations (Yes/No)
 * and sub-second CLI startup flickers from prematurely closing the pane.
 */
export function useZenDispatchMonitor({
  step,
  hasHiringState,
  isAwaitingHireConfirm,
  isAnimatingOrLaunching,
  selectedLane,
  deck,
  effectiveWorker,
  hiredSolo,
  attachedAddress,
  terminals,
  previews,
}: UseZenDispatchMonitorParams): ZenDispatchMonitorResult {
  const lastViewedWorkerRef = useRef<ZenDispatchWorker | null>(null);
  const initialTurnsRef = useRef<{
    cardKey: string;
    turns: Record<string, number>;
  } | null>(null);
  const seenTrustPromptRef = useRef(false);
  const trustCooldownUntilRef = useRef(0);
  const prevSoloConfirmedRef = useRef(false);
  const workingConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const [workingConfirmedKey, setWorkingConfirmedKey] = useState<string | null>(
    null
  );

  // Brief 1.2s stabilization right after clicking "Hire & Assign" so brand-new CLI boot never false-fires
  useEffect(() => {
    const confirmed = Boolean(hiredSolo?.confirmed);
    if (confirmed && !prevSoloConfirmedRef.current) {
      trustCooldownUntilRef.current = Math.max(
        trustCooldownUntilRef.current,
        Date.now() + 1200
      );
      initialTurnsRef.current = null;
      setWorkingConfirmedKey(null);
    }
    prevSoloConfirmedRef.current = confirmed;
  }, [hiredSolo?.confirmed]);

  // Detect folder-trust / permission setup prompts on any live session of this worktree
  const isAwaitingTrustSetup = useMemo(() => {
    if (step !== "browse_worker" || !effectiveWorker) return false;
    const addrs = new Set<string>(effectiveWorker.sessions.map((s) => s.address));
    if (hiredSolo?.address) addrs.add(hiredSolo.address);
    if (attachedAddress) {
      const att = terminals[attachedAddress];
      if (att && normalizePath(att.cwd || "").startsWith(effectiveWorker.normWtPath)) {
        addrs.add(attachedAddress);
      }
    }
    for (const addr of addrs) {
      const t = terminals[addr];
      const lines = previews[addr]?.lines ?? [];
      if (isTrustOrSetupPrompt(t, lines)) {
        return true;
      }
    }
    return false;
  }, [step, effectiveWorker, hiredSolo, attachedAddress, terminals, previews]);

  // Pause dispatch detection during folder-trust prompt and hold a 3s cooldown after Yes
  useEffect(() => {
    if (step !== "browse_worker" || hasHiringState || isAwaitingHireConfirm) {
      lastViewedWorkerRef.current = null;
      initialTurnsRef.current = null;
      seenTrustPromptRef.current = false;
      trustCooldownUntilRef.current = 0;
      setWorkingConfirmedKey(null);
      if (workingConfirmTimerRef.current) {
        clearTimeout(workingConfirmTimerRef.current);
        workingConfirmTimerRef.current = null;
      }
      return;
    }

    if (isAwaitingTrustSetup) {
      seenTrustPromptRef.current = true;
      trustCooldownUntilRef.current = Date.now() + 3000;
      setWorkingConfirmedKey(null);
      if (workingConfirmTimerRef.current) {
        clearTimeout(workingConfirmTimerRef.current);
        workingConfirmTimerRef.current = null;
      }
      return;
    }

    if (seenTrustPromptRef.current) {
      seenTrustPromptRef.current = false;
      trustCooldownUntilRef.current = Date.now() + 3000;
      initialTurnsRef.current = null;
      setWorkingConfirmedKey(null);
    }
  }, [step, hasHiringState, isAwaitingHireConfirm, isAwaitingTrustSetup]);

  // Check whether any live AI session in the active worktree is currently `working`
  const isCurrentlyWorkingRaw = useMemo(() => {
    if (
      step !== "browse_worker" ||
      hasHiringState ||
      isAwaitingHireConfirm ||
      isAwaitingTrustSetup ||
      isAnimatingOrLaunching
    ) {
      return null;
    }
    const cur = lastViewedWorkerRef.current ?? effectiveWorker;
    if (!cur) return null;
    const addrs = new Set<string>(cur.sessions.map((s) => s.address));
    if (hiredSolo?.address) addrs.add(hiredSolo.address);
    if (attachedAddress) {
      const att = terminals[attachedAddress];
      if (att && normalizePath(att.cwd || "").startsWith(cur.normWtPath)) {
        addrs.add(attachedAddress);
      }
    }
    for (const addr of addrs) {
      const t = terminals[addr];
      if (
        t &&
        t.state === "live" &&
        !isPlainShellTerminal(t) &&
        t.status?.state === "working"
      ) {
        return cur.cardKey;
      }
    }
    return null;
  }, [
    step,
    hasHiringState,
    isAwaitingHireConfirm,
    isAwaitingTrustSetup,
    isAnimatingOrLaunching,
    effectiveWorker,
    hiredSolo,
    attachedAddress,
    terminals,
  ]);

  // Confirm `working` only after it persists >=650ms (and past any trust cooldown)
  useEffect(() => {
    if (workingConfirmTimerRef.current) {
      clearTimeout(workingConfirmTimerRef.current);
      workingConfirmTimerRef.current = null;
    }
    if (!isCurrentlyWorkingRaw) {
      setWorkingConfirmedKey(null);
      return;
    }
    const remainingCooldown = Math.max(
      0,
      trustCooldownUntilRef.current - Date.now()
    );
    const waitMs = Math.max(650, remainingCooldown + 200);
    workingConfirmTimerRef.current = setTimeout(() => {
      workingConfirmTimerRef.current = null;
      setWorkingConfirmedKey(isCurrentlyWorkingRaw);
    }, waitMs);
    return () => {
      if (workingConfirmTimerRef.current) {
        clearTimeout(workingConfirmTimerRef.current);
        workingConfirmTimerRef.current = null;
      }
    };
  }, [isCurrentlyWorkingRaw]);

  // Synchronous dispatch detection (blocks Auto-Attach race during the same render)
  const dispatchedWorkerPending = useMemo(() => {
    if (
      step !== "browse_worker" ||
      hasHiringState ||
      isAwaitingHireConfirm ||
      isAwaitingTrustSetup ||
      isAnimatingOrLaunching
    ) {
      return null;
    }
    if (Date.now() < trustCooldownUntilRef.current) {
      return null;
    }
    const prev = lastViewedWorkerRef.current;
    if (!prev || !selectedLane) return null;

    if (workingConfirmedKey === prev.cardKey) {
      return prev;
    }

    const trackedAddrs = new Set<string>(prev.sessions.map((s) => s.address));
    if (hiredSolo?.address) trackedAddrs.add(hiredSolo.address);
    if (attachedAddress) {
      const att = terminals[attachedAddress];
      if (att && normalizePath(att.cwd || "").startsWith(prev.normWtPath)) {
        trackedAddrs.add(attachedAddress);
      }
    }
    const turnSnap =
      initialTurnsRef.current?.cardKey === prev.cardKey
        ? initialTurnsRef.current.turns
        : null;

    for (const addr of trackedAddrs) {
      const t = terminals[addr];
      if (!t || t.state !== "live" || isPlainShellTerminal(t)) continue;
      if (
        turnSnap &&
        typeof turnSnap[addr] === "number" &&
        t.turn > turnSnap[addr] &&
        t.status?.state !== "blocked"
      ) {
        return prev;
      }
    }

    const stillInDeck = deck.some((w) => w.cardKey === prev.cardKey);
    if (!stillInDeck) {
      const matchedCell = selectedLane.cells.find(
        (c) => normalizePath(c.worktree.path) === prev.normWtPath
      );
      if (
        matchedCell &&
        (matchedCell.topBucket === "running" ||
          matchedCell.topBucket === "ready")
      ) {
        return prev;
      }
    }
    return null;
  }, [
    step,
    hasHiringState,
    isAwaitingHireConfirm,
    isAwaitingTrustSetup,
    isAnimatingOrLaunching,
    selectedLane,
    workingConfirmedKey,
    hiredSolo,
    attachedAddress,
    terminals,
    deck,
  ]);

  // Keep lastViewedWorker & baseline turn counts continuously synchronized
  useEffect(() => {
    if (
      step !== "browse_worker" ||
      hasHiringState ||
      isAwaitingHireConfirm ||
      isAnimatingOrLaunching ||
      dispatchedWorkerPending
    ) {
      return;
    }
    if (!effectiveWorker) {
      lastViewedWorkerRef.current = null;
      initialTurnsRef.current = null;
      return;
    }

    lastViewedWorkerRef.current = effectiveWorker;
    const sessionAddrs = new Set(effectiveWorker.sessions.map((s) => s.address));
    if (hiredSolo?.address) sessionAddrs.add(hiredSolo.address);
    const inTrustOrCooldown =
      isAwaitingTrustSetup || Date.now() < trustCooldownUntilRef.current;

    if (
      initialTurnsRef.current?.cardKey !== effectiveWorker.cardKey ||
      inTrustOrCooldown
    ) {
      const turns: Record<string, number> = {};
      for (const addr of sessionAddrs) {
        const t = terminals[addr];
        if (t && t.state === "live" && !isPlainShellTerminal(t)) {
          turns[addr] = t.turn;
        }
      }
      initialTurnsRef.current = { cardKey: effectiveWorker.cardKey, turns };
    } else {
      for (const addr of sessionAddrs) {
        const t = terminals[addr];
        if (
          t &&
          t.state === "live" &&
          !isPlainShellTerminal(t) &&
          initialTurnsRef.current.turns[addr] === undefined
        ) {
          initialTurnsRef.current.turns[addr] = t.turn;
        }
      }
    }
  }, [
    step,
    hasHiringState,
    isAwaitingHireConfirm,
    isAnimatingOrLaunching,
    dispatchedWorkerPending,
    effectiveWorker,
    hiredSolo,
    isAwaitingTrustSetup,
    terminals,
  ]);

  const resetTracking = (nextWorker: ZenDispatchWorker | null = null) => {
    lastViewedWorkerRef.current = nextWorker;
    initialTurnsRef.current = null;
    seenTrustPromptRef.current = false;
    setWorkingConfirmedKey(null);
  };

  return { isAwaitingTrustSetup, dispatchedWorkerPending, resetTracking };
}
