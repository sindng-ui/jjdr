import { describe, expect, it } from "vitest";
import {
  DEFAULT_RADAR_DENSITY,
  DEFAULT_THEME_ID,
  getRadarDensityPreset,
  getThemePreset,
  normalizeRadarDensity,
  normalizeThemeId,
  RADAR_DENSITY_PRESETS,
  THEME_PRESETS,
} from "./themes";

describe("themes", () => {
  it("defaults to aurora dark theme for unknown or missing values", () => {
    expect(DEFAULT_THEME_ID).toBe("aurora");
    expect(normalizeThemeId(undefined)).toBe("aurora");
    expect(normalizeThemeId(null)).toBe("aurora");
    expect(normalizeThemeId("unknown")).toBe("aurora");
    expect(getThemePreset("invalid").id).toBe("aurora");
  });

  it("exposes all 4 theme presets with distinct xterm palettes", () => {
    const ids = THEME_PRESETS.map((t) => t.id);
    expect(ids).toEqual(["aurora", "lounge", "nordic", "botanical"]);
    for (const id of ids) {
      expect(normalizeThemeId(id)).toBe(id);
      const preset = getThemePreset(id);
      expect(preset.xterm.background).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("provides radar density presets with balanced (4/2) as default and compact (5/3) option", () => {
    expect(DEFAULT_RADAR_DENSITY).toBe("balanced");
    expect(normalizeRadarDensity(undefined)).toBe("balanced");
    expect(getRadarDensityPreset("balanced")).toMatchObject({
      normalCols: 4,
      terminalCols: 2,
    });
    expect(getRadarDensityPreset("compact")).toMatchObject({
      normalCols: 5,
      terminalCols: 3,
    });
    expect(RADAR_DENSITY_PRESETS).toHaveLength(3);
  });
});
