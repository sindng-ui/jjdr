import React from "react";
import { BellRing, Check, Play, Plus, Trash2 } from "lucide-react";
import {
  BG_OVERLAY_POSITION_PRESETS,
  normalizeBgOverlayPosition,
} from "../../../utils/bgOverlay";
import { SymbolIndexSettingsSection } from "./SymbolIndexSettingsSection";
import type {
  AppSettings,
  BgOverlayPosition,
  PromptPreset,
} from "../../../types/domain";

interface GeneralSettingsTabProps {
  draft: AppSettings;
  onChangeDraft: (updater: (prev: AppSettings) => AppSettings) => void;
  onToggleBgOverlay: () => void;
  onSelectBgOverlayPosition: (position: BgOverlayPosition) => void;
  onPreviewBgOverlay: () => void;
  onToggleSymbolIndex: () => void;
  onSymbolCacheCleared?: () => void;
}

export const GeneralSettingsTab = React.memo(function GeneralSettingsTab({
  draft,
  onChangeDraft,
  onToggleBgOverlay,
  onSelectBgOverlayPosition,
  onPreviewBgOverlay,
  onToggleSymbolIndex,
  onSymbolCacheCleared,
}: GeneralSettingsTabProps) {
  const updatePreset = (idx: number, patch: Partial<PromptPreset>) => {
    onChangeDraft((prev) => ({
      ...prev,
      prompt_presets: prev.prompt_presets.map((p, i) =>
        i === idx ? { ...p, ...patch } : p
      ),
    }));
  };

  const addPreset = () => {
    onChangeDraft((prev) => ({
      ...prev,
      prompt_presets: [
        ...prev.prompt_presets,
        { id: `p-${Date.now()}`, label: "New Preset", prompt: "" },
      ],
    }));
  };

  const removePreset = (idx: number) => {
    onChangeDraft((prev) => ({
      ...prev,
      prompt_presets: prev.prompt_presets.filter((_, i) => i !== idx),
    }));
  };

  return (
    <div className="space-y-5">
      {/* Background Top-Priority Card Overlay HUD */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <BellRing className="w-3.5 h-3.5" style={{ color: "var(--accent)" }} />
            <span
              className="font-bold text-xs"
              style={{ color: "var(--text-primary)" }}
            >
              백그라운드 최우선 카드 알림 (HUD)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onPreviewBgOverlay}
              className="jjdr-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold cursor-pointer"
              style={{ color: "var(--accent)" }}
            >
              <Play className="w-3 h-3" />
              미리보기
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={draft.bg_overlay_enabled ?? false}
              onClick={onToggleBgOverlay}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold cursor-pointer transition-colors"
              style={{
                background:
                  draft.bg_overlay_enabled ?? false
                    ? "var(--accent)"
                    : "var(--pill-bg)",
                color:
                  draft.bg_overlay_enabled ?? false
                    ? "#ffffff"
                    : "var(--text-muted)",
                border: "1px solid var(--pill-border)",
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  background:
                    draft.bg_overlay_enabled ?? false
                      ? "#ffffff"
                      : "var(--text-faint)",
                }}
              />
              {draft.bg_overlay_enabled ?? false ? "ON" : "OFF"}
            </button>
          </div>
        </div>

        <p
          className="text-[11px] leading-snug"
          style={{ color: "var(--text-muted)" }}
        >
          jjdr이 백그라운드에 있을 때 가장 급한 카드(Needs You → Ready)를 포커스 방해
          없이 화면에 크게 띄워줍니다. 클릭하면 해당 카드로 즉시 이동합니다.
        </p>

        <div
          className="grid grid-cols-3 gap-2.5"
          style={{ opacity: draft.bg_overlay_enabled ?? false ? 1 : 0.48 }}
        >
          {BG_OVERLAY_POSITION_PRESETS.map((opt) => {
            const active =
              normalizeBgOverlayPosition(draft.bg_overlay_position) === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                disabled={!(draft.bg_overlay_enabled ?? false)}
                onClick={() => onSelectBgOverlayPosition(opt.id)}
                className="jjdr-card-lift text-left rounded-2xl p-2.5 cursor-pointer disabled:cursor-not-allowed flex flex-col gap-1"
                style={{
                  background: active ? "var(--accent-soft)" : "var(--input-bg)",
                  border: `1.5px solid ${
                    active ? "var(--accent)" : "var(--input-border)"
                  }`,
                }}
              >
                <div className="flex items-center justify-between gap-1">
                  <span
                    className="font-bold text-xs"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {opt.label}
                  </span>
                  {active && (
                    <span
                      className="w-4 h-4 rounded-full inline-flex items-center justify-center shrink-0"
                      style={{ background: "var(--accent)", color: "#ffffff" }}
                    >
                      <Check className="w-2.5 h-2.5" />
                    </span>
                  )}
                </div>
                <span
                  className="text-[11px] leading-snug"
                  style={{ color: "var(--text-muted)" }}
                >
                  {opt.desc}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* General Behavior Settings */}
      <div
        className="pt-4 space-y-2.5"
        style={{ borderTop: "1px solid var(--divider)" }}
      >
        <label className="flex items-center justify-between gap-3">
          <span style={{ color: "var(--text-secondary)" }}>
            Stuck warning threshold (minutes in Working state)
          </span>
          <input
            type="number"
            min={0}
            max={60}
            value={draft.stuck_minutes}
            onChange={(e) =>
              onChangeDraft((prev) => ({
                ...prev,
                stuck_minutes: Number(e.target.value),
              }))
            }
            className="jjdr-input w-20 px-3 py-1.5 rounded-full text-right font-mono-code"
          />
        </label>

        <label
          className="flex items-center gap-2.5 cursor-pointer"
          style={{ color: "var(--text-secondary)" }}
        >
          <input
            type="checkbox"
            checked={draft.notify_on_blocked}
            onChange={(e) =>
              onChangeDraft((prev) => ({
                ...prev,
                notify_on_blocked: e.target.checked,
              }))
            }
          />
          Calm OS notification when an AI session is Blocked / Error
        </label>

        <label
          className="flex items-center gap-2.5 cursor-pointer"
          style={{ color: "var(--text-secondary)" }}
        >
          <input
            type="checkbox"
            checked={draft.show_merge_overlap}
            onChange={(e) =>
              onChangeDraft((prev) => ({
                ...prev,
                show_merge_overlap: e.target.checked,
              }))
            }
          />
          Show Merge Overlap Radar badge (same relative file modified in 2+
          worktrees)
        </label>
      </div>

      {/* Symbol Jump Indexing (Opt-in, Default OFF) */}
      <SymbolIndexSettingsSection
        enabled={draft.symbol_index_enabled ?? false}
        onToggle={onToggleSymbolIndex}
        onCleared={onSymbolCacheCleared}
      />

      {/* Prompt Presets */}
      <div
        className="pt-4 space-y-2.5"
        style={{ borderTop: "1px solid var(--divider)" }}
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <span
              className="font-bold"
              style={{ color: "var(--text-primary)" }}
            >
              터미널 상단 원클릭 프롬프트 프리셋
            </span>
            <p
              className="text-[11px] mt-0.5"
              style={{ color: "var(--text-muted)" }}
            >
              버튼 이름과 보낼 프롬프트를 자유롭게 추가·수정·삭제할 수 있습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={addPreset}
            className="jjdr-pill inline-flex items-center gap-1 px-3 py-1 rounded-full font-semibold shrink-0 cursor-pointer"
            style={{ color: "var(--accent)" }}
          >
            <Plus className="w-3.5 h-3.5" />
            추가
          </button>
        </div>
        <div className="space-y-2">
          {draft.prompt_presets.map((p, i) => (
            <div key={p.id} className="flex items-center gap-2">
              <input
                type="text"
                value={p.label}
                placeholder="버튼 이름"
                onChange={(e) => updatePreset(i, { label: e.target.value })}
                className="jjdr-input w-36 px-3 py-1.5 rounded-full"
              />
              <input
                type="text"
                value={p.prompt}
                placeholder="AI에게 보낼 프롬프트 내용..."
                onChange={(e) => updatePreset(i, { prompt: e.target.value })}
                className="jjdr-input flex-1 px-3 py-1.5 rounded-full"
              />
              <button
                type="button"
                onClick={() => removePreset(i)}
                title="삭제"
                className="p-1.5 rounded-full hover:bg-black/10 cursor-pointer"
                style={{ color: "var(--action-fg)" }}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
