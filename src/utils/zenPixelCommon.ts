import type { ResolvedChillMood } from "./zenChillBackdrop";

export const PIXEL_W = 320;
export const PIXEL_H = 180;

export interface SummerPalette {
  sky: string[];
  sea: string[];
  foam: string;
  sand: string[];
  sun: string;
  sunRing: string;
  cloud: string;
  cloudShade: string;
  leafDark: string;
  leafMid: string;
  leafHi: string;
  trunk: string;
  trunkHi: string;
  islandFar: string;
  islandNear: string;
  isWarmLight: boolean;
  stars: boolean;
  sunX: number;
  sunY: number;
}

export interface WinterPalette {
  sky: string[];
  farRidge: string;
  farSnow: string;
  snowLit: string;
  snowMid: string;
  rockLit: string;
  rockShade: string;
  rockDeep: string;
  mist: string;
  snowGround: string[];
  pineDark: string;
  pineMid: string;
  pineSnow: string;
  lake: string[];
  sun: string;
  sunRing: string;
  cloud: string;
  cloudShade: string;
  stars: boolean;
  aurora: boolean;
  sunX: number;
  sunY: number;
}

export const SUMMER_PALETTES: Record<ResolvedChillMood, SummerPalette> = {
  day: {
    sky: ["#1b7ed1", "#33a3e8", "#64c7f5", "#a3e4fc", "#dff8ff"],
    sea: ["#0b6fa6", "#118ec4", "#1db3d1", "#3ed1d9", "#87ebe4"],
    foam: "#f4ffff",
    sand: ["#f5deaa", "#ebd094", "#dbbc7c"],
    sun: "#fff9c4",
    sunRing: "rgba(255, 250, 200, 0.35)",
    cloud: "#ffffff",
    cloudShade: "#bce4f7",
    leafDark: "#166143",
    leafMid: "#228c56",
    leafHi: "#4cc26c",
    trunk: "#784e34",
    trunkHi: "#9e6b47",
    islandFar: "#4d9cb8",
    islandNear: "#2c826e",
    isWarmLight: false,
    stars: false,
    sunX: 256,
    sunY: 36,
  },
  golden: {
    sky: ["#2b7bc4", "#4fa4d9", "#87c9e6", "#cbe7dc", "#fce9c0"],
    sea: ["#116d9c", "#1c8eb3", "#2eb0c2", "#58ccc9", "#9be6d8"],
    foam: "#fffbf0",
    sand: ["#f2d399", "#e3be7d", "#cfa463"],
    sun: "#fff0b3",
    sunRing: "rgba(255, 232, 160, 0.38)",
    cloud: "#fffaf0",
    cloudShade: "#d9ccb8",
    leafDark: "#1d5c3b",
    leafMid: "#2e854d",
    leafHi: "#6ec263",
    trunk: "#73462c",
    trunkHi: "#9c6440",
    islandFar: "#598fa6",
    islandNear: "#37785f",
    isWarmLight: true,
    stars: false,
    sunX: 224,
    sunY: 50,
  },
  sunset: {
    sky: ["#312a6b", "#6b3975", "#b84e6f", "#eb7b5b", "#fcbd68", "#ffe49e"],
    sea: ["#2f2c63", "#5c366b", "#9c4b69", "#cf6e63", "#eda06b"],
    foam: "#ffe6c4",
    sand: ["#c98d6b", "#ab7058", "#8a5649"],
    sun: "#fff3bd",
    sunRing: "rgba(255, 205, 115, 0.42)",
    cloud: "#ffd9ad",
    cloudShade: "#c96e7a",
    leafDark: "#1f303b",
    leafMid: "#2e4f4f",
    leafHi: "#567d62",
    trunk: "#4a2c2a",
    trunkHi: "#704239",
    islandFar: "#6b436e",
    islandNear: "#422b4d",
    isWarmLight: true,
    stars: true,
    sunX: 162,
    sunY: 78,
  },
  night: {
    sky: ["#0b132b", "#132247", "#1b3363", "#23467d", "#2c5a94"],
    sea: ["#0c1d3d", "#112b54", "#173c6e", "#1f4f85", "#29659c"],
    foam: "#a5e1fa",
    sand: ["#57586b", "#454759", "#353747"],
    sun: "#f4f9ff",
    sunRing: "rgba(186, 226, 255, 0.30)",
    cloud: "#3b5f91",
    cloudShade: "#223b63",
    leafDark: "#0e292e",
    leafMid: "#184245",
    leafHi: "#2b6661",
    trunk: "#2c222e",
    trunkHi: "#473745",
    islandFar: "#1a3359",
    islandNear: "#132645",
    isWarmLight: true,
    stars: true,
    sunX: 242,
    sunY: 36,
  },
};

