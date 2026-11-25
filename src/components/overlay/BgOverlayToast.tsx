import React, { useEffect, useState } from "react";
import { ArrowUpRight, BellRing, CheckCircle2, ShieldAlert, X } from "lucide-react";
import {
  dismissBgOverlay,
  focusMainFromOverlay,
  getBgOverlayPayload,
  hideBgOverlay,
  listenBgOverlayUpdate,
} from "../../services/tauriBridge";
import type { BgOverlayPayload } from "../../types/domain";
import { applyThemeToDom, normalizeThemeId } from "../../utils/themes";

export const BgOverlayToast: React.FC = () => {
  const [payload, setPayload] = useState<BgOverlayPayload | null>(null);
  const [pulseKey, setPulseKey] = useState(0);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;

    const applyPayload = (next: BgOverlayPayload | null) => {
      if (!active || !next) return;
      applyThemeToDom(normalizeThemeId(next.theme));
      setPayload(next);
      setPulseKey((n) => n + 1);
    };

    void getBgOverlayPayload()
      .then((initial) => applyPayload(initial))
      .catch(() => {});

    void listenBgOverlayUpdate((next) => applyPayload(next))
      .then((fn) => {
        if (!active) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    return () => {
      active = false;
      if (unlisten) unlisten();
    };
  }, []);

  // Auto-dismiss settings preview after 5.5s so it never lingers unexpectedly
  useEffect(() => {
    if (!payload?.is_preview) return;
    const timer = setTimeout(() => {
      void hideBgOverlay().catch(() => {});
    }, 5500);
    return () => clearTimeout(timer);
  }, [payload?.is_preview, pulseKey]);

  if (!payload) {
    return null;
  }

  const isUrgent = payload.bucket === "needs_you";
  const isLightTheme = payload.theme === "nordic";
  const accentColor = isUrgent ? "var(--action-fg)" : "var(--ready-fg)";
  const accentSoft = isUrgent ? "var(--action-soft)" : "var(--ready-soft)";
  const badgeTextColor = isLightTheme ? "#ffffff" : "#0b0f1c";
  const surfaceBg = isUrgent
    ? "linear-gradient(135deg, rgba(251, 113, 133, 0.22) 0%, var(--modal-bg) 42%, var(--modal-bg) 100%)"
    : "linear-gradient(135deg, rgba(52, 211, 153, 0.2) 0%, var(--modal-bg) 42%, var(--modal-bg) 100%)";

  const handleOpen = () => {
    if (payload.is_preview && payload.card_key === "__preview__") {
      void hideBgOverlay().catch(() => {});
      return;
    }
    void focusMainFromOverlay(payload.card_key, payload.address).catch(() => {});
  };

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (payload.is_preview) {
      void hideBgOverlay().catch(() => {});
      return;
    }
    void dismissBgOverlay(payload.stamp).catch(() => {});
  };

  return (
    <div className="w-screen h-screen p-2 flex items-center justify-center bg-transparent select-none overflow-hidden">
      <div
        key={pulseKey}
        role="button"
        tabIndex={0}
        onClick={handleOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleOpen();
          } else if (e.key === "Escape") {
            if (payload.is_preview) void hideBgOverlay().catch(() => {});
            else void dismissBgOverlay(payload.stamp).catch(() => {});
          }
        }}
        className="jjdr-overlay-card relative w-full h-full rounded-[18px] cursor-pointer overflow-hidden flex items-stretch"
        style={{
          background: surfaceBg,
          border: `2px solid ${accentColor}`,
          boxShadow: isUrgent
            ? "0 14px 34px -6px rgba(244, 63, 94, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.08) inset"
            : "0 14px 34px -6px rgba(16, 185, 129, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.08) inset",
        }}
      >
        {/* High-visibility Left Beacon Strip */}
        <div
          className="w-2 shrink-0 jjdr-overlay-beacon"
          style={{ background: accentColor }}
        />

        {/* Main Content */}
        <div className="flex-1 min-w-0 px-3.5 py-2.5 flex flex-col justify-between gap-1.5">
          {/* Top Row: Status Badge + Project + Pending Count + Close */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold tracking-wide shrink-0"
                style={{
                  background: accentColor,
                  color: badgeTextColor,
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full jjdr-dot-pulse"
                  style={{ background: badgeTextColor }}
                />
                {isUrgent ? (
                  <ShieldAlert className="w-3 h-3" />
                ) : (
                  <CheckCircle2 className="w-3 h-3" />
                )}
                {payload.badge}
              </span>

              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: payload.project_color || "var(--accent)" }}
                />
                <span
                  className="text-xs font-bold truncate"
                  style={{ color: "var(--text-primary)" }}
                >
                  {payload.project_name}
                </span>
                <span
                  className="text-[10px] font-mono-code px-1.5 py-0.5 rounded-md shrink-0"
                  style={{
                    background: "var(--pill-bg)",
                    color: "var(--text-secondary)",
                  }}
                >
                  {payload.agent_label}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {payload.is_preview && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
                  style={{
                    background: "var(--accent-soft)",
                    color: "var(--accent)",
                  }}
                >
                  <BellRing className="w-2.5 h-2.5" />
                  미리보기
                </span>
              )}
              {payload.pending_count > 1 && (
                <span
                  className="px-2 py-0.5 rounded-full text-[10px] font-bold tabular-nums"
                  style={{
                    background: accentSoft,
                    color: accentColor,
                    border: `1px solid ${accentColor}`,
                  }}
                >
                  +{payload.pending_count - 1} 대기
                </span>
              )}
              <button
                type="button"
                onClick={handleDismiss}
                title="이 알림 닫기"
                className="p-1 rounded-full hover:bg-black/20 cursor-pointer transition-colors"
                style={{ color: "var(--text-muted)" }}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Middle & Bottom Row: Branch + Message + Prominent Open CTA */}
          <div className="flex items-end justify-between gap-3 min-w-0">
            <div className="min-w-0 flex-1">
              <div
                className="text-[15px] font-extrabold leading-tight truncate"
                style={{ color: "var(--text-primary)" }}
              >
                {payload.branch}
              </div>
              <p
                className="mt-1 text-xs leading-snug line-clamp-2"
                style={{ color: "var(--text-secondary)" }}
              >
                {payload.message}
              </p>
            </div>

            <div
              className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-extrabold"
              style={{
                background: accentSoft,
                color: accentColor,
                border: `1.5px solid ${accentColor}`,
              }}
            >
              <span>{payload.is_approval ? "지금 확인" : "열기"}</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
