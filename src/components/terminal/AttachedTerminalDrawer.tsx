import React, { useEffect, useRef, useState } from "react";
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
  listenTermClosed,
  listenTermData,
  popoutExternalTerminal,
  resizeTerminal,
  sendTerminalText,
  writeTerminalInput,
} from "../../services/tauriBridge";
import { StatusBadge } from "../shared/StatusBadge";

function decodeBase64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

export const AttachedTerminalDrawer = React.memo(function AttachedTerminalDrawer() {
  const attachedAddress = useUiStore((s) => s.attachedAddress);
  const setAttachedAddress = useUiStore((s) => s.setAttachedAddress);
  const setDiffTarget = useUiStore((s) => s.setDiffTarget);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const showToast = useUiStore((s) => s.showToast);
  const presets = useAppStore((s) => s.settings.prompt_presets);

  const session = useAppStore((s) =>
    attachedAddress
      ? s.computed.allSessions.find((item) => item.address === attachedAddress) ??
        null
      : null
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const [statusText, setStatusText] = useState<string>("Connecting...");

  useEffect(() => {
    if (!attachedAddress || !containerRef.current) return;

    let disposed = false;
    let activeChannel: number | null = null;
    let unlistenData: (() => void) | null = null;
    let unlistenClosed: (() => void) | null = null;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const earlyChunks: Uint8Array[] = [];

    setStatusText("Attaching...");

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      lineHeight: 1.25,
      fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
      scrollback: 2000,
      theme: {
        background: "#0b0c0e",
        foreground: "#f4f4f5",
        cursor: "#e4e4e7",
        selectionBackground: "#272a34",
        black: "#0b0c0e",
        red: "#f87171",
        green: "#34d399",
        yellow: "#fbbf24",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#38bdf8",
        white: "#f4f4f5",
      },
    });

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
      const isCtrlCombo = (ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey;
      const k = ev.key.toLowerCase();
      const isReserved =
        (isCtrlCombo &&
          (ev.code === "Backquote" ||
            ev.key === "`" ||
            ev.key === "ArrowUp" ||
            ev.key === "ArrowDown" ||
            ev.key === "ArrowLeft" ||
            ev.key === "ArrowRight" ||
            k === "n" ||
            ev.code === "KeyN" ||
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
            showToast("종료된 세션입니다. 타일에서 새 세션을 시작하세요.", "info");
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

  if (!attachedAddress) return null;

  const handleSendPreset = async (prompt: string) => {
    if (!prompt.trim()) return;
    try {
      await sendTerminalText(attachedAddress, prompt, false);
      if (session) {
        useAppStore.getState().acknowledgeTurn(attachedAddress, session.terminal.turn);
      }
    } catch (err) {
      showToast(`프리셋 전송 실패: ${String(err)}`, "error");
    }
  };

  return (
    <section className="w-[52%] min-w-[460px] max-w-[860px] border-l border-[#1c1f26] bg-[#0b0c0e] flex flex-col shrink-0">
      {/* Sleek Obsidian Terminal Header */}
      <div className="h-10 px-3.5 bg-[#0e1013] border-b border-[#1c1f26] flex items-center justify-between gap-2 shrink-0 select-none">
        <div className="flex items-center gap-2 min-w-0">
          {session && (
            <StatusBadge
              bucket={session.bucket}
              status={session.terminal.status}
              compact
            />
          )}
          <span className="text-xs font-medium text-[#a1a1aa] truncate">
            {session ? session.projectName : "Terminal"}
          </span>
          {session && (
            <>
              <span className="text-[#3f3f46]">/</span>
              <span className="text-xs font-mono-code font-semibold text-[#f4f4f5] truncate">
                {session.branch}
              </span>
            </>
          )}
          <span className="text-[11px] font-mono-code text-[#52525b] shrink-0">
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
              className="p-1 rounded-md hover:bg-[#181b22] text-[#71717a] hover:text-[#e4e4e7] transition-colors cursor-pointer"
            >
              <FileDiff className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => void interruptTerminal(attachedAddress)}
            title="Send interrupt signal"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-[#181b22] hover:bg-[#271c18] text-[#a1a1aa] hover:text-[#f59e0b] border border-[#222630] transition-colors cursor-pointer"
          >
            <OctagonX className="w-3 h-3" />
            Stop
          </button>
          <button
            onClick={() => void popoutExternalTerminal(attachedAddress)}
            title="Pop out in external terminal"
            className="p-1 rounded-md hover:bg-[#181b22] text-[#71717a] hover:text-[#e4e4e7] transition-colors cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setAttachedAddress(null)}
            title="Close terminal pane (Ctrl+`)"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-[#181b22] hover:bg-[#222631] text-[#d4d4d8] border border-[#222630] transition-colors cursor-pointer"
          >
            <X className="w-3 h-3" />
            <kbd className="text-[10px] text-[#71717a] font-mono-code">
              Ctrl+`
            </kbd>
          </button>
        </div>
      </div>

      {/* Minimal Pill Preset Strip */}
      <div className="px-3 py-1.5 bg-[#0d0f13] border-b border-[#181b22] flex items-center gap-1.5 flex-wrap shrink-0 select-none">
        {presets.slice(0, 8).map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => void handleSendPreset(p.prompt)}
            title={p.prompt}
            className="px-2.5 py-0.5 rounded-full text-[11px] bg-[#14171d] hover:bg-[#1d212a] text-[#a1a1aa] hover:text-[#f4f4f5] border border-[#1f232c] transition-colors cursor-pointer"
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          title="프롬프트 프리셋 편집"
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] text-[#6b7280] hover:text-[#d4d4d8] transition-colors cursor-pointer"
        >
          <Settings2 className="w-3 h-3" />
          <span>Edit</span>
        </button>
      </div>

      <div ref={containerRef} className="flex-1 w-full h-full p-2 overflow-hidden" />
    </section>
  );
});
