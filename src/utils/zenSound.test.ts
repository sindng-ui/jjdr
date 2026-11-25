import { describe, expect, it } from "vitest";
import {
  formatZenComboLabel,
  playZenAllClearSfx,
  playZenDeploySfx,
  playZenLeverSfx,
  playZenStampSfx,
} from "./zenSound";

describe("zenSound", () => {
  it("formats consecutive clear combo labels cleanly", () => {
    expect(formatZenComboLabel(1, false)).toBe("+1 Cleared!");
    expect(formatZenComboLabel(1, true)).toBe("+1 Approved!");
    expect(formatZenComboLabel(2, false)).toBe("2x COMBO!");
    expect(formatZenComboLabel(3, false)).toBe("3x STREAK!");
    expect(formatZenComboLabel(4, true)).toBe("4x STREAK!");
    expect(formatZenComboLabel(5, false)).toBe("5x ON FIRE!");
  });

  it("no-ops safely when disabled or without AudioContext in headless test env", () => {
    expect(() => playZenStampSfx(false)).not.toThrow();
    expect(() => playZenLeverSfx(false)).not.toThrow();
    expect(() => playZenDeploySfx(false)).not.toThrow();
    expect(() => playZenAllClearSfx(false)).not.toThrow();
    expect(() => playZenStampSfx(true)).not.toThrow();
  });
});
