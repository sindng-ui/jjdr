import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, GitBranchPlus } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import type { ZenCardStyle } from "../../utils/zenQueue";
import {
  buildDispatchProjectSummaries,
  buildFallbackHiredWorker,
  buildProjectDispatchDeck,
  stepDispatchIndex,
  type ZenDispatchWorker,
} from "../../utils/zenDispatch";
import { getWorkerPersona } from "../../utils/workerPersona";
import { recordZenRecapEvent } from "../../utils/zenRecap";
import {
  playZenDeploySfx,
  playZenLeverSfx,
  playZenStampSfx,
} from "../../utils/zenSound";
import { launchSession } from "../../services/tauriBridge";
import {
  isPlainShellTerminal,
  normalizePath,
} from "../../workers/dashboardLogic";
import { useZenDispatchShortcuts } from "../../hooks/useZenDispatchShortcuts";
import { useZenDispatchMonitor } from "../../hooks/useZenDispatchMonitor";
import {
  ZenActionPicker,
  ZenHiringStage,
  ZenNoWorkersNotice,
  ZenProjectPicker,
} from "./ZenDispatchPicker";
import { ZenWorkerCard } from "./ZenWorkerCard";
import { ZenTactileControl } from "./ZenTactileControl";

interface ZenDispatchViewProps {
  styleMode: ZenCardStyle;
  sfxEnabled: boolean;
}