export const WINTER_PALETTES: Record<ResolvedChillMood, WinterPalette> = {
  day: {
    sky: ["#1b67b8", "#3b8fd6", "#74bdf2", "#b8e3fc", "#e8f6ff"],
    farRidge: "#8ab3db",
    farSnow: "#d6ebfc",
    snowLit: "#ffffff",
    snowMid: "#d9ecfc",
    rockLit: "#6c89ad",
    rockShade: "#3f5b82",
    rockDeep: "#2c4366",
    mist: "rgba(218, 240, 255, 0.36)",
    snowGround: ["#f5faff", "#e0eefc", "#c3dbf5"],
    pineDark: "#14453d",
    pineMid: "#1e6152",
    pineSnow: "#f2faff",
    lake: ["#166fa3", "#2391c2", "#43b2d9", "#7cd2eb"],
    sun: "#fffbe0",
    sunRing: "rgba(255, 250, 220, 0.35)",
    cloud: "#ffffff",
    cloudShade: "#c7e2f7",
    stars: false,
    aurora: false,
    sunX: 256,
    sunY: 30,
  },
  golden: {
    sky: ["#295c9c", "#528bc2", "#8abce0", "#cde0db", "#fcebc2"],
    farRidge: "#88a7c7",
    farSnow: "#f7ecd2",
    snowLit: "#fff8db",
    snowMid: "#f2deb3",
    rockLit: "#6f85a3",
    rockShade: "#485f82",
    rockDeep: "#304463",
    mist: "rgba(252, 238, 200, 0.30)",
    snowGround: ["#fffaf0", "#ebe4d8", "#cfd0e0"],
    pineDark: "#18453b",
    pineMid: "#266350",
    pineSnow: "#fff8eb",
    lake: ["#1f618f", "#3382ab", "#59a6c0", "#9ad0d4"],
    sun: "#fff5b8",
    sunRing: "rgba(255, 232, 160, 0.42)",
    cloud: "#fff8eb",
    cloudShade: "#d9ccb8",
    stars: false,
    aurora: false,
    sunX: 66,
    sunY: 38,
  },
  sunset: {
    sky: ["#2a2b63", "#5d4382", "#a85f89", "#e38c94", "#fcc4a4", "#ffe4c7"],
    farRidge: "#8e6e9e",
    farSnow: "#f5c4cc",
    snowLit: "#ffe3d1",
    snowMid: "#f0b4bc",
    rockLit: "#7c5e8a",
    rockShade: "#4b3b69",
    rockDeep: "#32274d",
    mist: "rgba(252, 206, 200, 0.28)",
    snowGround: ["#fce8e8", "#e6c7d9", "#c2a1c4"],
    pineDark: "#1a2b3d",
    pineMid: "#284359",
    pineSnow: "#fce6ec",
    lake: ["#3a3a70", "#684b82", "#a36a90", "#d998a2"],
    sun: "#fff0c4",
    sunRing: "rgba(255, 200, 165, 0.38)",
    cloud: "#ffe0d6",
    cloudShade: "#c4849c",
    stars: true,
    aurora: false,
    sunX: 232,
    sunY: 50,
  },
  night: {
    sky: ["#060c1f", "#0b1736", "#11244d", "#173663", "#1e4875"],
    farRidge: "#1d3861",
    farSnow: "#6b99c4",
    snowLit: "#d6f2ff",
    snowMid: "#8bb8de",
    rockLit: "#2e4d7a",
    rockShade: "#192f52",
    rockDeep: "#0e1d38",
    mist: "rgba(82, 168, 214, 0.16)",
    snowGround: ["#bfdcf2", "#96b9d9", "#7094ba"],
    pineDark: "#0a2229",
    pineMid: "#123840",
    pineSnow: "#c7e6fa",
    lake: ["#0a1a38", "#102a52", "#17406b", "#225882"],
    sun: "#f0f9ff",
    sunRing: "rgba(186, 230, 253, 0.30)",
    cloud: "#2d4c78",
    cloudShade: "#182d4f",
    stars: true,
    aurora: true,
    sunX: 256,
    sunY: 32,
  },
};

