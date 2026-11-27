import type { ChillBackdropScene, ResolvedChillMood } from "./zenChillBackdrop";
import {
  drawAuroraCurtains,
  drawFluffyCloud,
  drawNaturalMassif,
  drawPixelHill,
  drawSeaBase,
  drawSeagull,
  drawSkyBands,
  drawSnowfall,
  drawSnowPine,
  drawStringLights,
  drawSummerMonster,
  drawValleyMist,
  drawWinterMonster,
  PIXEL_H,
  PIXEL_W,
  px,
  sampleRidgeProfile,
  SUMMER_PALETTES,
  WINTER_PALETTES,
} from "./zenPixelCommon";

export type PixelBackdropScene = Exclude<
  ChillBackdropScene,
  "none" | "custom_photo"
>;

export interface PixelSceneRenderOptions {
  monsters: boolean;
  snow: boolean;
}

/**
 * Single-slot offscreen cache holding pre-baked static mountain & terrain layers
 * (<= 320x180 RGBA = ~0.23 MB) so animated frames blit static peaks in 1 drawImage()
 * instead of ~11,500 fillRect() calls per frame. Freed immediately on unmount.
 */
export interface ChillStaticLayerCache {
  key: string;
  canvas: HTMLCanvasElement;
  ridgeHeights?: Int16Array;
}

export interface ChillStaticCacheHolder {
  current: ChillStaticLayerCache | null;
}

function getOrBakeStaticLayer(
  holder: ChillStaticCacheHolder | undefined,
  key: string,
  width: number,
  height: number,
  bake: (ctx: CanvasRenderingContext2D) => Int16Array | undefined
): ChillStaticLayerCache | null {
  if (!holder || typeof document === "undefined") return null;
  if (holder.current && holder.current.key === key) {
    return holder.current;
  }
  const off = document.createElement("canvas");
  off.width = width;
  off.height = height;
  const offCtx = off.getContext("2d");
  if (!offCtx) return null;
  const ridgeHeights = bake(offCtx);
  holder.current = { key, canvas: off, ridgeHeights };
  return holder.current;
}

export function getScenePixelDimensions(
  scene: PixelBackdropScene
): { width: number; height: number } {
  if (scene === "resort_beach") {
    return { width: 240, height: 135 };
  }
  return { width: PIXEL_W, height: PIXEL_H };
}

interface SereneCoastPalette {
  sky: string[];
  sun: string;
  sunGlow: string;
  cloud: string;
  cloudShade: string;
  islandFar: string;
  islandNear: string;
  sea: string[];
  foam: string;
  sand: string[];
  palm: string;
  palmHi: string;
  stars: boolean;
  sunY: number;
  sunX: number;
}

const SERENE_COAST_PALETTES: Record<ResolvedChillMood, SereneCoastPalette> = {
  day: {
    sky: ["#1d78c2", "#35a2de", "#64c7ee", "#a6e6f5", "#dcf7f7"],
    sun: "#fff7c2",
    sunGlow: "rgba(255, 248, 200, 0.35)",
    cloud: "#f3fbff",
    cloudShade: "#b8e2f4",
    islandFar: "#2b7f9e",
    islandNear: "#1e6478",
    sea: ["#0e6b9c", "#1487b5", "#20a8c7", "#3fc7d4", "#7ee3de"],
    foam: "#e9fdfc",
    sand: ["#e8cf9b", "#d9b97e", "#c29d62"],
    palm: "#113d3f",
    palmHi: "#1d5d54",
    stars: false,
    sunY: 0.31,
    sunX: 0.68,
  },
  golden: {
    sky: ["#1f2e59", "#3f5387", "#7c73a6", "#c98eb0", "#f2b8b5", "#fde1cc"],
    sun: "#fff2dc",
    sunGlow: "rgba(253, 224, 198, 0.35)",
    cloud: "#ffe9e3",
    cloudShade: "#b98dad",
    islandFar: "#4a4d7d",
    islandNear: "#323963",
    sea: ["#2b3d6e", "#3d558a", "#5f74a6", "#8d8eb8", "#b9a6c4"],
    foam: "#f7e3e4",
    sand: ["#8a7384", "#6e5a6d", "#504154"],
    palm: "#181d38",
    palmHi: "#2b3259",
    stars: true,
    sunY: 0.46,
    sunX: 0.34,
  },
  sunset: {
    sky: ["#1c1b42", "#472c64", "#98446c", "#de6d60", "#f7ad67", "#fce09b"],
    sun: "#fff0b3",
    sunGlow: "rgba(255, 194, 102, 0.38)",
    cloud: "#ffd3a1",
    cloudShade: "#c46872",
    islandFar: "#492954",
    islandNear: "#2e1c3d",
    sea: ["#26204b", "#4c2c5e", "#873e62", "#ba5c62", "#d98862"],
    foam: "#ffd9b3",
    sand: ["#87545a", "#6b3f4a", "#4d2c3b"],
    palm: "#140e24",
    palmHi: "#281b40",
    stars: true,
    sunY: 0.48,
    sunX: 0.52,
  },
  night: {
    sky: ["#070b1a", "#0c142e", "#122147", "#18315e", "#1e4070"],
    sun: "#eef6ff",
    sunGlow: "rgba(186, 225, 255, 0.28)",
    cloud: "#294673",
    cloudShade: "#16294a",
    islandFar: "#0d1b36",
    islandNear: "#081124",
    sea: ["#071226", "#0b1e3b", "#102c52", "#163c69", "#1e507d"],
    foam: "#8ecae6",
    sand: ["#1c2a42", "#142036", "#0d1626"],
    palm: "#050914",
    palmHi: "#0e1933",
    stars: true,
    sunY: 0.25,
    sunX: 0.66,
  },
};

