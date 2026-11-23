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
      ? status.kind || "Action"
      : status?.state === "error"
      ? "Error"
      : "Failed";
    if (compact) {
      return (
        <span
          title={detail}
          className="w-2 h-2 rounded-full bg-[#ef4444] shrink-0"
        />
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#ef4444]/12 text-[#f87171]">
        <span className="w-1.5 h-1.5 rounded-full bg-[#ef4444]" />
        {detail}
      </span>
    );
  }

  if (bucket === "ready") {
    if (compact) {
      return (
        <span
          title="Ready"
          className="w-2 h-2 rounded-full bg-[#10b981] shrink-0"
        />
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#10b981]/12 text-[#34d399]">
        <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
        Ready
      </span>
    );
  }

  if (bucket === "running") {
    const pct =
      typeof status?.progress === "number" ? ` ${status.progress}%` : "";
    if (compact) {
      return (
        <span
          title={`Working${pct}`}
          className="w-2 h-2 rounded-full bg-[#f59e0b] shrink-0"
        />
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#f59e0b]/12 text-[#fbbf24]">
        <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b]" />
        Working{pct}
      </span>
    );
  }

  if (compact) {
    return (
      <span
        title="Idle"
        className="w-1.5 h-1.5 rounded-full bg-[#52525b] shrink-0"
      />
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium text-[#71717a]">
      <span className="w-1.5 h-1.5 rounded-full bg-[#52525b]" />
      Idle
    </span>
  );
});
