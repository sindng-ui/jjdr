import { describe, expect, it } from "vitest";
import {
  CHILL_BACKDROP_PRESETS,
  clampChillScrim,
  DEFAULT_CHILL_BACKDROP,
  getPhotoObjectPosition,
  isSnowBackdropScene,
  normalizeChillBackdropConfig,
  resolveEffectiveChillMood,
} from "./zenChillBackdrop";

describe("zenChillBackdrop", () => {
  it("defaults to classic centered card mode (scene: none)", () => {
    expect(DEFAULT_CHILL_BACKDROP.scene).toBe("none");
    expect(DEFAULT_CHILL_BACKDROP.mood).toBe("auto");
    expect(DEFAULT_CHILL_BACKDROP.photoPosition).toBe("center");
    expect(DEFAULT_CHILL_BACKDROP.photoVignette).toBe(true);
    expect(CHILL_BACKDROP_PRESETS.map((p) => p.id)).toEqual([
      "none",
      "resort_beach",
      "coastal_train",
      "alpine_chalet",
      "glacier_express",
      "custom_photo",
    ]);
  });

  it("maps photo framing positions cleanly", () => {
    expect(getPhotoObjectPosition("top")).toBe("center 18%");
    expect(getPhotoObjectPosition("center")).toBe("center 50%");
    expect(getPhotoObjectPosition("bottom")).toBe("center 82%");
  });

  it("identifies snowy alpine scenes correctly", () => {
    expect(isSnowBackdropScene("none")).toBe(false);
    expect(isSnowBackdropScene("resort_beach")).toBe(false);
    expect(isSnowBackdropScene("coastal_train")).toBe(false);
    expect(isSnowBackdropScene("alpine_chalet")).toBe(true);
    expect(isSnowBackdropScene("glacier_express")).toBe(true);
  });

  it("resolves auto mood cleanly across local hours and respects explicit moods", () => {
    expect(resolveEffectiveChillMood("day", new Date(2026, 10, 28, 23, 0))).toBe("day");
    expect(resolveEffectiveChillMood("night", new Date(2026, 10, 28, 12, 0))).toBe("night");

    expect(resolveEffectiveChillMood("auto", new Date(2026, 10, 28, 7, 30))).toBe("golden");
    expect(resolveEffectiveChillMood("auto", new Date(2026, 10, 28, 13, 0))).toBe("day");
    expect(resolveEffectiveChillMood("auto", new Date(2026, 10, 28, 18, 15))).toBe("sunset");
    expect(resolveEffectiveChillMood("auto", new Date(2026, 10, 28, 22, 0))).toBe("night");
    expect(resolveEffectiveChillMood("auto", new Date(2026, 10, 28, 3, 0))).toBe("night");
  });

  it("clamps scrim and sanitizes invalid persisted configs safely", () => {
    expect(clampChillScrim(-20)).toBe(0);
    expect(clampChillScrim(120)).toBe(55);
    expect(clampChillScrim(Number.NaN)).toBe(DEFAULT_CHILL_BACKDROP.scrim);

    const sanitized = normalizeChillBackdropConfig({
      scene: "unknown_scene" as never,
      mood: "invalid_mood" as never,
      scrim: 99,
      monsters: false,
      snow: false,
      motion: false,
      photoPosition: "invalid" as never,
      photoVignette: false,
    });
    expect(sanitized).toEqual({
      scene: "none",
      mood: "auto",
      scrim: 55,
      monsters: false,
      snow: false,
      motion: false,
      photoPosition: "center",
      photoVignette: false,
    });
  });
});
