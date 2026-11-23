import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import {
  ExternalLink,
  FileDiff,
  OctagonX,
  Settings2,
  X,
} from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import {
  attachTerminal,
  detachTerminal,
  focusTerminal,
  interruptTerminal,
  killTerminal,
  launchSession,
  listenTermClosed,
  listenTermData,
  popoutExternalTerminal,
  resizeTerminal,
  sendTerminalText,
  writeTerminalInput,
} from "../../services/tauriBridge";
import { StatusBadge } from "../shared/StatusBadge";
import { TerminalSessionTabs } from "./TerminalSessionTabs";
import { getThemePreset } from "../../utils/themes";
import {
  cardKeyForSession,
  getWorktreeLiveSessions,
} from "../../utils/worktreeSessions";

function decodeBase64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

export const AttachedTerminalDrawer = React.memo(
  function AttachedTerminalDrawer() {
    const attachedAddress = useUiStore((s) => s.attachedAddress);
    const setAttachedAddress = useUiStore((s) => s.setAttachedAddress);
    const setSelectedAddress = useUiStore((s) => s.setSelectedAddress);
    const rememberCardSession = useUiStore((s) => s.rememberCardSession);
    const setDiffTarget = useUiStore((s) => s.setDiffTarget);
    const setLaunchTarget = useUiStore((s) => s.setLaunchTarget);
    const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
    const showToast = useUiStore((s) => s.showToast);

    const allSessions = useAppStore((s) => s.computed.allSessions);
    const projects = useAppStore((s) => s.projects);
    const presets = useAppStore((s) => s.settings.prompt_presets);
    const themeId = useAppStore((s) => s.settings.theme);

    const session = useMemo(
      () =>
        attachedAddress
          ? allSessions.find((item) => item.address === attachedAddress) ?? null
          : null,
      [allSessions, attachedAddress]
    );

    const worktreeTabs = useMemo(
      () => getWorktreeLiveSessions(allSessions, session),
      [allSessions, session]
    );

    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<XTerm | null>(null);
    const [statusText, setStatusText] = useState<string>("Connecting...");
    const [spawningShell, setSpawningShell] = useState(false);

    // Remember whichever session tab the user is actively viewing in this worktree
    useEffect(() => {
      if (session && attachedAddress === session.address) {
        rememberCardSession(cardKeyForSession(session), session.address);
      }
    }, [session, attachedAddress, rememberCardSession]);

    // Sync xterm color theme live whenever user switches themes in Settings!
    useEffect(() => {
      if (termRef.current) {
        termRef.current.options.theme = getThemePreset(themeId).xterm;
      }
    }, [themeId]);

    useEffect(() => {
      if (!attachedAddress || !containerRef.current) return;

      let disposed = false;
      let activeChannel: number | null = null;
      let unlistenData: (() => void) | null = null;
      let unlistenClosed: (() => void) | null = null;
      let resizeTimer: ReturnType<typeof setTimeout> | null = null;
      const earlyChunks: Uint8Array[] = [];

      setStatusText("Attaching...");

      const initialXtermTheme = getThemePreset(
        useAppStore.getState().settings.theme
      ).xterm;

      const term = new XTerm({
        cursorBlink: true,
        fontSize: 13,
        lineHeight: 1.25,
        fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
        scrollback: 2000,
        theme: initialXtermTheme,
      });
      termRef.current = term;

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);

      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch {
        // Fallback gracefully to canvas/DOM
      }

      fitAddon.fit();

      term.attachCustomKeyEventHandler((ev) => {
        if (ev.type !== "keydown") return true;
        const hasCtrl = ev.ctrlKey || ev.metaKey;
        const isPlainCtrl = hasCtrl && !ev.altKey && !ev.shiftKey;
        const isCtrlShift = hasCtrl && !ev.altKey && ev.shiftKey;
        const k = ev.key.toLowerCase();

        const isReserved =
          // Ctrl+Tab / Ctrl+Shift+Tab -> switch session tabs within current worktree
          (hasCtrl && !ev.altKey && (ev.key === "Tab" || ev.code === "Tab")) ||
          // Ctrl+Shift+T (+Shell) / Ctrl+Shift+A (+AI)
          (isCtrlShift &&
            (k === "t" ||
              ev.code === "KeyT" ||
              k === "a" ||
              ev.code === "KeyA")) ||
          (isPlainCtrl &&
            (ev.code === "Backquote" ||
              ev.key === "`" ||
              ev.key === "ArrowUp" ||
              ev.key === "ArrowDown" ||
              ev.key === "ArrowLeft" ||
              ev.key === "ArrowRight" ||
              k === "n" ||
              ev.code === "KeyN" ||
              k === "f" ||
              ev.code === "KeyF" ||
              k === "k" ||
              ev.code === "KeyK" ||
              k === "m" ||
              ev.code === "KeyM" ||
              k === "b" ||
              ev.code === "KeyB" ||
              k === "1" ||
              ev.code === "Digit1" ||
              k === "2" ||
              ev.code === "Digit2" ||
              ev.key === "\\" ||
              ev.code === "Backslash")) ||
          (ev.altKey && ev.key === "Escape");

        if (isReserved) {
          return false;
        }
        return true;
      });

      const dataSub = term.onData((data) => {
        if (activeChannel !== null) {
          void writeTerminalInput(activeChannel, data);
        }
      });

      const onFocusIn = () => {
        if (activeChannel !== null) void focusTerminal(activeChannel, true);
      };
      const onFocusOut = () => {
        if (activeChannel !== null) void focusTerminal(activeChannel, false);
      };
      const hostEl = containerRef.current;
      hostEl.addEventListener("focusin", onFocusIn);
      hostEl.addEventListener("focusout", onFocusOut);

      const resizeObserver = new ResizeObserver(() => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          if (disposed) return;
          fitAddon.fit();
          if (activeChannel !== null) {
            void resizeTerminal(activeChannel, term.cols, term.rows);
          }
        }, 50);
      });
      resizeObserver.observe(hostEl);

      const connectStream = async () => {
        try {
          unlistenData = await listenTermData((ev) => {
            if (disposed || ev.address !== attachedAddress) return;
            const bytes = decodeBase64ToBytes(ev.data_b64);
            if (activeChannel === null) {
              earlyChunks.push(bytes);
            } else if (ev.channel === activeChannel) {
              term.write(bytes);
            }
          });

          unlistenClosed = await listenTermClosed((ev) => {
            if (disposed || ev.address !== attachedAddress) return;
            if (activeChannel === null || ev.channel === activeChannel) {
              setStatusText("Closed");
            }
          });

          const res = await attachTerminal(
            attachedAddress,
            term.cols || 100,
            term.rows || 30,
            false
          );

          if (disposed) {
            void detachTerminal(res.channel);
            return;
          }

          activeChannel = res.channel;
          setStatusText(`ch ${res.channel}`);
          for (const chunk of earlyChunks.splice(0)) {
            term.write(chunk);
          }
          term.focus();
          void focusTerminal(res.channel, true);
        } catch (err) {
          if (!disposed) {
            const msg = String(err);
            if (msg.includes("has finished") || msg.includes("not_found")) {
              setAttachedAddress(null);
              showToast(
                "종료된 세션입니다. 타일에서 새 세션을 시작하세요.",
                "info"
              );
            } else {
              setStatusText("Error");
              showToast(`Attach failed: ${msg}`, "error");
            }
          }
        }
      };

      void connectStream();

      return () => {
        disposed = true;
        termRef.current = null;
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeObserver.disconnect();
        hostEl.removeEventListener("focusin", onFocusIn);
        hostEl.removeEventListener("focusout", onFocusOut);
        dataSub.dispose();
        if (unlistenData) unlistenData();
        if (unlistenClosed) unlistenClosed();
        if (activeChannel !== null) {
          void detachTerminal(activeChannel);
        }
        term.dispose();
      };
    }, [attachedAddress, setAttachedAddress, showToast]);

    const handleSelectTab = useCallback(
      (addr: string) => {
        setSelectedAddress(addr);
        setAttachedAddress(addr);
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
              setAttachedAddress(null);
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
        rememberCardSession,
        showToast,
      ]
    );

    const handleAddShell = useCallback(async () => {
      if (!session || spawningShell) return;
      setSpawningShell(true);
      try {
        const newAddr = await launchSession({
          project_id: session.projectId ?? undefined,
          cwd: session.worktreePath,
          branch: session.branch || undefined,
          argv: [],
          name: `${session.projectName}-${(session.branch || "main").replace(
            /[/\\ ]/g,
            "-"
          )}-sh`,
        });
        if (newAddr) {
          setSelectedAddress(newAddr);
          setAttachedAddress(newAddr);
          rememberCardSession(cardKeyForSession(session), newAddr);
        }
      } catch (err) {
        showToast(`PowerShell 추가 실패: ${String(err)}`, "error");
      } finally {
        setSpawningShell(false);
      }
    }, [
      session,
      spawningShell,
      setSelectedAddress,
      setAttachedAddress,
      rememberCardSession,
      showToast,
    ]);

    const handleAddAi = useCallback(() => {
      if (!session) return;
      const proj = session.projectId
        ? projects.find((p) => p.id === session.projectId)
        : undefined;
      setLaunchTarget({
        projectId: session.projectId ?? undefined,
        cwd: session.worktreePath,
        branch: session.branch || undefined,
        defaultAgent: proj?.default_agent,
      });
    }, [session, projects, setLaunchTarget]);

    if (!attachedAddress) return null;

    const handleSendPreset = async (prompt: string) => {
      if (!prompt.trim()) return;
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
    };

    const canSpawnInWorktree = Boolean(session?.projectId && session.worktreePath);

    return (
      <section className="w-[50%] min-w-[440px] max-w-[860px] p-2.5 pl-0 flex flex-col shrink-0">
        {/* Floating Rounded Terminal Card Inside Stage */}
        <div
          className="h-full rounded-[18px] overflow-hidden flex flex-col text-slate-100"
          style={{
            background: "var(--term-bg)",
            border: "1px solid var(--term-border)",
          }}
        >
          {/* Floating Terminal Header */}
          <div
            className="h-11 px-4 flex items-center justify-between gap-2 shrink-0 select-none"
            style={{
              background: "var(--term-header-bg)",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div className="flex items-center gap-2 min-w-0">
              {session && (
                <StatusBadge
                  bucket={session.bucket}
                  status={session.terminal.status}
                  compact
                />
              )}
              <span className="text-xs font-medium text-slate-300 truncate">
                {session ? session.projectName : "Terminal"}
              </span>
              {session && (
                <>
                  <span className="text-slate-500">/</span>
                  <span className="text-xs font-mono-code font-bold text-white truncate">
                    {session.branch}
                  </span>
                </>
              )}
              <span className="text-[11px] font-mono-code text-slate-400 shrink-0">
                {attachedAddress} · {statusText}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {session?.projectId && session.worktree && (
                <button
                  onClick={() =>
                    setDiffTarget({
                      projectId: session.projectId!,
                      worktreePath: session.worktree!.path,
                      branch: session.worktree!.branch,
                    })
                  }
                  title="View Git Diff"
                  className="p-1.5 rounded-full hover:bg-white/10 text-slate-300 hover:text-white transition-colors cursor-pointer"
                >
                  <FileDiff className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={() => void interruptTerminal(attachedAddress)}
                title="Send interrupt signal"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] bg-white/8 hover:bg-amber-500/20 text-slate-200 hover:text-amber-300 transition-colors cursor-pointer"
              >
                <OctagonX className="w-3 h-3" />
                Stop
              </button>
              <button
                onClick={() => void popoutExternalTerminal(attachedAddress)}
                title="Pop out in external terminal"
                className="p-1.5 rounded-full hover:bg-white/10 text-slate-300 hover:text-white transition-colors cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setAttachedAddress(null)}
                title="Close terminal pane (Ctrl+`)"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] bg-white/10 hover:bg-white/15 text-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-3 h-3" />
                <kbd className="text-[10px] text-slate-300 font-mono-code">
                  Ctrl+`
                </kbd>
              </button>
            </div>
          </div>

          {/* Worktree Multi-Session Tab Bar ([agy] [shell] [+ Shell] [+ AI]) */}
          <TerminalSessionTabs
            tabs={worktreeTabs}
            activeAddress={attachedAddress}
            canSpawnInWorktree={canSpawnInWorktree}
            spawningShell={spawningShell}
            onSelectTab={handleSelectTab}
            onCloseTab={(addr) => void handleCloseTab(addr)}
            onAddShell={() => void handleAddShell()}
            onAddAi={handleAddAi}
          />

          {/* Pill Preset Strip */}
          <div
            className="px-3.5 py-1.5 flex items-center gap-1.5 flex-wrap shrink-0 select-none"
            style={{
              borderBottom: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            {presets.slice(0, 8).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => void handleSendPreset(p.prompt)}
                title={p.prompt}
                className="px-3 py-0.5 rounded-full text-[11px] bg-white/8 hover:bg-white/15 text-slate-200 hover:text-white transition-colors cursor-pointer"
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              title="프롬프트 프리셋 편집"
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <Settings2 className="w-3 h-3" />
              <span>Edit</span>
            </button>
          </div>

          <div
            ref={containerRef}
            className="flex-1 w-full h-full p-2.5 overflow-hidden"
          />
        </div>
      </section>
    );
  }
);
