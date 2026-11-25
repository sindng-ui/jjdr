export type MonsterBodyType =
  | "blob"
  | "horned"
  | "catbot"
  | "golem"
  | "ghost"
  | "alien";

export type MonsterEyeType = "round" | "cyclops" | "visor" | "starry" | "glasses";

export type MonsterMouthType = "smile" | "fang" | "cat" | "ooh";

export interface MonsterPalette {
  body: string;
  shade: string;
  accent: string;
  belly: string;
  cheek: string;
}

export interface WorkerPersona {
  name: string;
  role: string;
  bodyType: MonsterBodyType;
  eyeType: MonsterEyeType;
  mouthType: MonsterMouthType;
  palette: MonsterPalette;
}

const MONSTER_NAMES = [
  "Mochi", "Boba", "Poko", "Nori", "Kibo", "Taco", "Zuzu", "Milo",
  "Pip", "Luma", "Koko", "Bibi", "Sora", "Toto", "Roku", "Yuzu",
  "Gigi", "Dodo", "Neko", "Fuzu", "Baku", "Chibi", "Pika", "Tori",
  "Momo", "Kuma", "Ruru", "Sabi", "Otis", "Vivi", "Wisp", "Ziggy",
  "Miso", "Udon", "Puff", "Juno", "Kiki", "Tofu", "Mimi", "Bori",
  "Lulu", "Pebble", "Sprout", "Spark", "Pixel", "Byte", "Glitch", "Cosmo",
] as const;

const MONSTER_ROLES = [
  "Code Gremlin",
  "Bug Hunter",
  "Patch Wizard",
  "Build Goblin",
  "Test Sprite",
  "Refactor Imp",
  "Merge Knight",
  "Logic Slime",
  "Type Sentinel",
  "PR Alchemist",
  "Diff Ninja",
  "Stack Yeti",
] as const;

const BODY_TYPES: MonsterBodyType[] = [
  "blob",
  "horned",
  "catbot",
  "golem",
  "ghost",
  "alien",
];

const EYE_TYPES: MonsterEyeType[] = [
  "round",
  "cyclops",
  "visor",
  "starry",
  "glasses",
];

const MOUTH_TYPES: MonsterMouthType[] = ["smile", "fang", "cat", "ooh"];

const PALETTES: MonsterPalette[] = [
  { body: "#34d399", shade: "#059669", accent: "#a7f3d0", belly: "#d1fae5", cheek: "#fb7185" },
  { body: "#60a5fa", shade: "#2563eb", accent: "#bfdbfe", belly: "#dbeafe", cheek: "#f472b6" },
  { body: "#a78bfa", shade: "#7c3aed", accent: "#ddd6fe", belly: "#ede9fe", cheek: "#fb7185" },
  { body: "#fb923c", shade: "#ea580c", accent: "#fed7aa", belly: "#ffedd5", cheek: "#f43f5e" },
  { body: "#f472b6", shade: "#db2777", accent: "#fbcfe8", belly: "#fce7f3", cheek: "#fde047" },
  { body: "#2dd4bf", shade: "#0d9488", accent: "#99f6e4", belly: "#ccfbf1", cheek: "#fda4af" },
  { body: "#facc15", shade: "#ca8a04", accent: "#fef08a", belly: "#fef9c3", cheek: "#fb7185" },
  { body: "#fb7185", shade: "#e11d48", accent: "#fecdd3", belly: "#ffe4e6", cheek: "#fde047" },
];

/** Fast deterministic FNV-1a 32-bit hash */
export function hashPersonaSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * Generates a stable monster character persona (name, role, SVG traits, palette)
 * for any worktree path / branch so the same worker always keeps the same face
 * across Dispatch and Inbox views.
 */
export function getWorkerPersona(seed: string): WorkerPersona {
  const normalized = seed.trim().toLowerCase() || "worker-default";
  const h1 = hashPersonaSeed(normalized);
  const h2 = hashPersonaSeed(`${normalized}::traits`);
  const h3 = hashPersonaSeed(`${normalized}::color`);

  return {
    name: MONSTER_NAMES[h1 % MONSTER_NAMES.length],
    role: MONSTER_ROLES[(h1 >>> 6) % MONSTER_ROLES.length],
    bodyType: BODY_TYPES[h2 % BODY_TYPES.length],
    eyeType: EYE_TYPES[(h2 >>> 4) % EYE_TYPES.length],
    mouthType: MOUTH_TYPES[(h2 >>> 9) % MOUTH_TYPES.length],
    palette: PALETTES[h3 % PALETTES.length],
  };
}
