import React, { useState } from "react";
import {
  Code2,
  ExternalLink,
  Eye,
  GitPullRequest,
  Sparkles,
  Tag,
  Wrench,
} from "lucide-react";
import type { MissionKind } from "../../types/domain";
import {
  MISSION_KIND_META,
  MISSION_KINDS,
  type EffectiveMission,
} from "../../utils/missionDetector";
import { openExternalUrl } from "../../services/tauriBridge";

function MissionKindIcon({
  kind,
  className,
}: {
  kind: MissionKind;
  className: string;
}) {
  switch (kind) {
    case "review":
      return <Eye className={className} />;
    case "fix":
      return <Wrench className={className} />;
    case "refactor":
      return <Sparkles className={className} />;
    case "dev":
    default:
      return <Code2 className={className} />;
  }
}

interface MissionBadgesProps {
  mission: EffectiveMission;
  size?: "xs" | "sm";
}

/**
 * Ultra-slim mission chips ([Review] [PR #114]) rendered only when mission info exists.
 * If a GitHub/GitLab PR URL was detected or provided, clicking the PR chip opens it in the browser.
 */
export const MissionBadges = React.memo(function MissionBadges({
  mission,
  size = "xs",
}: MissionBadgesProps) {
  if (!mission.hasAny) return null;

  const isSm = size === "sm";
  const padClass = isSm ? "px-2 py-0.5 text-[10px]" : "px-1.5 py-0.2 text-[9px]";
  const iconClass = isSm ? "w-2.5 h-2.5" : "w-2.5 h-2.5";

  return (
    <span className="inline-flex items-center gap-1 shrink-0 flex-wrap">
      {mission.kind && (
        <span
          className={`inline-flex items-center gap-0.5 rounded-full font-mono-code font-bold uppercase tracking-wide ${padClass}`}
          style={{
            background: MISSION_KIND_META[mission.kind].bg,
            color: MISSION_KIND_META[mission.kind].fg,
            border: `1px solid ${MISSION_KIND_META[mission.kind].border}`,
          }}
          title={`${MISSION_KIND_META[mission.kind].label} · ${mission.sourceLabel}`}
        >
          <MissionKindIcon kind={mission.kind} className={iconClass} />
          <span>{MISSION_KIND_META[mission.kind].shortLabel}</span>
        </span>
      )}

      {mission.prNumber !== null &&
        (mission.prUrl ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void openExternalUrl(mission.prUrl!);
            }}
            onKeyDown={(e) => e.stopPropagation()}
            title={`Open PR #${mission.prNumber} in browser (${mission.prUrl})`}
            className={`inline-flex items-center gap-0.5 rounded-full font-mono-code font-bold cursor-pointer hover:underline ${padClass}`}
            style={{
              background: "var(--pill-bg)",
              color: "var(--accent)",
              border: "1px solid var(--accent-border)",
            }}
          >
            <GitPullRequest className={iconClass} />
            <span>PR #{mission.prNumber}</span>
            <ExternalLink className="w-2 h-2 opacity-80" />
          </button>
        ) : (
          <span
            className={`inline-flex items-center gap-0.5 rounded-full font-mono-code font-bold ${padClass}`}
            style={{
              background: "var(--pill-bg)",
              color: "var(--text-primary)",
              border: "1px solid var(--pill-border)",
            }}
            title={`PR #${mission.prNumber} · ${mission.sourceLabel}`}
          >
            <GitPullRequest className={iconClass} />
            <span>PR #{mission.prNumber}</span>
          </span>
        ))}
    </span>
  );
});

interface MissionTagPickerProps {
  kind: MissionKind | null;
  prNumberText: string;
  onKindChange: (next: MissionKind | null) => void;
  onPrNumberChange: (next: string) => void;
  autoHint?: string | null;
}

/**
 * Compact single-row optional tag picker used inside Hire (collapsible) & Edit modals.
 */
