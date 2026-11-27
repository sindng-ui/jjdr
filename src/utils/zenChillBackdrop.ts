export type ChillBackdropScene =
  | "none"
  | "resort_beach"
  | "coastal_train"
  | "alpine_chalet"
  | "glacier_express";

export type ChillBackdropMood = "auto" | "day" | "golden" | "sunset" | "night";
export type ResolvedChillMood = Exclude<ChillBackdropMood, "auto">;

export interface ChillBackdropConfig {
  scene: ChillBackdropScene;
  mood: ChillBackdropMood;
  scrim: number; // 0..55 (%)
  monsters: boolean;
  snow: boolean;
  motion: boolean;
}

export interface ChillBackdropPresetMeta {
  id: ChillBackdropScene;
  label: string;
  shortLabel: string;
  category: "classic" | "summer" | "winter";
  description: string;
  swatch: string;
}

export const CHILL_BACKDROP_STORAGE_KEY = "jjdr.zen_chill_backdrop.v1";

export const DEFAULT_CHILL_BACKDROP: ChillBackdropConfig = {
  scene: "none",
  mood: "auto",
  scrim: 18,
  monsters: true,
  snow: true,
  motion: true,
};

export const CHILL_BACKDROP_PRESETS: ReadonlyArray<ChillBackdropPresetMeta> = [
  {
    id: "none",
    label: "Classic Card",
    shortLabel: "Classic",
    category: "classic",
    description: "Default centered Zen briefing card",
    swatch: "linear-gradient(135deg, #1e2644 0%, #151c33 100%)",
  },
  {
    id: "resort_beach",
    label: "Pixel Resort Coast",
    shortLabel: "Resort Coast",
    category: "summer",
    description: "Serene 2D pixel beach, palm silhouettes & shimmering sea",
    swatch: "linear-gradient(180deg, #472c64 0%, #de6d60 48%, #873e62 100%)",
  },
  {
    id: "coastal_train",
    label: "Summer Coastal Train",
    shortLabel: "Coastal Train",
    category: "summer",
    description: "2D pixel summer sea, cumulus clouds & seaside tram",
    swatch: "linear-gradient(180deg, #64c7f5 0%, #1db3d1 60%, #4ade80 100%)",
  },
  {
    id: "alpine_chalet",
    label: "Alpine Chalet & Gondola",
    shortLabel: "Alpine Chalet",
    category: "winter",
    description: "2D pixel snowy massif, red gondola & warm chalet",
    swatch: "linear-gradient(180deg, #3b8fd6 0%, #dceeff 58%, #f5faff 100%)",
  },
  {
    id: "glacier_express",
    label: "Glacier Express & Lake",
    shortLabel: "Glacier Train",
    category: "winter",
    description: "2D pixel alpine gorge, red viaduct train & lake",
    swatch: "linear-gradient(180deg, #3b8fd6 0%, #b8e3fc 52%, #2391c2 100%)",
  },
];

export const CHILL_MOOD_OPTIONS: ReadonlyArray<{
  id: ChillBackdropMood;
  label: string;
}> = [
  { id: "auto", label: "Auto" },
  { id: "day", label: "Day" },
  { id: "golden", label: "Warm" },
  { id: "sunset", label: "Sunset" },
  { id: "night", label: "Night" },
];

const VALID_SCENES = new Set<ChillBackdropScene>([
  "none",
  "resort_beach",
  "coastal_train",
  "alpine_chalet",
  "glacier_express",
]);

const VALID_MOODS = new Set<ChillBackdropMood>([
  "auto",
  "day",
  "golden",
  "sunset",
  "night",
]);

export function isSnowBackdropScene(scene: ChillBackdropScene): boolean {
  return scene === "alpine_chalet" || scene === "glacier_express";
}

/**
 * Resolves `auto` mood based on local clock hour:
 * - 06..09 -> golden (morning/warm sunlight)
 * - 10..16 -> day (crisp bright daylight)
 * - 17..19 -> sunset (golden hour / alpenglow)
 * - 20..05 -> night (cozy starlight / aurora)
 */
export function resolveEffectiveChillMood(
  mood: ChillBackdropMood,
  date: Date = new Date()
): ResolvedChillMood {
  if (mood !== "auto") return mood;
  const hour = date.getHours();
  if (hour >= 10 && hour < 17) return "day";
  if (hour >= 6 && hour < 10) return "golden";
  if (hour >= 17 && hour < 20) return "sunset";
  return "night";
}

export function clampChillScrim(raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULT_CHILL_BACKDROP.scrim;
  return Math.max(0, Math.min(55, Math.round(raw)));
}

export function normalizeChillBackdropConfig(
  raw: Partial<ChillBackdropConfig> | null | undefined
): ChillBackdropConfig {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_CHILL_BACKDROP };
  }
  const scene =
    typeof raw.scene === "string" &&
    VALID_SCENES.has(raw.scene as ChillBackdropScene)
      ? (raw.scene as ChillBackdropScene)
      : DEFAULT_CHILL_BACKDROP.scene;
  const mood =
    typeof raw.mood === "string" &&
    VALID_MOODS.has(raw.mood as ChillBackdropMood)
      ? (raw.mood as ChillBackdropMood)
      : DEFAULT_CHILL_BACKDROP.mood;

  return {
    scene,
    mood,
    scrim: clampChillScrim(
      typeof raw.scrim === "number" ? raw.scrim : DEFAULT_CHILL_BACKDROP.scrim
    ),
    monsters:
      typeof raw.monsters === "boolean"
        ? raw.monsters
        : DEFAULT_CHILL_BACKDROP.monsters,
    snow:
      typeof raw.snow === "boolean" ? raw.snow : DEFAULT_CHILL_BACKDROP.snow,
    motion:
      typeof raw.motion === "boolean"
        ? raw.motion
        : DEFAULT_CHILL_BACKDROP.motion,
  };
}

export function readStoredChillBackdrop(): ChillBackdropConfig {
  try {
    const raw = window.localStorage.getItem(CHILL_BACKDROP_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CHILL_BACKDROP };
    return normalizeChillBackdropConfig(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_CHILL_BACKDROP };
  }
}

export function writeStoredChillBackdrop(config: ChillBackdropConfig): void {
  try {
    window.localStorage.setItem(
      CHILL_BACKDROP_STORAGE_KEY,
      JSON.stringify(normalizeChillBackdropConfig(config))
    );
  } catch {
    // Ignore storage quota / private mode failures
  }
}
