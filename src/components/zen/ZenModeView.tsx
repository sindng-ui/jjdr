import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Inbox, Send, Sparkles, Volume2, VolumeX } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import {
  cardKeyForSession,
  getWorktreeLiveSessions,
} from "../../utils/worktreeSessions";
import {
  computeSessionDigest,
  isPermissionApprovalPending,
  normalizePath,
} from "../../workers/dashboardLogic";
import { sendTerminalKeys } from "../../services/tauriBridge";
import {
  computeNextSkippedOrder,
  incrementTodayClearedCount,
  readStoredZenStyle,
  readTodayClearedCount,
  selectZenTopCard,
  writeStoredZenStyle,
  type ZenCardStyle,
} from "../../utils/zenQueue";
import {
  formatZenComboLabel,
  playZenAllClearSfx,
  playZenLeverSfx,
  playZenStampSfx,
  readStoredZenSfxEnabled,
  writeStoredZenSfxEnabled,
} from "../../utils/zenSound";
import { buildDispatchProjectSummaries } from "../../utils/zenDispatch";
import { recordZenRecapEvent } from "../../utils/zenRecap";
import { ZenHeroCard } from "./ZenHeroCard";
import { ZenTactileControl } from "./ZenTactileControl";
import { ZenEmptyBriefing } from "./ZenEmptyBriefing";
import { ZenDispatchView } from "./ZenDispatchView";
import { ZenRecapModal } from "./ZenRecapModal";
import type { EnrichedSession } from "../../types/domain";
import "../../styles/zenMode.css";

function sessionReadyStamp(s: EnrichedSession): string {
  const digest = computeSessionDigest(s.terminal, s.previewLines);
  return `${s.address}:${s.terminal.turn}:${s.terminal.status?.state ?? ""}:${digest}`;
}

