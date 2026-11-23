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
});
