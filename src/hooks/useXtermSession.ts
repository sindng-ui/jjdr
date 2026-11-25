import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { useAppStore } from "../store/useAppStore";
import { useUiStore } from "../store/useUiStore";
import {
  attachTerminal,
  detachTerminal,
  focusTerminal,
  listenTermClosed,
  listenTermData,
  resizeTerminal,
  writeTerminalInput,
} from "../services/tauriBridge";
import { getThemePreset } from "../utils/themes";
import { cardKeyForSession } from "../utils/worktreeSessions";

// DEC Mode 2026 (Synchronized Output): lets xterm.js paint an entire screen swap in one atomic frame
const SYNC_START = new TextEncoder().encode("\x1b[?2026h");
const SYNC_END = new TextEncoder().encode("\x1b[?2026l");

function decodeBase64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0];
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below for restricted WebView2 focus states
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function isReservedGlobalShortcut(ev: KeyboardEvent): boolean {
  const hasCtrl = ev.ctrlKey || ev.metaKey;
  // Block Ctrl+Shift+Alt+Arrow (keyboard card grab/swap) across ALL phases
  if (
    hasCtrl &&
    ev.shiftKey &&
    ev.altKey &&
    (ev.key === "ArrowUp" ||
      ev.key === "ArrowDown" ||
      ev.key === "ArrowLeft" ||
      ev.key === "ArrowRight")
  ) {
    return true;
  }
  // Block Ctrl+Tab / Ctrl+Shift+Tab and Alt+Enter across ALL key phases so they never leak into xterm
  if (hasCtrl && !ev.altKey && (ev.key === "Tab" || ev.code === "Tab")) {
    return true;
  }
  if (ev.altKey && !hasCtrl && !ev.shiftKey && ev.key === "Enter") {
    return true;
  }
  if (ev.type !== "keydown") return false;
  const isPlainCtrl = hasCtrl && !ev.altKey && !ev.shiftKey;
  const isCtrlShift = hasCtrl && !ev.altKey && ev.shiftKey;
  const k = ev.key.toLowerCase();

  return (
    (isCtrlShift &&
      (k === "t" || ev.code === "KeyT" || k === "a" || ev.code === "KeyA")) ||
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
        k === "p" ||
        ev.code === "KeyP" ||
        k === "m" ||
        ev.code === "KeyM" ||
        k === "b" ||
        ev.code === "KeyB" ||
        k === "1" ||
        ev.code === "Digit1" ||
        k === "2" ||
        ev.code === "Digit2" ||
        k === "3" ||
        ev.code === "Digit3" ||
        (ev.key === "Enter" && useUiStore.getState().viewMode === "zen") ||
        ev.key === "\\" ||
        ev.code === "Backslash")) ||
    (ev.altKey && (ev.key === "Escape" || ev.key === "Enter"))
  );
}

function isSameWorktreeSwitch(
  prevAddr: string | null,
  nextAddr: string | null
): boolean {
  if (!prevAddr || !nextAddr) return false;
  const all = useAppStore.getState().computed.allSessions;
  const prev = all.find((s) => s.address === prevAddr);
  const next = all.find((s) => s.address === nextAddr);
  if (!prev || !next) return false;
  return cardKeyForSession(prev) === cardKeyForSession(next);
}

/**
 * Reuses a single XTerm + WebGL instance while the drawer stays open and performs
 * atomic DEC-2026 synchronized screen swaps so switching tabs (Ctrl+Tab) or cards
 * never flashes blank screens or replays slow scrollback animations.
 */