const COAST_STARS = Array.from({ length: 42 }, (_, i) => ({
  x: ((i * 73 + 17) % 100) / 100,
  y: ((i * 41 + 9) % 44) / 100,
  phase: i * 0.9,
  size: i % 5 === 0 ? 2 : 1,
}));

function drawCoastPalm(
  ctx: CanvasRenderingContext2D,
  baseX: number,
  baseY: number,
  dir: number,
  sway: number,
  dark: string,
  hi: string
): void {
  const steps = 28;
  let tipX = baseX;
  let tipY = baseY;
  for (let i = 0; i < steps; i++) {
    const prog = i / steps;
    const x = Math.round(baseX - dir * Math.sin(prog * 1.45) * 14 + sway * prog * 0.7);
    const y = baseY - i * 2;
    ctx.fillStyle = dark;
    ctx.fillRect(x - 2, y, 4 - Math.floor(prog * 1.8), 3);
    if (i % 3 === 0) {
      ctx.fillStyle = hi;
      ctx.fillRect(x - 1, y, 1, 1);
    }
    tipX = x;
    tipY = y;
  }
  const angles = [-2.5, -1.9, -1.2, -0.5, 0.25, 0.9];
  for (const a of angles) {
    for (let r = 0; r < 18; r++) {
      const fx = Math.round(tipX + Math.cos(a) * r * 1.3 + sway * (r / 18));
      const fy = Math.round(tipY + Math.sin(a) * r * 0.9 + r * r * 0.045);
      ctx.fillStyle = r % 4 === 0 ? hi : dark;
      ctx.fillRect(fx, fy, 2, 2);
    }
  }
}

