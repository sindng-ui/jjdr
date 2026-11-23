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
    <div className="flex items-center justify-between gap-3 px-4 py-1.5 bg-[#1a1114] border-b border-[#381d24] text-xs">
      <div className="flex items-center gap-2 text-[#fca5a5] min-w-0">
        <AlertCircle className="w-3.5 h-3.5 shrink-0 text-[#ef4444]" />
        <span className="font-medium shrink-0">
          {health.hc_found ? "herdr-core Disconnected" : "hc CLI Not Found"}
        </span>
        <span className="text-[#a1a1aa] truncate">
          {health.error || "Waiting for herdr-core daemon..."}
          {health.hint ? ` — ${health.hint}` : ""}
        </span>
      </div>
      <button
        onClick={() => void handleReconnect()}
        disabled={reconnecting}
        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-[#28161b] hover:bg-[#361c23] text-[#f87171] border border-[#4a232c] font-medium shrink-0 cursor-pointer transition-colors"
      >
        <RefreshCw className={`w-3 h-3 ${reconnecting ? "animate-spin" : ""}`} />
        Reconnect
      </button>
    </div>
  );
});
