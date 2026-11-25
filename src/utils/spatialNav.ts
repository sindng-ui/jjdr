export type NavDirection = "up" | "down" | "left" | "right";

export interface CardRect {
  key: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  cx: number;
  cy: number;
}

/**
 * Find the most intuitive neighbor card in a 2D layout (works across multi-column grids and stacked project sections).
 */
export function findNextCardInDirection(
  cards: CardRect[],
  currentKey: string | null,
  dir: NavDirection
): string | null {
  if (cards.length === 0) return null;
  const cur = cards.find((c) => c.key === currentKey);
  if (!cur) return cards[0].key;

  const isVertical = dir === "up" || dir === "down";
  const EPS = 6;

  let bestKey: string | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const cand of cards) {
    if (cand.key === cur.key) continue;

    if (dir === "down" && cand.cy <= cur.cy + EPS) continue;
    if (dir === "up" && cand.cy >= cur.cy - EPS) continue;
    if (dir === "right" && cand.cx <= cur.cx + EPS) continue;
    if (dir === "left" && cand.cx >= cur.cx - EPS) continue;

    if (isVertical) {
      // Primary: stay within the same column (horizontal overlap) first, then pick closest row above/below
      const horizontalOverlap =
        Math.min(cur.right, cand.right) - Math.max(cur.left, cand.left);
      const sameColPenalty = horizontalOverlap > 10 ? 0 : 100_000;
      const primary =
        dir === "down"
          ? Math.max(0, cand.top - cur.bottom) + (cand.cy - cur.cy) * 0.35
          : Math.max(0, cur.top - cand.bottom) + (cur.cy - cand.cy) * 0.35;
      const secondary = Math.abs(cand.cx - cur.cx);
      const score = sameColPenalty + primary * 3.0 + secondary * 0.8;
      if (score < bestScore) {
        bestScore = score;
        bestKey = cand.key;
      }
    } else {
      // Horizontal move: strongly prefer cards on the same visual row
      const verticalOverlap =
        Math.min(cur.bottom, cand.bottom) - Math.max(cur.top, cand.top);
      const sameRowPenalty = verticalOverlap > 10 ? 0 : 100_000;
      const primary =
        dir === "right"
          ? Math.max(0, cand.left - cur.right) + (cand.cx - cur.cx) * 0.3
          : Math.max(0, cur.left - cand.right) + (cur.cx - cand.cx) * 0.3;
      const secondary = Math.abs(cand.cy - cur.cy);
      const score = sameRowPenalty + primary * 2.0 + secondary * 4.0;
      if (score < bestScore) {
        bestScore = score;
        bestKey = cand.key;
      }
    }
  }

  return bestKey;
}