/** First-group Concept A: Serene 240x135 Pixel Resort Coast (palm silhouettes, shimmering water, sailboat) */
function drawResortBeachScene(
  ctx: CanvasRenderingContext2D,
  mood: ResolvedChillMood,
  t: number,
  _opts: PixelSceneRenderOptions
): void {
  const W = 240;
  const H = 135;
  const p = SERENE_COAST_PALETTES[mood];
  const horizon = 74;

  // 1. Banded pixel sky + subtle ordered dither seams
  const bands = p.sky.length;
  const bandH = horizon / bands;
  for (let i = 0; i < bands; i++) {
    const y0 = Math.floor(i * bandH);
    const y1 = Math.ceil((i + 1) * bandH);
    ctx.fillStyle = p.sky[i];
    ctx.fillRect(0, y0, W, y1 - y0);
    if (i < bands - 1) {
      ctx.fillStyle = p.sky[i + 1];
      for (let x = 0; x < W; x += 2) {
        ctx.fillRect(x + (i % 2), y1 - 2, 1, 1);
      }
    }
  }

  // 2. Twinkling pixel stars
  if (p.stars) {
    for (const st of COAST_STARS) {
      const alpha =
        mood === "night"
          ? 0.45 + 0.55 * Math.sin(t * 2.1 + st.phase)
          : 0.2 + 0.35 * Math.sin(t * 1.8 + st.phase);
      ctx.fillStyle = `rgba(255,252,235,${alpha.toFixed(2)})`;
      ctx.fillRect(Math.floor(st.x * W), Math.floor(st.y * H), st.size, st.size);
    }
  }

  // 3. Pixel Sun / Moon + stepped halo
  const sx = Math.floor(p.sunX * W);
  const sy = Math.floor(p.sunY * H);
  ctx.fillStyle = p.sunGlow;
  ctx.fillRect(sx - 13, sy - 9, 26, 18);
  ctx.fillRect(sx - 10, sy - 12, 20, 24);
  ctx.fillStyle = p.sun;
  ctx.fillRect(sx - 7, sy - 5, 14, 10);
  ctx.fillRect(sx - 5, sy - 7, 10, 14);
  if (mood === "night") {
    ctx.fillStyle = p.sky[1];
    ctx.fillRect(sx - 1, sy - 6, 7, 8);
    ctx.fillRect(sx + 1, sy - 4, 6, 7);
  }

  // 4. Slow drifting chunky pixel clouds
  const clouds = [
    { base: 24, y: 20, w: 30, speed: 1.4 },
    { base: 118, y: 14, w: 40, speed: 1.0 },
    { base: 186, y: 28, w: 26, speed: 1.8 },
  ];
  for (const cl of clouds) {
    const cx = Math.floor((cl.base + t * cl.speed) % (W + 50)) - 25;
    ctx.fillStyle = p.cloudShade;
    ctx.fillRect(cx, cl.y + 4, cl.w, 3);
    ctx.fillStyle = p.cloud;
    ctx.fillRect(cx + 3, cl.y + 1, cl.w - 6, 4);
    ctx.fillRect(cx + 8, cl.y - 2, cl.w - 16, 4);
  }

  // 5. Distant pixel tropical islands on horizon
  drawPixelHill(ctx, 152, horizon, 52, 11, p.islandFar);
  drawPixelHill(ctx, 180, horizon, 44, 8, p.islandNear);
  drawPixelHill(ctx, 26, horizon, 32, 6, p.islandNear);

  // 6. Banded pixel ocean
  const seaBands = p.sea.length;
  const seaTop = horizon;
  const sandTop = 114;
  const seaH = sandTop - seaTop;
  for (let i = 0; i < seaBands; i++) {
    const y0 = seaTop + Math.floor((i * seaH) / seaBands);
    const y1 = seaTop + Math.ceil(((i + 1) * seaH) / seaBands);
    ctx.fillStyle = p.sea[i];
    ctx.fillRect(0, y0, W, y1 - y0);
  }

  // 7. Animated pixel sun/moon shimmer on water
  for (let y = seaTop + 2; y < sandTop - 5; y += 2) {
    const ratio = (y - seaTop) / seaH;
    const maxW = Math.floor(14 + ratio * 22);
    const drift = Math.round(Math.sin(t * 2.4 + y * 0.7) * (2 + ratio * 3));
    const segW = Math.max(
      4,
      Math.floor(maxW * (0.55 + 0.45 * Math.sin(t * 3 + y)))
    );
    ctx.fillStyle =
      mood === "night"
        ? "rgba(210, 238, 255, 0.55)"
        : "rgba(255, 240, 190, 0.65)";
    ctx.fillRect(sx - Math.floor(segW / 2) + drift, y, segW, 1);
  }

  // 8. Tiny pixel sailboat bobbing calmly
  const boatX = Math.floor((68 + t * 0.9) % (W - 40)) + 16;
  const boatY = seaTop + 9 + (Math.sin(t * 2.2) > 0 ? 0 : 1);
  ctx.fillStyle = "#2b1d2e";
  ctx.fillRect(boatX, boatY, 10, 2);
  ctx.fillRect(boatX + 1, boatY + 2, 8, 1);
  ctx.fillStyle = "#fff8ec";
  ctx.fillRect(boatX + 4, boatY - 6, 1, 6);
  ctx.fillRect(boatX + 5, boatY - 5, 2, 4);
  ctx.fillRect(boatX + 7, boatY - 3, 2, 2);

  // 9. Rolling pixel surf foam + sandy beach shore
  const waveShift = Math.round(Math.sin(t * 1.6) * 2);
  for (let i = 0; i < p.sand.length; i++) {
    ctx.fillStyle = p.sand[i];
    ctx.fillRect(0, sandTop + i * 7, W, 8);
  }
  ctx.fillStyle = p.foam;
  for (let x = 0; x < W; x += 6) {
    const wy =
      sandTop -
      2 +
      Math.round(Math.sin(x * 0.08 + t * 1.8) * 1.4) +
      (waveShift > 0 ? 1 : 0);
    ctx.fillRect(x, wy, 5, 1);
    if ((x / 6) % 2 === 0) {
      ctx.fillRect(x + 2, wy + 2, 4, 1);
    }
  }

  // 10. Foreground pixel palm silhouettes swaying gently (left & right)
  const sway = Math.round(Math.sin(t * 1.3) * 1.6);
  drawCoastPalm(ctx, 18, H, -1, sway, p.palm, p.palmHi);
  drawCoastPalm(ctx, W - 16, H, 1, -sway, p.palm, p.palmHi);

  // Warm beach lantern pixel glow at sunset/night
  if (mood === "night" || mood === "sunset") {
    const lx = W - 46;
    const ly = 117;
    ctx.fillStyle = "rgba(255, 206, 107, 0.25)";
    ctx.fillRect(lx - 4, ly - 4, 9, 9);
    ctx.fillStyle = "#ffe08a";
    ctx.fillRect(lx - 1, ly - 1, 3, 3);
  }

  // Tiny pixel seagull gliding high in sky
  const gx = Math.floor((t * 7 + 40) % (W + 30)) - 15;
  const gy = 34 + Math.round(Math.sin(t * 2.5) * 2);
  const wingUp = Math.sin(t * 5.2) > 0;
  ctx.fillStyle = mood === "night" ? "#93c5fd" : "#222038";
  ctx.fillRect(gx, gy, 2, 1);
  ctx.fillRect(gx - 2, wingUp ? gy - 1 : gy + 1, 2, 1);
  ctx.fillRect(gx + 2, wingUp ? gy - 1 : gy + 1, 2, 1);
}

