import React from "react";

/** Reusable Zero-Blur Zen Mascot brand icon (no text, crisp at any DPI) */
export const BrandMascotIcon = React.memo(function BrandMascotIcon({
  size = 34,
}: {
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden="true"
    >
      <path
        d="M14 10 L11 5"
        stroke="#ffffff"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="10.5" cy="4.5" r="2.2" fill="#6ee7b7" />
      <path
        d="M26 10 L29 5"
        stroke="#ffffff"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="29.5" cy="4.5" r="2.2" fill="#6ee7b7" />
      <path
        d="M8 24 C8 14 13 10 20 10 C27 10 32 14 32 24 C32 31 27 34 20 34 C13 34 8 31 8 24 Z"
        fill="#ffffff"
      />
      <circle cx="15.5" cy="21" r="2.6" fill="#0f172a" />
      <circle cx="24.5" cy="21" r="2.6" fill="#0f172a" />
      <circle cx="16.3" cy="20" r="0.9" fill="#ffffff" />
      <circle cx="25.3" cy="20" r="0.9" fill="#ffffff" />
      <path
        d="M16.5 26.5 Q20 29.8 23.5 26.5"
        fill="none"
        stroke="#0f172a"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
});

/**
 * Clean Zero-Blur startup splash shown inside the floating stage until
 * initial persistence hydration + first herdr-core snapshot finishes computing.
 * Unmounts immediately once startup routing completes (0 runtime overhead).
 */
export const StartupSplash = React.memo(function StartupSplash() {
  return (
    <div className="flex-1 h-full min-h-0 flex items-center justify-center p-8 select-none">
      <div className="flex flex-col items-center gap-5">
        <div className="relative w-24 h-24 flex items-center justify-center">
          <svg
            width="96"
            height="96"
            viewBox="0 0 96 96"
            className="absolute inset-0"
            aria-hidden="true"
          >
            <circle
              cx="48"
              cy="48"
              r="42"
              fill="none"
              stroke="var(--divider)"
              strokeWidth="2"
            />
            <circle
              cx="48"
              cy="48"
              r="32"
              fill="none"
              stroke="var(--accent-border)"
              strokeWidth="1.5"
              strokeDasharray="5 5"
            />
            <g className="zen-orbit-spin">
              <circle cx="48" cy="6" r="4.5" fill="var(--accent)" />
              <circle cx="90" cy="48" r="3" fill="var(--ready-fg)" />
            </g>
          </svg>

          <div
            className="w-12 h-12 rounded-[15px] flex items-center justify-center shadow-sm"
            style={{
              background: "var(--brand-bg)",
            }}
          >
            <BrandMascotIcon size={34} />
          </div>
        </div>

        <div className="text-center space-y-1">
          <div
            className="text-sm font-extrabold tracking-tight"
            style={{ color: "var(--text-primary)" }}
          >
            jjdr · Zen Mission Control
          </div>
          <div
            className="text-xs font-mono-code"
            style={{ color: "var(--text-muted)" }}
          >
            Syncing workers &amp; workspace...
          </div>
        </div>
      </div>
    </div>
  );
});