const STARS = Array.from({ length: 52 }, (_, i) => ({
  x: (i * 71 + 13) % PIXEL_W,
  y: (i * 31 + 5) % 82,
  phase: i * 0.8,
  big: i % 7 === 0,
}));

const SNOWFLAKES = Array.from({ length: 44 }, (_, i) => ({
  x: (i * 53 + 11) % PIXEL_W,
  y: (i * 37 + 7) % PIXEL_H,
  speed: 7 + (i % 5) * 3.2,
  drift: 0.6 + (i % 4) * 0.45,
  size: i % 5 === 0 ? 2 : 1,
  phase: i * 1.1,
}));

export function px(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string
): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function hash1(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function noise1(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash1(i) * (1 - u) + hash1(i + 1) * u;
}

export function sampleRidgeProfile(
  points: ReadonlyArray<readonly [number, number]>,
  x: number,
  cragAmp: number,
  seed: number
): number {
  let base = points[points.length - 1][1];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    if (x >= x0 && x <= x1) {
      const u = (x - x0) / Math.max(1, x1 - x0);
      const smooth = u * u * (3 - 2 * u);
      const blend = u * 0.6 + smooth * 0.4;
      base = y0 + (y1 - y0) * blend;
      break;
    }
  }
  const crag =
    (noise1(x * 0.09 + seed) - 0.5) * cragAmp +
    (noise1(x * 0.24 + seed * 2.3) - 0.5) * (cragAmp * 0.45);
  return Math.round(base + crag);
}

export function drawSkyBands(
  ctx: CanvasRenderingContext2D,
  sky: string[],
  horizon: number,
  stars: boolean,
  isNight: boolean,
  sunX: number,
  sunY: number,
  sun: string,
  sunRing: string,
  t: number
): void {
  const bands = sky.length;
  const bh = horizon / bands;
  for (let i = 0; i < bands; i++) {
    const y0 = Math.floor(i * bh);
    const y1 = Math.ceil((i + 1) * bh);
    px(ctx, 0, y0, PIXEL_W, y1 - y0, sky[i]);
    if (i < bands - 1) {
      ctx.fillStyle = sky[i + 1];
      for (let x = 0; x < PIXEL_W; x += 2) {
        ctx.fillRect(x + (i % 2), y1 - 2, 1, 1);
      }
    }
  }
  if (stars) {
    for (const s of STARS) {
      const a = isNight
        ? 0.45 + 0.55 * Math.sin(t * 2 + s.phase)
        : 0.18 + 0.28 * Math.sin(t * 1.8 + s.phase);
      px(
        ctx,
        s.x,
        s.y,
        s.big ? 2 : 1,
        s.big ? 2 : 1,
        `rgba(255,253,240,${a.toFixed(2)})`
      );
    }
  }
  px(ctx, sunX - 14, sunY - 10, 28, 20, sunRing);
  px(ctx, sunX - 10, sunY - 14, 20, 28, sunRing);
  px(ctx, sunX - 7, sunY - 5, 14, 10, sun);
  px(ctx, sunX - 5, sunY - 7, 10, 14, sun);
  if (isNight) {
    px(ctx, sunX - 1, sunY - 6, 7, 8, sky[1]);
  }
}

