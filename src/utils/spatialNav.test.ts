import { describe, expect, it } from "vitest";
import { findNextCardInDirection, type CardRect } from "./spatialNav";

function rect(key: string, x: number, y: number, w = 400, h = 200): CardRect {
  return {
    key,
    left: x,
    right: x + w,
    top: y,
    bottom: y + h,
    cx: x + w / 2,
    cy: y + h / 2,
  };
}

describe("findNextCardInDirection", () => {
  // Project A: 2 cards side by side (row 1)
  // Project B: 1 full-width card below (row 2)
  const cards: CardRect[] = [
    rect("projA-main", 0, 0, 400, 200),
    rect("projA-wt1", 420, 0, 400, 200),
    rect("projB-main", 0, 280, 820, 200),
  ];

  it("moves left and right within the same project row", () => {
    expect(findNextCardInDirection(cards, "projA-main", "right")).toBe("projA-wt1");
    expect(findNextCardInDirection(cards, "projA-wt1", "left")).toBe("projA-main");
  });

  it("moves down into the next project card below instead of jumping sideways", () => {
    expect(findNextCardInDirection(cards, "projA-main", "down")).toBe("projB-main");
    expect(findNextCardInDirection(cards, "projA-wt1", "down")).toBe("projB-main");
    expect(findNextCardInDirection(cards, "projB-main", "up")).toBe("projA-main");
  });

  it("navigates cleanly in vertical Kanban columns (up/down within project, left/right across projects)", () => {
    const columns: CardRect[] = [
      // Column A (Project A)
      rect("colA-1", 0, 0, 276, 86),
      rect("colA-2", 0, 98, 276, 86),
      rect("colA-3", 0, 196, 276, 86),
      // Column B (Project B)
      rect("colB-1", 292, 0, 276, 86),
      rect("colB-2", 292, 98, 276, 86),
    ];

    expect(findNextCardInDirection(columns, "colA-1", "down")).toBe("colA-2");
    expect(findNextCardInDirection(columns, "colA-2", "down")).toBe("colA-3");
    expect(findNextCardInDirection(columns, "colA-3", "up")).toBe("colA-2");
    expect(findNextCardInDirection(columns, "colA-2", "right")).toBe("colB-2");
    expect(findNextCardInDirection(columns, "colB-2", "left")).toBe("colA-2");
    // Column A row 3 moving right lands on Column B's closest row (row 2)
    expect(findNextCardInDirection(columns, "colA-3", "right")).toBe("colB-2");
  });

  it("navigates into and out of a compact ROOT header chip with up/down/right arrows", () => {
    const columnWithRootChip: CardRect[] = [
      // Compact ROOT main header chip aligned right inside Column A header
      rect("colA-root", 160, 44, 110, 24),
      // Worktree cards inside Column A
      rect("colA-wt1", 12, 84, 260, 86),
      rect("colA-wt2", 12, 182, 260, 86),
      // Neighbor Column B card
      rect("colB-root", 304, 84, 260, 86),
    ];

    expect(findNextCardInDirection(columnWithRootChip, "colA-wt1", "up")).toBe(
      "colA-root"
    );
    expect(findNextCardInDirection(columnWithRootChip, "colA-root", "down")).toBe(
      "colA-wt1"
    );
    expect(findNextCardInDirection(columnWithRootChip, "colA-root", "right")).toBe(
      "colB-root"
    );
  });
});