/** A-5: Ghibli-inspired Summer Sea & Retro Coastal Train */
function drawCoastalTrainScene(
  ctx: CanvasRenderingContext2D,
  mood: ResolvedChillMood,
  t: number,
  opts: PixelSceneRenderOptions
): void {
  const m = SUMMER_PALETTES[mood];
  const isNight = mood === "night";
  const horizon = 104;

  drawSkyBands(ctx, m.sky, horizon, m.stars, isNight, m.sunX, m.sunY, m.sun, m.sunRing, t);

  const drawBigCumulus = (cx: number, cy: number) => {
    px(ctx, cx - 26, cy + 18, 72, 10, m.cloudShade);
    px(ctx, cx - 22, cy + 8, 64, 14, m.cloud);
    px(ctx, cx - 14, cy - 4, 46, 16, m.cloud);
    px(ctx, cx - 4, cy - 14, 28, 14, m.cloud);
    px(ctx, cx + 18, cy + 2, 24, 12, m.cloud);
  };
  drawBigCumulus(((64 + t * 0.7) % (PIXEL_W + 100)) - 50, 54);
  drawBigCumulus(((230 + t * 0.5) % (PIXEL_W + 100)) - 50, 48);

  drawSeaBase(ctx, m.sea, horizon, 146, t, m.sunX, isNight);

  const yx = ((88 + t * 2.1) % (PIXEL_W - 40)) + 20;
  px(ctx, yx, horizon + 12, 10, 2, "#ffffff");
  px(ctx, yx + 4, horizon + 5, 4, 7, "#ffffff");

  // Seaside railway track & catenary poles
  px(ctx, 0, 134, PIXEL_W, 6, "#64748b");
  px(ctx, 0, 133, PIXEL_W, 2, "#cbd5e1");
  for (let x = 22; x < PIXEL_W; x += 64) {
    px(ctx, x, 114, 2, 20, "#475569");
    px(ctx, x - 3, 115, 8, 2, "#475569");
  }
  px(ctx, 0, 116, PIXEL_W, 1, "rgba(71, 85, 105, 0.55)");

  // Moving 2-car cream & emerald retro tram
  const trainX = Math.floor((t * 22) % (PIXEL_W + 140)) - 110;
  const winCol = m.isWarmLight ? "#fde047" : "#38bdf8";
  const drawCar = (cx: number) => {
    px(ctx, cx, 122, 42, 11, "#f8fafc");
    px(ctx, cx, 128, 42, 5, "#10b981");
    px(ctx, cx + 1, 121, 40, 2, "#94a3b8");
    for (let wx = 4; wx < 36; wx += 8) px(ctx, cx + wx, 124, 5, 4, winCol);
    px(ctx, cx + 6, 133, 4, 2, "#1e293b");
    px(ctx, cx + 32, 133, 4, 2, "#1e293b");
  };
  drawCar(trainX);
  px(ctx, trainX + 42, 126, 4, 5, "#334155");
  drawCar(trainX + 46);

  // Grassy wildflower hill foreground
  const g1 = isNight ? "#14453a" : "#22a055";
  const g2 = isNight ? "#1e5c4a" : "#4ade80";
  const g3 = isNight ? "#0f332c" : "#15803d";
  px(ctx, 0, 140, PIXEL_W, 40, g1);
  for (let x = 0; x < PIXEL_W; x += 4) {
    const swayY = Math.round(Math.sin(x * 0.14 + t * 2.5) * 1.2);
    px(ctx, x, 139 + swayY, 4, 4, g2);
  }
  px(ctx, 0, 158, PIXEL_W, 22, g3);

  for (let x = 10; x < PIXEL_W; x += 22) px(ctx, x, 140, 2, 10, "#f8fafc");
  px(ctx, 0, 143, PIXEL_W, 2, "#f8fafc");
  px(ctx, 0, 147, PIXEL_W, 1, "#e2e8f0");

  const flowerCols = ["#fde047", "#ffffff", "#fb7185", "#fef08a"];
  for (let i = 0; i < 28; i++) {
    const fx = ((i * 19 + 7) % (PIXEL_W - 8)) + 4;
    const fy = 152 + ((i * 13) % 22);
    const sw = Math.round(Math.sin(t * 2.6 + i) * 0.8);
    px(ctx, fx + sw, fy, 2, 2, flowerCols[i % flowerCols.length]);
  }

  if (opts.monsters) {
    drawSummerMonster(ctx, 76, 150, "#38bdf8", "#e0f2fe", false, t, true);
    drawSummerMonster(ctx, 94, 152, "#fb923c", "#ffedd5", true, t + 1, false);
  }
  drawSeagull(ctx, ((t * 13 + 30) % (PIXEL_W + 40)) - 20, 40, t, 0, isNight);
  drawSeagull(ctx, ((t * 11 + 190) % (PIXEL_W + 40)) - 20, 54, t, 2.4, isNight);
}