export function drawAuroraCurtains(
  ctx: CanvasRenderingContext2D,
  t: number,
  intensity = 1
): void {
  const bands = [
    {
      baseY: 22,
      amp: 11,
      col: `rgba(52, 211, 153, ${(0.28 * intensity).toFixed(2)})`,
      hi: `rgba(110, 231, 183, ${(0.44 * intensity).toFixed(2)})`,
      speed: 0.7,
    },
    {
      baseY: 36,
      amp: 9,
      col: `rgba(56, 189, 248, ${(0.22 * intensity).toFixed(2)})`,
      hi: `rgba(167, 139, 250, ${(0.28 * intensity).toFixed(2)})`,
      speed: -0.5,
    },
  ];
  for (const b of bands) {
    for (let x = 0; x < PIXEL_W; x += 3) {
      const wave =
        Math.sin(x * 0.028 + t * b.speed) * b.amp +
        Math.cos(x * 0.015 - t * 0.4) * 5;
      const yTop = Math.round(b.baseY + wave);
      const curtainH = 18 + Math.round(Math.sin(x * 0.05 + t * 1.4) * 7);
      px(ctx, x, yTop, 3, curtainH, b.col);
      px(ctx, x, yTop + curtainH - 4, 3, 4, b.hi);
    }
  }
}

export function drawFluffyCloud(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  cloud: string,
  shade: string
): void {
  const w = Math.round(36 * scale);
  px(ctx, x, y + 6, w, 4, shade);
  px(ctx, x + 2, y + 2, w - 4, 6, cloud);
  px(ctx, x + 7, y - 3, Math.round(w * 0.45), 6, cloud);
  px(ctx, x + Math.round(w * 0.42), y - 6, Math.round(w * 0.34), 9, cloud);
  px(ctx, x + Math.round(w * 0.65), y - 1, Math.round(w * 0.25), 5, cloud);
}

export function drawSeaBase(
  ctx: CanvasRenderingContext2D,
  sea: string[],
  topY: number,
  bottomY: number,
  t: number,
  shimmerX: number,
  isNight: boolean
): void {
  const bands = sea.length;
  const sh = bottomY - topY;
  for (let i = 0; i < bands; i++) {
    const y0 = topY + Math.floor((i * sh) / bands);
    const y1 = topY + Math.ceil(((i + 1) * sh) / bands);
    px(ctx, 0, y0, PIXEL_W, y1 - y0, sea[i]);
  }
  const shimmerCol = isNight
    ? "rgba(205,236,255,0.52)"
    : "rgba(255,246,196,0.62)";
  for (let row = topY + 3; row < bottomY - 4; row += 4) {
    const ratio = (row - topY) / sh;
    for (let k = 0; k < 7; k++) {
      const gx =
        ((row * 31 + k * 53 + Math.floor(t * (3 + (k % 3)))) % (PIXEL_W - 12)) +
        6;
      const gw = 3 + ((row + k) % 5);
      px(ctx, gx, row, gw, 1, "rgba(255, 255, 255, 0.24)");
    }
    const maxW = Math.floor(14 + ratio * 26);
    const drift = Math.round(Math.sin(t * 2.2 + row * 0.5) * 3);
    const sw = Math.max(
      5,
      Math.floor(maxW * (0.55 + 0.45 * Math.sin(t * 2.8 + row)))
    );
    px(ctx, shimmerX - sw / 2 + drift, row, sw, 1, shimmerCol);
  }
}

export function drawPixelHill(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  halfW: number,
  height: number,
  col: string
): void {
  ctx.fillStyle = col;
  for (let dy = 0; dy < height; dy++) {
    const span = Math.floor(
      halfW * Math.sqrt(1 - (dy / height) * (dy / height))
    );
    ctx.fillRect(Math.round(cx - span), Math.round(baseY - dy - 1), span * 2, 1);
  }
}

