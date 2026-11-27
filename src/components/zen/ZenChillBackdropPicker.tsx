import React, { useEffect, useRef, useState } from "react";
import {
  Check,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Loader2,
  Palette,
  Snowflake,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import {
  CHILL_BACKDROP_PRESETS,
  CHILL_MOOD_OPTIONS,
  CHILL_PHOTO_POSITIONS,
  isSnowBackdropScene,
  type ChillBackdropConfig,
} from "../../utils/zenChillBackdrop";
import {
  clearChillPhoto,
  loadChillPhoto,
  saveChillPhoto,
  type StoredChillPhotoMeta,
} from "../../utils/zenPhotoStore";
import { formatBytes } from "../../utils/updatePolicy";

interface ZenChillBackdropPickerProps {
  config: ChillBackdropConfig;
  peekSceneryOnly: boolean;
  photoVersion: number;
  onChange: (next: ChillBackdropConfig) => void;
  onTogglePeekScenery: () => void;
  onPhotoChanged: () => void;
}

/**
 * Compact Zero-Blur popover in Zen Inbox top bar to pick a 2D pixel backdrop,
 * upload/frame a custom photo, or return to Classic Card.
 */
export const ZenChillBackdropPicker = React.memo(function ZenChillBackdropPicker({
  config,
  peekSceneryOnly,
  photoVersion,
  onChange,
  onTogglePeekScenery,
  onPhotoChanged,
}: ZenChillBackdropPickerProps) {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoMeta, setPhotoMeta] = useState<StoredChillPhotoMeta | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Close on outside pointerdown or Escape
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

  // Load saved photo thumbnail & metadata only while the popover is open
  useEffect(() => {
    if (!open) return;
    let active = true;
    let createdUrl: string | null = null;
    void loadChillPhoto().then((stored) => {
      if (!active) return;
      if (stored?.blob) {
        createdUrl = URL.createObjectURL(stored.blob);
        setThumbUrl(createdUrl);
        setPhotoMeta({
          name: stored.name,
          width: stored.width,
          height: stored.height,
          sizeBytes: stored.sizeBytes,
          updatedAt: stored.updatedAt,
        });
      } else {
        setThumbUrl(null);
        setPhotoMeta(null);
      }
    });
    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [open, photoVersion]);

  const isScenic = config.scene !== "none";
  const isPhotoScene = config.scene === "custom_photo";
  const isPixelScene = isScenic && !isPhotoScene;
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

  const handlePhotoFile = async (file: File | null | undefined) => {
    if (!file || uploading) return;
    setUploading(true);
    setPhotoError(null);
    try {
      await saveChillPhoto(file);
      onPhotoChanged();
      if (config.scene !== "custom_photo") {
        onChange({ ...config, scene: "custom_photo" });
      }
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemovePhoto = async () => {
    setPhotoError(null);
    await clearChillPhoto();
    onPhotoChanged();
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

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void handlePhotoFile(e.target.files?.[0])}
      />

      {open && (
        <div
          className="jjdr-modal absolute right-0 top-full mt-2 z-40 w-[340px] max-h-[80vh] overflow-y-auto rounded-2xl p-3.5 space-y-3 text-xs"
          style={{
            background: "var(--modal-bg)",
            border: "1px solid var(--modal-border)",
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div
              className="flex items-center gap-1.5 font-bold"
              style={{ color: "var(--text-primary)" }}
            >
              <ImageIcon
                className="w-3.5 h-3.5"
                style={{ color: "var(--accent)" }}
              />
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

          {/* 6 Scene Preset Selector (Classic + 4 Pixel Art + Custom Photo) */}
          <div className="space-y-1.5">
            {CHILL_BACKDROP_PRESETS.map((preset) => {
              const selected = config.scene === preset.id;
              const isCustomItem = preset.id === "custom_photo";
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => patch({ scene: preset.id })}
                  className="w-full text-left rounded-xl px-2.5 py-2 flex items-center gap-2.5 cursor-pointer transition-colors"
                  style={{
                    background: selected
                      ? "var(--accent-soft)"
                      : "var(--input-bg)",
                    border: `1px solid ${
                      selected ? "var(--accent-border)" : "var(--divider)"
                    }`,
                  }}
                >
                  {isCustomItem && thumbUrl ? (
                    <img
                      src={thumbUrl}
                      alt=""
                      className="w-7 h-7 rounded-lg shrink-0 object-cover border border-white/15"
                    />
                  ) : (
                    <span
                      className="w-7 h-7 rounded-lg shrink-0 border border-white/15 flex items-center justify-center"
                      style={{ background: preset.swatch }}
                    >
                      {isCustomItem && (
                        <Upload className="w-3.5 h-3.5 text-white" />
                      )}
                    </span>
                  )}
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
                      {isCustomItem && photoMeta
                        ? `${photoMeta.name} · ${formatBytes(photoMeta.sizeBytes)}`
                        : preset.description}
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

          {/* Custom Photo Upload & Framing Panel */}
          {isPhotoScene && (
            <div
              className="pt-2.5 space-y-2.5"
              style={{ borderTop: "1px solid var(--divider)" }}
            >
              {/* Drag & Drop / Click Upload Box */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  void handlePhotoFile(e.dataTransfer.files?.[0]);
                }}
                className="rounded-xl p-2.5 space-y-2 transition-colors"
                style={{
                  background: dragOver
                    ? "var(--accent-soft)"
                    : "var(--input-bg)",
                  border: `1.5px dashed ${
                    dragOver ? "var(--accent)" : "var(--input-border)"
                  }`,
                }}
              >
                {thumbUrl && photoMeta ? (
                  <div className="space-y-2">
                    <div className="relative h-24 rounded-lg overflow-hidden border border-white/10">
                      <img
                        src={thumbUrl}
                        alt={photoMeta.name}
                        className="w-full h-full object-cover"
                        style={{
                          objectPosition:
                            config.photoPosition === "top"
                              ? "center 18%"
                              : config.photoPosition === "bottom"
                              ? "center 82%"
                              : "center 50%",
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div
                          className="text-[11px] font-semibold truncate"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {photoMeta.name}
                        </div>
                        <div
                          className="text-[10px] font-mono-code"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {photoMeta.width}×{photoMeta.height} ·{" "}
                          {formatBytes(photoMeta.sizeBytes)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          disabled={uploading}
                          onClick={() => fileInputRef.current?.click()}
                          className="jjdr-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10.5px] font-semibold cursor-pointer disabled:opacity-50"
                          style={{ color: "var(--accent)" }}
                        >
                          {uploading ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Upload className="w-3 h-3" />
                          )}
                          <span>Change</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRemovePhoto()}
                          title="Remove saved photo"
                          className="jjdr-pill p-1.5 rounded-full cursor-pointer"
                          style={{ color: "var(--text-muted)" }}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full py-3 flex flex-col items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {uploading ? (
                      <Loader2
                        className="w-5 h-5 animate-spin"
                        style={{ color: "var(--accent)" }}
                      />
                    ) : (
                      <Upload
                        className="w-5 h-5"
                        style={{ color: "var(--accent)" }}
                      />
                    )}
                    <span
                      className="text-[11px] font-bold"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {uploading
                        ? "Optimizing photo..."
                        : "Upload or Drop a Photo"}
                    </span>
                    <span
                      className="text-[10px]"
                      style={{ color: "var(--text-muted)" }}
                    >
                      Auto-optimized to HD WebP (Zero-Blur)
                    </span>
                  </button>
                )}
              </div>

              {photoError && (
                <div
                  className="text-[11px] px-2.5 py-1.5 rounded-lg"
                  style={{
                    background: "var(--action-soft)",
                    color: "var(--action-fg)",
                  }}
                >
                  {photoError}
                </div>
              )}

              {/* Framing Position (Top / Center / Bottom) */}
              <div className="space-y-1">
                <div
                  className="text-[10.5px] font-semibold"
                  style={{ color: "var(--text-muted)" }}
                >
                  Photo Framing
                </div>
                <div
                  className="grid grid-cols-3 gap-1 p-0.5 rounded-full"
                  style={{
                    background: "var(--input-bg)",
                    border: "1px solid var(--divider)",
                  }}
                >
                  {CHILL_PHOTO_POSITIONS.map((opt) => {
                    const active = config.photoPosition === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => patch({ photoPosition: opt.id })}
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

              {/* Scrim & Edge Vignette */}
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

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    patch({ photoVignette: !config.photoVignette })
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10.5px] font-semibold cursor-pointer"
                  style={{
                    background: config.photoVignette
                      ? "var(--accent-soft)"
                      : "var(--input-bg)",
                    border: `1px solid ${
                      config.photoVignette
                        ? "var(--accent-border)"
                        : "var(--divider)"
                    }`,
                    color: config.photoVignette
                      ? "var(--accent)"
                      : "var(--text-muted)",
                  }}
                >
                  <span>Edge Vignette {config.photoVignette ? "ON" : "OFF"}</span>
                </button>
              </div>
            </div>
          )}

          {/* Pixel Art Controls (only shown when one of the 4 pixel scenes is selected) */}
          {isPixelScene && (
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
                        config.monsters
                          ? "var(--accent-border)"
                          : "var(--divider)"
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
