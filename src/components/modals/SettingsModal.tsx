import React, { useEffect, useState } from "react";
import {
  Check,
  LayoutGrid,
  Palette,
  Plus,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import { saveSettings } from "../../services/tauriBridge";
import { RADAR_DENSITY_PRESETS, THEME_PRESETS } from "../../utils/themes";
import type {
  AppSettings,
  PromptPreset,
  RadarDensity,
  ThemeId,
} from "../../types/domain";

export const SettingsModal = React.memo(function SettingsModal() {
  const open = useUiStore((s) => s.settingsOpen);
  const setOpen = useUiStore((s) => s.setSettingsOpen);
  const showToast = useUiStore((s) => s.showToast);
  const current = useAppStore((s) => s.settings);

  const [draft, setDraft] = useState<AppSettings>(current);

  useEffect(() => {
    if (open) setDraft(current);
  }, [open, current]);

  if (!open) return null;

  const handleSelectTheme = (themeId: ThemeId) => {
    const next: AppSettings = { ...draft, theme: themeId };
    setDraft(next);
    useAppStore.getState().setSettings(next);
    void saveSettings(next).catch(() => {});
  };

  const handleSelectDensity = (density: RadarDensity) => {
    const next: AppSettings = { ...draft, radar_density: density };
    setDraft(next);
    useAppStore.getState().setSettings(next);
    void saveSettings(next).catch(() => {});
  };

  const updatePreset = (idx: number, patch: Partial<PromptPreset>) => {
    setDraft((prev) => ({
      ...prev,
      prompt_presets: prev.prompt_presets.map((p, i) =>
        i === idx ? { ...p, ...patch } : p
      ),
    }));
  };

  const addPreset = () => {
    setDraft((prev) => ({
      ...prev,
      prompt_presets: [
        ...prev.prompt_presets,
        { id: `p-${Date.now()}`, label: "New Preset", prompt: "" },
      ],
    }));
  };

  const removePreset = (idx: number) => {
    setDraft((prev) => ({
      ...prev,
      prompt_presets: prev.prompt_presets.filter((_, i) => i !== idx),
    }));
  };

  const handleSave = async () => {
    useAppStore.getState().setSettings(draft);
    await saveSettings(draft).catch(() => {});
    showToast("설정이 저장되었습니다", "success");
    setOpen(false);
  };

  return (
    <div
      onClick={() => setOpen(false)}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "var(--modal-overlay)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="jjdr-modal w-full max-w-xl rounded-[22px] overflow-hidden"
      >
        <div
          className="px-5 py-4 flex items-center justify-between"
          style={{ borderBottom: "1px solid var(--divider)" }}
        >
          <div className="flex items-center gap-2.5">
            <Settings className="w-4 h-4" style={{ color: "var(--accent)" }} />
            <h3
              className="text-sm font-bold"
              style={{ color: "var(--text-primary)" }}
            >
              Mission Control Settings
            </h3>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 rounded-full hover:bg-black/10 cursor-pointer"
            style={{ color: "var(--text-muted)" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 text-xs max-h-[72vh] overflow-y-auto">
          {/* 4-Theme One-Click Visual Switcher */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Palette
                  className="w-3.5 h-3.5"
                  style={{ color: "var(--accent)" }}
                />
                <span
                  className="font-bold text-xs"
                  style={{ color: "var(--text-primary)" }}
                >
                  테마 선택 (원클릭 즉시 적용)
                </span>
              </div>
              <span
                className="text-[11px]"
                style={{ color: "var(--text-muted)" }}
              >
                Zero-Blur · 4종 내장
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              {THEME_PRESETS.map((preset) => {
                const active = draft.theme === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectTheme(preset.id)}
                    className="jjdr-card-lift text-left rounded-2xl p-3 cursor-pointer flex flex-col gap-2.5"
                    style={{
                      background: active
                        ? "var(--accent-soft)"
                        : "var(--input-bg)",
                      border: `1.5px solid ${
                        active ? "var(--accent)" : "var(--input-border)"
                      }`,
                    }}
                  >
                    {/* Miniature Theme Swatch Preview */}
                    <div
                      className="h-11 rounded-xl p-1.5 flex items-center gap-1.5"
                      style={{
                        background: preset.swatches.shell,
                        border: "1px solid rgba(128,128,128,0.18)",
                      }}
                    >
                      <div
                        className="w-4 h-full rounded-lg opacity-80"
                        style={{ background: preset.swatches.card }}
                      />
                      <div
                        className="flex-1 h-full rounded-lg p-1.5 flex items-center justify-between"
                        style={{ background: preset.swatches.stage }}
                      >
                        <div
                          className="w-10 h-full rounded-md"
                          style={{ background: preset.swatches.card }}
                        />
                        <div className="flex items-center gap-1">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ background: preset.swatches.accent }}
                          />
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ background: preset.swatches.ready }}
                          />
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ background: preset.swatches.action }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="font-bold text-xs truncate"
                            style={{ color: "var(--text-primary)" }}
                          >
                            {preset.name}
                          </span>
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                            style={{
                              background: "var(--pill-bg)",
                              color: "var(--text-muted)",
                            }}
                          >
                            {preset.tagline}
                          </span>
                        </div>
                        <p
                          className="mt-1 text-[11px] leading-snug truncate"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {preset.description}
                        </p>
                      </div>
                      {active && (
                        <span
                          className="w-5 h-5 rounded-full inline-flex items-center justify-center shrink-0"
                          style={{
                            background: "var(--accent)",
                            color: "#ffffff",
                          }}
                        >
                          <Check className="w-3 h-3" />
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Radar Row Density Switcher (3/2, 4/2 Default, 5/3) */}
          <div
            className="pt-4 space-y-2.5"
            style={{ borderTop: "1px solid var(--divider)" }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <LayoutGrid
                  className="w-3.5 h-3.5"
                  style={{ color: "var(--accent)" }}
                />
                <span
                  className="font-bold text-xs"
                  style={{ color: "var(--text-primary)" }}
                >
                  레이더 한 줄 카드 수 (기본 / 터미널 열림)
                </span>
              </div>
              <span
                className="text-[11px]"
                style={{ color: "var(--text-muted)" }}
              >
                원클릭 즉시 적용
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {RADAR_DENSITY_PRESETS.map((opt) => {
                const active = draft.radar_density === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleSelectDensity(opt.id)}
                    className="jjdr-card-lift text-left rounded-2xl p-3 cursor-pointer flex flex-col gap-1.5"
                    style={{
                      background: active
                        ? "var(--accent-soft)"
                        : "var(--input-bg)",
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
                          style={{
                            background: "var(--accent)",
                            color: "#ffffff",
                          }}
                        >
                          <Check className="w-2.5 h-2.5" />
                        </span>
                      )}
                    </div>
                    <span
                      className="text-[10px] font-medium"
                      style={{ color: "var(--accent)" }}
                    >
                      {opt.tagline}
                    </span>
                    <span
                      className="text-[11px] leading-snug"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {opt.description}
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
                  setDraft({ ...draft, stuck_minutes: Number(e.target.value) })
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
                  setDraft({ ...draft, notify_on_blocked: e.target.checked })
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
                  setDraft({ ...draft, show_merge_overlap: e.target.checked })
                }
              />
              Show Merge Overlap Radar badge (same relative file modified in 2+
              worktrees)
            </label>
          </div>

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
                    className="jjdr-input w-32 px-3 py-1.5 rounded-full"
                  />
                  <input
                    type="text"
                    value={p.prompt}
                    placeholder="AI에게 보낼 프롬프트 내용..."
                    onChange={(e) => updatePreset(i, { prompt: e.target.value })}
                    className="jjdr-input flex-1 px-3 py-1.5 rounded-full"
                  />
                  <button
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

        <div
          className="px-5 py-3.5 flex justify-end gap-2"
          style={{
            background: "var(--modal-footer)",
            borderTop: "1px solid var(--divider)",
          }}
        >
          <button
            onClick={() => setOpen(false)}
            className="px-4 py-1.5 rounded-full text-xs font-medium cursor-pointer"
            style={{ color: "var(--text-muted)" }}
          >
            Close
          </button>
          <button
            onClick={() => void handleSave()}
            className="jjdr-primary-btn px-4 py-1.5 rounded-full text-xs font-semibold cursor-pointer"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
});
