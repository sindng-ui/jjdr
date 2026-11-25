import React from "react";
import type { WorkerPersona } from "../../utils/workerPersona";

export type MonsterMood = "ready" | "working" | "sleeping" | "alert" | "mystery";

interface WorkerMonsterAvatarProps {
  persona: WorkerPersona;
  mood?: MonsterMood;
  size?: number;
  className?: string;
}

/**
 * Pure Zero-Blur SVG Monster Avatar with deterministic traits per worktree.
 * Gives each AI worker a memorable face so users recognize them in <0.5s.
 */
export const WorkerMonsterAvatar = React.memo(function WorkerMonsterAvatar({
  persona,
  mood = "ready",
  size = 68,
  className = "",
}: WorkerMonsterAvatarProps) {
  const { bodyType, eyeType, mouthType, palette } = persona;
  const isSleeping = mood === "sleeping";
  const isMystery = mood === "mystery";
  const bodyColor = isMystery ? "var(--accent)" : palette.body;
  const shadeColor = isMystery ? "var(--accent-border)" : palette.shade;
  const bellyColor = isMystery ? "var(--accent-soft)" : palette.belly;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      aria-hidden="true"
      className={className}
    >
      {/* Subtle circular backing halo (Zero-Blur) */}
      <circle
        cx="40"
        cy="42"
        r="34"
        fill={isSleeping ? "var(--input-bg)" : "var(--modal-bg)"}
        stroke={isSleeping ? "var(--divider)" : bodyColor}
        strokeWidth="2"
        strokeOpacity={isSleeping ? 0.8 : 0.45}
      />

      {/* Ears / Horns / Antennas by bodyType */}
      {bodyType === "horned" && (
        <>
          <path d="M22 28 L15 11 L30 22 Z" fill={palette.accent} stroke={shadeColor} strokeWidth="2" strokeLinejoin="round" />
          <path d="M58 28 L65 11 L50 22 Z" fill={palette.accent} stroke={shadeColor} strokeWidth="2" strokeLinejoin="round" />
        </>
      )}
      {bodyType === "catbot" && (
        <>
          <path d="M20 30 L18 12 L34 22 Z" fill={bodyColor} stroke={shadeColor} strokeWidth="2" strokeLinejoin="round" />
          <path d="M60 30 L62 12 L46 22 Z" fill={bodyColor} stroke={shadeColor} strokeWidth="2" strokeLinejoin="round" />
          <path d="M22 27 L21 17 L30 23 Z" fill={palette.cheek} opacity="0.7" />
          <path d="M58 27 L59 17 L50 23 Z" fill={palette.cheek} opacity="0.7" />
        </>
      )}
      {bodyType === "alien" && (
        <>
          <path d="M31 23 L26 11" stroke={shadeColor} strokeWidth="3" strokeLinecap="round" />
          <circle cx="25" cy="10" r="4" fill={palette.accent} stroke={shadeColor} strokeWidth="1.5" />
          <path d="M49 23 L54 11" stroke={shadeColor} strokeWidth="3" strokeLinecap="round" />
          <circle cx="55" cy="10" r="4" fill={palette.accent} stroke={shadeColor} strokeWidth="1.5" />
        </>
      )}
      {bodyType === "golem" && (
        <>
          <rect x="28" y="13" width="24" height="8" rx="3" fill={palette.accent} stroke={shadeColor} strokeWidth="1.8" />
        </>
      )}

      {/* Main Body Silhouette */}
      {bodyType === "golem" ? (
        <rect
          x="18"
          y="20"
          width="44"
          height="46"
          rx="12"
          fill={bodyColor}
          stroke={shadeColor}
          strokeWidth="2.5"
        />
      ) : bodyType === "ghost" ? (
        <path
          d="M18 44 C18 24 28 16 40 16 C52 16 62 24 62 44 L62 64 L54 58 L47 64 L40 58 L33 64 L26 58 L18 64 Z"
          fill={bodyColor}
          stroke={shadeColor}
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M17 47 C17 26 26 18 40 18 C54 18 63 26 63 47 C63 60 55 66 40 66 C25 66 17 60 17 47 Z"
          fill={bodyColor}
          stroke={shadeColor}
          strokeWidth="2.5"
        />
      )}

      {/* Belly Patch */}
      <ellipse cx="40" cy="54" rx="14" ry="8" fill={bellyColor} opacity="0.6" />

      {/* Cheeks */}
      {!isMystery && (
        <>
          <ellipse cx="24" cy="45" rx="4" ry="2.4" fill={palette.cheek} opacity={isSleeping ? 0.35 : 0.65} />
          <ellipse cx="56" cy="45" rx="4" ry="2.4" fill={palette.cheek} opacity={isSleeping ? 0.35 : 0.65} />
        </>
      )}

      {/* Eyes */}
      {isMystery ? (
        <text
          x="40"
          y="46"
          textAnchor="middle"
          fontSize="22"
          fontWeight="900"
          fill="#ffffff"
          fontFamily="monospace"
        >
          ?
        </text>
      ) : isSleeping ? (
        <>
          <path d="M26 39 Q31 44 36 39" fill="none" stroke="#0f172a" strokeWidth="2.8" strokeLinecap="round" />
          <path d="M44 39 Q49 44 54 39" fill="none" stroke="#0f172a" strokeWidth="2.8" strokeLinecap="round" />
        </>
      ) : eyeType === "cyclops" ? (
        <>
          <circle cx="40" cy="37" r="10" fill="#ffffff" stroke="#0f172a" strokeWidth="2" />
          <circle cx="40" cy="37" r="5" fill="#0f172a" />
          <circle cx="42" cy="35" r="2" fill="#ffffff" />
        </>
      ) : eyeType === "visor" ? (
        <>
          <rect x="23" y="31" width="34" height="12" rx="6" fill="#0f172a" stroke={palette.accent} strokeWidth="2" />
          <circle cx="32" cy="37" r="2.8" fill="#38bdf8" />
          <circle cx="48" cy="37" r="2.8" fill="#38bdf8" />
        </>
      ) : eyeType === "glasses" ? (
        <>
          <circle cx="31" cy="38" r="6.5" fill="#ffffff" stroke="#0f172a" strokeWidth="2.2" />
          <circle cx="49" cy="38" r="6.5" fill="#ffffff" stroke="#0f172a" strokeWidth="2.2" />
          <line x1="37.5" y1="38" x2="42.5" y2="38" stroke="#0f172a" strokeWidth="2.2" />
          <circle cx="32" cy="38" r="2.8" fill="#0f172a" />
          <circle cx="50" cy="38" r="2.8" fill="#0f172a" />
          <circle cx="33" cy="36.8" r="1" fill="#ffffff" />
          <circle cx="51" cy="36.8" r="1" fill="#ffffff" />
        </>
      ) : eyeType === "starry" ? (
        <>
          <circle cx="31" cy="38" r="5.5" fill="#0f172a" />
          <circle cx="49" cy="38" r="5.5" fill="#0f172a" />
          <circle cx="33" cy="36" r="2" fill="#fef08a" />
          <circle cx="51" cy="36" r="2" fill="#fef08a" />
          <circle cx="29.5" cy="40" r="1" fill="#ffffff" />
          <circle cx="47.5" cy="40" r="1" fill="#ffffff" />
        </>
      ) : (
        <>
          <circle cx="31" cy="38" r="5.5" fill="#ffffff" stroke="#0f172a" strokeWidth="1.8" />
          <circle cx="49" cy="38" r="5.5" fill="#ffffff" stroke="#0f172a" strokeWidth="1.8" />
          <circle cx="32" cy="38" r="3" fill="#0f172a" />
          <circle cx="50" cy="38" r="3" fill="#0f172a" />
          <circle cx="33" cy="36.5" r="1.2" fill="#ffffff" />
          <circle cx="51" cy="36.5" r="1.2" fill="#ffffff" />
        </>
      )}

      {/* Mouth */}
      {!isMystery && (
        isSleeping ? (
          <circle cx="40" cy="49" r="2.6" fill="#0f172a" opacity="0.7" />
        ) : mood === "alert" ? (
          <ellipse cx="40" cy="50" rx="4.5" ry="3.5" fill="#0f172a" />
        ) : mouthType === "fang" ? (
          <>
            <path d="M32 48 Q40 55 48 48" fill="none" stroke="#0f172a" strokeWidth="2.4" strokeLinecap="round" />
            <path d="M35 49 L37 53 L39 49.5 Z" fill="#ffffff" />
            <path d="M41 49.5 L43 53 L45 49 Z" fill="#ffffff" />
          </>
        ) : mouthType === "cat" ? (
          <path d="M33 49 Q36.5 53 40 49 Q43.5 53 47 49" fill="none" stroke="#0f172a" strokeWidth="2.3" strokeLinecap="round" />
        ) : mouthType === "ooh" ? (
          <ellipse cx="40" cy="50" rx="3.5" ry="4" fill="#0f172a" />
        ) : (
          <path d="M33 48 Q40 55 47 48" fill="none" stroke="#0f172a" strokeWidth="2.5" strokeLinecap="round" />
        )
      )}

      {/* Mood Overlays */}
      {isSleeping && (
        <g fill="var(--text-muted)" fontFamily="monospace" fontWeight="800">
          <text x="58" y="23" fontSize="11">z</text>
          <text x="64" y="15" fontSize="14">Z</text>
        </g>
      )}
      {mood === "alert" && (
        <g>
          <circle cx="64" cy="18" r="9" fill="#f43f5e" />
          <text x="64" y="22" textAnchor="middle" fontSize="12" fontWeight="900" fill="#ffffff">
            !
          </text>
        </g>
      )}
    </svg>
  );
});