export function drawNaturalMassif(
  ctx: CanvasRenderingContext2D,
  points: ReadonlyArray<readonly [number, number]>,
  baseY: number,
  m: WinterPalette,
  opts: {
    cragAmp?: number;
    seed?: number;
    sunFromRight?: boolean;
    isFar?: boolean;
    snowBias?: number;
  }
): void {
  const {
    cragAmp = 5,
    seed = 1,
    sunFromRight = true,
    isFar = false,
    snowBias = 0.52,
  } = opts;

  const heights = new Int16Array(PIXEL_W);
  for (let x = 0; x < PIXEL_W; x++) {
    heights[x] = sampleRidgeProfile(points, x, cragAmp, seed);
  }

  for (let x = 0; x < PIXEL_W; x++) {
    const topY = heights[x];
    if (topY >= baseY) continue;
    const prevY = heights[Math.max(0, x - 3)];
    const nextY = heights[Math.min(PIXEL_W - 1, x + 3)];
    const slope = nextY - prevY;

    if (isFar) {
      px(ctx, x, topY, 1, baseY - topY, m.farRidge);
      const litSide = sunFromRight ? slope >= -1 : slope <= 1;
      const snowDepth = Math.round(
        (litSide ? 11 : 4) + noise1(x * 0.12 + seed) * 6
      );
      px(ctx, x, topY, 1, Math.min(snowDepth, baseY - topY), m.farSnow);
      continue;
    }

    const spurWave = Math.sin(x * 0.055 + seed) * 2.2;
    const sunFacing = sunFromRight
      ? slope + spurWave >= 0
      : -slope + spurWave >= 0;
    const totalH = baseY - topY;

    for (let y = topY; y < baseY; y += 2) {
      const depth = y - topY;
      const depthRatio = depth / Math.max(1, totalH);
      const diagX = x + (sunFromRight ? depth * 0.55 : -depth * 0.55);
      const gully = noise1(diagX * 0.08 + seed * 3.1);
      const strata = noise1(x * 0.14 + y * 0.09 + seed * 5.7);

      const snowThreshold =
        snowBias + (sunFacing ? 0.22 : -0.18) - depthRatio * 0.36;
      const isSnow = depth < 4 || gully < snowThreshold;

      let col: string;
      if (isSnow) {
        if (sunFacing) {
          col = depth < 8 || strata > 0.42 ? m.snowLit : m.snowMid;
        } else {
          col = depth < 5 || gully < snowThreshold - 0.14 ? m.snowMid : m.rockLit;
        }
      } else if (sunFacing) {
        col = strata > 0.5 ? m.rockLit : m.rockShade;
      } else {
        col = strata > 0.56 ? m.rockShade : m.rockDeep;
      }
      px(ctx, x, y, 1, 2, col);
    }
  }
}

export function drawValleyMist(
  ctx: CanvasRenderingContext2D,
  yStart: number,
  height: number,
  mistColor: string
): void {
  for (let dy = 0; dy < height; dy += 2) {
    const p = dy / height;
    const alpha = Math.sin(p * Math.PI);
    if (alpha > 0.15) {
      ctx.fillStyle = mistColor;
      ctx.globalAlpha = alpha * 0.65;
      ctx.fillRect(0, Math.round(yStart + dy), PIXEL_W, 2);
    }
  }
  ctx.globalAlpha = 1;
}

