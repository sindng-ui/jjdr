import type { EnrichedSession } from "../types/domain";
import { cardKeyForSession } from "./worktreeSessions";

export type ZenCardStyle = "holo_stamp" | "gacha_dial";

const STYLE_STORAGE_KEY = "jjdr.zen_card_style";
const CLEARED_STORAGE_KEY = "jjdr.zen_cleared_today";

export function readStoredZenStyle(): ZenCardStyle {
  try {
    const raw = window.localStorage.getItem(STYLE_STORAGE_KEY);
    if (raw === "gacha_dial" || raw === "holo_stamp") return raw;
  } catch {
    // ignore storage errors
  }
  return "holo_stamp";
}

export function writeStoredZenStyle(style: ZenCardStyle) {
  try {
    window.localStorage.setItem(STYLE_STORAGE_KEY, style);
  } catch {
    // ignore storage errors
  }
}

function getLocalDateKey(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function readTodayClearedCount(now = new Date()): number {
  try {
    const raw = window.localStorage.getItem(CLEARED_STORAGE_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { date?: string; count?: number };
    if (parsed.date === getLocalDateKey(now) && typeof parsed.count === "number") {
      return Math.max(0, Math.floor(parsed.count));
    }
  } catch {
    // ignore
  }
  return 0;
}

export function incrementTodayClearedCount(now = new Date()): number {
  const next = readTodayClearedCount(now) + 1;
  try {
    window.localStorage.setItem(
      CLEARED_STORAGE_KEY,
      JSON.stringify({ date: getLocalDateKey(now), count: next })
    );
  } catch {
    // ignore
  }
  return next;
}

export interface ZenSelectionResult {
  /** Top actionable card currently in focus (null when All Clear) */
  activeCard: EnrichedSession | null;
  /** Number of other actionable cards waiting underneath (for subtle deck depth only) */
  remainingCount: number;
  /** True when the previously locked card was just resolved (left actionable buckets) */
  lockedCardResolved: boolean;
}

/**
 * Pure Z-axis Top-of-Stack selector for Zen (놈팽이) Mode:
 * - Actionable pool is strictly `needs_you` followed by `ready` (already worktree-deduplicated).
 * - Sticky Lock: if `lockedCardKey` is still actionable and not newly skipped, keep it locked on top
 *   so background status changes from other cards NEVER interrupt the user mid-task.
 * - Skipped keys are rotated to the back of the stack (if all actionable cards were skipped, wraps cleanly).
 */
export function selectZenTopCard(
  needsYou: EnrichedSession[],
  ready: EnrichedSession[],
  lockedCardKey: string | null,
  skippedKeys: string[]
): ZenSelectionResult {
  const pool: EnrichedSession[] = [...needsYou, ...ready];
  if (pool.length === 0) {
    return {
      activeCard: null,
      remainingCount: 0,
      lockedCardResolved: Boolean(lockedCardKey),
    };
  }

  const byKey = new Map<string, EnrichedSession>();
  for (const item of pool) {
    const k = cardKeyForSession(item);
    if (!byKey.has(k)) {
      byKey.set(k, item);
    }
  }

  // 1. Sticky Lock: keep showing the locked card while it remains actionable
  if (lockedCardKey && byKey.has(lockedCardKey)) {
    return {
      activeCard: byKey.get(lockedCardKey)!,
      remainingCount: Math.max(0, byKey.size - 1),
      lockedCardResolved: false,
    };
  }

  const lockedCardResolved = Boolean(lockedCardKey && !byKey.has(lockedCardKey));

  // 2. Prefer non-skipped cards in priority order; if all were skipped, rotate by oldest skip
  const skippedSet = new Set(skippedKeys);
  const unskipped = pool.find((item) => !skippedSet.has(cardKeyForSession(item)));
  if (unskipped) {
    return {
      activeCard: unskipped,
      remainingCount: Math.max(0, byKey.size - 1),
      lockedCardResolved,
    };
  }

  // All actionable cards are in skippedKeys -> pick the one skipped earliest
  for (const key of skippedKeys) {
    const match = byKey.get(key);
    if (match) {
      return {
        activeCard: match,
        remainingCount: Math.max(0, byKey.size - 1),
        lockedCardResolved,
      };
    }
  }

  return {
    activeCard: pool[0],
    remainingCount: Math.max(0, byKey.size - 1),
    lockedCardResolved,
  };
}

/**
 * Computes the next card key when the user manually skips/advances via Ctrl+N,
 * Arcade Lever pull, or Gacha Dial turn.
 */
export function computeNextSkippedOrder(
  pool: EnrichedSession[],
  currentKey: string,
  prevSkippedKeys: string[]
): { nextKey: string | null; nextSkippedKeys: string[] } {
  const validKeys = pool.map((s) => cardKeyForSession(s));
  if (validKeys.length <= 1) {
    return { nextKey: validKeys[0] ?? null, nextSkippedKeys: [] };
  }

  const validSet = new Set(validKeys);
  const cleaned = prevSkippedKeys.filter((k) => validSet.has(k) && k !== currentKey);
  const updated = [...cleaned, currentKey];

  // Find first key not in updated
  const updatedSet = new Set(updated);
  const firstFresh = validKeys.find((k) => !updatedSet.has(k));
  if (firstFresh) {
    return { nextKey: firstFresh, nextSkippedKeys: updated };
  }

  // Full cycle completed: reset skip history except keeping currentKey at the tail
  const firstOther = validKeys.find((k) => k !== currentKey) ?? validKeys[0];
  return { nextKey: firstOther, nextSkippedKeys: [currentKey] };
}
