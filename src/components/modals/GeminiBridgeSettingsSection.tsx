import React, { useCallback, useEffect, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Loader2,
  Radio,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import {
  getGeminiBridgeStatus,
  installGeminiBridgeHooks,
  isTauriRuntime,
  testGeminiBridgeEvent,
  uninstallGeminiBridgeHooks,
} from "../../services/tauriBridge";
import { useUiStore } from "../../store/useUiStore";
import type { GeminiBridgeStatus } from "../../types/domain";

function formatLastEventAge(ts?: number | null): string {
  if (!ts) return "never";
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

export const GeminiBridgeSettingsSection = React.memo(
  function GeminiBridgeSettingsSection() {
    const showToast = useUiStore((s) => s.showToast);
    const [status, setStatus] = useState<GeminiBridgeStatus | null>(null);
    const [busy, setBusy] = useState<"load" | "install" | "uninstall" | "test" | null>(
      null
    );

    const refresh = useCallback(async () => {
      if (!isTauriRuntime()) return;
      setBusy("load");
      try {
        const res = await getGeminiBridgeStatus();
        setStatus(res);
      } catch {
        // Non-fatal in browser preview
      } finally {
        setBusy(null);
      }
    }, []);

    useEffect(() => {
      void refresh();
    }, [refresh]);

    const handleInstall = async () => {
      if (busy) return;
      setBusy("install");
      try {
        const res = await installGeminiBridgeHooks();
        setStatus(res);
        showToast("Gemini CLI 3-event bridge hooks enabled.", "success");
      } catch (err) {
        showToast(`Failed to enable Gemini hooks: ${String(err)}`, "error");
      } finally {
        setBusy(null);
      }
    };

    const handleUninstall = async () => {
      if (busy) return;
      setBusy("uninstall");
      try {
        const res = await uninstallGeminiBridgeHooks();
        setStatus(res);
        showToast(
          "Gemini CLI switched to Screen-Only Mode (0 hooks).",
          "info"
        );
      } catch (err) {
        showToast(`Failed to remove Gemini hooks: ${String(err)}`, "error");
      } finally {
        setBusy(null);
      }
    };

    const handleTest = async () => {
      if (busy) return;
      setBusy("test");
      try {
        const res = await testGeminiBridgeEvent("AfterAgent");
        setStatus(res);
        showToast("Gemini bridge loopback self-test passed.", "success");
      } catch (err) {
        showToast(`Gemini bridge self-test failed: ${String(err)}`, "error");
      } finally {
        setBusy(null);
      }
    };

    const hooksEnabled = status?.hooks_installed ?? false;
    const isRunning = status?.running ?? false;

    return (
      <div
        className="pt-4 space-y-2.5"
        style={{ borderTop: "1px solid var(--divider)" }}
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <Sparkles
              className="w-3.5 h-3.5"
              style={{ color: "var(--accent)" }}
            />
            <span
              className="font-bold text-xs"
              style={{ color: "var(--text-primary)" }}
            >
              Gemini CLI Status Bridge
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span
              className="inline-flex items-center gap-1 text-[10px] font-mono-code px-2 py-0.5 rounded-full"
              style={{
                background: isRunning
                  ? "rgba(52, 211, 153, 0.14)"
                  : "var(--pill-bg)",
                color: isRunning ? "var(--status-ready)" : "var(--text-muted)",
              }}
            >
              <Radio className="w-2.5 h-2.5" />
              {isRunning
                ? `UDP 127.0.0.1:${status?.port}`
                : "Bridge Standby"}
            </span>
            <span
              className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{
                background: hooksEnabled
                  ? "rgba(99, 102, 241, 0.14)"
                  : "var(--pill-bg)",
                color: hooksEnabled ? "var(--accent)" : "var(--text-secondary)",
              }}
            >
              {hooksEnabled ? (
                <>
                  <CheckCircle2 className="w-2.5 h-2.5" />
                  3-Event Hooks + Screen
                </>
              ) : (
                <>
                  <ShieldCheck className="w-2.5 h-2.5" />
                  Screen-Only (0 Hooks)
                </>
              )}
            </span>
          </div>
        </div>

        <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
          Tracks Gemini CLI <span className="font-mono-code">working</span>,{" "}
          <span className="font-mono-code">permission</span>, and{" "}
          <span className="font-mono-code">ready</span> states using only 3
          turn-boundary hooks (zero per-tool hooks, zero extra Node spawns) plus
          built-in TUI screen fallback.
        </p>

        {status && (
          <div
            className="rounded-xl px-3 py-2 text-[11px] flex items-center justify-between gap-2 flex-wrap"
            style={{
              background: "var(--pill-bg)",
              border: "1px solid var(--divider)",
              color: "var(--text-secondary)",
            }}
          >
            <div className="flex items-center gap-3 flex-wrap">
              <span>
                Live Gemini:{" "}
                <strong style={{ color: "var(--text-primary)" }}>
                  {status.active_gemini_terminals}
                </strong>
              </span>
              <span>
                Events:{" "}
                <strong style={{ color: "var(--text-primary)" }}>
                  {status.events_received}
                </strong>
              </span>
              <span>
                Last:{" "}
                <strong className="font-mono-code" style={{ color: "var(--text-primary)" }}>
                  {status.last_event_name
                    ? `${status.last_event_name} (${formatLastEventAge(status.last_event_ms)})`
                    : "none"}
                </strong>
              </span>
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={busy !== null}
              className="p-1 rounded-full hover:bg-black/10 cursor-pointer disabled:opacity-50"
              style={{ color: "var(--text-muted)" }}
              title="Refresh bridge status"
            >
              <RefreshCw
                className={`w-3 h-3 ${busy === "load" ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        )}

        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => void handleInstall()}
            disabled={busy !== null}
            className="jjdr-pill inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold cursor-pointer disabled:opacity-50"
            style={{ color: "var(--accent)" }}
          >
            {busy === "install" ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Wrench className="w-3 h-3" />
            )}
            <span>
              {hooksEnabled ? "Repair 3-Event Hooks" : "Enable 3-Event Hooks"}
            </span>
          </button>

          {hooksEnabled && (
            <button
              type="button"
              onClick={() => void handleUninstall()}
              disabled={busy !== null}
              className="jjdr-pill inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium cursor-pointer disabled:opacity-50"
              style={{ color: "var(--text-secondary)" }}
              title="Remove ~/.gemini/settings.json hooks and rely solely on built-in screen parsing"
            >
              {busy === "uninstall" ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <ShieldCheck className="w-3 h-3" />
              )}
              <span>Screen-Only Mode (0 Hooks)</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => void handleTest()}
            disabled={busy !== null}
            className="jjdr-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium cursor-pointer disabled:opacity-50"
            style={{ color: "var(--text-muted)" }}
          >
            {busy === "test" ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Activity className="w-3 h-3" />
            )}
            <span>Test Bridge</span>
          </button>
        </div>
      </div>
    );
  }
);
