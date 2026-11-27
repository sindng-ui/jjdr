import React, { useEffect, useRef, useState } from "react";
import {
  getPhotoObjectPosition,
  resolveEffectiveChillMood,
  type ChillBackdropConfig,
  type ResolvedChillMood,
} from "../../utils/zenChillBackdrop";
import {
  drawChillPixelScene,
  getScenePixelDimensions,
  type ChillStaticLayerCache,
  type PixelBackdropScene,
} from "../../utils/zenPixelScenes";
import { loadChillPhoto } from "../../utils/zenPhotoStore";

interface ZenChillBackdropCanvasProps {
  config: ChillBackdropConfig;
  photoVersion?: number;
}

const FRAME_INTERVAL_MS = 85; // ~12fps crisp pixel motion -> near-0% CPU/GPU

/**
 * Lazy-loaded, Zero-Blur backdrop layer for Zen Inbox All Clear / Time to Chill.
 * Renders either a 2D pixel art scene (12fps throttled, paused when hidden) or
 * the user's locally stored optimized HD photo from IndexedDB with smart scrim & framing.
 */
export const ZenChillBackdropCanvas = React.memo(function ZenChillBackdropCanvas({
  config,
  photoVersion = 0,
}: ZenChillBackdropCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const elapsedRef = useRef(0);
  const staticCacheRef = useRef<ChillStaticLayerCache | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const [resolvedMood, setResolvedMood] = useState<ResolvedChillMood>(() =>
    resolveEffectiveChillMood(config.mood)
  );

  const isPhotoScene = config.scene === "custom_photo";
  const pixelScene: PixelBackdropScene | null =
    config.scene !== "none" && config.scene !== "custom_photo"
      ? config.scene
      : null;

  // Load user photo Blob from IndexedDB only when `custom_photo` is active
  useEffect(() => {
    if (!isPhotoScene) {
      setPhotoUrl(null);
      return;
    }
    let active = true;
    let createdUrl: string | null = null;
    void loadChillPhoto().then((stored) => {
      if (!active) return;
      if (stored?.blob) {
        createdUrl = URL.createObjectURL(stored.blob);
        setPhotoUrl(createdUrl);
      } else {
        setPhotoUrl(null);
      }
    });
    return () => {
      active = false;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [isPhotoScene, photoVersion]);

  // Sync mood immediately and refresh every 60s only when in `auto` pixel mode
  useEffect(() => {
    if (!pixelScene) return;
    setResolvedMood(resolveEffectiveChillMood(config.mood));
    if (config.mood !== "auto") return;
    const id = setInterval(() => {
      setResolvedMood(resolveEffectiveChillMood("auto"));
    }, 60_000);
    return () => clearInterval(id);
  }, [pixelScene, config.mood]);

  // Release cached static offscreen canvas on unmount or when switching away from pixel scenes
  useEffect(() => {
    if (!pixelScene) {
      staticCacheRef.current = null;
    }
    return () => {
      staticCacheRef.current = null;
    };
  }, [pixelScene]);

  // Pixel art renderer loop
  useEffect(() => {
    if (!pixelScene) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dims = getScenePixelDimensions(pixelScene);
    if (canvas.width !== dims.width || canvas.height !== dims.height) {
      canvas.width = dims.width;
      canvas.height = dims.height;
    }

    const opts = { monsters: config.monsters, snow: config.snow };
    drawChillPixelScene(
      ctx,
      pixelScene,
      resolvedMood,
      elapsedRef.current,
      opts,
      staticCacheRef
    );
    if (!config.motion) return;

    let rafId = 0;
    let lastDraw = performance.now();

    const tick = (now: number) => {
      rafId = requestAnimationFrame(tick);
      if (document.hidden) return;
      if (now - lastDraw < FRAME_INTERVAL_MS) return;
      const dt = Math.min(0.15, (now - lastDraw) / 1000);
      elapsedRef.current += dt;
      lastDraw = now;
      drawChillPixelScene(
        ctx,
        pixelScene,
        resolvedMood,
        elapsedRef.current,
        opts,
        staticCacheRef
      );
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [pixelScene, resolvedMood, config.monsters, config.snow, config.motion]);

  if (config.scene === "none") return null;

  const alpha = config.scrim / 100;
  const scrimBg = `linear-gradient(180deg, rgba(8, 14, 28, ${(
    alpha * 1.1
  ).toFixed(2)}) 0%, rgba(8, 14, 28, ${(alpha * 0.2).toFixed(
    2
  )}) 46%, rgba(8, 14, 28, ${(alpha * 1.25).toFixed(2)}) 100%)`;

  const showVignette = isPhotoScene ? config.photoVignette : true;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden select-none"
      aria-hidden="true"
    >
      {isPhotoScene ? (
        photoUrl ? (
          <img
            src={photoUrl}
            alt=""
            className="w-full h-full object-cover transition-[object-position] duration-200"
            style={{
              objectPosition: getPhotoObjectPosition(config.photoPosition),
            }}
          />
        ) : (
          <div
            className="w-full h-full"
            style={{
              background:
                "linear-gradient(160deg, #16223d 0%, #1c3252 50%, #121c33 100%)",
            }}
          />
        )
      ) : (
        <canvas
          ref={canvasRef}
          className="w-full h-full block"
          style={{ imageRendering: "pixelated" }}
        />
      )}

      {/* Zero-Blur Smart Scrim: keeps top greeting & bottom dock legible while center stays clear */}
      <div className="absolute inset-0" style={{ background: scrimBg }} />

      {/* Subtle Zero-Blur stage vignette so edges melt smoothly into the 22px rounded stage */}
      {showVignette && (
        <div
          className="absolute inset-0"
          style={{
            background: isPhotoScene
              ? "radial-gradient(110% 90% at 50% 48%, rgba(8, 12, 24, 0) 52%, rgba(8, 12, 24, 0.56) 100%)"
              : "radial-gradient(115% 95% at 50% 48%, rgba(8, 12, 24, 0) 58%, rgba(8, 12, 24, 0.42) 100%)",
          }}
        />
      )}
    </div>
  );
});