export const ZenDispatchView = React.memo(function ZenDispatchView({
  styleMode,
  sfxEnabled,
}: ZenDispatchViewProps) {
  const terminals = useAppStore((s) => s.terminals);
  const previews = useAppStore((s) => s.previews);
  const projects = useAppStore((s) => s.projects);
  const matrixLanes = useAppStore((s) => s.computed.matrixLanes);
  const worktreeMeta = useAppStore((s) => s.worktreeMeta);
  const removingWorktreePaths = useAppStore((s) => s.removingWorktreePaths);
  const rootCardMode = useAppStore((s) => s.settings.root_card_mode);

  const step = useUiStore((s) => s.zenDispatchStep);
  const projectId = useUiStore((s) => s.zenDispatchProjectId);
  const attachedAddress = useUiStore((s) => s.attachedAddress);
  const zenSkipNonce = useUiStore((s) => s.zenSkipNonce);
  const zenPrevNonce = useUiStore((s) => s.zenPrevNonce);
  const zenApproveNonce = useUiStore((s) => s.zenApproveNonce);
  const zenRecentAckedAt = useUiStore((s) => s.zenRecentAckedAt);
  const hiredSolo = useUiStore((s) => s.zenHiredSolo);
  const zenHiringState = useUiStore((s) => s.zenHiringState);

  const setZenDispatchStep = useUiStore((s) => s.setZenDispatchStep);
  const setZenDispatchProjectId = useUiStore((s) => s.setZenDispatchProjectId);
  const returnToZenInbox = useUiStore((s) => s.returnToZenInbox);
  const confirmZenHiredSolo = useUiStore((s) => s.confirmZenHiredSolo);
  const clearZenHiredSolo = useUiStore((s) => s.clearZenHiredSolo);
  const setZenHiringState = useUiStore((s) => s.setZenHiringState);
  const setSelectedCardKey = useUiStore((s) => s.setSelectedCardKey);
  const setSelectedAddress = useUiStore((s) => s.setSelectedAddress);
  const setAttachedAddress = useUiStore((s) => s.setAttachedAddress);
  const detachToEmptyDrawer = useUiStore((s) => s.detachToEmptyDrawer);
  const closeTerminalDrawer = useUiStore((s) => s.closeTerminalDrawer);
  const requestTerminalFocus = useUiStore((s) => s.requestTerminalFocus);
  const setCreateWorktreeProjectId = useUiStore(
    (s) => s.setCreateWorktreeProjectId
  );
  const setProjectModalProject = useUiStore((s) => s.setProjectModalProject);
  const setEditWorktreeTarget = useUiStore((s) => s.setEditWorktreeTarget);
  const setDiffTarget = useUiStore((s) => s.setDiffTarget);
  const setTeardownTarget = useUiStore((s) => s.setTeardownTarget);
  const showToast = useUiStore((s) => s.showToast);

  const [activeCardKey, setActiveCardKey] = useState<string | null>(null);
  const [dialAngle, setDialAngle] = useState(0);
  const [pullRatio, setPullRatio] = useState(0);
  const [enterNonce, setEnterNonce] = useState(0);
  const [enterKind, setEnterKind] = useState<"rise" | "drop">("rise");
  const [exitAnimClass, setExitAnimClass] = useState("");
  const [launchingCard, setLaunchingCard] = useState<ZenDispatchWorker | null>(
    null
  );
  const [stampLabel, setStampLabel] = useState<string | null>(null);
  const [thumpActive, setThumpActive] = useState(false);
  const [wakingAi, setWakingAi] = useState(false);
  const [floatNotice, setFloatNotice] = useState<{
    id: number;
    text: string;
    color: string;
  } | null>(null);

  const animatingRef = useRef(false);
  const wakingCardKeyRef = useRef<string | null>(null);
  const lastSyncRef = useRef<string | null>(null);

  const deckOptions = useMemo(
    () => ({
      worktreeMeta,
      recentAckedAt: zenRecentAckedAt,
      rootCardMode,
      removingWorktreePaths,
    }),
    [worktreeMeta, zenRecentAckedAt, rootCardMode, removingWorktreePaths]
  );

  const projectSummaries = useMemo(
    () => buildDispatchProjectSummaries(matrixLanes, deckOptions),
    [matrixLanes, deckOptions]
  );

  const selectedLane = useMemo(
    () =>
      projectId
        ? matrixLanes.find((l) => l.project.id === projectId) ?? null
        : null,
    [matrixLanes, projectId]
  );

  const selectedSummary = useMemo(
    () =>
      projectId
        ? projectSummaries.find((s) => s.project.id === projectId) ?? null
        : null,
    [projectSummaries, projectId]
  );

  const deck = useMemo(
    () => buildProjectDispatchDeck(selectedLane, deckOptions),
    [selectedLane, deckOptions]
  );

  const activeIndex = useMemo(() => {
    if (deck.length === 0) return -1;
    if (!activeCardKey) return 0;
    const found = deck.findIndex((w) => w.cardKey === activeCardKey);
    return found >= 0 ? found : 0;
  }, [deck, activeCardKey]);

  const activeWorker = activeIndex >= 0 ? deck[activeIndex] : null;

  const soloWorker = useMemo(() => {
    if (!hiredSolo) return null;
    const fromDeck = deck.find((w) => w.cardKey === hiredSolo.cardKey);
    if (fromDeck) return fromDeck;
    const normSolo = normalizePath(hiredSolo.worktreePath);
    const laneCell = selectedLane?.cells.find(
      (c) => normalizePath(c.worktree.path) === normSolo
    );
    const proj =
      selectedLane?.project ??
      projects.find((p) => p.id === hiredSolo.projectId) ??
      null;
    if (!proj) return null;
    if (laneCell) {
      const ai =
        laneCell.sessions.find(
          (s) => s.terminal.state === "live" && !isPlainShellTerminal(s.terminal)
        ) ?? null;
      return {
        cardKey: hiredSolo.cardKey,
        normWtPath: normSolo,
        project: proj,
        worktree: laneCell.worktree,
        sessions: laneCell.sessions,
        aiSession: ai,
        tier: ai ? (0 as const) : (1 as const),
        readiness: ai ? ("fresh" as const) : ("dormant" as const),
        mruMs: Date.now(),
      };
    }
    return buildFallbackHiredWorker({
      project: proj,
      worktreePath: hiredSolo.worktreePath,
      branchName: hiredSolo.branchName,
      address: hiredSolo.address,
      terminal: hiredSolo.address ? terminals[hiredSolo.address] ?? null : null,
    });
  }, [hiredSolo, deck, selectedLane, projects, terminals]);

  const effectiveWorker = hiredSolo ? soloWorker : activeWorker;
  const isAwaitingHireConfirm = Boolean(hiredSolo && !hiredSolo.confirmed);

  const triggerFloat = useCallback((text: string, color: string) => {
    setFloatNotice({ id: Date.now(), text, color });
  }, []);

  const { isAwaitingTrustSetup, dispatchedWorkerPending, resetTracking } =
    useZenDispatchMonitor({
      step,
      hasHiringState: Boolean(zenHiringState),
      isAwaitingHireConfirm,
      isAnimatingOrLaunching: animatingRef.current || Boolean(launchingCard),
      selectedLane,
      deck,
      effectiveWorker,
      hiredSolo,
      attachedAddress,
      terminals,
      previews,
    });

  /** Stamps HIRED! on the newly recruited card, then reveals & focuses the right terminal pane. */
  const handleConfirmHire = useCallback(() => {
    if (!hiredSolo || hiredSolo.confirmed || animatingRef.current || !soloWorker) {
      return;
    }
    animatingRef.current = true;
    (document.activeElement as HTMLElement | null)?.blur();

    const persona = getWorkerPersona(soloWorker.normWtPath);
    setStampLabel("HIRED!");
    setThumpActive(true);
    playZenStampSfx(sfxEnabled);
    triggerFloat(`${persona.name} joined!`, "var(--ready-fg)");

    setTimeout(() => {
      setThumpActive(false);
      setStampLabel(null);
      animatingRef.current = false;
      confirmZenHiredSolo();
    }, 360);
  }, [hiredSolo, soloWorker, sfxEnabled, triggerFloat, confirmZenHiredSolo]);

  /** Fires DISPATCHED! stamp slam and returns to Zen Inbox (or All Clear). */
  const triggerDispatched = useCallback(
    (worker: ZenDispatchWorker) => {
      if (animatingRef.current) return;
      animatingRef.current = true;
      resetTracking(null);
      const persona = getWorkerPersona(worker.normWtPath);

      setLaunchingCard(worker);
      setStampLabel("DISPATCHED!");
      setThumpActive(true);
      playZenDeploySfx(sfxEnabled);
      triggerFloat(`${persona.name} deployed!`, "var(--ready-fg)");
      const meta = worktreeMeta[worker.normWtPath];
      recordZenRecapEvent({
        kind: "dispatched",
        cardKey: worker.cardKey,
        worktreePath: worker.worktree.path,
        projectId: worker.project.id,
        projectName: worker.project.name,
        projectColor: worker.project.color,
        branch: worker.worktree.branch,
        displayName: meta?.display_name ?? undefined,
        note: meta?.note ?? undefined,
        addedLines: worker.worktree.added_lines,
        deletedLines: worker.worktree.deleted_lines,
        isMerged: worker.worktree.is_merged,
        summary:
          worker.aiSession?.terminal.status?.msg ||
          worker.aiSession?.previewLines.slice(-1)[0] ||
          "",
      });

      setTimeout(() => {
        setThumpActive(false);
        setExitAnimClass(
          styleMode === "gacha_dial" ? "zen-exit-roll" : "zen-exit-fly-right"
        );
        setTimeout(() => {
          setStampLabel(null);
          setExitAnimClass("");
          setLaunchingCard(null);
          animatingRef.current = false;
          returnToZenInbox();
        }, 250);
      }, 320);
    },
    [styleMode, sfxEnabled, worktreeMeta, triggerFloat, returnToZenInbox, resetTracking]
  );

  // Trigger DISPATCHED! when monitor confirms a real task deployment
  useEffect(() => {
    if (dispatchedWorkerPending) {
      triggerDispatched(dispatchedWorkerPending);
      return;
    }
    if (
      step === "browse_worker" &&
      !zenHiringState &&
      !isAwaitingHireConfirm &&
      effectiveWorker &&
      activeCardKey !== effectiveWorker.cardKey
    ) {
      setActiveCardKey(effectiveWorker.cardKey);
    }
  }, [
    dispatchedWorkerPending,
    triggerDispatched,
    step,
    zenHiringState,
    isAwaitingHireConfirm,
    effectiveWorker,
    activeCardKey,
  ]);

  // Keep Step 1/2, Hiring stage, and pre-confirm Solo Reveal clean (right terminal strictly hidden)
  useEffect(() => {
    if (step !== "browse_worker" || zenHiringState || isAwaitingHireConfirm) {
      lastSyncRef.current = null;
      wakingCardKeyRef.current = null;
      const ui = useUiStore.getState();
      if (ui.terminalDrawerOpen || ui.attachedAddress) {
        closeTerminalDrawer();
      }
    }
  }, [step, zenHiringState, isAwaitingHireConfirm, closeTerminalDrawer]);

  // Auto-attach right terminal whenever active worker changes in Step 3 (only after HIRED! confirm for solo)
  useEffect(() => {
    if (
      step !== "browse_worker" ||
      zenHiringState ||
      isAwaitingHireConfirm ||
      launchingCard ||
      animatingRef.current ||
      dispatchedWorkerPending
    ) {
      return;
    }

    if (!effectiveWorker) {
      lastSyncRef.current = null;
      return;
    }

    const targetAddr =
      effectiveWorker.aiSession?.address ??
      (hiredSolo?.confirmed ? hiredSolo.address : null);

    if (targetAddr) {
      if (wakingCardKeyRef.current === effectiveWorker.cardKey) {
        wakingCardKeyRef.current = null;
      }
      const syncKey = `${effectiveWorker.cardKey}::${targetAddr}`;
      if (lastSyncRef.current !== syncKey) {
        lastSyncRef.current = syncKey;
        setSelectedCardKey(effectiveWorker.cardKey);
        setSelectedAddress(targetAddr);
        setAttachedAddress(targetAddr);
        requestTerminalFocus();
      }
      return;
    }

    if (wakingCardKeyRef.current === effectiveWorker.cardKey) {
      return;
    }
    const emptySyncKey = `${effectiveWorker.cardKey}::empty`;
    if (lastSyncRef.current !== emptySyncKey) {
      lastSyncRef.current = emptySyncKey;
      setSelectedCardKey(effectiveWorker.cardKey);
      setSelectedAddress(null);
      detachToEmptyDrawer();
    }
  }, [
    step,
    zenHiringState,
    isAwaitingHireConfirm,
    hiredSolo,
    effectiveWorker,
    launchingCard,
    dispatchedWorkerPending,
    setSelectedCardKey,
    setSelectedAddress,
    setAttachedAddress,
    detachToEmptyDrawer,
    requestTerminalFocus,
  ]);

  const handleStepWorker = useCallback(
    (delta: number) => {
      if (
        step !== "browse_worker" ||
        zenHiringState ||
        hiredSolo ||
        animatingRef.current ||
        !activeWorker ||
        deck.length === 0
      ) {
        return;
      }
      if (deck.length <= 1) {
        if (styleMode === "gacha_dial") {
          setDialAngle((a) => a + 180);
        }
        setThumpActive(true);
        setTimeout(() => setThumpActive(false), 220);
        triggerFloat("Only standby worker in this project", "var(--text-secondary)");
        return;
      }

      animatingRef.current = true;
      playZenLeverSfx(sfxEnabled);
      const isGacha = styleMode === "gacha_dial";
      if (isGacha) {
        setDialAngle((a) => a + (delta > 0 ? 180 : -180));
      }
      setExitAnimClass(isGacha ? "zen-exit-roll" : "zen-exit-fly-up");

      const nextIdx = stepDispatchIndex(activeIndex, deck.length, delta);
      const nextWorker = deck[nextIdx];

      setTimeout(() => {
        setExitAnimClass("");
        resetTracking(nextWorker);
        setActiveCardKey(nextWorker.cardKey);
        setEnterKind(isGacha ? "drop" : "rise");
        setEnterNonce((n) => n + 1);
        animatingRef.current = false;
      }, 220);
    },
    [step, zenHiringState, hiredSolo, activeWorker, activeIndex, deck, styleMode, sfxEnabled, triggerFloat, resetTracking]
  );

  const handleJumpToIndex = useCallback(
    (idx: number) => {
      if (animatingRef.current || idx < 0 || idx >= deck.length) return;
      if (idx === activeIndex) return;
      const nextWorker = deck[idx];
      resetTracking(nextWorker);
      setActiveCardKey(nextWorker.cardKey);
      setEnterKind(styleMode === "gacha_dial" ? "drop" : "rise");
      setEnterNonce((n) => n + 1);
    },
    [deck, activeIndex, styleMode, resetTracking]
  );

  const handleWakeAi = useCallback(async () => {
    if (!effectiveWorker || effectiveWorker.aiSession || wakingAi) return;
    const { project, worktree, cardKey, normWtPath } = effectiveWorker;
    const persona = getWorkerPersona(normWtPath);
    setWakingAi(true);
    wakingCardKeyRef.current = cardKey;
    try {
      const defaultCmd = project.default_agent || "agy";
      const argv = defaultCmd.split(/\s+/).filter(Boolean);
      const newAddr = await launchSession({
        project_id: project.id,
        cwd: worktree.path,
        branch: worktree.branch,
        argv,
        name: `${project.name}-${worktree.branch || "main"}`,
        autonomous: true,
      });
      useAppStore.getState().recordLastAgent(normWtPath, argv);
      if (newAddr) {
        setSelectedCardKey(cardKey);
        setSelectedAddress(newAddr);
        setAttachedAddress(newAddr);
        requestTerminalFocus();
        triggerFloat(`${persona.name} woke up!`, "var(--ready-fg)");
      }
    } catch (err) {
      wakingCardKeyRef.current = null;
      showToast(`Failed to start AI: ${String(err)}`, "error");
    } finally {
      setWakingAi(false);
    }
  }, [
    effectiveWorker,
    wakingAi,
    setSelectedCardKey,
    setSelectedAddress,
    setAttachedAddress,
    requestTerminalFocus,
    triggerFloat,
    showToast,
  ]);

  const handleSelectProject = useCallback(
    (pid: string) => {
      setZenDispatchProjectId(pid);
      setZenDispatchStep("pick_action");
    },
    [setZenDispatchProjectId, setZenDispatchStep]
  );

  const handleEnterBrowse = useCallback(() => {
    setActiveCardKey(null);
    setEnterKind(styleMode === "gacha_dial" ? "drop" : "rise");
    setEnterNonce((n) => n + 1);
    setZenDispatchStep("browse_worker");
  }, [styleMode, setZenDispatchStep]);

  const handleWakeDormantAi = useCallback(() => {
    if (effectiveWorker && !effectiveWorker.aiSession) {
      void handleWakeAi();
    }
  }, [effectiveWorker, handleWakeAi]);

  useZenDispatchShortcuts({
    step,
    hasHiringState: Boolean(zenHiringState),
    isAwaitingHireConfirm,
    projectSummaries,
    selectedSummary,
    zenSkipNonce,
    zenPrevNonce,
    zenApproveNonce,
    onSelectProject: handleSelectProject,
    onHireProject: setCreateWorktreeProjectId,
    onEnterBrowse: handleEnterBrowse,
    onConfirmHire: handleConfirmHire,
    onStepWorker: handleStepWorker,
    onWakeDormantAi: handleWakeDormantAi,
  });

  // ── Playful Hiring Stage while creating a new Worktree + AI session ───────
  if (zenHiringState) {
    return (
      <ZenHiringStage
        hiring={zenHiringState}
        onDismissWaiting={() => setZenHiringState(null)}
      />
    );
  }

  // ── Step 1: Pick Project ──────────────────────────────────────────────────
  if (step === "pick_project" || !selectedSummary) {
    return (
      <ZenProjectPicker
        projectSummaries={projectSummaries}
        onSelectProject={handleSelectProject}
        onAddProject={() => setProjectModalProject("new")}
      />
    );
  }

  // ── Step 2: Hire New Worker vs Assign Existing Worker ─────────────────────
  if (step === "pick_action") {
    return (
      <ZenActionPicker
        summary={selectedSummary}
        onChangeProject={() => {
          setZenDispatchStep("pick_project");
          setZenDispatchProjectId(null);
        }}
        onHireNew={() => setCreateWorktreeProjectId(selectedSummary.project.id)}
        onAssignExisting={handleEnterBrowse}
      />
    );
  }

  // ── Step 3: Browse Worker Deck OR Hired Solo Reveal ───────────────────────
  const displayWorker =
    launchingCard ?? dispatchedWorkerPending ?? effectiveWorker;
  const isSolo = Boolean(hiredSolo);

  if (!displayWorker) {
    return (
      <ZenNoWorkersNotice
        projectName={selectedSummary.project.name}
        onHireNew={() => setCreateWorktreeProjectId(selectedSummary.project.id)}
        onChangeProject={() => setZenDispatchStep("pick_project")}
      />
    );
  }

  const enterAnimClass =
    launchingCard || dispatchedWorkerPending
      ? ""
      : enterKind === "drop"
      ? "zen-anim-drop"
      : "zen-anim-rise";

  return (
    <div className="flex-1 min-h-0 flex flex-col relative">
      {/* Sub-breadcrumb bar */}
      <div className="flex items-center justify-between gap-2 pt-3 shrink-0 select-none">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              clearZenHiredSolo();
              closeTerminalDrawer();
              setZenDispatchStep("pick_action");
            }}
            className="jjdr-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium cursor-pointer"
            style={{ color: "var(--text-secondary)" }}
          >
            <ArrowLeft className="w-3 h-3" />
            <span>{selectedSummary.project.name}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              clearZenHiredSolo();
              closeTerminalDrawer();
              setZenDispatchStep("pick_project");
              setZenDispatchProjectId(null);
            }}
            className="jjdr-pill px-2.5 py-1 rounded-full text-[11px] cursor-pointer"
            style={{ color: "var(--text-muted)" }}
          >
            Change Project
          </button>
        </div>

        {!isSolo && (
          <button
            type="button"
            onClick={() =>
              setCreateWorktreeProjectId(selectedSummary.project.id)
            }
            className="jjdr-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold cursor-pointer"
            style={{ color: "var(--accent)" }}
          >
            <GitBranchPlus className="w-3 h-3" />
            <span>Hire Worker</span>
          </button>
        )}
      </div>

      {/* Center Worker Face Card + Right Physical Next Control (hidden in Solo Hire mode) */}
      <div className="flex-1 min-h-0 flex items-center justify-center relative">
        {floatNotice && (
          <div
            key={floatNotice.id}
            className="zen-float-pop pointer-events-none absolute top-4 right-10 z-30 font-mono-code text-sm font-black"
            style={{ color: floatNotice.color }}
          >
            {floatNotice.text}
          </div>
        )}

        <div className="w-full max-w-xl flex items-center justify-center gap-5">
          <ZenWorkerCard
            key={`${displayWorker.cardKey}-${enterNonce}`}
            worker={displayWorker}
            styleMode={styleMode}
            index={Math.max(0, activeIndex)}
            total={isSolo ? 1 : deck.length}
            deckWorkers={isSolo ? [displayWorker] : deck}
            enterAnimClass={enterAnimClass}
            exitAnimClass={exitAnimClass}
            stampLabel={stampLabel}
            thumpActive={thumpActive}
            pullRatio={pullRatio}
            launchingAi={wakingAi}
            soloMode={isSolo}
            awaitingHireConfirm={isAwaitingHireConfirm}
            awaitingTrustSetup={isAwaitingTrustSetup}
            onConfirmHire={handleConfirmHire}
            onWakeAi={() => void handleWakeAi()}
            onPrevWorker={() => handleStepWorker(-1)}
            onNextWorker={() => handleStepWorker(1)}
            onJumpToIndex={handleJumpToIndex}
            onEditCard={() =>
              setEditWorktreeTarget({
                projectId: displayWorker.project.id,
                worktreePath: displayWorker.worktree.path,
                branch: displayWorker.worktree.branch,
                isMain: displayWorker.worktree.is_main,
              })
            }
            onOpenDiff={() =>
              setDiffTarget({
                projectId: displayWorker.project.id,
                worktreePath: displayWorker.worktree.path,
                branch: displayWorker.worktree.branch,
              })
            }
            onTeardown={
              !displayWorker.worktree.is_main
                ? () =>
                    setTeardownTarget({
                      projectId: displayWorker.project.id,
                      worktreePath: displayWorker.worktree.path,
                      branch: displayWorker.worktree.branch,
                      isMerged: displayWorker.worktree.is_merged,
                      dirtyCount: displayWorker.worktree.dirty_count,
                      terminalAddresses: displayWorker.sessions.map(
                        (s) => s.address
                      ),
                    })
                : undefined
            }
          />

          {!isSolo && (
            <ZenTactileControl
              styleMode={styleMode}
              remainingCount={Math.max(0, deck.length - 1)}
              dialAngle={dialAngle}
              onPullProgress={setPullRatio}
              onTriggerNext={() => handleStepWorker(1)}
              label={styleMode === "gacha_dial" ? "NEXT ↻" : "NEXT!"}
              titleOverride={
                deck.length > 1
                  ? `Next standby worker (${deck.length} available · Ctrl+N / Ctrl+Right)`
                  : "Only standby worker in this project"
              }
            />
          )}
        </div>
      </div>
    </div>
  );
});
