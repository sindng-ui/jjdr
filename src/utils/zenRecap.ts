import type { MatrixProjectLane, WorktreeCardMeta } from "../types/domain";
import { normalizePath } from "../workers/dashboardLogic";
import { getWorkerPersona } from "./workerPersona";

export type RecapEventKind = "cleared" | "dispatched";
export type RecapMarkdownFormat = "standup" | "compact";

export interface DailyWorkerRecapEntry {
  cardKey: string;
  normWtPath: string;
  projectId: string | null;
  projectName: string;
  projectColor: string;
  branch: string;
  displayName: string;
  note: string;
  clearedCount: number;
  dispatchedCount: number;
  addedLines: number;
  deletedLines: number;
  isMerged: boolean;
  lastSummary: string;
  firstAtMs: number;
  lastAtMs: number;
}

export interface DailyRecapLog {
  dateKey: string;
  totalCleared: number;
  totalDispatched: number;
  entries: Record<string, DailyWorkerRecapEntry>;
}

export interface RecordRecapEventInput {
  kind: RecapEventKind;
  cardKey: string;
  worktreePath: string;
  projectId: string | null;
  projectName: string;
  projectColor: string;
  branch: string;
  displayName?: string;
  note?: string;
  addedLines?: number;
  deletedLines?: number;
  isMerged?: boolean;
  summary?: string;
  now?: Date;
}

const RECAP_STORAGE_KEY = "jjdr.zen_daily_recap.v1";
const MAX_STORED_DAYS = 7;

export function getRecapDateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getYesterdayDateKey(now = new Date()): string {
  const prev = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return getRecapDateKey(prev);
}

function sanitizeSummary(raw?: string): string {
  if (!raw) return "";
  const singleLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .pop();
  if (!singleLine) return "";
  return singleLine.length > 140 ? `${singleLine.slice(0, 137)}...` : singleLine;
}