/** S-1: Jungfrau-inspired Natural Alpine Massif, Red Gondola & Warm Chalet */
function drawAlpineChaletScene(
  ctx: CanvasRenderingContext2D,
  mood: ResolvedChillMood,
  t: number,
  opts: PixelSceneRenderOptions,
  cacheHolder?: ChillStaticCacheHolder
): void {
  const m = WINTER_PALETTES[mood];
  const isNight = mood === "night";
  const sunRight = mood !== "golden";

  drawSkyBands(ctx, m.sky, 120, m.stars, isNight, m.sunX, m.sunY, m.sun, m.sunRing, t);
  if (m.aurora) drawAuroraCurtains(ctx, t, 0.9);
  if (!isNight) {
    drawFluffyCloud(ctx, ((30 + t * 1.1) % (PIXEL_W + 70)) - 45, 22, 1.05, m.cloud, m.cloudShade);
    drawFluffyCloud(ctx, ((175 + t * 0.7) % (PIXEL_W + 70)) - 45, 16, 1.25, m.cloud, m.cloudShade);
  }

  const drawStaticTerrain = (target: CanvasRenderingContext2D) => {
    drawNaturalMassif(
      target,
      [
        [0, 74], [48, 56], [108, 66], [176, 48], [228, 64], [278, 52], [320, 68],
      ],
      126,
      m,
      { cragAmp: 4, seed: 11, sunFromRight: sunRight, isFar: true }
    );

    drawNaturalMassif(
      target,
      [
        [0, 62], [28, 54], [56, 36], [82, 24], [102, 46], [134, 58],
        [168, 44], [196, 52], [230, 78], [274, 86], [320, 64],
      ],
      126,
      m,
      { cragAmp: 5.5, seed: 23, sunFromRight: sunRight, snowBias: 0.56 }
    );
    drawValleyMist(target, 102, 22, m.mist);

    // Gondola cable line
    for (let x = 0; x < PIXEL_W; x += 2) {
      const p = x / PIXEL_W;
      const y = 64 + 50 * p + Math.sin(p * Math.PI) * 9;
      px(target, x, y, 2, 1, "rgba(30, 41, 59, 0.5)");
    }

    // Rolling snowy alpine meadow & pines
    px(target, 0, 122, PIXEL_W, 58, m.snowGround[1]);
    for (let x = 0; x < PIXEL_W; x += 4) {
      const slope = Math.round(118 + Math.sin(x * 0.015) * 6 - (x / PIXEL_W) * 6);
      px(target, x, slope, 4, 22, m.snowGround[0]);
    }
    px(target, 0, 154, PIXEL_W, 26, m.snowGround[2]);

    const backPines = [16, 34, 52, 70, 134, 152, 276, 296];
    backPines.forEach((bx, i) =>
      drawSnowPine(target, bx, 134 + (i % 3) * 5, 14 + (i % 3) * 3, m)
    );

    // Chalet structure & snowman
    const cx = 190;
    const cy = 112;
    px(target, cx + 42, cy - 12, 7, 16, "#7c2d12");
    px(target, cx, cy + 8, 56, 26, "#8a5230");
    for (let ly = cy + 11; ly < cy + 34; ly += 4) px(target, cx, ly, 56, 1, "#6b3d22");
    px(target, cx - 2, cy + 31, 60, 5, "#64748b");
    px(target, cx - 4, cy + 35, 64, 7, "rgba(253, 224, 71, 0.22)");
    px(target, cx + 7, cy + 13, 11, 10, "#fde047");
    px(target, cx + 7, cy + 17, 11, 1, "#78350f");
    px(target, cx + 12, cy + 13, 1, 10, "#78350f");
    px(target, cx + 38, cy + 13, 11, 10, "#fde047");
    px(target, cx + 38, cy + 17, 11, 1, "#78350f");
    px(target, cx + 43, cy + 13, 1, 10, "#78350f");
    px(target, cx + 23, cy + 18, 10, 15, "#5c3018");
    px(target, cx + 25, cy + 20, 6, 5, "#fbbf24");
    for (let r = 0; r < 15; r++) {
      const rw = 70 - r * 4;
      px(target, cx + 28 - rw / 2, cy + 9 - r, rw, 2, "#5c3420");
      px(target, cx + 28 - rw / 2 + 1, cy + 7 - r, Math.max(4, rw - 2), 2, "#ffffff");
    }

    px(target, 90, 147, 12, 10, "#ffffff");
    px(target, 92, 139, 8, 8, "#ffffff");
    px(target, 91, 146, 10, 2, "#ef4444");
    px(target, 94, 141, 1, 1, "#0f172a");
    px(target, 97, 141, 1, 1, "#0f172a");
    px(target, 96, 142, 3, 1, "#f97316");
    px(target, 92, 136, 8, 3, "#1e293b");
    px(target, 90, 138, 12, 1, "#1e293b");

    drawSnowPine(target, 14, 170, 22, m);
    drawSnowPine(target, 306, 170, 22, m);
    return undefined;
  };

  const cached = getOrBakeStaticLayer(
    cacheHolder,
    `alpine_chalet:${mood}`,
    PIXEL_W,
    PIXEL_H,
    drawStaticTerrain
  );
  if (cached) {
    ctx.drawImage(cached.canvas, 0, 0);
  } else {
    drawStaticTerrain(ctx);
  }

  // Animated overlay elements only (~150 fillRects): gondolas, chimney smoke, fairy lights, monsters, snow
  for (const offset of [0.12, 0.62]) {
    const p = (t * 0.04 + offset) % 1;
    const gx = PIXEL_W * p;
    const gy = 64 + 50 * p + Math.sin(p * Math.PI) * 9;
    px(ctx, gx, gy, 1, 6, "#334155");
    px(ctx, gx - 5, gy + 5, 11, 7, "#dc2626");
    px(ctx, gx - 4, gy + 6, 9, 3, "#fef08a");
    px(ctx, gx - 5, gy + 4, 11, 2, "#f8fafc");
  }

  const cx = 190;
  const cy = 112;
  for (let i = 0; i < 6; i++) {
    const prog = (t * 0.42 + i * 0.17) % 1;
    const smX = cx + 44 + Math.sin(prog * 5 + t) * 5 + prog * 12;
    const smY = cy - 14 - prog * 28;
    const sz = Math.round(3 + prog * 4);
    px(ctx, smX, smY, sz, sz - 1, `rgba(255, 255, 255, ${(0.65 * (1 - prog)).toFixed(2)})`);
  }
  drawStringLights(ctx, cx - 5, cy + 10, cx + 61, cy + 10, 3, 9, t, true);

  if (opts.monsters) {
    drawWinterMonster(ctx, 112, 148, "#38bdf8", "#e0f2fe", "#f43f5e", t);
    drawWinterMonster(ctx, 164, 149, "#34d399", "#d1fae5", "#f59e0b", t + 1.2);
  }
  if (opts.snow) drawSnowfall(ctx, t);
}

