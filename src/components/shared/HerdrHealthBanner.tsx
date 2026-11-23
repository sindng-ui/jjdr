import React, { useEffect, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { getInitialState, reconnectHerdr } from "../../services/tauriBridge";

export const HerdrHealthBanner = React.memo(function HerdrHealthBanner() {
  const health = useAppStore((s) => s.health);
  const [reconnecting, setReconnecting] = useState(false);
  const [graceElapsed, setGraceElapsed] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setGraceElapsed(true), 1500);
    return () => clearTimeout(t);
  }, []);

  if (health.connected) return null;
  if (!graceElapsed && !health.error) return null;

  const handleReconnect = async () => {
    setReconnecting(true);
    try {
      const nextHealth = await reconnectHerdr();
      useAppStore.getState().setHealth(nextHealth);
      const snap = await getInitialState();
      useAppStore.getState().applyBatch(snap);
    } finally {
      setReconnecting(false);
    }
  };

  return (
    <div className="px-3 pb-2 shrink-0">
      <div
        className="flex items-center justify-between gap-3 px-4 py-2 rounded-full text-xs"
        style={{
          background: "var(--action-soft)",
          border: "1px solid var(--action-border)",
        }}
      >
        <div
          className="flex items-center gap-2 min-w-0"
          style={{ color: "var(--action-fg)" }}
        >
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="font-semibold shrink-0">
            {health.hc_found ? "herdr-core Disconnected" : "hc CLI Not Found"}
          </span>
          <span
            className="truncate"
            style={{ color: "var(--text-secondary)" }}
          >
            {health.error || "Waiting for herdr-core daemon..."}
            {health.hint ? ` — ${health.hint}` : ""}
          </span>
        </div>
        <button
          onClick={() => void handleReconnect()}
          disabled={reconnecting}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-semibold shrink-0 cursor-pointer transition-opacity hover:opacity-90"
          style={{
            background: "var(--action-fg)",
            color: "#ffffff",
          }}
        >
          <RefreshCw
            className={`w-3 h-3 ${reconnecting ? "animate-spin" : ""}`}
          />
          Reconnect
        </button>
      </div>
    </div>
  );
});