export function useXtermSession(
  containerRef: React.RefObject<HTMLDivElement | null>,
  attachedAddress: string | null
) {
  const themeId = useAppStore((s) => s.settings.theme);
  const terminalFocusNonce = useUiStore((s) => s.terminalFocusNonce);
  const detachToEmptyDrawer = useUiStore((s) => s.detachToEmptyDrawer);
  const showToast = useUiStore((s) => s.showToast);

  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const activeChannelRef = useRef<number | null>(null);
  const activeAddressRef = useRef<string | null>(null);
  const prevAddressRef = useRef<string | null>(null);
  const attachGenRef = useRef(0);
  const hasEverAttachedRef = useRef(false);
  const needsAtomicResetRef = useRef(false);
  const writeQueueRef = useRef<Uint8Array[]>([]);
  const rafIdRef = useRef<number | null>(null);

  const [statusText, setStatusText] = useState<string>("Ready");

  const flushWriteQueue = useCallback(() => {
    rafIdRef.current = null;
    const term = termRef.current;
    if (!term || writeQueueRef.current.length === 0) return;
    const batch = writeQueueRef.current.splice(0);
    const merged = concatBytes(batch);

    if (needsAtomicResetRef.current) {
      needsAtomicResetRef.current = false;
      // Atomic screen swap: reset + initial paint inside a single DEC 2026 sync frame (zero flash!)
      term.reset();
      term.write(concatBytes([SYNC_START, merged, SYNC_END]));
    } else {
      term.write(merged);
    }
  }, []);

  const enqueueBytes = useCallback(
    (bytes: Uint8Array) => {
      writeQueueRef.current.push(bytes);
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(flushWriteQueue);
      }
    },
    [flushWriteQueue]
  );

  const fitNow = useCallback(() => {
    const term = termRef.current;
    const fitAddon = fitAddonRef.current;
    const hostEl = containerRef.current;
    if (!term || !fitAddon || !hostEl) return;
    if (hostEl.clientWidth < 40 || hostEl.clientHeight < 40) return;
    try {
      fitAddon.fit();
      if (activeChannelRef.current !== null && term.cols > 0 && term.rows > 0) {
        void resizeTerminal(activeChannelRef.current, term.cols, term.rows);
      }
    } catch {
      // Ignore transient fit while hidden
    }
  }, [containerRef]);

  const focusNow = useCallback(() => {
    const term = termRef.current;
    if (!term || !activeAddressRef.current) return;
    // Never steal focus when any modal or context menu is open
    const ui = useUiStore.getState();
    if (
      ui.settingsOpen ||
      ui.commandPaletteOpen ||
      ui.quickFileOpen ||
      ui.projectModalProject ||
      ui.createWorktreeProjectId ||
      ui.editWorktreeTarget ||
      ui.launchTarget ||
      ui.teardownTarget ||
      ui.diffTarget ||
      ui.markdownViewerTarget ||
      ui.codeViewerTarget ||
      ui.contextMenu
    ) {
      return;
    }
    const activeEl = document.activeElement as HTMLElement | null;
    // Never steal focus if user deliberately opened a modal/search input
    if (
      activeEl &&
      (activeEl.tagName === "INPUT" ||
        activeEl.tagName === "SELECT" ||
        (activeEl.tagName === "TEXTAREA" &&
          !activeEl.classList.contains("xterm-helper-textarea")))
    ) {
      return;
    }
    term.focus();
    term.textarea?.focus({ preventScroll: true });
    if (activeChannelRef.current !== null) {
      void focusTerminal(activeChannelRef.current, true);
    }
  }, []);

  // 1. Mount a single XTerm + WebGL instance for the lifetime of the open drawer
  useEffect(() => {
    const hostEl = containerRef.current;
    if (!hostEl) return;

    const initialXtermTheme = getThemePreset(
      useAppStore.getState().settings.theme
    ).xterm;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      lineHeight: 1.25,
      fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
      scrollback: 2000,
      rightClickSelectsWord: false,
      theme: initialXtermTheme,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(hostEl);

    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // Graceful fallback to canvas/DOM renderer
    }

    const copyCurrentSelection = () => {
      if (!term.hasSelection()) return false;
      const text = term.getSelection();
      if (!text) return false;
      void copyTextToClipboard(text).then((ok) => {
        if (ok) {
          term.clearSelection();
          showToast(`클립보드에 복사됨 (${text.length}자)`, "success", 1400);
        } else {
          showToast("클립보드 복사에 실패했습니다.", "error", 2000);
        }
        term.focus();
      });
      return true;
    };

    term.attachCustomKeyEventHandler((ev) => {
      if (isReservedGlobalShortcut(ev)) return false;

      if (ev.type === "keydown") {
        const hasCtrl = ev.ctrlKey || ev.metaKey;
        const k = ev.key.toLowerCase();

        // Smart Ctrl+C: copy when text is selected; otherwise forward SIGINT (^C) to PTY
        if (hasCtrl && !ev.altKey && !ev.shiftKey && (k === "c" || ev.code === "KeyC")) {
          if (term.hasSelection()) {
            ev.preventDefault();
            copyCurrentSelection();
            return false;
          }
        }
        // Ctrl+Shift+C: explicit copy
        if (hasCtrl && ev.shiftKey && !ev.altKey && (k === "c" || ev.code === "KeyC")) {
          if (term.hasSelection()) {
            ev.preventDefault();
            copyCurrentSelection();
            return false;
          }
        }
        // Ctrl+Shift+V: explicit paste into PTY
        if (hasCtrl && ev.shiftKey && !ev.altKey && (k === "v" || ev.code === "KeyV")) {
          ev.preventDefault();
          void navigator.clipboard
            ?.readText()
            .then((clip) => {
              if (clip && activeChannelRef.current !== null) {
                void writeTerminalInput(activeChannelRef.current, clip);
              }
            })
            .catch(() => {});
          return false;
        }
      }
      return true;
    });

    const onContextMenu = (ev: MouseEvent) => {
      ev.preventDefault();
      if (term.hasSelection()) {
        copyCurrentSelection();
      }
    };
    hostEl.addEventListener("contextmenu", onContextMenu);

    const dataSub = term.onData((data) => {
      if (activeChannelRef.current !== null) {
        void writeTerminalInput(activeChannelRef.current, data);
      }
    });

    const onFocusIn = () => {
      if (activeChannelRef.current !== null) {
        void focusTerminal(activeChannelRef.current, true);
      }
    };
    const onFocusOut = () => {
      if (activeChannelRef.current !== null) {
        void focusTerminal(activeChannelRef.current, false);
      }
    };
    hostEl.addEventListener("focusin", onFocusIn);
    hostEl.addEventListener("focusout", onFocusOut);

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!activeAddressRef.current) return;
        fitNow();
      }, 60);
    });
    resizeObserver.observe(hostEl);

    termRef.current = term;
    fitAddonRef.current = fitAddon;
    fitAddon.fit();

    return () => {
      attachGenRef.current += 1;
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      writeQueueRef.current = [];
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      hostEl.removeEventListener("contextmenu", onContextMenu);
      hostEl.removeEventListener("focusin", onFocusIn);
      hostEl.removeEventListener("focusout", onFocusOut);
      dataSub.dispose();
      if (activeChannelRef.current !== null) {
        const ch = activeChannelRef.current;
        activeChannelRef.current = null;
        void detachTerminal(ch);
      }
      termRef.current = null;
      fitAddonRef.current = null;
      term.dispose();
    };
  }, [containerRef, fitNow, showToast]);

  // 2. Live theme sync without recreating XTerm
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = getThemePreset(themeId).xterm;
    }
  }, [themeId]);

  // 2b. Explicit focus requests (e.g. Ctrl+Arrow card switch, Ctrl+N jump, or Zen card rise)
  useEffect(() => {
    if (terminalFocusNonce === 0 || !attachedAddress) return;
    const raf = requestAnimationFrame(() => focusNow());
    const t1 = setTimeout(() => focusNow(), 70);
    const t2 = setTimeout(() => focusNow(), 180);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [terminalFocusNonce, attachedAddress, focusNow]);

  // 3. Switch attached stream smoothly without blank-screen flashing
  useEffect(() => {
    const gen = ++attachGenRef.current;
    const prevAddr = prevAddressRef.current;
    prevAddressRef.current = attachedAddress;
    activeAddressRef.current = attachedAddress;

    writeQueueRef.current = [];
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    if (activeChannelRef.current !== null) {
      const prevCh = activeChannelRef.current;
      activeChannelRef.current = null;
      void detachTerminal(prevCh);
    }

    if (!attachedAddress) {
      needsAtomicResetRef.current = false;
      termRef.current?.reset();
      setStatusText("Standby");
      return;
    }

    // Defer reset until the first frame of the new terminal arrives (eliminates blank-screen flash!)
    needsAtomicResetRef.current = true;

    let cancelled = false;
    let unlistenData: (() => void) | null = null;
    let unlistenClosed: (() => void) | null = null;
    const earlyChunks: Uint8Array[] = [];

    setStatusText("Switching...");

    // Same-worktree tab switches (Ctrl+Tab) & first open attach immediately (0ms);
    // cross-card rapid arrow flips debounce 100ms to prevent Gemini CLI stalls.
    const sameWt = isSameWorktreeSwitch(prevAddr, attachedAddress);
    const delayMs = !hasEverAttachedRef.current || sameWt ? 0 : 100;
    hasEverAttachedRef.current = true;

    const timer = setTimeout(() => {
      const connectStream = async () => {
        if (cancelled || gen !== attachGenRef.current) return;
        const currentTerm = termRef.current;
        if (!currentTerm) return;

        try {
          unlistenData = await listenTermData((ev) => {
            if (
              cancelled ||
              gen !== attachGenRef.current ||
              ev.address !== attachedAddress
            ) {
              return;
            }
            const bytes = decodeBase64ToBytes(ev.data_b64);
            if (activeChannelRef.current === null) {
              earlyChunks.push(bytes);
            } else if (ev.channel === activeChannelRef.current) {
              enqueueBytes(bytes);
            }
          });

          unlistenClosed = await listenTermClosed((ev) => {
            if (
              cancelled ||
              gen !== attachGenRef.current ||
              ev.address !== attachedAddress
            ) {
              return;
            }
            if (
              activeChannelRef.current === null ||
              ev.channel === activeChannelRef.current
            ) {
              setStatusText("Closed");
            }
          });

          if (cancelled || gen !== attachGenRef.current) return;

          // Ensure exact viewport cols/rows right before attaching so PTY never overflows bottom lines
          try {
            fitAddonRef.current?.fit();
          } catch {
            // ignore transient layout
          }

          const res = await attachTerminal(
            attachedAddress,
            currentTerm.cols || 100,
            currentTerm.rows || 30,
            false
          );

          if (cancelled || gen !== attachGenRef.current) {
            void detachTerminal(res.channel);
            return;
          }

          activeChannelRef.current = res.channel;
          setStatusText(`ch ${res.channel}`);

          // Re-sync PTY size after headers/tabs settle and immediately hand keyboard focus to the prompt
          requestAnimationFrame(() => {
            if (cancelled || gen !== attachGenRef.current) return;
            fitNow();
            focusNow();
          });
          setTimeout(() => {
            if (!cancelled && gen === attachGenRef.current) {
              fitNow();
              focusNow();
            }
          }, 140);

          if (earlyChunks.length > 0) {
            enqueueBytes(concatBytes(earlyChunks.splice(0)));
          } else {
            // Fallback: if an empty terminal emits no initial frame within 150ms, clear stale screen
            setTimeout(() => {
              if (!cancelled && gen === attachGenRef.current && needsAtomicResetRef.current) {
                needsAtomicResetRef.current = false;
                termRef.current?.reset();
              }
            }, 150);
          }
        } catch (err) {
          if (!cancelled && gen === attachGenRef.current) {
            const msg = String(err);
            if (msg.includes("has finished") || msg.includes("not_found")) {
              detachToEmptyDrawer();
              showToast("종료된 세션입니다. 새 세션을 시작하세요.", "info");
            } else {
              setStatusText("Error");
              showToast(`Attach failed: ${msg}`, "error");
            }
          }
        }
      };

      void connectStream();
    }, delayMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (unlistenData) unlistenData();
      if (unlistenClosed) unlistenClosed();
    };
  }, [attachedAddress, detachToEmptyDrawer, enqueueBytes, fitNow, focusNow, showToast]);

  return { statusText, fitNow, focusNow };
}
