import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import {
  interruptTerminal,
  killTerminal,
  launchSession,
  popoutExternalTerminal,
  sendTerminalText,
} from "../../services/tauriBridge";
import { TerminalSessionTabs } from "./TerminalSessionTabs";
import { TerminalDrawerHeader } from "./TerminalDrawerHeader";
import { TerminalEmptyState } from "./TerminalEmptyState";
import { useXtermSession } from "../../hooks/useXtermSession";
import {
  cardKeyForSession,
  countWorktreeLiveShells,
  getWorktreeLiveSessions,
  MAX_SHELLS_PER_WORKTREE,
} from "../../utils/worktreeSessions";
import { normalizePath } from "../../workers/dashboardLogic";

const MIN_DRAWER_WIDTH_PX = 360;
const MAX_DRAWER_RATIO = 0.78;

export const AttachedTerminalDrawer = React.memo(
  function AttachedTerminalDrawer() {
    const terminalDrawerOpen = useUiStore((s) => s.terminalDrawerOpen);
    const attachedAddress = useUiStore((s) => s.attachedAddress);
    const selectedCardKey = useUiStore((s) => s.selectedCardKey);
    const terminalWidthPx = useUiStore((s) => s.terminalWidthPx);
    const setTerminalWidthPx = useUiStore((s) => s.setTerminalWidthPx);
    const setAttachedAddress = useUiStore((s) => s.setAttachedAddress);
    const setSelectedAddress = useUiStore((s) => s.setSelectedAddress);
    const detachToEmptyDrawer = useUiStore((s) => s.detachToEmptyDrawer);
    const closeTerminalDrawer = useUiStore((s) => s.closeTerminalDrawer);
    const rememberCardSession = useUiStore((s) => s.rememberCardSession);
    const setDiffTarget = useUiStore((s) => s.setDiffTarget);
    const setLaunchTarget = useUiStore((s) => s.setLaunchTarget);
    const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
    const showToast = useUiStore((s) => s.showToast);

    const allSessions = useAppStore((s) => s.computed.allSessions);
    const matrixLanes = useAppStore((s) => s.computed.matrixLanes);
    const projects = useAppStore((s) => s.projects);
    const presets = useAppStore((s) => s.settings.prompt_presets);

    const session = useMemo(
      () =>
        attachedAddress
          ? allSessions.find((item) => item.address === attachedAddress) ?? null
          : null,
      [allSessions, attachedAddress]
    );

    // Resolve the currently selected empty worktree card when attachedAddress is null
    const selectedWorktreeInfo = useMemo(() => {
      if (session || !selectedCardKey || !selectedCardKey.startsWith("wt::")) {
        return null;
      }
      for (const lane of matrixLanes) {
        for (const cell of lane.cells) {
          const key = `wt::${lane.project.id}::${normalizePath(cell.worktree.path)}`;
          if (key === selectedCardKey) {
            return { project: lane.project, worktree: cell.worktree, key };
          }
        }
      }
      return null;
    }, [session, selectedCardKey, matrixLanes]);

    const worktreeTabs = useMemo(
      () => getWorktreeLiveSessions(allSessions, session),
      [allSessions, session]
    );

    const worktreeShellCount = useMemo(() => {
      const targetCwd = session?.worktreePath ?? selectedWorktreeInfo?.worktree.path;
      const targetProjId = session?.projectId ?? selectedWorktreeInfo?.project.id;
      if (!targetCwd) return 0;
      return countWorktreeLiveShells(allSessions, targetCwd, targetProjId);
    }, [allSessions, session, selectedWorktreeInfo]);

    const drawerRef = useRef<HTMLElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [spawningShell, setSpawningShell] = useState(false);
    const [resizing, setResizing] = useState(false);

    const { statusText, fitNow } = useXtermSession(containerRef, attachedAddress);

    // Remember active tab per worktree
    useEffect(() => {
      if (session && attachedAddress === session.address) {
        rememberCardSession(cardKeyForSession(session), session.address);
      }
    }, [session, attachedAddress, rememberCardSession]);

    // Drag-to-resize right terminal pane width (#12)
    const handleStartResize = useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        const sectionEl = drawerRef.current;
        const parentEl = sectionEl?.parentElement;
        if (!sectionEl || !parentEl) return;

        const startX = e.clientX;
        const startWidth = sectionEl.getBoundingClientRect().width;
        const maxWidth = Math.max(
          MIN_DRAWER_WIDTH_PX,
          Math.floor(parentEl.clientWidth * MAX_DRAWER_RATIO)
        );

        setResizing(true);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";

        let rafId: number | null = null;
        let latestWidth = startWidth;

        const onPointerMove = (moveEv: PointerEvent) => {
          const delta = startX - moveEv.clientX;
          latestWidth = Math.round(
            Math.max(MIN_DRAWER_WIDTH_PX, Math.min(maxWidth, startWidth + delta))
          );
          if (rafId === null) {
            rafId = requestAnimationFrame(() => {
              rafId = null;
              setTerminalWidthPx(latestWidth);
            });
          }
        };

        const onPointerUp = () => {
          if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
          }
          setTerminalWidthPx(latestWidth);
          setResizing(false);
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          window.removeEventListener("pointermove", onPointerMove);
          window.removeEventListener("pointerup", onPointerUp);
          requestAnimationFrame(() => fitNow());
        };

        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
      },
      [setTerminalWidthPx, fitNow]
    );

    const handleResetWidth = useCallback(() => {
      setTerminalWidthPx(null);
      requestAnimationFrame(() => fitNow());
    }, [setTerminalWidthPx, fitNow]);

    const handleSelectTab = useCallback(
      (addr: string) => {
        setSelectedAddress(addr);
        setAttachedAddress(addr);
        useUiStore.getState().requestTerminalFocus();
        if (session) {
          rememberCardSession(cardKeyForSession(session), addr);
        }
      },
      [session, setSelectedAddress, setAttachedAddress, rememberCardSession]
    );

    const handleCloseTab = useCallback(
      async (addr: string) => {
        const remaining = worktreeTabs.filter((t) => t.address !== addr);
        try {
          await killTerminal(addr, true);
          if (attachedAddress === addr) {
            const next = remaining[0] ?? null;
            if (next) {
              setSelectedAddress(next.address);
              setAttachedAddress(next.address);
              rememberCardSession(cardKeyForSession(next), next.address);
            } else {
              detachToEmptyDrawer();
            }
          }
        } catch (err) {
          showToast(`세션 종료 실패: ${String(err)}`, "error");
        }
      },
      [
        worktreeTabs,
        attachedAddress,
        setSelectedAddress,
        setAttachedAddress,
        detachToEmptyDrawer,
        rememberCardSession,
        showToast,
      ]
    );

    const handleAddShell = useCallback(async () => {
      const targetProjId = session?.projectId ?? selectedWorktreeInfo?.project.id;
      const targetCwd = session?.worktreePath ?? selectedWorktreeInfo?.worktree.path;
      const targetBranch = session?.branch ?? selectedWorktreeInfo?.worktree.branch;
      const targetProjName = session?.projectName ?? selectedWorktreeInfo?.project.name;
      const cardKey = session
        ? cardKeyForSession(session)
        : selectedWorktreeInfo?.key;
      if (!targetCwd || spawningShell) return;

      const curShells = countWorktreeLiveShells(
        useAppStore.getState().computed.allSessions,
        targetCwd,
        targetProjId
      );
      if (curShells >= MAX_SHELLS_PER_WORKTREE) {
        showToast(
          `한 Worktree당 PowerShell은 최대 ${MAX_SHELLS_PER_WORKTREE}개까지 열 수 있습니다.`,
          "info"
        );
        return;
      }

      setSpawningShell(true);
      try {
        const newAddr = await launchSession({
          project_id: targetProjId ?? undefined,
          cwd: targetCwd,
          branch: targetBranch || undefined,
          argv: [],
          name: targetProjName
            ? `${targetProjName}-${targetBranch || "main"}-sh`
            : undefined,
        });
        if (newAddr) {
          setSelectedAddress(newAddr);
          setAttachedAddress(newAddr);
          if (cardKey) rememberCardSession(cardKey, newAddr);
        }
      } catch (err) {
        showToast(`PowerShell 추가 실패: ${String(err)}`, "error");
      } finally {
        setSpawningShell(false);
      }
    }, [
      session,
      selectedWorktreeInfo,
      spawningShell,
      setSelectedAddress,
      setAttachedAddress,
      rememberCardSession,
      showToast,
    ]);

    const handleLaunchDefaultAi = useCallback(async () => {
      if (!selectedWorktreeInfo || spawningShell) return;
      const { project, worktree, key } = selectedWorktreeInfo;
      setSpawningShell(true);
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
        useAppStore.getState().recordLastAgent(normalizePath(worktree.path), argv);
        if (newAddr) {
          setSelectedAddress(newAddr);
          setAttachedAddress(newAddr);
          rememberCardSession(key, newAddr);
        }
      } catch (err) {
        showToast(`AI 시작 실패: ${String(err)}`, "error");
      } finally {
        setSpawningShell(false);
      }
    }, [
      selectedWorktreeInfo,
      spawningShell,
      setSelectedAddress,
      setAttachedAddress,
      rememberCardSession,
      showToast,
    ]);

    const handleAddAi = useCallback(() => {
      if (session) {
        const proj = session.projectId
          ? projects.find((p) => p.id === session.projectId)
          : undefined;
        setLaunchTarget({
          projectId: session.projectId ?? undefined,
          cwd: session.worktreePath,
          branch: session.branch || undefined,
          defaultAgent: proj?.default_agent,
        });
      } else if (selectedWorktreeInfo) {
        setLaunchTarget({
          projectId: selectedWorktreeInfo.project.id,
          cwd: selectedWorktreeInfo.worktree.path,
          branch: selectedWorktreeInfo.worktree.branch,
          defaultAgent: selectedWorktreeInfo.project.default_agent,
        });
      }
    }, [session, selectedWorktreeInfo, projects, setLaunchTarget]);

    const handleSendPreset = useCallback(
      async (prompt: string) => {
        if (!prompt.trim() || !attachedAddress) return;
        try {
          await sendTerminalText(attachedAddress, prompt, false);
          if (session) {
            useAppStore
              .getState()
              .acknowledgeTurn(attachedAddress, session.terminal.turn);
          }
        } catch (err) {
          showToast(`프리셋 전송 실패: ${String(err)}`, "error");
        }
      },
      [attachedAddress, session, showToast]
    );

    if (!terminalDrawerOpen && !attachedAddress) return null;

    const canSpawnInWorktree = Boolean(session?.projectId && session.worktreePath);

    const widthStyle: React.CSSProperties = terminalWidthPx
      ? { width: `${terminalWidthPx}px` }
      : { width: "50%" };

    return (
      <section
        ref={drawerRef}
        style={widthStyle}
        className="relative h-full min-h-0 min-w-[360px] max-w-[78%] p-2.5 pl-0 flex shrink-0"
      >
        {/* Left Drag-to-Resize Handle (#12) */}
        <div
          onPointerDown={handleStartResize}
          onDoubleClick={handleResetWidth}
          title="드래그하여 터미널 너비 조절 · 더블클릭으로 기본 너비 복원"
          className="group w-2.5 -ml-1 mr-0.5 flex items-center justify-center cursor-col-resize shrink-0 select-none"
        >
          <div
            className="w-1 h-14 rounded-full transition-all group-hover:h-24"
            style={{
              background: resizing ? "var(--accent)" : "var(--pill-border)",
              opacity: resizing ? 1 : 0.65,
            }}
          />
        </div>

        {/* Floating Rounded Terminal Card */}
        <div
          className="flex-1 h-full min-h-0 rounded-[18px] overflow-hidden flex flex-col text-slate-100 min-w-0"
          style={{
            background: "var(--term-bg)",
            border: "1px solid var(--term-border)",
          }}
        >
          <TerminalDrawerHeader
            session={session}
            attachedAddress={attachedAddress}
            fallbackTitle={selectedWorktreeInfo?.project.name}
            fallbackBranch={selectedWorktreeInfo?.worktree.branch}
            statusText={statusText}
            presets={presets}
            onOpenDiff={
              session?.projectId && session.worktree
                ? () =>
                    setDiffTarget({
                      projectId: session.projectId!,
                      worktreePath: session.worktree!.path,
                      branch: session.worktree!.branch,
                    })
                : selectedWorktreeInfo
                ? () =>
                    setDiffTarget({
                      projectId: selectedWorktreeInfo.project.id,
                      worktreePath: selectedWorktreeInfo.worktree.path,
                      branch: selectedWorktreeInfo.worktree.branch,
                    })
                : undefined
            }
            onInterrupt={
              attachedAddress
                ? () => void interruptTerminal(attachedAddress)
                : undefined
            }
            onPopout={
              attachedAddress
                ? () => void popoutExternalTerminal(attachedAddress)
                : undefined
            }
            onClose={closeTerminalDrawer}
            onSendPreset={(p) => void handleSendPreset(p)}
            onOpenSettings={() => setSettingsOpen(true)}
          />

          {attachedAddress && (
            <TerminalSessionTabs
              tabs={worktreeTabs}
              activeAddress={attachedAddress}
              canSpawnInWorktree={canSpawnInWorktree}
              spawningShell={spawningShell}
              shellCount={worktreeShellCount}
              onSelectTab={handleSelectTab}
              onCloseTab={(addr) => void handleCloseTab(addr)}
              onAddShell={() => void handleAddShell()}
              onAddAi={handleAddAi}
            />
          )}

          {/* Keep XTerm host mounted while drawer stays open so WebGL context is reused (0ms switch).
              Padding lives on the outer flex-1 min-h-0 wrapper so FitAddon measures exact inner viewport height without clipping bottom lines. */}
          <div className="relative flex-1 min-h-0 w-full overflow-hidden">
            <div
              className={`absolute inset-0 p-2.5 overflow-hidden ${
                attachedAddress
                  ? "visible opacity-100"
                  : "invisible opacity-0 pointer-events-none"
              }`}
            >
              <div ref={containerRef} className="w-full h-full overflow-hidden" />
            </div>
            {!attachedAddress && (
              <div className="relative z-10 h-full min-h-0 flex overflow-y-auto">
                <TerminalEmptyState
                  projectName={selectedWorktreeInfo?.project.name}
                  branch={selectedWorktreeInfo?.worktree.branch}
                  cwd={selectedWorktreeInfo?.worktree.path}
                  defaultAgent={selectedWorktreeInfo?.project.default_agent}
                  launching={spawningShell}
                  onLaunchDefaultAi={() => void handleLaunchDefaultAi()}
                  onLaunchShell={() => void handleAddShell()}
                  onOpenSessionPicker={handleAddAi}
                />
              </div>
            )}
          </div>
        </div>
      </section>
    );
  }
);
