import type { ITheme } from "@xterm/xterm";
import type { RadarDensity, ThemeId } from "../types/domain";

export interface RadarDensityPreset {
  id: RadarDensity;
  label: string;
  tagline: string;
  normalCols: number;
  terminalCols: number;
  description: string;
}

export const DEFAULT_RADAR_DENSITY: RadarDensity = "balanced";

export const RADAR_DENSITY_PRESETS: RadarDensityPreset[] = [
  {
    id: "comfortable",
    label: "여유 (3 / 2)",
    tagline: "노트북·작은 창",
    normalCols: 3,
    terminalCols: 2,
    description: "기본 한 줄 3개 · 터미널 열림 2개",
  },
  {
    id: "balanced",
    label: "표준 (4 / 2)",
    tagline: "기본 · 추천",
    normalCols: 4,
    terminalCols: 2,
    description: "기본 한 줄 4개 · 터미널 열림 2개",
  },
  {
    id: "compact",
    label: "고밀도 (5 / 3)",
    tagline: "와이드·다수 프로젝트",
    normalCols: 5,
    terminalCols: 3,
    description: "기본 한 줄 5개 · 터미널 열림 3개",
  },
];

export function normalizeRadarDensity(value?: string | null): RadarDensity {
  if (value === "comfortable" || value === "balanced" || value === "compact") {
    return value;
  }
  return DEFAULT_RADAR_DENSITY;
}

export function getRadarDensityPreset(
  value?: string | null
): RadarDensityPreset {
  const id = normalizeRadarDensity(value);
  return (
    RADAR_DENSITY_PRESETS.find((d) => d.id === id) ?? RADAR_DENSITY_PRESETS[1]
  );
}

export interface ThemePreset {
  id: ThemeId;
  name: string;
  tagline: string;
  description: string;
  isLight: boolean;
  swatches: {
    shell: string;
    stage: string;
    card: string;
    accent: string;
    ready: string;
    action: string;
  };
  xterm: ITheme;
}

export const DEFAULT_THEME_ID: ThemeId = "aurora";
export const THEME_STORAGE_KEY = "jjdr-theme";

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "aurora",
    name: "Aurora Dusk",
    tagline: "기본 · 청량 다크",
    description: "맑고 깊은 미드나잇 인디고와 은은한 오로라 빛",
    isLight: false,
    swatches: {
      shell: "#101526",
      stage: "#161d34",
      card: "#1e2745",
      accent: "#6366f1",
      ready: "#34d399",
      action: "#fb7185",
    },
    xterm: {
      background: "#0e1322",
      foreground: "#eef2ff",
      cursor: "#818cf8",
      selectionBackground: "#2c3863",
      black: "#0e1322",
      red: "#fb7185",
      green: "#34d399",
      yellow: "#fbbf24",
      blue: "#60a5fa",
      magenta: "#c084fc",
      cyan: "#38bdf8",
      white: "#eef2ff",
    },
  },
  {
    id: "lounge",
    name: "Obsidian Copper",
    tagline: "Graphite · Muted Copper",
    description: "Neutral graphite dark canvas with understated burnished copper accents",
    isLight: false,
    swatches: {
      shell: "#121316",
      stage: "#181a1f",
      card: "#21232a",
      accent: "#d6946b",
      ready: "#78b899",
      action: "#d97b77",
    },
    xterm: {
      background: "#101114",
      foreground: "#eeece8",
      cursor: "#d6946b",
      selectionBackground: "#343742",
      black: "#101114",
      red: "#d97b77",
      green: "#78b899",
      yellow: "#d6a96b",
      blue: "#7ea8d6",
      magenta: "#b896cf",
      cyan: "#7bb3bc",
      white: "#eeece8",
    },
  },
  {
    id: "nordic",
    name: "Titanium Studio",
    tagline: "Titanium · Monochrome",
    description: "Crisp space-gray titanium canvas with brushed silver accents",
    isLight: false,
    swatches: {
      shell: "#16171a",
      stage: "#1e2024",
      card: "#27292e",
      accent: "#d4d8e0",
      ready: "#78c29b",
      action: "#e07d86",
    },
    xterm: {
      background: "#131417",
      foreground: "#f0f2f5",
      cursor: "#d4d8e0",
      selectionBackground: "#343740",
      black: "#131417",
      red: "#e07d86",
      green: "#78c29b",
      yellow: "#d9b978",
      blue: "#8fb7e0",
      magenta: "#bfa0d8",
      cyan: "#84c0cc",
      white: "#f0f2f5",
    },
  },
  {
    id: "botanical",
    name: "Celadon Ink",
    tagline: "Deep Slate · Celadon",
    description: "Low-fatigue ink slate paired with calm ceramic celadon accents",
    isLight: false,
    swatches: {
      shell: "#111517",
      stage: "#171d20",
      card: "#20282c",
      accent: "#7ab3a8",
      ready: "#78bf9b",
      action: "#d97a86",
    },
    xterm: {
      background: "#0f1315",
      foreground: "#eaf1f0",
      cursor: "#7ab3a8",
      selectionBackground: "#26363a",
      black: "#0f1315",
      red: "#d97a86",
      green: "#78bf9b",
      yellow: "#d6b072",
      blue: "#7aa8cc",
      magenta: "#b89ad4",
      cyan: "#7eb4c7",
      white: "#eaf1f0",
    },
  },
];

export function normalizeThemeId(value?: string | null): ThemeId {
  if (
    value === "aurora" ||
    value === "lounge" ||
    value === "nordic" ||
    value === "botanical"
  ) {
    return value;
  }
  return DEFAULT_THEME_ID;
}

export function getThemePreset(value?: string | null): ThemePreset {
  const id = normalizeThemeId(value);
  return THEME_PRESETS.find((t) => t.id === id) ?? THEME_PRESETS[0];
}

export function readStoredTheme(): ThemeId {
  try {
    if (typeof window !== "undefined") {
      return normalizeThemeId(window.localStorage.getItem(THEME_STORAGE_KEY));
    }
  } catch {
    // Ignore storage failures
  }
  return DEFAULT_THEME_ID;
}

export function applyThemeToDom(themeId: ThemeId): void {
  const id = normalizeThemeId(themeId);
  const preset = getThemePreset(id);
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = id;
    document.documentElement.classList.toggle("dark", !preset.isLight);
  }
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, id);
    }
  } catch {
    // Ignore storage failures
  }
}
