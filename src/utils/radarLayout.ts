import type {
  EnrichedSession,
  MatrixProjectLane,
  MatrixWorktreeCell,
  RadarDensity,
} from "../types/domain";
import { normalizeRadarDensity } from "./themes";

export type RadarLayoutMode = "columns" | "rows";

export type FocusedRadarColumn =
  | { kind: "project"; projectId: string }
  | { kind: "external" }
  | null;

export const DEFAULT_RADAR_LAYOUT: RadarLayoutMode = "columns";
export const RADAR_LAYOUT_STORAGE_KEY = "jjdr.radar_layout";

export function normalizeRadarLayout(value?: string | null): RadarLayoutMode {
  if (value === "rows" || value === "columns") {
    return value;
  }
  return DEFAULT_RADAR_LAYOUT;
}

export function readStoredRadarLayout(): RadarLayoutMode {
  try {
    if (typeof window !== "undefined") {
      return normalizeRadarLayout(
        window.localStorage.getItem(RADAR_LAYOUT_STORAGE_KEY)
      );
    }
  } catch {
    // ignore storage errors
  }
  return DEFAULT_RADAR_LAYOUT;
}

export function writeStoredRadarLayout(mode: RadarLayoutMode): void {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        RADAR_LAYOUT_STORAGE_KEY,
        normalizeRadarLayout(mode)
      );
    }
  } catch {
    // ignore storage errors
  }
}

/**
 * Maps existing RadarDensity presets to fixed Kanban column widths so
 * overview columns stay crisp and scannable.
 */
export function getRadarColumnWidthPx(density?: RadarDensity | null): number {
  const norm = normalizeRadarDensity(density);
  if (norm === "comfortable") return 308;
  if (norm === "compact") return 244;
  return 276;
}

/**
 * Expanded column width used in Radar Columns Focus Mode (when the right terminal
 * pane is open and only the focused project is shown) so branch names & previews breathe.
 */
export function getRadarFocusedColumnWidthPx(
  density?: RadarDensity | null
): number {
  const norm = normalizeRadarDensity(density);
  if (norm === "comfortable") return 388;
  if (norm === "compact") return 320;
  return 356;
}

/**
 * Extract project ID from a Radar worktree cardKey (`wt::<projectId>::<normPath>`).
 */
export function extractProjectIdFromCardKey(
  cardKey: string | null | undefined
): string | null {
  if (!cardKey || !cardKey.startsWith("wt::")) return null;
  const rest = cardKey.slice(4);
  const sep = rest.indexOf("::");
  if (sep <= 0) return null;
  return rest.slice(0, sep);
}

/**
 * Resolve which single column (project or external shells) should be shown
 * when Radar Columns Focus Mode is active.
 */
export function resolveFocusedRadarColumn(params: {
  lanes: MatrixProjectLane[];
  unassigned: EnrichedSession[];
  allSessions: EnrichedSession[];
  attachedAddress: string | null;
  selectedCardKey: string | null;
  selectedProjectId: string | null;
}): FocusedRadarColumn {
  const {
    lanes,
    unassigned,
    allSessions,
    attachedAddress,
    selectedCardKey,
    selectedProjectId,
  } = params;

  const hasLane = (id: string | null | undefined): id is string =>
    Boolean(id && lanes.some((l) => l.project.id === id));

  if (attachedAddress) {
    const attached = allSessions.find((s) => s.address === attachedAddress);
    if (attached) {
      if (hasLane(attached.projectId)) {
        return { kind: "project", projectId: attached.projectId };
      }
      if (!attached.projectId && unassigned.length > 0) {
        return { kind: "external" };
      }
    }
  }

  if (selectedCardKey) {
    if (selectedCardKey.startsWith("ext::") && unassigned.length > 0) {
      return { kind: "external" };
    }
    const cardProjectId = extractProjectIdFromCardKey(selectedCardKey);
    if (hasLane(cardProjectId)) {
      return { kind: "project", projectId: cardProjectId };
    }
  }

  if (hasLane(selectedProjectId)) {
    return { kind: "project", projectId: selectedProjectId };
  }

  if (lanes.length > 0) {
    return { kind: "project", projectId: lanes[0].project.id };
  }

  if (unassigned.length > 0) {
    return { kind: "external" };
  }

  return null;
}

const BUCKET_PRIORITY: Record<MatrixWorktreeCell["topBucket"], number> = {
  needs_you: 0,
  ready: 1,
  running: 2,
  idle: 3,
};

/**
 * Pick the highest-priority worktree cell when switching directly to a project
 * column in Focus Mode (urgent -> ready -> running -> first non-root -> root).
 */
export function pickPreferredCellForLane(
  lane: MatrixProjectLane
): MatrixWorktreeCell | null {
  if (lane.cells.length === 0) return null;

  let best: MatrixWorktreeCell | null = null;
  let bestRank = Number.POSITIVE_INFINITY;

  for (const cell of lane.cells) {
    const bucketRank = BUCKET_PRIORITY[cell.topBucket] ?? 3;
    // Slightly prefer non-root worktrees when buckets tie at idle
    const rootTieBreaker = cell.worktree.is_main ? 0.5 : 0;
    const rank = bucketRank * 2 + rootTieBreaker;
    if (rank < bestRank) {
      bestRank = rank;
      best = cell;
    }
  }

  return best ?? lane.cells[0];
}
