import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "jjdr.viewer_width_px";
const MIN_VIEWER_WIDTH_PX = 640;

function computeDefaultWidth(): number {
  if (typeof window === "undefined") return 1180;
  return Math.max(
    MIN_VIEWER_WIDTH_PX,
    Math.min(1320, Math.round(window.innerWidth * 0.84))
  );
}

function computeMaxWidth(): number {
  if (typeof window === "undefined") return 1800;
  return Math.max(MIN_VIEWER_WIDTH_PX, Math.round(window.innerWidth * 0.96));
}

function clampWidth(width: number): number {
  return Math.round(
    Math.max(MIN_VIEWER_WIDTH_PX, Math.min(computeMaxWidth(), width))
  );
}

function readStoredWidth(): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= MIN_VIEWER_WIDTH_PX) {
      return clampWidth(parsed);
    }
  } catch {
    // Ignore storage access failures
  }
  return null;
}

function writeStoredWidth(width: number | null) {
  try {
    if (width === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, String(Math.round(width)));
    }
  } catch {
    // Ignore storage access failures
  }
}

/**
 * Shared drag-to-resize modal width hook for built-in Markdown & Code viewers.
 * Persists user-chosen width to localStorage and clamps gracefully on window resize.
 */
export function useResizableModalWidth() {
  const [widthPx, setWidthPx] = useState<number>(
    () => readStoredWidth() ?? computeDefaultWidth()
  );
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    const onWindowResize = () => {
      setWidthPx((prev) => clampWidth(prev));
    };
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, []);

  const startResize = useCallback(
    (side: "left" | "right", e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startWidth = widthPx;
      let latest = startWidth;
      let rafId: number | null = null;

      setResizing(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (moveEv: PointerEvent) => {
        const dx =
          side === "right" ? moveEv.clientX - startX : startX - moveEv.clientX;
        // Modal is horizontally centered, so dragging one edge expands symmetrically
        latest = clampWidth(startWidth + dx * 2);
        if (rafId === null) {
          rafId = requestAnimationFrame(() => {
            rafId = null;
            setWidthPx(latest);
          });
        }
      };

      const onUp = () => {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        setWidthPx(latest);
        writeStoredWidth(latest);
        setResizing(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [widthPx]
  );

  const resetWidth = useCallback(() => {
    const next = computeDefaultWidth();
    setWidthPx(next);
    writeStoredWidth(null);
  }, []);

  return { widthPx, resizing, startResize, resetWidth };
}
