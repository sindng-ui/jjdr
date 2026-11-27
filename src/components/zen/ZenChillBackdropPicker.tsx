import React, { useEffect, useRef, useState } from "react";
import { Check, Eye, EyeOff, Image as ImageIcon, Palette, Snowflake, Sparkles } from "lucide-react";
import {
  CHILL_BACKDROP_PRESETS,
  CHILL_MOOD_OPTIONS,
  isSnowBackdropScene,
  type ChillBackdropConfig,
} from "../../utils/zenChillBackdrop";

interface ZenChillBackdropPickerProps {
  config: ChillBackdropConfig;
  peekSceneryOnly: boolean;
  onChange: (next: ChillBackdropConfig) => void;
  onTogglePeekScenery: () => void;
}

/**
 * Compact Zero-Blur popover in Zen Inbox top bar to pick the Time to Chill / All Clear
 * 2D pixel backdrop (or return to Classic Card) and tune time-of-day mood & scrim.
 */
export const ZenChillBackdropPicker = React.memo(function ZenChillBackdropPicker({
  config,
  peekSceneryOnly,
  onChange,
  onTogglePeekScenery,
}: ZenChillBackdropPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  const isScenic = config.scene !== "none";
  const isSnow = isSnowBackdropScene(config.scene);
  const hasMonsters =
    config.scene === "coastal_train" ||
    config.scene === "alpine_chalet" ||
    config.scene === "glacier_express";
  const activePreset =
    CHILL_BACKDROP_PRESETS.find((p) => p.id === config.scene) ??
    CHILL_BACKDROP_PRESETS[0];

  const patch = (partial: Partial<ChillBackdropConfig>) => {
    onChange({ ...config, ...partial });
  };

  return (
    <div ref={rootRef} className="relative flex items-center gap-1.5">
      {isScenic && (
        <button
          type="button"
          onClick={onTogglePeekScenery}
          title={
            peekSceneryOnly
              ? "Show Zen Chill HUD"
              : "Hide HUD to enjoy pure scenery"
          }
          className="jjdr-pill h-7 px-2.5 rounded-full inline-flex items-center gap-1 text-[11px] font-medium cursor-pointer transition-colors"
          style={{
            color: peekSceneryOnly ? "var(--accent)" : "var(--text-secondary)",
            borderColor: peekSceneryOnly ? "var(--accent-border)" : undefined,
          }}
        >
          {peekSceneryOnly ? (
            <Eye className="w-3.5 h-3.5" />
          ) : (
            <EyeOff className="w-3.5 h-3.5" />
          )}
          <span className="hidden sm:inline">
            {peekSceneryOnly ? "Show UI" : "Pure View"}
          </span>
        </button>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Customize Zen Chill & All Clear backdrop"
        className={`jjdr-pill h-7 px-2.5 rounded-full inline-flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer transition-colors ${
          open || isScenic ? "jjdr-pill-active" : ""
        }`}
        style={
          open || isScenic ? undefined : { color: "var(--text-secondary)" }
        }
      >
        <Palette className="w-3.5 h-3.5" />
        <span>{isScenic ? activePreset.shortLabel : "Backdrop"}</span>
      </button>

      {open && (
        <div
          className="jjdr-modal absolute right-0 top-full mt-2 z-40 w-[332px] rounded-2xl p-3.5 space-y-3 text-xs"
          style={{
            background: "var(--modal-bg)",
            border: "1px solid var(--modal-border)",
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-bold" style={{ color: "var(--text-primary)" }}>
              <ImageIcon className="w-3.5 h-3.5" style={{ color: "var(--accent)" }} />
              <span>Zen Chill Backdrop</span>
            </div>
            <span
              className="text-[10px] font-mono-code px-2 py-0.5 rounded-full"
              style={{
                background: "var(--pill-bg)",
                color: "var(--text-muted)",
              }}
            >
              {isScenic ? "Open Scenic HUD" : "Classic Card"}
            </span>
          </div>

          {/* 5 Scene Preset Selector */}
          <div className="space-y-1.5">
            {CHILL_BACKDROP_PRESETS.map((preset) => {
              const selected = config.scene === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => patch({ scene: preset.id })}
                  className="w-full text-left rounded-xl px-2.5 py-2 flex items-center gap-2.5 cursor-pointer transition-colors"
                  style={{
                    background: selected ? "var(--accent-soft)" : "var(--input-bg)",
                    border: `1px solid ${
                      selected ? "var(--accent-border)" : "var(--divider)"
                    }`,
                  }}
                >
                  <span
                    className="w-7 h-7 rounded-lg shrink-0 border border-white/15"
                    style={{ background: preset.swatch }}
                  />
                  <div className="min-w-0 flex-1">
                    <div
                      className="text-xs font-bold truncate"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {preset.label}
                    </div>
                    <div
                      className="text-[10.5px] truncate"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {preset.description}
                    </div>
                  </div>
                  {selected && (
                    <Check
                      className="w-3.5 h-3.5 shrink-0"
                      style={{ color: "var(--accent)" }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Scenic Controls (only shown when one of the 4 pixel scenes is selected) */}
          {isScenic && (
            <div
              className="pt-2.5 space-y-2.5"
              style={{ borderTop: "1px solid var(--divider)" }}
            >
              {/* Time of Day Mood */}
              <div className="space-y-1">
                <div
                  className="text-[10.5px] font-semibold"
                  style={{ color: "var(--text-muted)" }}
                >
                  Time of Day
                </div>
                <div
                  className="grid grid-cols-5 gap-1 p-0.5 rounded-full"
                  style={{
                    background: "var(--input-bg)",
                    border: "1px solid var(--divider)",
                  }}
                >
                  {CHILL_MOOD_OPTIONS.map((opt) => {
                    const active = config.mood === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => patch({ mood: opt.id })}
                        className={`py-1 rounded-full text-[10.5px] font-semibold cursor-pointer transition-colors ${
                          active ? "jjdr-pill-active" : ""
                        }`}
                        style={
                          active ? undefined : { color: "var(--text-muted)" }
                        }
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Scrim Dimmer */}
              <div className="flex items-center justify-between gap-2">
                <span
                  className="text-[10.5px] font-semibold"
                  style={{ color: "var(--text-muted)" }}
                >
                  Readability Scrim
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={55}
                    value={config.scrim}
                    onChange={(e) => patch({ scrim: Number(e.target.value) })}
                    className="w-24 cursor-pointer accent-[var(--accent)]"
                  />
                  <span
                    className="text-[10.5px] font-mono-code w-8 text-right"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {config.scrim}%
                  </span>
                </div>
              </div>

              {/* Feature Toggles */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {hasMonsters && (
                  <button
                    type="button"
                    onClick={() => patch({ monsters: !config.monsters })}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10.5px] font-semibold cursor-pointer"
                    style={{
                      background: config.monsters
                        ? "var(--accent-soft)"
                        : "var(--input-bg)",
                      border: `1px solid ${
                        config.monsters ? "var(--accent-border)" : "var(--divider)"
                      }`,
                      color: config.monsters
                        ? "var(--accent)"
                        : "var(--text-muted)",
                    }}
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Monsters {config.monsters ? "ON" : "OFF"}</span>
                  </button>
                )}

                {isSnow && (
                  <button
                    type="button"
                    onClick={() => patch({ snow: !config.snow })}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10.5px] font-semibold cursor-pointer"
                    style={{
                      background: config.snow
                        ? "var(--accent-soft)"
                        : "var(--input-bg)",
                      border: `1px solid ${
                        config.snow ? "var(--accent-border)" : "var(--divider)"
                      }`,
                      color: config.snow
                        ? "var(--accent)"
                        : "var(--text-muted)",
                    }}
                  >
                    <Snowflake className="w-3 h-3" />
                    <span>Snow {config.snow ? "ON" : "OFF"}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => patch({ motion: !config.motion })}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10.5px] font-semibold cursor-pointer"
                  style={{
                    background: config.motion
                      ? "var(--accent-soft)"
                      : "var(--input-bg)",
                    border: `1px solid ${
                      config.motion ? "var(--accent-border)" : "var(--divider)"
                    }`,
                    color: config.motion
                      ? "var(--accent)"
                      : "var(--text-muted)",
                  }}
                >
                  <span>Motion {config.motion ? "ON" : "OFF"}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
