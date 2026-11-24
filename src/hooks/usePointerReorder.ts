import { useCallback, useRef, useState } from "react";

export function reorderIds(
  ids: string[],
  fromId: string,
  toId: string
): string[] {
  if (fromId === toId) return ids;
  const fromIdx = ids.indexOf(fromId);
  const toIdx = ids.indexOf(toId);
  if (fromIdx === -1 || toIdx === -1) return ids;
  const next = [...ids];
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next;
}

interface UsePointerReorderOptions {
  ids: string[];
  containerRef: React.RefObject<HTMLElement | null>;
  onReorder: (nextIds: string[]) => void;
  disabled?: boolean;
}

const DRAG_THRESHOLD_PX = 6;

/**
 * WebView2-safe Pointer Events drag-to-reorder hook (works reliably even with Tauri v2 dragDropEnabled).
 * Suppresses accidental drags under 6px so click/double-click stay 100% responsive.
 */
export function usePointerReorder({
  ids,
  containerRef,
  onReorder,
  disabled = false,
}: UsePointerReorderOptions) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const idsRef = useRef(ids);
  idsRef.current = ids;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;
  const suppressClickUntilRef = useRef<number>(0);

  const shouldSuppressClick = useCallback(
    () => Date.now() < suppressClickUntilRef.current,
    []
  );

  const startDrag = useCallback(
    (id: string, e: React.PointerEvent<HTMLElement>) => {
      if (disabled || e.button !== 0 || idsRef.current.length <= 1) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("button, input, textarea, select, a, [data-no-drag]")) {
        return;
      }

      const startX = e.clientX;
      const startY = e.clientY;
      let active = false;
      let currentOver: string | null = id;

      const findTargetId = (clientX: number, clientY: number): string | null => {
        const container = containerRef.current;
        if (!container) return null;
        const nodes = Array.from(
          container.querySelectorAll<HTMLElement>("[data-reorder-id]")
        );
        let bestId: string | null = null;
        let bestDist = Infinity;

        for (const node of nodes) {
          const nid = node.dataset.reorderId;
          if (!nid) continue;
          const r = node.getBoundingClientRect();
          if (
            clientX >= r.left &&
            clientX <= r.right &&
            clientY >= r.top &&
            clientY <= r.bottom
          ) {
            return nid;
          }
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const d = Math.hypot(clientX - cx, clientY - cy);
          if (d < bestDist) {
            bestDist = d;
            bestId = nid;
          }
        }
        return bestId;
      };

      const onMove = (moveEv: PointerEvent) => {
        if (!active) {
          const dist = Math.hypot(
            moveEv.clientX - startX,
            moveEv.clientY - startY
          );
          if (dist < DRAG_THRESHOLD_PX) return;
          active = true;
          setDraggingId(id);
          setOverId(id);
          document.body.style.userSelect = "none";
          document.body.style.cursor = "grabbing";
        }
        const hit = findTargetId(moveEv.clientX, moveEv.clientY);
        if (hit && hit !== currentOver) {
          currentOver = hit;
          setOverId(hit);
        }
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        if (active) {
          document.body.style.userSelect = "";
          document.body.style.cursor = "";
          suppressClickUntilRef.current = Date.now() + 180;
          const finalOver = currentOver;
          setDraggingId(null);
          setOverId(null);
          if (finalOver && finalOver !== id) {
            const next = reorderIds(idsRef.current, id, finalOver);
            onReorderRef.current(next);
          }
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [containerRef, disabled]
  );

  return {
    draggingId,
    overId,
    startDrag,
    shouldSuppressClick,
  };
}
