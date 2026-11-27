import React, { useCallback, useEffect, useState } from "react";
import { Code2, RefreshCw, Trash2 } from "lucide-react";
import {
  clearSymbolIndexCache,
  getSymbolCacheStats,
} from "../../../services/tauriBridge";
import type { SymbolCacheStats } from "../../../types/domain";

interface SymbolIndexSettingsSectionProps {
  enabled: boolean;
  onToggle: () => void;
  onCleared?: () => void;
}

function formatMb(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const SymbolIndexSettingsSection = React.memo(
  function SymbolIndexSettingsSection({
    enabled,
    onToggle,
    onCleared,
  }: SymbolIndexSettingsSectionProps) {
    const [stats, setStats] = useState<SymbolCacheStats | null>(null);
    const [busy, setBusy] = useState(false);

    const refreshStats = useCallback(() => {
      void getSymbolCacheStats()
        .then((s) => {
          if (s) setStats(s);
        })
        .catch(() => {});
    }, []);

    useEffect(() => {
      refreshStats();
    }, [refreshStats, enabled]);

    const handleClearDisk = async () => {
      setBusy(true);
      try {
        const next = await clearSymbolIndexCache(true);
        if (next) setStats(next);
        onCleared?.();
      } finally {
        setBusy(false);
      }
    };

    return (
      <div
        className="pt-4 space-y-2.5"
        style={{ borderTop: "1px solid var(--divider)" }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Code2 className="w-3.5 h-3.5" style={{ color: "var(--accent)" }} />
            <span
              className="font-bold text-xs"
              style={{ color: "var(--text-primary)" }}
            >
              코드뷰어 심볼 점프 인덱싱 (Beta · 기본 OFF)
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={onToggle}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold cursor-pointer transition-colors"
            style={{
              background: enabled ? "var(--accent)" : "var(--pill-bg)",
              color: enabled ? "#ffffff" : "var(--text-muted)",
              border: "1px solid var(--pill-border)",
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: enabled ? "#ffffff" : "var(--text-faint)",
              }}
            />
            {enabled ? "ON" : "OFF"}
          </button>
        </div>

        <p
          className="text-[11px] leading-snug"
          style={{ color: "var(--text-muted)" }}
        >
          ON일 때만 <span className="font-mono-code">Ctrl+P</span>를 열면 현재 활성
          프로젝트 1개에 대해 백그라운드에서 C#·C++·TS/JS·Rust 심볼을 천천히 수집합니다.
          코드뷰어에서 <span className="font-mono-code">Ctrl+Click</span> 또는{" "}
          <span className="font-mono-code">F12</span>로 정의 점프가 가능하며, RAM은 최대
          2개 프로젝트만 LRU 상주합니다. (OFF 시 워커·RAM 0, 단{" "}
          <span className="font-mono-code">Ctrl+Shift+O</span> 아웃라인 및{" "}
          <span className="font-mono-code">Ctrl+Shift+F</span> 전체 찾기는 항상 동작)
        </p>

        {stats && (
          <div
            className="rounded-xl px-3 py-2 flex items-center justify-between gap-2 text-[11px]"
            style={{
              background: "var(--input-bg)",
              border: "1px solid var(--input-border)",
              color: "var(--text-secondary)",
            }}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono-code">
              <span>
                RAM: <strong>{formatMb(stats.ram_estimated_bytes)}</strong> (
                {stats.ram_projects}proj / {stats.ram_symbols.toLocaleString()}sym)
              </span>
              <span>
                디스크 캐시: <strong>{formatMb(stats.disk_cache_bytes)}</strong> (
                {stats.disk_cache_files}개)
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={refreshStats}
                title="상태 새로고침"
                className="jjdr-pill p-1 rounded-full cursor-pointer"
                style={{ color: "var(--text-muted)" }}
              >
                <RefreshCw className="w-3 h-3" />
              </button>
              <button
                type="button"
                disabled={
                  busy ||
                  (stats.ram_projects === 0 && stats.disk_cache_files === 0)
                }
                onClick={() => void handleClearDisk()}
                className="jjdr-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ color: "var(--action-fg)" }}
              >
                <Trash2 className="w-3 h-3" />
                <span>캐시 비우기</span>
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }
);
