import React, { useEffect, useState } from "react";
import {
  Palette,
  Plug,
  Settings,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import {
  hideBgOverlay,
  saveSettings,
  showBgOverlay,
} from "../../services/tauriBridge";
import {
  buildPreviewBgOverlayPayload,
  normalizeBgOverlayPosition,
} from "../../utils/bgOverlay";
import {
  normalizeTeamSettings,
  validateTeamSettings,
} from "../../utils/teamSettings";
import { AppearanceSettingsTab } from "./settings/AppearanceSettingsTab";
import { GeneralSettingsTab } from "./settings/GeneralSettingsTab";
import { TeamOrchestrationSettingsTab } from "./settings/TeamOrchestrationSettingsTab";
import { IntegrationsSettingsTab } from "./settings/IntegrationsSettingsTab";
import type {
  AppSettings,
  BgOverlayPosition,
  RadarDensity,
  RootCardMode,
  ThemeId,
} from "../../types/domain";

type SettingsTabId = "appearance" | "general" | "team" | "integrations";

const SETTINGS_TABS: Array<{
  id: SettingsTabId;
  label: string;
  desc: string;
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}> = [
  {
    id: "appearance",
    label: "Appearance",
    desc: "테마 · 레이더 · ROOT",
    Icon: Palette,
  },
  {
    id: "general",
    label: "General & HUD",
    desc: "알림 · HUD · 프리셋",
    Icon: SlidersHorizontal,
  },
  {
    id: "team",
    label: "Team Orchestration",
    desc: "Relay · 자동 리뷰 · Reject",
    Icon: Users,
  },
  {
    id: "integrations",
    label: "Bridges & Updates",
    desc: "Gemini 훅 · 업데이트",
    Icon: Plug,
  },
];

export const SettingsModal = React.memo(function SettingsModal() {
  const open = useUiStore((s) => s.settingsOpen);
  const setOpen = useUiStore((s) => s.setSettingsOpen);
  const radarColumnWidthPx = useUiStore((s) => s.radarColumnWidthPx);
  const setRadarColumnWidthPx = useUiStore((s) => s.setRadarColumnWidthPx);
  const showToast = useUiStore((s) => s.showToast);
  const current = useAppStore((s) => s.settings);
  const teamSnapshot = useAppStore((s) => s.teamSnapshot);

  const [activeTab, setActiveTab] = useState<SettingsTabId>("appearance");
  const [draft, setDraft] = useState<AppSettings>(current);

  useEffect(() => {
    if (open) {
      setDraft({
        ...current,
        team: normalizeTeamSettings(current.team),
      });
    }
  }, [open, current]);

  if (!open) return null;

  const persistImmediate = (next: AppSettings) => {
    setDraft(next);
    useAppStore.getState().setSettings(next);
    void saveSettings(next).catch(() => {});
  };

  const handleSelectTheme = (themeId: ThemeId) => {
    persistImmediate({ ...draft, theme: themeId });
  };

  const handleSelectDensity = (density: RadarDensity) => {
    persistImmediate({ ...draft, radar_density: density });
  };

  const handleSelectRootMode = (mode: RootCardMode) => {
    persistImmediate({ ...draft, root_card_mode: mode });
  };

  const handleToggleBgOverlay = () => {
    const nextEnabled = !(draft.bg_overlay_enabled ?? false);
    persistImmediate({ ...draft, bg_overlay_enabled: nextEnabled });
    if (!nextEnabled) {
      void hideBgOverlay(true).catch(() => {});
    }
  };

  const handleSelectBgOverlayPosition = (position: BgOverlayPosition) => {
    persistImmediate({ ...draft, bg_overlay_position: position });
  };

  const handlePreviewBgOverlay = () => {
    const pos = normalizeBgOverlayPosition(draft.bg_overlay_position);
    const { computed, worktreeMeta } = useAppStore.getState();
    const payload = buildPreviewBgOverlayPayload(
      computed.allSessions,
      pos,
      draft.theme,
      worktreeMeta
    );
    void showBgOverlay(payload, true).catch(() => {});
  };

  const handleSave = async () => {
    const normalizedTeam = normalizeTeamSettings(draft.team);
    const validationErr = validateTeamSettings(normalizedTeam);
    if (validationErr) {
      setActiveTab("team");
      showToast(validationErr, "error");
      return;
    }

    const latestSkipped =
      useAppStore.getState().settings.skipped_update_version ?? null;
    const toSave: AppSettings = {
      ...draft,
      team: normalizedTeam,
      skipped_update_version: latestSkipped,
    };
    useAppStore.getState().setSettings(toSave);
    await saveSettings(toSave).catch(() => {});
    showToast("설정이 저장되었습니다", "success");
    setOpen(false);
  };

  const teamDotColor =
    teamSnapshot?.state === "connected"
      ? "var(--ready-fg)"
      : teamSnapshot?.state === "paused"
      ? "var(--warn-fg)"
      : teamSnapshot?.state === "error"
      ? "var(--action-fg)"
      : "var(--text-faint)";

  return (
    <div
      onClick={() => setOpen(false)}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "var(--modal-overlay)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="jjdr-modal w-[94vw] max-w-[940px] h-[min(84vh,760px)] rounded-[22px] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div
          className="px-5 py-3.5 flex items-center justify-between shrink-0"
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
            type="button"
            onClick={() => setOpen(false)}
            className="p-1.5 rounded-full hover:bg-black/10 cursor-pointer"
            style={{ color: "var(--text-muted)" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 2-Column Body: Left Sidebar Tabs + Wide Right Content */}
        <div className="flex-1 min-h-0 flex">
          <nav
            className="w-[212px] shrink-0 p-3 space-y-1.5 overflow-y-auto"
            style={{
              background: "var(--sidebar-bg, var(--input-bg))",
              borderRight: "1px solid var(--divider)",
            }}
          >
            {SETTINGS_TABS.map(({ id, label, desc, Icon }) => {
              const active = activeTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className="w-full text-left rounded-2xl px-3 py-2.5 cursor-pointer flex items-start gap-2.5 transition-colors"
                  style={{
                    background: active ? "var(--accent-soft)" : "transparent",
                    border: `1px solid ${
                      active ? "var(--accent)" : "transparent"
                    }`,
                  }}
                >
                  <Icon
                    className="w-4 h-4 mt-0.5 shrink-0"
                    style={{
                      color: active ? "var(--accent)" : "var(--text-muted)",
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1.5">
                      <span
                        className="text-xs font-bold truncate"
                        style={{
                          color: active
                            ? "var(--text-primary)"
                            : "var(--text-secondary)",
                        }}
                      >
                        {label}
                      </span>
                      {id === "team" && (
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ background: teamDotColor }}
                          title={`Relay: ${teamSnapshot?.state ?? "disabled"}`}
                        />
                      )}
                    </div>
                    <div
                      className="text-[10px] mt-0.5 truncate"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {desc}
                    </div>
                  </div>
                </button>
              );
            })}
          </nav>

          <div className="flex-1 min-w-0 p-5 text-xs overflow-y-auto">
            {activeTab === "appearance" && (
              <AppearanceSettingsTab
                draft={draft}
                radarColumnWidthPx={radarColumnWidthPx}
                onSelectTheme={handleSelectTheme}
                onSelectDensity={handleSelectDensity}
                onSelectRootMode={handleSelectRootMode}
                onChangeRadarColumnWidth={setRadarColumnWidthPx}
              />
            )}
            {activeTab === "general" && (
              <GeneralSettingsTab
                draft={draft}
                onChangeDraft={setDraft}
                onToggleBgOverlay={handleToggleBgOverlay}
                onSelectBgOverlayPosition={handleSelectBgOverlayPosition}
                onPreviewBgOverlay={handlePreviewBgOverlay}
              />
            )}
            {activeTab === "team" && (
              <TeamOrchestrationSettingsTab
                draft={draft}
                onChangeDraft={setDraft}
              />
            )}
            {activeTab === "integrations" && <IntegrationsSettingsTab />}
          </div>
        </div>

        {/* Footer */}
        <div
          className="px-5 py-3.5 flex justify-end gap-2 shrink-0"
          style={{
            background: "var(--modal-footer)",
            borderTop: "1px solid var(--divider)",
          }}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="px-4 py-1.5 rounded-full text-xs font-medium cursor-pointer"
            style={{ color: "var(--text-muted)" }}
          >
            Close
          </button>
          <button
            type="button"
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
