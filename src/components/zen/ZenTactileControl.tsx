import React, { useEffect, useRef, useState } from "react";
import type { ZenCardStyle } from "../../utils/zenQueue";

interface ZenTactileControlProps {
  styleMode: ZenCardStyle;
  remainingCount: number;
  dialAngle: number;
  onPullProgress?: (ratio: number) => void;
  onTriggerNext: () => void;
}

const MAX_PULL_PX = 128;
const PULL_THRESHOLD_PX = 62;

/**
 * Tactile right-side physical next-card control for Zen Mode:
 * - "holo_stamp": Arcade spring-loaded ball lever (drag down to pull, or click)
 * - "gacha_dial": Rotary Gacha capsule knob (click or drag to turn 180deg)
 */
export const ZenTactileControl = React.memo(function ZenTactileControl({
  styleMode,
  remainingCount,
  dialAngle,
  onPullProgress,
  onTriggerNext,
}: ZenTactileControlProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const [pulling, setPulling] = useState(false);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
    };
  }, []);

  if (styleMode === "gacha_dial") {
    return (
      <div className="flex flex-col items-center gap-2 shrink-0 select-none">
        <button
          type="button"
          onClick={onTriggerNext}
          title={
            remainingCount > 0
              ? `가챠 다이얼을 돌려 결재 완료 & 다음 카드로! (뒤에 ${remainingCount}장 대기 · 보류는 Ctrl+N)`
              : "가챠 다이얼을 돌려 마지막 카드 결재 완료! (All Clear)"
          }
          className="relative w-16 h-16 rounded-full flex items-center justify-center cursor-pointer active:scale-95 transition-transform"
          style={{
            background:
              "radial-gradient(circle at 35% 30%, var(--card-hover-bg), var(--term-bg))",
            border: "2px solid var(--accent-border)",
            boxShadow: "0 12px 26px -8px rgba(0, 0, 0, 0.55)",
          }}
        >
          <div
            className="w-12 h-3.5 rounded-full flex items-center justify-between px-1.5"
            style={{
              background: "var(--brand-bg)",
              transform: `rotate(${dialAngle}deg)`,
              transition: "transform 360ms cubic-bezier(0.22, 1.2, 0.36, 1)",
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-white" />
            <span className="w-1.5 h-1.5 rounded-full bg-white/55" />
          </div>
        </button>
        <span
          className="text-[10px] font-mono-code font-bold tracking-wider"
          style={{ color: "var(--text-faint)" }}
        >
          TURN ↻
        </span>
      </div>
    );
  }

  // Arcade Pull Lever (always tactile and interactive, never disabled)
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const track = trackRef.current;
    const knob = knobRef.current;
    if (!track || !knob) return;

    const pointerId = e.pointerId;
    const startY = e.clientY;
    let pullY = 0;
    let moved = false;
    let finished = false;

    dragCleanupRef.current?.();
    setPulling(true);
    try {
      track.setPointerCapture(pointerId);
    } catch {
      // ignore if capture is unsupported
    }
    knob.style.transition = "none";

    const detach = () => {
      track.removeEventListener("pointermove", onMove);
      track.removeEventListener("pointerup", onUp);
      track.removeEventListener("pointercancel", onCancel);
      track.removeEventListener("lostpointercapture", onCancel);
      window.removeEventListener("blur", onCancel);
      try {
        if (track.hasPointerCapture(pointerId)) {
          track.releasePointerCapture(pointerId);
        }
      } catch {
        // ignore release error if detached
      }
      if (dragCleanupRef.current === detach) {
        dragCleanupRef.current = null;
      }
    };

    const onMove = (ev: PointerEvent) => {
      pullY = Math.max(0, Math.min(MAX_PULL_PX, ev.clientY - startY));
      if (pullY > 5) moved = true;
      knob.style.transform = `translateY(${pullY}px)`;
      onPullProgress?.(pullY / MAX_PULL_PX);
    };

    const onCancel = () => {
      if (finished) return;
      finished = true;
      detach();
      setPulling(false);
      onPullProgress?.(0);
      if (knobRef.current) {
        knobRef.current.style.transition =
          "transform 240ms cubic-bezier(0.22, 1.3, 0.36, 1)";
        knobRef.current.style.transform = "translateY(0px)";
      }
    };

    const onUp = () => {
      if (finished) return;
      finished = true;
      detach();
      setPulling(false);
      onPullProgress?.(0);

      // Quick tap without dragging also triggers a satisfying spring dip + next card
      if (!moved) {
        knob.style.transition = "transform 120ms ease-out";
        knob.style.transform = `translateY(${PULL_THRESHOLD_PX}px)`;
        setTimeout(() => {
          if (knobRef.current) {
            knobRef.current.style.transition =
              "transform 300ms cubic-bezier(0.22, 1.35, 0.36, 1)";
            knobRef.current.style.transform = "translateY(0px)";
          }
          onTriggerNext();
        }, 110);
        return;
      }

      knob.style.transition =
        "transform 300ms cubic-bezier(0.22, 1.35, 0.36, 1)";
      knob.style.transform = "translateY(0px)";
      if (pullY >= PULL_THRESHOLD_PX) {
        onTriggerNext();
      }
    };

    dragCleanupRef.current = detach;
    track.addEventListener("pointermove", onMove);
    track.addEventListener("pointerup", onUp);
    track.addEventListener("pointercancel", onCancel);
    track.addEventListener("lostpointercapture", onCancel);
    window.addEventListener("blur", onCancel);
  };

  return (
    <div className="flex flex-col items-center gap-2 shrink-0 select-none">
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        title={
          remainingCount > 0
            ? `레버를 아래로 당기거나 클릭해 결재 완료 & 다음 카드로! (뒤에 ${remainingCount}장 대기 · 보류는 Ctrl+N)`
            : "레버를 당겨 마지막 카드 결재 완료! (All Clear)"
        }
        className={`relative w-11 rounded-full flex flex-col items-center py-2 ${
          pulling ? "cursor-grabbing" : "cursor-grab"
        }`}
        style={{
          height: "184px",
          background: "var(--input-bg)",
          border: "1.5px solid var(--modal-border)",
          boxShadow: "inset 0 4px 12px rgba(0, 0, 0, 0.45)",
        }}
      >
        <div
          className="w-1.5 flex-1 rounded-full"
          style={{ background: "var(--divider)" }}
        />
        <div
          ref={knobRef}
          className="absolute top-2 w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-black text-white shadow-lg"
          style={{
            background:
              "radial-gradient(circle at 35% 30%, #fda4af, #f43f5e 65%, #9f1239)",
            border: "2px solid rgba(255, 255, 255, 0.35)",
            transition: "transform 280ms cubic-bezier(0.22, 1.3, 0.36, 1)",
          }}
        >
          ↓
        </div>
      </div>
      <span
        className="text-[10px] font-mono-code font-bold tracking-wider"
        style={{ color: "var(--text-faint)" }}
      >
        PULL!
      </span>
    </div>
  );
});
