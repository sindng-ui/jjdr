import React, { useEffect, useRef, useState } from "react";
import {
  resolveEffectiveChillMood,
  type ChillBackdropConfig,
  type ResolvedChillMood,
} from "../../utils/zenChillBackdrop";
import {
  drawChillPixelScene,
  getScenePixelDimensions,
} from "../../utils/zenPixelScenes";

interface ZenChillBackdropCanvasProps {
  config: ChillBackdropConfig;
}

const FRAME_INTERVAL_MS = 85; // ~12fps crisp pixel motion -> near-0% CPU/GPU

/**
 * Lazy-loaded, Zero-Blur 2D pixel art backdrop for Zen Inbox All Clear / Time to Chill.
 * Pauses animation automatically when the tab/window is hidden or when `motion === false`.
 */
export const ZenChillBackdropCanvas = React.memo(function ZenChillBackdropCanvas({
  config,
}: ZenChillBackdropCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const elapsedRef = useRef(0);

  const [resolvedMood, setResolvedMood] = useState<ResolvedChillMood>(() =>
    resolveEffectiveChillMood(config.mood)
  );

  // Sync mood immediately and refresh every 60s only when in `auto` time-of-day mode
  useEffect(() => {
    setResolvedMood(resolveEffectiveChillMood(config.mood));
    if (config.mood !== "auto") return;
    const id = setInterval(() => {
      setResolvedMood(resolveEffectiveChillMood("auto"));
    }, 60_000);
    return () => clearInterval(id);
  }, [config.mood]);

  const activeScene = config.scene === "none" ? null : config.scene;

  useEffect(() => {
    if (!activeScene) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dims = getScenePixelDimensions(activeScene);
    if (canvas.width !== dims.width || canvas.height !== dims.height) {
      canvas.width = dims.width;
      canvas.height = dims.height;
    }

    const opts = { monsters: config.monsters, snow: config.snow };
    const renderOnce = () => {
      drawChillPixelScene(ctx, activeScene, resolvedMood, elapsedRef.current, opts);
    };

    renderOnce();
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
      drawChillPixelScene(ctx, activeScene, resolvedMood, elapsedRef.current, opts);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [activeScene, resolvedMood, config.monsters, config.snow, config.motion]);

  if (!activeScene) return null;

  const alpha = config.scrim / 100;
  const scrimBg = `linear-gradient(180deg, rgba(8, 14, 28, ${(
    alpha * 1.1
  ).toFixed(2)}) 0%, rgba(8, 14, 28, ${(alpha * 0.2).toFixed(
    2
  )}) 46%, rgba(8, 14, 28, ${(alpha * 1.25).toFixed(2)}) 100%)`;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden select-none"
      aria-hidden="true"
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ imageRendering: "pixelated" }}
      />
      {/* Zero-Blur Smart Scrim: keeps top greeting & bottom dock legible while horizon stays crystal clear */}
      <div className="absolute inset-0" style={{ background: scrimBg }} />
      {/* Subtle stage vignette so edges melt smoothly into the 22px rounded stage */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(115% 95% at 50% 48%, rgba(8, 12, 24, 0) 58%, rgba(8, 12, 24, 0.42) 100%)",
        }}
      />
    </div>
  );
});