export function drawLushPalm(
  ctx: CanvasRenderingContext2D,
  baseX: number,
  baseY: number,
  leanDir: number,
  heightSteps: number,
  sway: number,
  m: SummerPalette,
  hasCoconuts: boolean
): void {
  let tx = baseX;
  let ty = baseY;
  for (let i = 0; i < heightSteps; i++) {
    const prog = i / heightSteps;
    const x = baseX + leanDir * Math.sin(prog * 1.35) * 18 + sway * prog;
    const y = baseY - i * 2.1;
    const thick = Math.max(3, Math.round(6 - prog * 2.5));
    px(ctx, x - thick / 2, y, thick, 3, m.trunk);
    if (i % 2 === 0) px(ctx, x - thick / 2 + 1, y, 1, 2, m.trunkHi);
    tx = x;
    ty = y;
  }
  const fronds = [
    { a: -2.75, len: 24 },
    { a: -2.15, len: 26 },
    { a: -1.45, len: 22 },
    { a: -0.75, len: 25 },
    { a: -0.15, len: 24 },
    { a: 0.45, len: 20 },
    { a: 2.55, len: 19 },
  ];
  for (const f of fronds) {
    for (let r = 0; r < f.len; r++) {
      const p = r / f.len;
      const fx = tx + Math.cos(f.a) * r * 1.15 + sway * p * 1.1;
      const fy = ty + Math.sin(f.a) * r * 0.72 + p * p * 12;
      px(ctx, fx, fy, 3, 2, m.leafDark);
      px(ctx, fx, fy - 1, 2, 2, p < 0.55 ? m.leafHi : m.leafMid);
    }
  }
  if (hasCoconuts) {
    px(ctx, tx - 2, ty + 2, 3, 3, "#5c3620");
    px(ctx, tx + 1, ty + 3, 3, 3, "#6e4228");
    px(ctx, tx - 1, ty + 4, 2, 2, "#875335");
  }
}

export function drawSnowPine(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  size: number,
  m: WinterPalette
): void {
  px(ctx, cx - 1, baseY - 4, 3, 5, "#5c3d2e");
  for (let i = 0; i < 4; i++) {
    const ty = baseY - 4 - i * Math.round(size * 0.34);
    const tw = Math.round(size * (1 - i * 0.22));
    const th = Math.round(size * 0.44);
    for (let dy = 0; dy < th; dy++) {
      const w = Math.max(2, Math.round((dy / th) * tw));
      px(ctx, cx - w / 2, ty - th + dy, w, 1, dy % 2 === 0 ? m.pineMid : m.pineDark);
    }
    const capW = Math.max(2, Math.round(tw * 0.65));
    px(ctx, cx - capW / 2, ty - th + 1, capW, 2, m.pineSnow);
    px(ctx, cx - capW / 2 + 1, ty - th, Math.max(1, capW - 2), 1, m.pineSnow);
  }
}

export function drawStringLights(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  sag: number,
  count: number,
  t: number,
  lit: boolean
): void {
  for (let i = 0; i <= 26; i++) {
    const p = i / 26;
    px(
      ctx,
      x1 + (x2 - x1) * p,
      y1 + (y2 - y1) * p + Math.sin(p * Math.PI) * sag,
      1,
      1,
      "rgba(35, 32, 48, 0.7)"
    );
  }
  const colors = ["#fde047", "#fdba74", "#fca5a5", "#a7f3d0", "#fef08a"];
  for (let i = 1; i < count; i++) {
    const p = i / count;
    const x = x1 + (x2 - x1) * p;
    const y = y1 + (y2 - y1) * p + Math.sin(p * Math.PI) * sag + 1;
    const c = colors[i % colors.length];
    if (lit) {
      const tw = 0.24 + 0.14 * Math.sin(t * 3.4 + i * 1.3);
      px(ctx, x - 2, y - 2, 5, 5, `rgba(255, 224, 130, ${tw.toFixed(2)})`);
    }
    px(ctx, x, y, 2, 2, c);
  }
}