export const ZenModeView = React.memo(function ZenModeView() {
  const byBucket = useAppStore((s) => s.computed.byBucket);
  const matrixLanes = useAppStore((s) => s.computed.matrixLanes);
  const worktreeMeta = useAppStore((s) => s.worktreeMeta);
  const removingWorktreePaths = useAppStore((s) => s.removingWorktreePaths);
  const rootCardMode = useAppStore((s) => s.settings.root_card_mode);

  const zenModeTab = useUiStore((s) => s.zenModeTab);
  const openZenDispatch = useUiStore((s) => s.openZenDispatch);
  const returnToZenInbox = useUiStore((s) => s.returnToZenInbox);
  const recordZenAcked = useUiStore((s) => s.recordZenAcked);
  const zenSkipNonce = useUiStore((s) => s.zenSkipNonce);
  const zenApproveNonce = useUiStore((s) => s.zenApproveNonce);
  const dismissedStamps = useUiStore((s) => s.zenDismissedStamps);
  const dismissZenCardStamp = useUiStore((s) => s.dismissZenCardStamp);
  const terminalDrawerOpen = useUiStore((s) => s.terminalDrawerOpen);
  const attachedAddress = useUiStore((s) => s.attachedAddress);
  const setSelectedCardKey = useUiStore((s) => s.setSelectedCardKey);
  const setSelectedAddress = useUiStore((s) => s.setSelectedAddress);
  const setAttachedAddress = useUiStore((s) => s.setAttachedAddress);
  const closeTerminalDrawer = useUiStore((s) => s.closeTerminalDrawer);
  const requestTerminalFocus = useUiStore((s) => s.requestTerminalFocus);
  const setDiffTarget = useUiStore((s) => s.setDiffTarget);
  const setTeardownTarget = useUiStore((s) => s.setTeardownTarget);
  const setViewMode = useUiStore((s) => s.setViewMode);
  const showToast = useUiStore((s) => s.showToast);

  const [styleMode, setStyleMode] = useState<ZenCardStyle>(() =>
    readStoredZenStyle()
  );
  const [sfxEnabled, setSfxEnabled] = useState<boolean>(() =>
    readStoredZenSfxEnabled()
  );
  const [clearedToday, setClearedToday] = useState<number>(() =>
    readTodayClearedCount()
  );
  const [celebrateNonce, setCelebrateNonce] = useState(0);
  const [recapOpen, setRecapOpen] = useState(false);
  const [lockedCardKey, setLockedCardKey] = useState<string | null>(null);
  const [skippedKeys, setSkippedKeys] = useState<string[]>([]);

  const [dialAngle, setDialAngle] = useState(0);
  const [pullRatio, setPullRatio] = useState(0);
  const [enterNonce, setEnterNonce] = useState(0);
  const [enterKind, setEnterKind] = useState<"rise" | "drop">("rise");
  const [exitAnimClass, setExitAnimClass] = useState("");
  const [exitingCard, setExitingCard] = useState<EnrichedSession | null>(null);
  const [stampLabel, setStampLabel] = useState<string | null>(null);
  const [thumpActive, setThumpActive] = useState(false);
  const [floatNotice, setFloatNotice] = useState<{
    id: number;
    text: string;
    color: string;
  } | null>(null);

  // Track if user explicitly clicked a Running card in All Clear briefing to peek its terminal
  const [peekingAddr, setPeekingAddr] = useState<string | null>(null);

  const animatingRef = useRef(false);
  const prevSkipNonceRef = useRef(zenSkipNonce);
  const prevApproveNonceRef = useRef(zenApproveNonce);
  const lastAttachedKeyRef = useRef<string | null>(null);
  const lastLockedSessionRef = useRef<EnrichedSession | null>(null);
  const comboRef = useRef<{ count: number; lastMs: number }>({
    count: 0,
    lastMs: 0,
  });

  const logClearedSession = useCallback(
    (s: EnrichedSession | null) => {
      if (!s) return;
      const meta = worktreeMeta[normalizePath(s.worktreePath)];
      recordZenRecapEvent({
        kind: "cleared",
        cardKey: cardKeyForSession(s),
        worktreePath: s.worktreePath,
        projectId: s.projectId,
        projectName: s.projectName,
        projectColor: s.projectColor,
        branch: s.branch,
        displayName: meta?.display_name ?? undefined,
        note: meta?.note ?? undefined,
        addedLines: s.worktree?.added_lines,
        deletedLines: s.worktree?.deleted_lines,
        isMerged: s.worktree?.is_merged,
        summary: s.terminal.status?.msg || s.previewLines.slice(-1)[0] || "",
      });
    },
    [worktreeMeta]
  );

  const nextComboStep = useCallback((isApproval: boolean): string => {
    const now = Date.now();
    const withinWindow = now - comboRef.current.lastMs <= 25_000;
    const nextCount = withinWindow ? comboRef.current.count + 1 : 1;
    comboRef.current = { count: nextCount, lastMs: now };
    return formatZenComboLabel(nextCount, isApproval);
  }, []);

  const handleToggleSfx = useCallback(() => {
    setSfxEnabled((prev) => {
      const next = !prev;
      writeStoredZenSfxEnabled(next);
      if (next) playZenLeverSfx(true);
      return next;
    });
  }, []);

  // Filter out cards the user explicitly stamped "결재 완료" at the exact same turn/status_ms
  const visibleNeedsYou = useMemo(
    () =>
      byBucket.needs_you.filter((s) => {
        const ck = cardKeyForSession(s);
        return dismissedStamps[ck] !== sessionReadyStamp(s);
      }),
    [byBucket.needs_you, dismissedStamps]
  );

  const visibleReady = useMemo(
    () =>
      byBucket.ready.filter((s) => {
        const ck = cardKeyForSession(s);
        return dismissedStamps[ck] !== sessionReadyStamp(s);
      }),
    [byBucket.ready, dismissedStamps]
  );

  const actionablePool = useMemo(
    () => [...visibleNeedsYou, ...visibleReady],
    [visibleNeedsYou, visibleReady]
  );

  const selection = useMemo(
    () =>
      selectZenTopCard(
        visibleNeedsYou,
        visibleReady,
        lockedCardKey,
        skippedKeys
      ),
    [visibleNeedsYou, visibleReady, lockedCardKey, skippedKeys]
  );

  const activeCard = selection.activeCard;
  const activeKey = activeCard ? cardKeyForSession(activeCard) : null;

  const triggerFloat = useCallback((text: string, color: string) => {
    setFloatNotice({ id: Date.now(), text, color });
  }, []);

  const projectSummaries = useMemo(
    () =>
      buildDispatchProjectSummaries(matrixLanes, {
        worktreeMeta,
        rootCardMode,
        removingWorktreePaths,
      }),
    [matrixLanes, worktreeMeta, rootCardMode, removingWorktreePaths]
  );

  const totalDispatchAvailable = useMemo(
    () =>
      projectSummaries.reduce((acc, item) => acc + item.totalAvailableCount, 0),
    [projectSummaries]
  );

  const isDispatchTab = zenModeTab === "dispatch";

  // Maintain Sticky Lock & handle automatic advance when the locked card resolves via right terminal
  useEffect(() => {
    if (isDispatchTab || animatingRef.current) return;

    if (selection.lockedCardResolved) {
      if (lockedCardKey) {
        recordZenAcked(lockedCardKey);
      }
      logClearedSession(lastLockedSessionRef.current);
      lastLockedSessionRef.current = activeCard;
      const nextCount = incrementTodayClearedCount();
      setClearedToday(nextCount);
      const comboText = nextComboStep(false);
      triggerFloat(
        comboText,
        comboRef.current.count >= 3 ? "var(--warn-fg)" : "var(--ready-fg)"
      );
      if (!activeKey) {
        playZenAllClearSfx(sfxEnabled);
        setCelebrateNonce((n) => n + 1);
      } else {
        playZenStampSfx(sfxEnabled);
      }
      setEnterKind(styleMode === "gacha_dial" ? "drop" : "rise");
      setEnterNonce((n) => n + 1);
      setLockedCardKey(activeKey);
      return;
    }

    if (activeCard) {
      lastLockedSessionRef.current = activeCard;
    }

    if (!lockedCardKey && activeKey) {
      setLockedCardKey(activeKey);
      setEnterKind(styleMode === "gacha_dial" ? "drop" : "rise");
      setEnterNonce((n) => n + 1);
    }
  }, [
    isDispatchTab,
    selection.lockedCardResolved,
    lockedCardKey,
    activeCard,
    activeKey,
    styleMode,
    sfxEnabled,
    nextComboStep,
    logClearedSession,
    recordZenAcked,
    triggerFloat,
  ]);

  // Auto-attach right terminal pane to the active Zen Hero Card;
  // automatically close right pane whenever All Clear briefing is shown (unless user explicitly clicked to peek a running card).
  useEffect(() => {
    if (isDispatchTab) {
      lastAttachedKeyRef.current = null;
      return;
    }
    if (activeCard && activeKey) {
      setPeekingAddr(null);
      const syncKey = `${activeKey}::${activeCard.address}`;
      if (lastAttachedKeyRef.current !== syncKey) {
        lastAttachedKeyRef.current = syncKey;
        setSelectedCardKey(activeKey);
        setSelectedAddress(activeCard.address);
        if (activeCard.terminal.state === "live") {
          setAttachedAddress(activeCard.address);
          requestTerminalFocus();
        }
      }
    } else if (!exitingCard) {
      lastAttachedKeyRef.current = null;
      if (!peekingAddr && (terminalDrawerOpen || attachedAddress)) {
        closeTerminalDrawer();
      }
    }
  }, [
    isDispatchTab,
    activeCard,
    activeKey,
    exitingCard,
    peekingAddr,
    terminalDrawerOpen,
    attachedAddress,
    setSelectedCardKey,
    setSelectedAddress,
    setAttachedAddress,
    requestTerminalFocus,
    closeTerminalDrawer,
  ]);

  // Ensure right terminal receives keyboard focus ONCE whenever a new Zen card finishes rising into view
  const lastFocusedCardEnterRef = useRef<string | null>(null);
  const hasExitingCard = Boolean(exitingCard);
  const activeAddr = activeCard?.address ?? null;
  const isActiveLive = activeCard?.terminal.state === "live";

  useEffect(() => {
    if (isDispatchTab || hasExitingCard || !activeKey || !activeAddr || !isActiveLive) {
      return;
    }
    const token = `${enterNonce}::${activeKey}::${activeAddr}`;
    if (lastFocusedCardEnterRef.current === token) return;
    lastFocusedCardEnterRef.current = token;
    requestTerminalFocus();
  }, [
    isDispatchTab,
    enterNonce,
    hasExitingCard,
    activeKey,
    activeAddr,
    isActiveLive,
    requestTerminalFocus,
  ]);

  const handleChangeStyle = useCallback((next: ZenCardStyle) => {
    setStyleMode(next);
    writeStoredZenStyle(next);
    setEnterKind(next === "gacha_dial" ? "drop" : "rise");
    setEnterNonce((n) => n + 1);
  }, []);

  // Manual Skip / Next via Ctrl+N, Arcade Ball Lever, or Gacha Dial
  const handleManualNext = useCallback(() => {
    if (animatingRef.current || !activeCard || !activeKey) return;
    if (actionablePool.length <= 1) {
      if (styleMode === "gacha_dial") {
        setDialAngle((a) => a + 180);
      }
      setThumpActive(true);
      setTimeout(() => setThumpActive(false), 240);
      triggerFloat("Last card in queue!", "var(--text-secondary)");
      return;
    }

    animatingRef.current = true;
    playZenLeverSfx(sfxEnabled);
    const isGacha = styleMode === "gacha_dial";
    if (isGacha) {
      setDialAngle((a) => a + 180);
      triggerFloat("Next capsule!", "var(--warn-fg)");
      setExitAnimClass("zen-exit-roll");
    } else {
      triggerFloat("Next priority!", "var(--accent)");
      setExitAnimClass("zen-exit-fly-up");
    }

    const { nextKey, nextSkippedKeys } = computeNextSkippedOrder(
      actionablePool,
      activeKey,
      skippedKeys
    );

    setTimeout(() => {
      setExitAnimClass("");
      setSkippedKeys(nextSkippedKeys);
      setLockedCardKey(nextKey);
      setEnterKind(isGacha ? "drop" : "rise");
      setEnterNonce((n) => n + 1);
      animatingRef.current = false;
    }, 260);
  }, [
    activeCard,
    activeKey,
    actionablePool,
    skippedKeys,
    styleMode,
    sfxEnabled,
    showToast,
    triggerFloat,
  ]);

  // Primary Boss Stamp Action (Approve permission or Acknowledge/Clear Ready card)
  const handlePrimaryAction = useCallback(() => {
    if (animatingRef.current || !activeCard || !activeKey) return;
    animatingRef.current = true;
    (document.activeElement as HTMLElement | null)?.blur();

    const cardSnapshot = activeCard;
    const isApproval = isPermissionApprovalPending(cardSnapshot.terminal);
    const stamp = isApproval ? "APPROVED" : "CLEARED";
    const isGacha = styleMode === "gacha_dial";
    const digest = computeSessionDigest(
      cardSnapshot.terminal,
      cardSnapshot.previewLines
    );
    const stampKey = sessionReadyStamp(cardSnapshot);

    // Freeze the exiting card visually for the 560ms stamp + fly-out animation,
    // while immediately persisting acknowledgment so status_ms updates can NEVER resurrect it.
    setExitingCard(cardSnapshot);
    setStampLabel(stamp);
    setThumpActive(true);
    playZenStampSfx(sfxEnabled);
    if (isGacha) {
      setDialAngle((a) => a + 180);
    }
    const comboText = nextComboStep(isApproval);
    triggerFloat(
      comboText,
      comboRef.current.count >= 3 ? "var(--warn-fg)" : "var(--ready-fg)"
    );

    if (isApproval) {
      void sendTerminalKeys(cardSnapshot.address, ["enter"]).catch((err) =>
        showToast(`Approval send failed: ${String(err)}`, "error")
      );
    } else {
      useAppStore
        .getState()
        .acknowledgeSession(
          cardSnapshot.address,
          cardSnapshot.terminal.turn,
          digest
        );
    }
    dismissZenCardStamp(activeKey, stampKey);
    recordZenAcked(activeKey);
    logClearedSession(cardSnapshot);
    lastLockedSessionRef.current = null;

    setTimeout(() => {
      setThumpActive(false);
      setExitAnimClass(isGacha ? "zen-exit-roll" : "zen-exit-fly-right");

      setTimeout(() => {
        const nextCount = incrementTodayClearedCount();
        setClearedToday(nextCount);
        setStampLabel(null);
        setExitAnimClass("");
        setExitingCard(null);
        // Advance lock to next remaining card immediately
        const remaining = actionablePool.filter(
          (item) => cardKeyForSession(item) !== activeKey
        );
        const nextSel = selectZenTopCard(
          remaining.filter((r) => r.bucket === "needs_you"),
          remaining.filter((r) => r.bucket === "ready"),
          null,
          skippedKeys
        );
        const nextCardKey = nextSel.activeCard
          ? cardKeyForSession(nextSel.activeCard)
          : null;
        setLockedCardKey(nextCardKey);
        if (!nextCardKey) {
          playZenAllClearSfx(sfxEnabled);
          setCelebrateNonce((n) => n + 1);
        }
        setEnterKind(isGacha ? "drop" : "rise");
        setEnterNonce((n) => n + 1);
        animatingRef.current = false;
      }, 260);
    }, 300);
  }, [
    activeCard,
    activeKey,
    actionablePool,
    skippedKeys,
    styleMode,
    sfxEnabled,
    nextComboStep,
    logClearedSession,
    dismissZenCardStamp,
    recordZenAcked,
    showToast,
    triggerFloat,
  ]);

  // React to global Ctrl+N (skip) & Ctrl+Enter (stamp approve/done) triggers in Inbox tab only
  useEffect(() => {
    if (zenSkipNonce !== prevSkipNonceRef.current) {
      prevSkipNonceRef.current = zenSkipNonce;
      if (!isDispatchTab) {
        handleManualNext();
      }
    }
  }, [zenSkipNonce, isDispatchTab, handleManualNext]);

  useEffect(() => {
    if (zenApproveNonce !== prevApproveNonceRef.current) {
      prevApproveNonceRef.current = zenApproveNonce;
      if (!isDispatchTab) {
        handlePrimaryAction();
      }
    }
  }, [zenApproveNonce, isDispatchTab, handlePrimaryAction]);

  const handlePeekRunning = useCallback(
    (session: EnrichedSession) => {
      setPeekingAddr(session.address);
      setSelectedCardKey(cardKeyForSession(session));
      setSelectedAddress(session.address);
      if (session.terminal.state === "live") {
        setAttachedAddress(session.address);
        requestTerminalFocus();
      }
    },
    [setSelectedCardKey, setSelectedAddress, setAttachedAddress, requestTerminalFocus]
  );

  const displayCard = exitingCard ?? activeCard;
  const displayKey = displayCard ? cardKeyForSession(displayCard) : null;

  const enterAnimClass = exitingCard
    ? ""
    : enterKind === "drop"
    ? "zen-anim-drop"
    : "zen-anim-rise";

  return (
    <div className="flex-1 h-full min-h-0 overflow-hidden flex flex-col px-6 py-4 min-w-0 relative">
      {/* Calm Minimal Top Bar: Inbox <-> Dispatch Switcher + Style Switcher + Today Cleared */}
      <div className="flex items-center justify-between gap-2 flex-wrap shrink-0 select-none">
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="jjdr-pill inline-flex items-center rounded-full p-0.5 text-xs">
            <button
              type="button"
              onClick={returnToZenInbox}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full cursor-pointer transition-colors ${
                !isDispatchTab ? "jjdr-pill-active font-bold" : ""
              }`}
              style={
                !isDispatchTab ? undefined : { color: "var(--text-muted)" }
              }
              title="Focus on actionable review cards"
            >
              <Inbox className="w-3.5 h-3.5" />
              <span>Inbox</span>
              {actionablePool.length > 0 && (
                <span
                  className="text-[10px] font-mono-code px-1.5 py-0.2 rounded-full"
                  style={{
                    background: "var(--action-soft)",
                    color: "var(--action-fg)",
                  }}
                >
                  {actionablePool.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => openZenDispatch(null)}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full cursor-pointer transition-colors ${
                isDispatchTab ? "jjdr-pill-active font-bold" : ""
              }`}
              style={isDispatchTab ? undefined : { color: "var(--text-muted)" }}
              title="Hire or assign a standby worker (Ctrl+Shift+D)"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Dispatch</span>
              {totalDispatchAvailable > 0 && (
                <span
                  className="text-[10px] font-mono-code px-1.5 py-0.2 rounded-full"
                  style={{
                    background: "var(--ready-soft)",
                    color: "var(--ready-fg)",
                  }}
                >
                  {totalDispatchAvailable}
                </span>
              )}
            </button>
          </div>

          <div className="jjdr-pill inline-flex items-center rounded-full p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => handleChangeStyle("holo_stamp")}
              className={`px-2.5 py-0.5 rounded-full cursor-pointer transition-colors ${
                styleMode === "holo_stamp" ? "jjdr-pill-active font-semibold" : ""
              }`}
              style={
                styleMode === "holo_stamp"
                  ? undefined
                  : { color: "var(--text-muted)" }
              }
            >
              Holo + Lever
            </button>
            <button
              type="button"
              onClick={() => handleChangeStyle("gacha_dial")}
              className={`px-2.5 py-0.5 rounded-full cursor-pointer transition-colors ${
                styleMode === "gacha_dial" ? "jjdr-pill-active font-semibold" : ""
              }`}
              style={
                styleMode === "gacha_dial"
                  ? undefined
                  : { color: "var(--text-muted)" }
              }
            >
              Gacha Dial
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggleSfx}
            title={
              sfxEnabled
                ? "Zen tactile SFX ON (click to mute)"
                : "Zen tactile SFX muted (click to enable)"
            }
            className="jjdr-pill h-7 w-7 rounded-full inline-flex items-center justify-center cursor-pointer transition-colors"
            style={{
              color: sfxEnabled ? "var(--text-primary)" : "var(--text-faint)",
            }}
          >
            {sfxEnabled ? (
              <Volume2 className="w-3.5 h-3.5" />
            ) : (
              <VolumeX className="w-3.5 h-3.5" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setRecapOpen(true)}
            title="View Daily Work Recap & copy Standup Markdown"
            className="jjdr-pill inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-mono-code font-semibold tabular-nums cursor-pointer transition-transform active:scale-[0.98]"
            style={{ color: "var(--warn-fg)" }}
          >
            <Sparkles className="w-3 h-3" />
            {clearedToday} Cleared Today
          </button>
        </div>
      </div>

      {/* Main Zen Stage: Dispatch View OR Inbox Hero Card OR All Clear Briefing */}
      {isDispatchTab ? (
        <ZenDispatchView styleMode={styleMode} sfxEnabled={sfxEnabled} />
      ) : !displayCard ? (
        <ZenEmptyBriefing
          runningCards={byBucket.running}
          idleCount={byBucket.idle.length}
          clearedToday={clearedToday}
          celebrateNonce={celebrateNonce}
          projectSummaries={projectSummaries}
          onPeekSession={handlePeekRunning}
          onStartDispatch={(pid) => openZenDispatch(pid ?? null)}
          onOpenRecap={() => setRecapOpen(true)}
          onOpenRadar={() => setViewMode("radar")}
        />
      ) : (
        <div className="flex-1 min-h-0 flex items-center justify-center relative">
          {floatNotice && (
            <div
              key={floatNotice.id}
              className="zen-float-pop pointer-events-none absolute top-6 right-12 z-30 font-mono-code text-sm font-black"
              style={{ color: floatNotice.color }}
            >
              {floatNotice.text}
            </div>
          )}

          <div className="w-full max-w-xl flex items-center justify-center gap-5">
            <ZenHeroCard
              key={`${displayKey}-${enterNonce}`}
              session={displayCard}
              styleMode={styleMode}
              remainingCount={selection.remainingCount}
              enterAnimClass={enterAnimClass}
              exitAnimClass={exitAnimClass}
              stampLabel={stampLabel}
              thumpActive={thumpActive}
              pullRatio={pullRatio}
              onPrimaryAction={handlePrimaryAction}
              onOpenDiff={
                displayCard.projectId && displayCard.worktree
                  ? () =>
                      setDiffTarget({
                        projectId: displayCard.projectId!,
                        worktreePath: displayCard.worktree!.path,
                        branch: displayCard.worktree!.branch,
                      })
                  : undefined
              }
              onDismissMerged={
                displayCard.projectId &&
                displayCard.worktree &&
                !displayCard.worktree.is_main &&
                displayCard.worktree.is_merged
                  ? () => {
                      const liveTabs = getWorktreeLiveSessions(
                        useAppStore.getState().computed.allSessions,
                        displayCard
                      );
                      setTeardownTarget({
                        projectId: displayCard.projectId!,
                        worktreePath: displayCard.worktree!.path,
                        branch: displayCard.worktree!.branch,
                        isMerged: true,
                        dirtyCount: displayCard.worktree!.dirty_count,
                        terminalAddresses: liveTabs.map((s) => s.address),
                      });
                    }
                  : undefined
              }
            />

            <ZenTactileControl
              styleMode={styleMode}
              remainingCount={selection.remainingCount}
              dialAngle={dialAngle}
              onPullProgress={setPullRatio}
              onTriggerNext={handlePrimaryAction}
            />
          </div>
        </div>
      )}

      {recapOpen && (
        <ZenRecapModal open={recapOpen} onClose={() => setRecapOpen(false)} />
      )}
    </div>
  );
});
