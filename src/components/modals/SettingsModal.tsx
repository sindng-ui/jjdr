import React, { useEffect, useState } from "react";
import { Plus, Settings, Trash2, X } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import { saveSettings } from "../../services/tauriBridge";
import type { AppSettings, PromptPreset } from "../../types/domain";

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
    showToast("Saved settings", "success");
    setOpen(false);
  };

  return (
    <div
      onClick={() => setOpen(false)}
      className="fixed inset-0 z-50 bg-[#05070a]/80 flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl bg-[#111318] border border-[#252932] overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-[#1c1f26] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-[#58a6ff]" />
            <h3 className="text-sm font-bold text-[#e6edf3]">
              Mission Control Settings
            </h3>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="text-[#8b949e] hover:text-[#e6edf3] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 text-xs max-h-[70vh] overflow-y-auto">
          <div className="space-y-2">
            <label className="flex items-center justify-between">
              <span className="text-[#c9d1d9]">
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
                className="w-20 px-2 py-1 rounded bg-[#0b0c0e] border border-[#222630] text-[#e6edf3] text-right"
              />
            </label>

            <label className="flex items-center gap-2 text-[#c9d1d9] cursor-pointer">
              <input
                type="checkbox"
                checked={draft.notify_on_blocked}
                onChange={(e) =>
                  setDraft({ ...draft, notify_on_blocked: e.target.checked })
                }
              />
              Calm OS notification when an AI session is Blocked / Error
            </label>

            <label className="flex items-center gap-2 text-[#c9d1d9] cursor-pointer">
              <input
                type="checkbox"
                checked={draft.show_merge_overlap}
                onChange={(e) =>
                  setDraft({ ...draft, show_merge_overlap: e.target.checked })
                }
              />
              Show Merge Overlap Radar badge (same relative file modified in 2+ worktrees)
            </label>
          </div>

          <div className="pt-3 border-t border-[#1c1f26] space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-semibold text-[#e6edf3]">
                  카드 원클릭 프롬프트 프리셋
                </span>
                <p className="text-[11px] text-[#8b949e]">
                  버튼 이름과 보낼 프롬프트를 자유롭게 추가·수정·삭제할 수 있습니다.
                </p>
              </div>
              <button
                onClick={addPreset}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#1f2a3d] hover:bg-[#2a3952] text-[#79c0ff] border border-[#388bfd]/40 shrink-0 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                추가
              </button>
            </div>
            <div className="space-y-2">
              {draft.prompt_presets.map((p, i) => (
                <div key={p.id} className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={p.label}
                    placeholder="버튼 이름"
                    onChange={(e) => updatePreset(i, { label: e.target.value })}
                    className="w-32 px-2 py-1.5 rounded bg-[#0b0c0e] border border-[#222630] focus:border-[#58a6ff] focus:outline-none text-[#e6edf3]"
                  />
                  <input
                    type="text"
                    value={p.prompt}
                    placeholder="AI에게 보낼 프롬프트 내용..."
                    onChange={(e) => updatePreset(i, { prompt: e.target.value })}
                    className="flex-1 px-2 py-1.5 rounded bg-[#0b0c0e] border border-[#222630] focus:border-[#58a6ff] focus:outline-none text-[#e6edf3]"
                  />
                  <button
                    onClick={() => removePreset(i)}
                    title="삭제"
                    className="p-1 text-[#8b949e] hover:text-[#ff7b72] cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-4 py-3 bg-[#0e1014] border-t border-[#1c1f26] flex justify-end gap-2">
          <button
            onClick={() => setOpen(false)}
            className="px-3 py-1.5 rounded text-xs text-[#9aa7b8] cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            className="px-4 py-1.5 rounded text-xs font-semibold bg-[#238636] hover:bg-[#2ea043] text-white cursor-pointer"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
});