export function drawSummerMonster(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  bodyColor: string,
  bellyColor: string,
  hasDrink: boolean,
  t: number,
  withShades: boolean
): void {
  const bob = Math.round(Math.sin(t * 2.8 + x) * 0.8);
  const my = y + bob;
  px(ctx, x - 4, y + 8, 10, 2, "rgba(0,0,0,0.22)");
  px(ctx, x - 2, my - 3, 1, 3, bodyColor);
  px(ctx, x + 3, my - 3, 1, 3, bodyColor);
  px(ctx, x - 3, my - 4, 2, 2, "#fde047");
  px(ctx, x + 3, my - 4, 2, 2, "#fde047");
  px(ctx, x - 4, my, 10, 7, bodyColor);
  px(ctx, x - 3, my - 1, 8, 9, bodyColor);
  px(ctx, x - 2, my + 3, 6, 4, bellyColor);
  if (withShades) {
    px(ctx, x - 3, my + 1, 8, 2, "#0f172a");
    px(ctx, x - 2, my + 1, 2, 1, "#38bdf8");
    px(ctx, x + 2, my + 1, 2, 1, "#38bdf8");
  } else {
    px(ctx, x - 2, my + 1, 2, 2, "#0f172a");
    px(ctx, x + 2, my + 1, 2, 2, "#0f172a");
    px(ctx, x - 2, my + 1, 1, 1, "#ffffff");
    px(ctx, x + 2, my + 1, 1, 1, "#ffffff");
  }
  px(ctx, x - 3, my + 3, 1, 1, "#fb7185");
  px(ctx, x + 4, my + 3, 1, 1, "#fb7185");
  px(ctx, x, my + 4, 2, 1, "#0f172a");
  const wave = Math.sin(t * 4 + x) > 0 ? -1 : 0;
  px(ctx, x + 6, my + 2 + wave, 2, 2, bodyColor);
  if (hasDrink) {
    px(ctx, x + 7, my - 1 + wave, 2, 3, "#fb923c");
    px(ctx, x + 8, my - 3 + wave, 1, 2, "#f43f5e");
  }
}

export function drawWinterMonster(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  bodyCol: string,
  bellyCol: string,
  beanieCol: string,
  t: number
): void {
  const bob = Math.round(Math.sin(t * 2.6 + x) * 0.7);
  const my = y + bob;
  px(ctx, x - 4, y + 8, 10, 2, "rgba(15, 23, 42, 0.2)");
  px(ctx, x - 4, my, 10, 7, bodyCol);
  px(ctx, x - 3, my - 1, 8, 9, bodyCol);
  px(ctx, x - 2, my + 3, 6, 4, bellyCol);
  px(ctx, x - 4, my + 4, 10, 2, "#ef4444");
  px(ctx, x + 3, my + 6, 2, 3, "#dc2626");
  px(ctx, x - 3, my - 3, 8, 3, beanieCol);
  px(ctx, x - 2, my - 4, 6, 2, beanieCol);
  px(ctx, x, my - 6, 2, 2, "#ffffff");
  px(ctx, x - 2, my + 1, 2, 2, "#0f172a");
  px(ctx, x + 2, my + 1, 2, 2, "#0f172a");
  px(ctx, x - 2, my + 1, 1, 1, "#ffffff");
  px(ctx, x + 2, my + 1, 1, 1, "#ffffff");
  px(ctx, x - 3, my + 3, 1, 1, "#fb7185");
  px(ctx, x + 4, my + 3, 1, 1, "#fb7185");
  px(ctx, x + 6, my + 3, 3, 3, "#ffffff");
  px(ctx, x + 7, my + 1, 1, 2, "rgba(255,255,255,0.65)");
}

export function drawSeagull(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  t: number,
  phase: number,
  isNight: boolean
): void {
  const up = Math.sin(t * 5.4 + phase) > 0;
  const c = isNight ? "#bae6fd" : "#ffffff";
  px(ctx, x, y, 2, 1, c);
  px(ctx, x - 2, up ? y - 1 : y + 1, 2, 1, c);
  px(ctx, x + 2, up ? y - 1 : y + 1, 2, 1, c);
}

export function drawSnowfall(ctx: CanvasRenderingContext2D, t: number): void {
  for (const f of SNOWFLAKES) {
    const sx = (f.x + Math.sin(t * f.drift + f.phase) * 9 + PIXEL_W) % PIXEL_W;
    const sy = (f.y + t * f.speed) % PIXEL_H;
    px(ctx, sx, sy, f.size, f.size, "rgba(255, 255, 255, 0.85)");
  }
}
