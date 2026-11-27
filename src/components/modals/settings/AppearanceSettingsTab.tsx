import React from "react";
import { Check, LayoutGrid, Palette } from "lucide-react";
import { RADAR_DENSITY_PRESETS, THEME_PRESETS } from "../../../utils/themes";
import {
  getRadarColumnWidthPx,
  MAX_RADAR_COLUMN_WIDTH_PX,
  MIN_RADAR_COLUMN_WIDTH_PX,
  RADAR_COLUMN_WIDTH_STEP_PX,
} from "../../../utils/radarLayout";
import type {
  AppSettings,
  RadarDensity,
  RootCardMode,
  ThemeId,
} from "../../../types/domain";

interface AppearanceSettingsTabProps {
  draft: AppSettings;
  radarColumnWidthPx: number | null;
  onSelectTheme: (themeId: ThemeId) => void;
  onSelectDensity: (density: RadarDensity) => void;
  onSelectRootMode: (mode: RootCardMode) => void;
  onChangeRadarColumnWidth: (px: number | null) => void;
}

export const AppearanceSettingsTab = React.memo(function AppearanceSettingsTab({
  draft,
  radarColumnWidthPx,
  onSelectTheme,
  onSelectDensity,
  onSelectRootMode,
  onChangeRadarColumnWidth,
}: AppearanceSettingsTabProps) {
  return (
    <div className="space-y-5">
      {/* 4-Theme One-Click Visual Switcher */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Palette className="w-3.5 h-3.5" style={{ color: "var(--accent)" }} />
            <span
              className="font-bold text-xs"
              style={{ color: "var(--text-primary)" }}
            >
              테마 선택 (원클릭 즉시 적용)
            </span>
          </div>
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
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
                onClick={() => onSelectTheme(preset.id)}
                className="jjdr-card-lift text-left rounded-2xl p-3 cursor-pointer flex flex-col gap-2.5"
                style={{
                  background: active ? "var(--accent-soft)" : "var(--input-bg)",
                  border: `1.5px solid ${
                    active ? "var(--accent)" : "var(--input-border)"
                  }`,
                }}
              >
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
                      style={{ background: "var(--accent)", color: "#ffffff" }}
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

      {/* Radar Row Density Switcher */}
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
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            원클릭 즉시 적용
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          {RADAR_DENSITY_PRESETS.map((opt) => {
            const active = draft.radar_density === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onSelectDensity(opt.id)}
                className="jjdr-card-lift text-left rounded-2xl p-3 cursor-pointer flex flex-col gap-1.5"
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

        {/* Radar Columns Mode Custom Width Slider */}
        <div
          className="rounded-2xl p-3.5 space-y-2"
          style={{
            background: "var(--input-bg)",
            border: "1px solid var(--input-border)",
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <div
                className="text-xs font-bold"
                style={{ color: "var(--text-primary)" }}
              >
                Columns Mode Column Width
              </div>
              <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                Wide range ({MIN_RADAR_COLUMN_WIDTH_PX}px –{" "}
                {MAX_RADAR_COLUMN_WIDTH_PX}px) for any monitor resolution
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span
                className="text-xs font-mono-code font-bold tabular-nums px-2 py-0.5 rounded-full"
                style={{ background: "var(--pill-bg)", color: "var(--accent)" }}
              >
                {getRadarColumnWidthPx(draft.radar_density, radarColumnWidthPx)}px
              </span>
              {radarColumnWidthPx !== null && (
                <button
                  type="button"
                  onClick={() => onChangeRadarColumnWidth(null)}
                  className="text-[11px] font-semibold hover:underline cursor-pointer"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Auto
                </button>
              )}
            </div>
          </div>
          <input
            type="range"
            min={MIN_RADAR_COLUMN_WIDTH_PX}
            max={MAX_RADAR_COLUMN_WIDTH_PX}
            step={RADAR_COLUMN_WIDTH_STEP_PX}
            value={getRadarColumnWidthPx(draft.radar_density, radarColumnWidthPx)}
            onChange={(e) => onChangeRadarColumnWidth(Number(e.target.value))}
            aria-label="Radar columns width"
            className="w-full h-1.5 cursor-pointer accent-[var(--accent)]"
          />
          <div
            className="flex items-center justify-between text-[10px] font-mono-code tabular-nums"
            style={{ color: "var(--text-faint)" }}
          >
            <span>{MIN_RADAR_COLUMN_WIDTH_PX}px</span>
            <span>340px</span>
            <span>450px</span>
            <span>{MAX_RADAR_COLUMN_WIDTH_PX}px</span>
          </div>
        </div>
      </div>

      {/* ROOT Card Display Mode */}
      <div
        className="pt-4 space-y-2.5"
        style={{ borderTop: "1px solid var(--divider)" }}
      >
        <div className="flex items-center justify-between">
          <span
            className="font-bold text-xs"
            style={{ color: "var(--text-primary)" }}
          >
            프로젝트 ROOT 카드 표시 방식
          </span>
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            원클릭 즉시 적용
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {(
            [
              {
                id: "header_chip",
                label: "헤더 칩 (추천)",
                desc: "Worktree가 있으면 헤더에 컴팩트 칩으로 접기",
              },
              {
                id: "card",
                label: "그리드 카드",
                desc: "기존처럼 일반 Worktree 카드로 표시",
              },
              {
                id: "hidden",
                label: "숨기기",
                desc: "Worktree가 있을 때 ROOT 표시 안 함",
              },
            ] as const
          ).map((opt) => {
            const active = (draft.root_card_mode ?? "header_chip") === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onSelectRootMode(opt.id)}
                className="jjdr-card-lift text-left rounded-2xl p-2.5 cursor-pointer flex flex-col gap-1"
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
    </div>
  );
});
