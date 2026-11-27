import React from "react";
import { Loader2, Sparkles } from "lucide-react";
import type { SymbolIndexStatus } from "../../../types/domain";

interface SymbolIndexBadgeProps {
  enabled: boolean;
  status: SymbolIndexStatus | null;
}

function formatCompactCount(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  }
  return String(n);
}

export const SymbolIndexBadge = React.memo(function SymbolIndexBadge({
  enabled,
  status,
}: SymbolIndexBadgeProps) {
  if (!enabled || !status || status.state === "disabled" || status.state === "idle") {
    return null;
  }

  if (status.state === "loading_cache" || status.state === "indexing") {
    const label =
      status.total_files > 0
        ? `심볼 ${formatCompactCount(status.indexed_files)}/${formatCompactCount(
            status.total_files
          )}`
        : "심볼 준비 중...";
    return (
      <span
        className="inline-flex items-center gap-1 text-[10.5px] font-mono-code px-2 py-0.5 rounded-full shrink-0"
        style={{
          background: "var(--warn-soft)",
          border: "1px solid var(--warn-border)",
          color: "var(--warn-fg)",
        }}
        title={`백그라운드 심볼 인덱싱 중 (${status.indexed_files.toLocaleString()} / ${status.total_files.toLocaleString()} 파일)`}
      >
        <Loader2 className="w-2.5 h-2.5 animate-spin shrink-0" />
        <span>{label}</span>
      </span>
    );
  }

  if (status.state === "ready") {
    const ramMb = (status.estimated_ram_bytes / (1024 * 1024)).toFixed(1);
    return (
      <span
        className="inline-flex items-center gap-1 text-[10.5px] font-mono-code px-2 py-0.5 rounded-full shrink-0"
        style={{
          background: "var(--ready-soft)",
          border: "1px solid var(--ready-border)",
          color: "var(--ready-fg)",
        }}
        title={`심볼 점프 준비됨 · ${status.symbol_count.toLocaleString()}개 심볼 · 약 ${ramMb} MB RAM${
          status.from_cache ? " (디스크 캐시)" : ""
        }`}
      >
        <Sparkles className="w-2.5 h-2.5 shrink-0" />
        <span>심볼 {formatCompactCount(status.symbol_count)}</span>
      </span>
    );
  }

  return null;
});
