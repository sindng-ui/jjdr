import { describe, expect, it } from "vitest";
import { reorderIds, swapIds } from "./usePointerReorder";

describe("reorderIds", () => {
  it("moves an item forward cleanly", () => {
    expect(reorderIds(["a", "b", "c", "d"], "a", "c")).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
  });

  it("moves an item backward cleanly", () => {
    expect(reorderIds(["a", "b", "c", "d"], "d", "b")).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
  });

  it("returns original array when ids match or are missing", () => {
    const src = ["a", "b", "c"];
    expect(reorderIds(src, "b", "b")).toBe(src);
    expect(reorderIds(src, "x", "a")).toBe(src);
    expect(reorderIds(src, "a", "z")).toBe(src);
  });
});

describe("swapIds", () => {
  it("swaps two items 1:1 without shifting intermediate items (#11)", () => {
    expect(swapIds(["a", "b", "c", "d"], "a", "d")).toEqual([
      "d",
      "b",
      "c",
      "a",
    ]);
    expect(swapIds(["a", "b", "c", "d"], "c", "b")).toEqual([
      "a",
      "c",
      "b",
      "d",
    ]);
  });

  it("returns original array when ids match or are missing", () => {
    const src = ["a", "b", "c"];
    expect(swapIds(src, "b", "b")).toBe(src);
    expect(swapIds(src, "x", "a")).toBe(src);
    expect(swapIds(src, "a", "z")).toBe(src);
  });
});
