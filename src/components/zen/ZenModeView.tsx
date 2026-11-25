import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import { cardKeyForSession } from "../../utils/worktreeSessions";
import {
  computeSessionDigest,
  isPermissionApprovalPending,
} from "../../workers/dashboardLogic";
import { sendTerminalKeys, sendTerminalText } from "../../services/tauriBridge";
import {
  computeNextSkippedOrder,
  incrementTodayClearedCount,
  readStoredZenStyle,
  readTodayClearedCount,
  selectZenTopCard,
  writeStoredZenStyle,
  type ZenCardStyle,
} from "../../utils/zenQueue";
import { ZenHeroCard } from "./ZenHeroCard";
import { ZenTactileControl } from "./ZenTactileControl";
import { ZenEmptyBriefing } from "./ZenEmptyBriefing";
import type { EnrichedSession } from "../../types/domain";
import "../../styles/zenMode.css";

function sessionReadyStamp(s: EnrichedSession): string {
  const digest = computeSessionDigest(s.terminal, s.previewLines);
  return `${s.address}:${s.terminal.turn}:${s.terminal.status?.state ?? ""}:${digest}`;
}

export const ZenModeView = React.memo(function ZenModeView() {
  const byBucket = useAppStore((s) => s.computed.byBucket);
  const presets = useAppStore((s) => s.settings.prompt_presets);

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
  const setViewMode = useUiStore((s) => s.setViewMode);
  const showToast = useUiStore((s) => s.showToast);

  const [styleMode, setStyleMode] = useState<ZenCardStyle>(() =>
    readStoredZenStyle()
  );
  const [clearedToday, setClearedToday] = useState<number>(() =>
    readTodayClearedCount()
  );
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

  // Maintain Sticky Lock & handle automatic advance when the locked card resolves via right terminal
  useEffect(() => {
    if (animatingRef.current) return;

    if (selection.lockedCardResolved) {
      const nextCount = incrementTodayClearedCount();
      setClearedToday(nextCount);
      triggerFloat("+1 처리 완료!", "var(--ready-fg)");
      setEnterKind(styleMode === "gacha_dial" ? "drop" : "rise");
      setEnterNonce((n) => n + 1);
      setLockedCardKey(activeKey);
      return;
    }

    if (!lockedCardKey && activeKey) {
      setLockedCardKey(activeKey);
      setEnterKind(styleMode === "gacha_dial" ? "drop" : "rise");
      setEnterNonce((n) => n + 1);
    }
  }, [selection.lockedCardResolved, lockedCardKey, activeKey, styleMode, triggerFloat]);

  // Auto-attach right terminal pane to the active Zen Hero Card;
  // automatically close right pane whenever All Clear briefing is shown (unless user explicitly clicked to peek a running card).
  useEffect(() => {
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
    if (hasExitingCard || !activeKey || !activeAddr || !isActiveLive) {
      return;
    }
    const token = `${enterNonce}::${activeKey}::${activeAddr}`;
    if (lastFocusedCardEnterRef.current === token) return;
    lastFocusedCardEnterRef.current = token;
    requestTerminalFocus();
  }, [
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
      triggerFloat("마지막 1장입니다!", "var(--text-secondary)");
      return;
    }

    animatingRef.current = true;
    const isGacha = styleMode === "gacha_dial";
    if (isGacha) {
      setDialAngle((a) => a + 180);
      triggerFloat("철컥! 다음 캡슐", "var(--warn-fg)");
      setExitAnimClass("zen-exit-roll");
    } else {
      triggerFloat("다음 우선순위!", "var(--accent)");
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
    const stamp = isApproval ? "승인 완료" : "결재 완료";
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
    if (isGacha) {
      setDialAngle((a) => a + 180);
    }
    triggerFloat(
      isApproval ? "+1 승인 완료!" : "+1 결재 완료!",
      "var(--ready-fg)"
    );

    if (isApproval) {
      void sendTerminalKeys(cardSnapshot.address, ["enter"]).catch((err) =>
        showToast(`승인 전송 실패: ${String(err)}`, "error")
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
        setLockedCardKey(
          nextSel.activeCard ? cardKeyForSession(nextSel.activeCard) : null
        );
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
    dismissZenCardStamp,
    showToast,
    triggerFloat,
  ]);

  const handleSendPreset = useCallback(
    async (prompt: string) => {
      if (!activeCard || !prompt.trim()) return;
      try {
        await sendTerminalText(activeCard.address, prompt, false);
        useAppStore
          .getState()
          .acknowledgeTurn(
            activeCard.address,
            Math.max(1, activeCard.terminal.turn)
          );
        requestTerminalFocus();
      } catch (err) {
        showToast(`프리셋 전송 실패: ${String(err)}`, "error");
      }
    },
    [activeCard, requestTerminalFocus, showToast]
  );

  // React to global Ctrl+N (skip) & Ctrl+Enter (stamp approve/done) triggers
  useEffect(() => {
    if (zenSkipNonce !== prevSkipNonceRef.current) {
      prevSkipNonceRef.current = zenSkipNonce;
      handleManualNext();
    }
  }, [zenSkipNonce, handleManualNext]);

  useEffect(() => {
    if (zenApproveNonce !== prevApproveNonceRef.current) {
      prevApproveNonceRef.current = zenApproveNonce;
      handlePrimaryAction();
    }
  }, [zenApproveNonce, handlePrimaryAction]);

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

  if (!displayCard) {
    return (
      <ZenEmptyBriefing
        runningCards={byBucket.running}
        idleCount={byBucket.idle.length}
        clearedToday={clearedToday}
        onPeekSession={handlePeekRunning}
        onOpenRadar={() => setViewMode("radar")}
      />
    );
  }

  const enterAnimClass = exitingCard
    ? ""
    : enterKind === "drop"
    ? "zen-anim-drop"
    : "zen-anim-rise";

  return (
    <div className="flex-1 h-full min-h-0 overflow-hidden flex flex-col px-6 py-4 min-w-0 relative">
      {/* Calm Minimal Top Bar: Style Switcher (Holo+Lever vs Gacha Dial) + Today Cleared */}
      <div className="flex items-center justify-between gap-2 shrink-0 select-none">
        <div className="flex items-center gap-2">
          <span
            className="text-xs font-bold tracking-tight"
            style={{ color: "var(--text-secondary)" }}
          >
            ZEN
          </span>
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
              홀로그램 + 레버
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
              가챠 다이얼
            </button>
          </div>
        </div>

        <span
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-mono-code font-semibold tabular-nums"
          style={{
            background: "var(--pill-bg)",
            border: "1px solid var(--pill-border)",
            color: "var(--warn-fg)",
          }}
        >
          <Sparkles className="w-3 h-3" />
          오늘 {clearedToday}건 클리어
        </span>
      </div>

      {/* Center Single Hero Card + Right Physical Tactile Control */}
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
            presets={presets}
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
            onSendPreset={(prompt) => void handleSendPreset(prompt)}
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
    </div>
  );
});