/** S-3: Dolomites Glacier Gorge, Mirror Lake & Red Express Viaduct Train */
const EXPRESS_MAIN_RIDGE: ReadonlyArray<readonly [number, number]> = [
  [0, 32], [34, 42], [58, 62], [94, 76], [138, 66], [176, 36],
  [194, 28], [214, 44], [242, 34], [268, 56], [300, 64], [320, 48],
];

function drawGlacierExpressScene(
  ctx: CanvasRenderingContext2D,
  mood: ResolvedChillMood,
  t: number,
  opts: PixelSceneRenderOptions,
  cacheHolder?: ChillStaticCacheHolder
): void {
  const m = WINTER_PALETTES[mood];
  const isNight = mood === "night";
  const sunRight = mood !== "golden";
  const lakeTop = 104;
  const lakeBot = 152;

  drawSkyBands(ctx, m.sky, lakeTop + 4, m.stars, isNight, m.sunX, m.sunY, m.sun, m.sunRing, t);
  if (m.aurora) drawAuroraCurtains(ctx, t, 0.9);
  if (!isNight) {
    drawFluffyCloud(ctx, ((34 + t * 1.0) % (PIXEL_W + 70)) - 45, 20, 1.05, m.cloud, m.cloudShade);
    drawFluffyCloud(ctx, ((185 + t * 0.7) % (PIXEL_W + 70)) - 45, 16, 1.2, m.cloud, m.cloudShade);
  }

  const drawStaticPeaksAndLake = (target: CanvasRenderingContext2D) => {
    drawNaturalMassif(
      target,
      [
        [0, 62], [58, 48], [116, 62], [178, 38], [218, 50], [274, 44], [320, 60],
      ],
      lakeTop + 2,
      m,
      { cragAmp: 4.5, seed: 71, sunFromRight: sunRight, isFar: true }
    );

    drawNaturalMassif(target, EXPRESS_MAIN_RIDGE, lakeTop + 2, m, {
      cragAmp: 6.5,
      seed: 83,
      sunFromRight: sunRight,
      snowBias: 0.48,
    });
    drawValleyMist(target, 86, 18, m.mist);

    // Base glacial lake bands
    const bands = m.lake.length;
    for (let i = 0; i < bands; i++) {
      const y0 = lakeTop + Math.floor((i * (lakeBot - lakeTop)) / bands);
      const y1 = lakeTop + Math.ceil(((i + 1) * (lakeBot - lakeTop)) / bands);
      px(target, 0, y0, PIXEL_W, y1 - y0, m.lake[i]);
    }

    // Precompute ridge heights once for O(1) animated lake reflections
    const ridgeHeights = new Int16Array(PIXEL_W);
    for (let x = 0; x < PIXEL_W; x++) {
      ridgeHeights[x] = sampleRidgeProfile(EXPRESS_MAIN_RIDGE, x, 5, 83);
    }
    return ridgeHeights;
  };

  const cached = getOrBakeStaticLayer(
    cacheHolder,
    `glacier_express:${mood}`,
    PIXEL_W,
    PIXEL_H,
    drawStaticPeaksAndLake
  );
  let ridgeHeights: Int16Array | undefined;
  if (cached) {
    ctx.drawImage(cached.canvas, 0, 0);
    ridgeHeights = cached.ridgeHeights;
  } else {
    ridgeHeights = drawStaticPeaksAndLake(ctx);
  }

  // Rippled lake reflection using precomputed ridge heights (zero noise math per frame!)
  for (let y = lakeTop + 2; y < lakeBot - 6; y += 3) {
    const depth = y - lakeTop;
    const mirrorY = lakeTop - depth * 1.4;
    const drift = Math.round(Math.sin(t * 2 + y * 0.45) * 2.5);
    for (let x = 0; x < PIXEL_W; x += 4) {
      const ridgeY = ridgeHeights
        ? ridgeHeights[x]
        : sampleRidgeProfile(EXPRESS_MAIN_RIDGE, x, 5, 83);
      if (ridgeY < mirrorY) {
        px(ctx, x + drift, y, 4, 1, "rgba(224, 244, 255, 0.2)");
      }
    }
  }

  // Stone viaduct bridge
  const bridgeY = 114;
  px(ctx, 0, bridgeY, PIXEL_W, 6, "#94a3b8");
  px(ctx, 0, bridgeY - 1, PIXEL_W, 2, "#ffffff");
  for (let ax = 12; ax < PIXEL_W; ax += 38) {
    px(ctx, ax, bridgeY + 5, 10, 28, "#64748b");
    px(ctx, ax + 1, bridgeY + 5, 3, 28, "#94a3b8");
    px(ctx, ax + 10, bridgeY + 5, 28, 4, "#64748b");
    px(ctx, ax + 10, bridgeY + 9, 4, 4, "#64748b");
    px(ctx, ax + 34, bridgeY + 9, 4, 4, "#64748b");
  }

  // Red 3-car panoramic Glacier Express train
  const tx = Math.floor((t * 24) % (PIXEL_W + 180)) - 150;
  const drawRedCar = (cx: number, isEngine: boolean) => {
    px(ctx, cx, bridgeY - 11, 40, 10, "#dc2626");
    px(ctx, cx, bridgeY - 12, 40, 2, "#f8fafc");
    px(ctx, cx, bridgeY - 3, 40, 2, "#991b1b");
    for (let wx = 4; wx < 34; wx += 8) px(ctx, cx + wx, bridgeY - 9, 6, 5, "#fef08a");
    if (isEngine) {
      px(ctx, cx + 40, bridgeY - 7, 16, 4, "rgba(254, 240, 138, 0.28)");
      px(ctx, cx + 39, bridgeY - 6, 2, 2, "#ffffff");
    }
    px(ctx, cx + 6, bridgeY - 1, 4, 2, "#1e293b");
    px(ctx, cx + 30, bridgeY - 1, 4, 2, "#1e293b");
  };
  drawRedCar(tx, false);
  px(ctx, tx + 40, bridgeY - 8, 3, 5, "#334155");
  drawRedCar(tx + 43, false);
  px(ctx, tx + 83, bridgeY - 8, 3, 5, "#334155");
  drawRedCar(tx + 86, true);

  // Cliffside tunnel portal on far left
  px(ctx, 0, 74, 26, 46, m.rockShade);
  px(ctx, 0, 70, 20, 8, m.snowMid);
  px(ctx, 16, 98, 12, 16, "#1e293b");
  px(ctx, 15, 96, 14, 3, "#94a3b8");

  // Snowy foreground shore & lantern pier
  px(ctx, 0, 146, PIXEL_W, 34, m.snowGround[0]);
  px(ctx, 0, 158, PIXEL_W, 22, m.snowGround[1]);
  px(ctx, 222, 142, 48, 4, "#8a5a3c");
  px(ctx, 228, 146, 3, 8, "#5c3620");
  px(ctx, 260, 146, 3, 8, "#5c3620");
  px(ctx, 264, 132, 2, 12, "#475569");
  px(ctx, 260, 128, 10, 10, "rgba(253, 224, 71, 0.3)");
  px(ctx, 263, 131, 4, 4, "#fef08a");

  drawSnowPine(ctx, 20, 164, 22, m);
  drawSnowPine(ctx, 44, 156, 15, m);
  drawSnowPine(ctx, 300, 166, 22, m);

  if (opts.monsters) {
    drawWinterMonster(ctx, 74, 149, "#a78bfa", "#ede9fe", "#ef4444", t);
    drawWinterMonster(ctx, 244, 134, "#34d399", "#d1fae5", "#fbbf24", t + 1);
  }
  if (opts.snow) drawSnowfall(ctx, t);
}

export function drawChillPixelScene(
  ctx: CanvasRenderingContext2D,
  scene: PixelBackdropScene,
  mood: ResolvedChillMood,
  elapsedSec: number,
  opts: PixelSceneRenderOptions,
  cacheHolder?: ChillStaticCacheHolder
): void {
  switch (scene) {
    case "resort_beach":
      drawResortBeachScene(ctx, mood, elapsedSec, opts);
      break;
    case "coastal_train":
      drawCoastalTrainScene(ctx, mood, elapsedSec, opts);
      break;
    case "alpine_chalet":
      drawAlpineChaletScene(ctx, mood, elapsedSec, opts, cacheHolder);
      break;
    case "glacier_express":
      drawGlacierExpressScene(ctx, mood, elapsedSec, opts, cacheHolder);
      break;
  }
}
