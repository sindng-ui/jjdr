import React, { useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  GitMerge,
  Sparkles,
  Trophy,
  X,
} from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import { getWorkerPersona } from "../../utils/workerPersona";
import {
  buildDailyRecapMarkdown,
  enrichRecapEntries,
  getRecapDateKey,
  getYesterdayDateKey,
  pickDailyMvp,
  readAllDailyRecaps,
  type RecapMarkdownFormat,
} from "../../utils/zenRecap";
import { WorkerMonsterAvatar } from "./WorkerMonsterAvatar";

interface ZenRecapModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Daily Work Recap & Standup Markdown Copy Modal.
 * Zero-Blur, mounted only when open (0 idle DOM/CPU overhead).
 */
export const ZenRecapModal = React.memo(function ZenRecapModal({
  open,
  onClose,
}: ZenRecapModalProps) {
  const matrixLanes = useAppStore((s) => s.computed.matrixLanes);
  const worktreeMeta = useAppStore((s) => s.worktreeMeta);
  const showToast = useUiStore((s) => s.showToast);

  const todayKey = getRecapDateKey();
  const yesterdayKey = getYesterdayDateKey();

  const [selectedDate, setSelectedDate] = useState<string>(todayKey);
  const [format, setFormat] = useState<RecapMarkdownFormat>("standup");
  const [copied, setCopied] = useState(false);

  // Refresh selectedDate to today whenever opened
  useEffect(() => {
    if (open) {
      setSelectedDate(getRecapDateKey());
      setCopied(false);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  const allLogs = useMemo(
    () => (open ? readAllDailyRecaps() : {}),
    [open]
  );

  const dateTabs = useMemo(() => {
    const keys = new Set<string>([todayKey]);
    if (allLogs[yesterdayKey]) keys.add(yesterdayKey);
    for (const k of Object.keys(allLogs).sort().reverse()) {
      keys.add(k);
      if (keys.size >= 5) break;
    }
    return Array.from(keys).sort().reverse();
  }, [allLogs, todayKey, yesterdayKey]);

  const activeLog = allLogs[selectedDate] ?? null;
  const isToday = selectedDate === todayKey;

  const entries = useMemo(
    () => enrichRecapEntries(activeLog, matrixLanes, worktreeMeta, isToday),
    [activeLog, matrixLanes, worktreeMeta, isToday]
  );

  const mvp = useMemo(() => pickDailyMvp(entries), [entries]);
  const mvpPersona = useMemo(
    () => (mvp ? getWorkerPersona(mvp.normWtPath) : null),
    [mvp]
  );

  const groupedByProject = useMemo(() => {
    const map = new Map<
      string,
      { name: string; color: string; items: typeof entries }
    >();
    for (const item of entries) {
      const existing = map.get(item.projectName);
      if (existing) {
        existing.items.push(item);
      } else {
        map.set(item.projectName, {
          name: item.projectName,
          color: item.projectColor,
          items: [item],
        });
      }
    }
    return Array.from(map.values());
  }, [entries]);

  const totalCleared = activeLog?.totalCleared ?? 0;
  const totalDispatched = activeLog?.totalDispatched ?? 0;

  if (!open) return null;

  const handleCopyMarkdown = async () => {
    const md = buildDailyRecapMarkdown(
      selectedDate,
      entries,
      { cleared: totalCleared, dispatched: totalDispatched },
      format
    );
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      showToast(
        `Copied ${format === "standup" ? "Standup" : "Compact"} Markdown for ${selectedDate}`,
        "success"
      );
      setTimeout(() => setCopied(false), 1800);
    } catch (err) {
      showToast(`Clipboard copy failed: ${String(err)}`, "error");
    }
  };

  const formatDateTabLabel = (dk: string) => {
    if (dk === todayKey) return "Today";
    if (dk === yesterdayKey) return "Yesterday";
    return dk.slice(5);
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "var(--modal-overlay)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="jjdr-modal zen-anim-rise w-full max-w-2xl max-h-[84vh] rounded-[24px] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div
          className="px-6 py-4 flex items-center justify-between gap-3 shrink-0"
          style={{ borderBottom: "1px solid var(--divider)" }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
              style={{
                background: "var(--warn-soft)",
                color: "var(--warn-fg)",
              }}
            >
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3
                className="text-sm font-black tracking-tight truncate"
                style={{ color: "var(--text-primary)" }}
              >
                Daily Work Recap
              </h3>
              <p
                className="text-[11px] font-mono-code"
                style={{ color: "var(--text-muted)" }}
              >
                {selectedDate} · Standup &amp; Activity Summary
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="jjdr-pill inline-flex items-center rounded-full p-0.5 text-[11px]">
              {dateTabs.map((dk) => (
                <button
                  key={dk}
                  type="button"
                  onClick={() => setSelectedDate(dk)}
                  className={`px-2.5 py-0.5 rounded-full cursor-pointer transition-colors ${
                    selectedDate === dk ? "jjdr-pill-active font-semibold" : ""
                  }`}
                  style={
                    selectedDate === dk
                      ? undefined
                      : { color: "var(--text-muted)" }
                  }
                >
                  {formatDateTabLabel(dk)}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={onClose}
              title="Close (Esc)"
              className="p-1.5 rounded-full hover:bg-black/10 cursor-pointer"
              style={{ color: "var(--text-muted)" }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5">
          {/* Metric Strip + Today's MVP */}
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
            <div
              className="rounded-2xl px-3.5 py-2.5"
              style={{
                background: "var(--input-bg)",
                border: "1px solid var(--divider)",
              }}
            >
              <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                Cleared
              </div>
              <div
                className="text-lg font-black font-mono-code tabular-nums"
                style={{ color: "var(--ready-fg)" }}
              >
                {totalCleared}
              </div>
            </div>

            <div
              className="rounded-2xl px-3.5 py-2.5"
              style={{
                background: "var(--input-bg)",
                border: "1px solid var(--divider)",
              }}
            >
              <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                Dispatched
              </div>
              <div
                className="text-lg font-black font-mono-code tabular-nums"
                style={{ color: "var(--accent)" }}
              >
                {totalDispatched}
              </div>
            </div>

            <div
              className="rounded-2xl px-3.5 py-2.5"
              style={{
                background: "var(--input-bg)",
                border: "1px solid var(--divider)",
              }}
            >
              <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                Workers
              </div>
              <div
                className="text-lg font-black font-mono-code tabular-nums"
                style={{ color: "var(--text-primary)" }}
              >
                {entries.length}
              </div>
            </div>

            {mvp && mvpPersona && (
              <div
                className="col-span-3 sm:col-span-1 rounded-2xl px-3 py-2 flex items-center gap-2 min-w-0"
                style={{
                  background: "var(--warn-soft)",
                  border: "1px solid var(--warn-border)",
                }}
                title={`MVP: ${mvpPersona.name} (${mvp.branch})`}
              >
                <WorkerMonsterAvatar
                  persona={mvpPersona}
                  mood="ready"
                  size={34}
                  className="shrink-0"
                />
                <div className="min-w-0">
                  <div
                    className="inline-flex items-center gap-1 text-[10px] font-bold"
                    style={{ color: "var(--warn-fg)" }}
                  >
                    <Trophy className="w-2.5 h-2.5" />
                    MVP
                  </div>
                  <div
                    className="text-xs font-black truncate"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {mvpPersona.name}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Project-Grouped Worker Activity List */}
          {groupedByProject.length === 0 ? (
            <div
              className="rounded-2xl p-8 text-center space-y-1.5"
              style={{
                background: "var(--input-bg)",
                border: "1px dashed var(--divider)",
              }}
            >
              <div
                className="text-sm font-bold"
                style={{ color: "var(--text-primary)" }}
              >
                No activity logged for {formatDateTabLabel(selectedDate)}
              </div>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Clear review cards or dispatch workers in Zen mode and your standup summary will build itself automatically.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {groupedByProject.map((group) => (
                <div key={group.name} className="space-y-2">
                  <div className="flex items-center gap-2 px-1">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: group.color }}
                    />
                    <span
                      className="text-xs font-extrabold tracking-tight"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {group.name}
                    </span>
                    <span
                      className="text-[10px] font-mono-code"
                      style={{ color: "var(--text-faint)" }}
                    >
                      {group.items.length}{" "}
                      {group.items.length === 1 ? "worker" : "workers"}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {group.items.map((item) => {
                      const persona = getWorkerPersona(item.normWtPath);
                      const hasDiff =
                        item.addedLines > 0 || item.deletedLines > 0;
                      const detail = item.note || item.lastSummary;
                      return (
                        <div
                          key={item.cardKey}
                          className="rounded-2xl px-3.5 py-3 flex items-start gap-3"
                          style={{
                            background: "var(--input-bg)",
                            border: "1px solid var(--divider)",
                          }}
                        >
                          <WorkerMonsterAvatar
                            persona={persona}
                            mood="ready"
                            size={38}
                            className="shrink-0 mt-0.5"
                          />
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                                <span
                                  className="text-xs font-black"
                                  style={{ color: persona.palette.body }}
                                >
                                  {persona.name}
                                </span>
                                <span
                                  className="text-xs font-mono-code font-bold truncate"
                                  style={{ color: "var(--text-primary)" }}
                                >
                                  {item.displayName || item.branch}
                                </span>
                                {item.displayName && (
                                  <span
                                    className="text-[10px] font-mono-code px-1.5 py-0.2 rounded-full"
                                    style={{
                                      background: "var(--pill-bg)",
                                      color: "var(--text-muted)",
                                    }}
                                  >
                                    {item.branch}
                                  </span>
                                )}
                                {item.isMerged && (
                                  <span
                                    className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.2 rounded-full"
                                    style={{
                                      background: "var(--accent-soft)",
                                      color: "var(--accent)",
                                    }}
                                  >
                                    <GitMerge className="w-2.5 h-2.5" />
                                    MERGED
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-2 text-[11px] font-mono-code shrink-0">
                                {hasDiff && (
                                  <span>
                                    <span style={{ color: "var(--ready-fg)" }}>
                                      +{item.addedLines}
                                    </span>
                                    /
                                    <span style={{ color: "var(--action-fg)" }}>
                                      -{item.deletedLines}
                                    </span>
                                  </span>
                                )}
                                {item.clearedCount > 0 && (
                                  <span
                                    className="px-2 py-0.2 rounded-full font-semibold"
                                    style={{
                                      background: "var(--ready-soft)",
                                      color: "var(--ready-fg)",
                                    }}
                                  >
                                    {item.clearedCount} cleared
                                  </span>
                                )}
                                {item.dispatchedCount > 0 && (
                                  <span
                                    className="px-2 py-0.2 rounded-full"
                                    style={{
                                      background: "var(--pill-bg)",
                                      color: "var(--text-secondary)",
                                    }}
                                  >
                                    {item.dispatchedCount} sent
                                  </span>
                                )}
                              </div>
                            </div>

                            {detail && (
                              <p
                                className="text-[11px] font-mono-code truncate"
                                style={{ color: "var(--text-muted)" }}
                                title={detail}
                              >
                                {detail}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer: Format Switch + Copy Markdown */}
        <div
          className="px-6 py-3.5 flex items-center justify-between gap-3 flex-wrap shrink-0"
          style={{
            background: "var(--modal-footer)",
            borderTop: "1px solid var(--divider)",
          }}
        >
          <div className="flex items-center gap-2">
            <span
              className="text-[11px] font-semibold"
              style={{ color: "var(--text-muted)" }}
            >
              Format
            </span>
            <div className="jjdr-pill inline-flex items-center rounded-full p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setFormat("standup")}
                className={`px-2.5 py-0.5 rounded-full cursor-pointer transition-colors ${
                  format === "standup" ? "jjdr-pill-active font-semibold" : ""
                }`}
                style={
                  format === "standup"
                    ? undefined
                    : { color: "var(--text-muted)" }
                }
              >
                Standup
              </button>
              <button
                type="button"
                onClick={() => setFormat("compact")}
                className={`px-2.5 py-0.5 rounded-full cursor-pointer transition-colors ${
                  format === "compact" ? "jjdr-pill-active font-semibold" : ""
                }`}
                style={
                  format === "compact"
                    ? undefined
                    : { color: "var(--text-muted)" }
                }
              >
                Compact
              </button>
            </div>
          </div>

          <button
            type="button"
            disabled={entries.length === 0}
            onClick={() => void handleCopyMarkdown()}
            className="jjdr-primary-btn inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold cursor-pointer disabled:opacity-40"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>Copied Markdown!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Markdown</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
});
