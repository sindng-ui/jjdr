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
    name: "Warm Lounge",
    tagline: "포근 · 에스프레소",
    description: "따뜻한 에스프레소 차콜과 크림 아이보리, 테라코타 포인트",
    isLight: false,
    swatches: {
      shell: "#191614",
      stage: "#24201c",
      card: "#2e2823",
      accent: "#e8915a",
      ready: "#6fd1a2",
      action: "#f48078",
    },
    xterm: {
      background: "#181512",
      foreground: "#f6efe7",
      cursor: "#e8915a",
      selectionBackground: "#44382f",
      black: "#181512",
      red: "#f48078",
      green: "#6fd1a2",
      yellow: "#f0b360",
      blue: "#7cb5ec",
      magenta: "#d69ee8",
      cyan: "#6ec9d2",
      white: "#f6efe7",
    },
  },
  {
    id: "nordic",
    name: "Nordic Mist",
    tagline: "화사 · 웜 라이트",
    description: "눈부심 없는 웜 아이보리 포슬린과 파스텔 포인트",
    isLight: true,
    swatches: {
      shell: "#eae7e0",
      stage: "#f8f7f3",
      card: "#ffffff",
      accent: "#2563eb",
      ready: "#059669",
      action: "#e11d48",
    },
    xterm: {
      background: "#171a23",
      foreground: "#f1f5f9",
      cursor: "#60a5fa",
      selectionBackground: "#334155",
      black: "#171a23",
      red: "#fb7185",
      green: "#34d399",
      yellow: "#fbbf24",
      blue: "#60a5fa",
      magenta: "#c084fc",
      cyan: "#38bdf8",
      white: "#f1f5f9",
    },
  },
  {
    id: "botanical",
    name: "Botanical Slate",
    tagline: "힐링 · 딥 틸 다크",
    description: "눈 피로도가 가장 낮은 유칼립투스 딥 틸과 살구 골드",
    isLight: false,
    swatches: {
      shell: "#0e191a",
      stage: "#152526",
      card: "#1d3233",
      accent: "#2dd4bf",
      ready: "#4ade80",
      action: "#fb7185",
    },
    xterm: {
      background: "#0d1718",
      foreground: "#ebf7f4",
      cursor: "#2dd4bf",
      selectionBackground: "#224445",
      black: "#0d1718",
      red: "#fb7185",
      green: "#4ade80",
      yellow: "#f5c26b",
      blue: "#5eead4",
      magenta: "#d8b4fe",
      cyan: "#38bdf8",
      white: "#ebf7f4",
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
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = id;
    document.documentElement.classList.toggle("dark", id !== "nordic");
  }
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, id);
    }
  } catch {
    // Ignore storage failures
  }
}