export const MissionTagPicker = React.memo(function MissionTagPicker({
  kind,
  prNumberText,
  onKindChange,
  onPrNumberChange,
  autoHint,
}: MissionTagPickerProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={() => onKindChange(null)}
          className="px-2.5 py-1 rounded-full text-[11px] font-semibold cursor-pointer"
          style={
            kind === null
              ? {
                  background: "var(--accent-soft)",
                  border: "1px solid var(--accent)",
                  color: "var(--text-primary)",
                }
              : {
                  background: "var(--input-bg)",
                  border: "1px solid var(--input-border)",
                  color: "var(--text-muted)",
                }
          }
          title="Automatically detect from your prompt, AI output, or branch"
        >
          Auto
        </button>

        {MISSION_KINDS.map((k) => {
          const meta = MISSION_KIND_META[k];
          const active = kind === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => onKindChange(active ? null : k)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold cursor-pointer"
              style={
                active
                  ? {
                      background: meta.bg,
                      border: `1px solid ${meta.border}`,
                      color: meta.fg,
                    }
                  : {
                      background: "var(--input-bg)",
                      border: "1px solid var(--input-border)",
                      color: "var(--text-secondary)",
                    }
              }
            >
              <MissionKindIcon kind={k} className="w-3 h-3" />
              <span>{meta.label}</span>
            </button>
          );
        })}

        <div className="relative flex items-center ml-auto">
          <span
            className="pointer-events-none absolute left-2.5 text-[10px] font-mono-code font-bold"
            style={{ color: "var(--text-faint)" }}
          >
            PR #
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={prNumberText}
            onChange={(e) =>
              onPrNumberChange(e.target.value.replace(/[^\d]/g, "").slice(0, 7))
            }
            placeholder="auto"
            className="jjdr-input w-[96px] pl-10 pr-2.5 py-1 rounded-full text-[11px] font-mono-code"
            aria-label="PR number"
          />
        </div>
      </div>

      {autoHint && (
        <div
          className="text-[10px] font-mono-code px-1"
          style={{ color: "var(--text-faint)" }}
        >
          {autoHint}
        </div>
      )}
    </div>
  );
});

interface MissionOptionalTagBarProps {
  kind: MissionKind | null;
  prNumberText: string;
  onKindChange: (next: MissionKind | null) => void;
  onPrNumberChange: (next: string) => void;
}

/**
 * Collapsible 1-line optional tag pill for Hire modal so the default form stays clutter-free.
 */
export const MissionOptionalTagBar = React.memo(function MissionOptionalTagBar({
  kind,
  prNumberText,
  onKindChange,
  onPrNumberChange,
}: MissionOptionalTagBarProps) {
  const [open, setOpen] = useState(false);
  const hasValue = Boolean(kind || prNumberText);
  const active = open || hasValue;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold cursor-pointer"
          style={{
            background: active ? "var(--accent-soft)" : "var(--input-bg)",
            border: `1px solid ${
              active ? "var(--accent-border)" : "var(--input-border)"
            }`,
            color: active ? "var(--accent)" : "var(--text-muted)",
          }}
        >
          <Tag className="w-3 h-3" />
          <span>
            {hasValue
              ? [
                  kind ? MISSION_KIND_META[kind].label : null,
                  prNumberText ? `PR #${prNumberText}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "+ Tag (optional · auto-detected)"}
          </span>
        </button>
        {!active && (
          <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
            Auto-detects Dev / Review / Fix &amp; PR#
          </span>
        )}
      </div>

      {open && (
        <div
          className="p-2.5 rounded-2xl"
          style={{
            background: "var(--input-bg)",
            border: "1px solid var(--divider)",
          }}
        >
          <MissionTagPicker
            kind={kind}
            prNumberText={prNumberText}
            onKindChange={onKindChange}
            onPrNumberChange={onPrNumberChange}
          />
        </div>
      )}
    </div>
  );
});
