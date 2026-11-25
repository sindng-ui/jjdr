import React from "react";
import type { AttentionBucket, StatusInfo } from "../../types/domain";

interface StatusBadgeProps {
  bucket: AttentionBucket;
  status?: StatusInfo | null;
  isStuck?: boolean;
  stuckMinutes?: number;
  compact?: boolean;
}

export const StatusBadge = React.memo(function StatusBadge({
  bucket,
  status,
  isStuck,
  stuckMinutes,
  compact = false,
}: StatusBadgeProps) {
  if (bucket === "needs_you") {
    const detail = isStuck
      ? `Stuck ${stuckMinutes}m`
      : status?.state === "blocked"
      ? status.kind === "permission"
        ? "Approval"
        : status.kind === "question"
        ? "Question"
        : status.kind === "auth"
        ? "Auth"
        : status.kind || "Needs You"
      : status?.state === "error"
      ? "Error"
      : "Attention";

    const rawDiag = [
      status?.state ? `state=${status.state}` : null,
      status?.kind ? `kind=${status.kind}` : null,
      status?.msg ? `msg=${status.msg}` : null,
      isStuck ? `stuck=${stuckMinutes}m` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const tooltip = rawDiag ? `${detail} (${rawDiag})` : detail;

    if (compact) {
      return (
        <span
          title={tooltip}
          className="w-2 h-2 rounded-full jjdr-dot-pulse shrink-0"
          style={{ background: "var(--action-fg)" }}
        />
      );
    }
    return (
      <span
        title={tooltip}
        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold shrink-0"
        style={{
          background: "var(--action-soft)",
          color: "var(--action-fg)",
        }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full jjdr-dot-pulse"
          style={{ background: "var(--action-fg)" }}
        />
        {detail}
      </span>
    );
  }

  if (bucket === "ready") {
    if (compact) {
      return (
        <span
          title="Ready"
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: "var(--ready-fg)" }}
        />
      );
    }
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold shrink-0"
        style={{
          background: "var(--ready-soft)",
          color: "var(--ready-fg)",
        }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: "var(--ready-fg)" }}
        />
        Ready
      </span>
    );
  }

  if (bucket === "running") {
    const pct =
      typeof status?.progress === "number" ? ` ${status.progress}%` : "";
    const label = isStuck
      ? `Running ${stuckMinutes ?? 0}m`
      : `Running${pct}`;
    const tooltip = isStuck
      ? `장시간 진행 중 (${stuckMinutes ?? 0}분 경과)`
      : `Running${pct}`;
    const fg = isStuck ? "var(--warn-fg)" : "var(--run-fg)";
    const soft = isStuck ? "var(--warn-soft)" : "var(--run-soft)";

    if (compact) {
      return (
        <span
          title={tooltip}
          className="w-2 h-2 rounded-full jjdr-dot-pulse shrink-0"
          style={{ background: fg }}
        />
      );
    }
    return (
      <span
        title={tooltip}
        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold shrink-0"
        style={{
          background: soft,
          color: fg,
        }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full jjdr-dot-pulse"
          style={{ background: fg }}
        />
        {label}
      </span>
    );
  }

  if (compact) {
    return (
      <span
        title="Standby"
        className="w-2 h-2 rounded-full shrink-0 opacity-60"
        style={{ background: "var(--text-faint)" }}
      />
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium shrink-0"
      style={{
        background: "var(--pill-bg)",
        color: "var(--text-muted)",
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full opacity-70"
        style={{ background: "var(--text-faint)" }}
      />
      Standby
    </span>
  );
});