export function readAllDailyRecaps(): Record<string, DailyRecapLog> {
  try {
    const raw = window.localStorage.getItem(RECAP_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, DailyRecapLog>;
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch {
    // ignore corrupted storage
  }
  return {};
}

function writeAllDailyRecaps(logs: Record<string, DailyRecapLog>): void {
  const sortedDates = Object.keys(logs).sort().reverse().slice(0, MAX_STORED_DAYS);
  const pruned: Record<string, DailyRecapLog> = {};
  for (const dk of sortedDates) {
    pruned[dk] = logs[dk];
  }
  try {
    window.localStorage.setItem(RECAP_STORAGE_KEY, JSON.stringify(pruned));
  } catch {
    // ignore storage quota errors
  }
}

export function recordZenRecapEvent(
  input: RecordRecapEventInput
): DailyRecapLog {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const dateKey = getRecapDateKey(now);
  const all = readAllDailyRecaps();
  const day: DailyRecapLog = all[dateKey] ?? {
    dateKey,
    totalCleared: 0,
    totalDispatched: 0,
    entries: {},
  };

  const normWtPath = normalizePath(input.worktreePath);
  const existing = day.entries[input.cardKey];
  const nextSummary = sanitizeSummary(input.summary);

  const updatedEntry: DailyWorkerRecapEntry = existing
    ? {
        ...existing,
        projectName: input.projectName || existing.projectName,
        projectColor: input.projectColor || existing.projectColor,
        branch: input.branch || existing.branch,
        displayName: input.displayName?.trim() || existing.displayName,
        note: input.note?.trim() || existing.note,
        clearedCount:
          existing.clearedCount + (input.kind === "cleared" ? 1 : 0),
        dispatchedCount:
          existing.dispatchedCount + (input.kind === "dispatched" ? 1 : 0),
        addedLines:
          typeof input.addedLines === "number"
            ? input.addedLines
            : existing.addedLines,
        deletedLines:
          typeof input.deletedLines === "number"
            ? input.deletedLines
            : existing.deletedLines,
        isMerged:
          typeof input.isMerged === "boolean"
            ? input.isMerged
            : existing.isMerged,
        lastSummary: nextSummary || existing.lastSummary,
        lastAtMs: Math.max(existing.lastAtMs, nowMs),
      }
    : {
        cardKey: input.cardKey,
        normWtPath,
        projectId: input.projectId,
        projectName: input.projectName || "External",
        projectColor: input.projectColor || "#6c788a",
        branch: input.branch || "(detached)",
        displayName: input.displayName?.trim() || "",
        note: input.note?.trim() || "",
        clearedCount: input.kind === "cleared" ? 1 : 0,
        dispatchedCount: input.kind === "dispatched" ? 1 : 0,
        addedLines: input.addedLines ?? 0,
        deletedLines: input.deletedLines ?? 0,
        isMerged: Boolean(input.isMerged),
        lastSummary: nextSummary,
        firstAtMs: nowMs,
        lastAtMs: nowMs,
      };

  const nextDay: DailyRecapLog = {
    ...day,
    totalCleared: day.totalCleared + (input.kind === "cleared" ? 1 : 0),
    totalDispatched:
      day.totalDispatched + (input.kind === "dispatched" ? 1 : 0),
    entries: {
      ...day.entries,
      [input.cardKey]: updatedEntry,
    },
  };

  all[dateKey] = nextDay;
  writeAllDailyRecaps(all);
  return nextDay;
}

/**
 * Refreshes logged entries with live Git diff / merged status / custom card metadata
 * when viewing today's recap, without mutating historical days.
 */
export function enrichRecapEntries(
  log: DailyRecapLog | null,
  matrixLanes: MatrixProjectLane[],
  worktreeMeta: Record<string, WorktreeCardMeta>,
  isToday: boolean
): DailyWorkerRecapEntry[] {
  if (!log) return [];
  const rawList = Object.values(log.entries);
  if (rawList.length === 0) return [];

  const liveByKey = new Map<
    string,
    { added: number; deleted: number; merged: boolean; branch: string }
  >();
  if (isToday) {
    for (const lane of matrixLanes) {
      for (const cell of lane.cells) {
        const norm = normalizePath(cell.worktree.path);
        liveByKey.set(`wt::${lane.project.id}::${norm}`, {
          added: cell.worktree.added_lines,
          deleted: cell.worktree.deleted_lines,
          merged: cell.worktree.is_merged,
          branch: cell.worktree.branch,
        });
      }
    }
  }

  return rawList
    .map((entry) => {
      const live = liveByKey.get(entry.cardKey);
      const meta = worktreeMeta[entry.normWtPath];
      return {
        ...entry,
        branch: live?.branch || entry.branch,
        displayName: meta?.display_name?.trim() || entry.displayName,
        note: meta?.note?.trim() || entry.note,
        addedLines: live ? live.added : entry.addedLines,
        deletedLines: live ? live.deleted : entry.deletedLines,
        isMerged: live ? live.merged : entry.isMerged,
      };
    })
    .sort((a, b) => {
      const scoreA = a.clearedCount * 2 + a.dispatchedCount;
      const scoreB = b.clearedCount * 2 + b.dispatchedCount;
      if (scoreA !== scoreB) return scoreB - scoreA;
      return b.lastAtMs - a.lastAtMs;
    });
}

/** Picks the top-performing monster worker of the day. */
export function pickDailyMvp(
  entries: DailyWorkerRecapEntry[]
): DailyWorkerRecapEntry | null {
  if (entries.length === 0) return null;
  return [...entries].sort((a, b) => {
    if (a.clearedCount !== b.clearedCount) {
      return b.clearedCount - a.clearedCount;
    }
    if (a.dispatchedCount !== b.dispatchedCount) {
      return b.dispatchedCount - a.dispatchedCount;
    }
    return b.lastAtMs - a.lastAtMs;
  })[0];
}

/** Formats the daily recap into ready-to-paste Markdown for Slack / Standup / Notion. */
export function buildDailyRecapMarkdown(
  dateKey: string,
  entries: DailyWorkerRecapEntry[],
  totals: { cleared: number; dispatched: number },
  format: RecapMarkdownFormat = "standup"
): string {
  if (entries.length === 0) {
    return `## Daily Recap — ${dateKey}\n- No completed or dispatched tasks logged yet.`;
  }

  if (format === "compact") {
    const projectCount = new Set(entries.map((e) => e.projectName)).size;
    const lines = [
      `[${dateKey}] ${totals.cleared} cleared, ${totals.dispatched} dispatched across ${projectCount} ${
        projectCount === 1 ? "project" : "projects"
      }`,
    ];
    for (const e of entries) {
      const label = e.displayName ? `${e.displayName} (${e.branch})` : e.branch;
      const diffPart =
        e.addedLines > 0 || e.deletedLines > 0
          ? ` (+${e.addedLines}/-${e.deletedLines})`
          : "";
      const mergedPart = e.isMerged ? " [MERGED]" : "";
      lines.push(`- ${e.projectName} / ${label}${diffPart}${mergedPart}`);
    }
    return lines.join("\n");
  }

  // Standup format grouped by project
  const byProject = new Map<string, DailyWorkerRecapEntry[]>();
  for (const e of entries) {
    const list = byProject.get(e.projectName);
    if (list) list.push(e);
    else byProject.set(e.projectName, [e]);
  }

  const lines: string[] = [
    `## Daily Recap — ${dateKey} (${totals.cleared} cleared · ${totals.dispatched} dispatched)`,
  ];

  for (const [projName, projEntries] of byProject.entries()) {
    lines.push("", `### ${projName}`);
    for (const e of projEntries) {
      const persona = getWorkerPersona(e.normWtPath);
      const title = e.displayName
        ? `**${e.displayName}** (\`${e.branch}\`)`
        : `**${e.branch}**`;
      const parts: string[] = [`${title} · ${persona.name}`];
      if (e.clearedCount > 0) {
        parts.push(
          `${e.clearedCount} ${e.clearedCount === 1 ? "clear" : "clears"}`
        );
      }
      if (e.dispatchedCount > 0) {
        parts.push(`${e.dispatchedCount} dispatched`);
      }
      if (e.addedLines > 0 || e.deletedLines > 0) {
        parts.push(`+${e.addedLines}/-${e.deletedLines}`);
      }
      if (e.isMerged) {
        parts.push("MERGED");
      }
      lines.push(`- ${parts.join(" · ")}`);
      const detail = e.note || e.lastSummary;
      if (detail) {
        lines.push(`  - ${detail}`);
      }
    }
  }

  return lines.join("\n");
}
