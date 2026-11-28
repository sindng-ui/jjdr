import React from "react";
import { GitPullRequest, Inbox, Send, Sparkles, Volume2, VolumeX } from "lucide-react";
import type { ZenModeTab } from "../../store/useUiStore";
import type { ZenCardStyle } from "../../utils/zenQueue";
import type { ChillBackdropConfig } from "../../utils/zenChillBackdrop";
import { ZenChillBackdropPicker } from "./ZenChillBackdropPicker";

interface ZenModeTopBarProps {
  zenModeTab: ZenModeTab;
  teamEnabled: boolean;
  actionableCount: number;
  totalDispatchAvailable: number;
  reviewBadgeCount: number;
  reviewHasAttention: boolean;
  styleMode: ZenCardStyle;
  isAllClearStage: boolean;
  chillConfig: ChillBackdropConfig;
  peekSceneryOnly: boolean;
  photoVersion: number;
  sfxEnabled: boolean;
  clearedToday: number;
  onSelectInbox: () => void;
  onSelectDispatch: () => void;
  onSelectReviews: () => void;
  onChangeStyle: (style: ZenCardStyle) => void;
  onChangeChillConfig: (next: ChillBackdropConfig) => void;
  onTogglePeekScenery: () => void;
  onPhotoChanged: () => void;
  onToggleSfx: () => void;
  onOpenRecap: () => void;
}

export const ZenModeTopBar = React.memo(function ZenModeTopBar({
  zenModeTab,
  teamEnabled,
  actionableCount,
  totalDispatchAvailable,
  reviewBadgeCount,
  reviewHasAttention,
  styleMode,
  isAllClearStage,
  chillConfig,
  peekSceneryOnly,
  photoVersion,
  sfxEnabled,
  clearedToday,
  onSelectInbox,
  onSelectDispatch,
  onSelectReviews,
  onChangeStyle,
  onChangeChillConfig,
  onTogglePeekScenery,
  onPhotoChanged,
  onToggleSfx,
  onOpenRecap,
}: ZenModeTopBarProps) {
  const isInbox = zenModeTab === "inbox";
  const isDispatch = zenModeTab === "dispatch";
  const isReviews = zenModeTab === "reviews";

  return (
    <div className="relative z-20 flex items-center justify-between gap-2 flex-wrap shrink-0 select-none">
      <div className="flex items-center gap-2.5 flex-wrap">
        <div className="jjdr-pill inline-flex items-center rounded-full p-0.5 text-xs">
          <button
            type="button"
            onClick={onSelectInbox}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full cursor-pointer transition-colors ${
              isInbox ? "jjdr-pill-active font-bold" : ""
            }`}
            style={isInbox ? undefined : { color: "var(--text-muted)" }}
            title="Focus on actionable review cards"
          >
            <Inbox className="w-3.5 h-3.5" />
            <span>Inbox</span>
            {actionableCount > 0 && (
              <span
                className="text-[10px] font-mono-code px-1.5 py-0.2 rounded-full"
                style={{
                  background: "var(--action-soft)",
                  color: "var(--action-fg)",
                }}
              >
                {actionableCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={onSelectDispatch}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full cursor-pointer transition-colors ${
              isDispatch ? "jjdr-pill-active font-bold" : ""
            }`}
            style={isDispatch ? undefined : { color: "var(--text-muted)" }}
            title="Hire or assign a standby worker (Ctrl+Shift+D)"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Dispatch</span>
            {totalDispatchAvailable > 0 && (
              <span
                className="text-[10px] font-mono-code px-1.5 py-0.2 rounded-full"
                style={{
                  background: "var(--ready-soft)",
                  color: "var(--ready-fg)",
                }}
              >
                {totalDispatchAvailable}
              </span>
            )}
          </button>

          {teamEnabled && (
            <button
              type="button"
              onClick={onSelectReviews}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full cursor-pointer transition-colors ${
                isReviews ? "jjdr-pill-active font-bold" : ""
              }`}
              style={isReviews ? undefined : { color: "var(--text-muted)" }}
              title="Team PR Reviews Dashboard (Ctrl+Shift+R · Esc returns to Inbox)"
            >
              <GitPullRequest className="w-3.5 h-3.5" />
              <span>Reviews</span>
              {reviewBadgeCount > 0 && (
                <span
                  className="text-[10px] font-mono-code px-1.5 py-0.2 rounded-full"
                  style={{
                    background: reviewHasAttention
                      ? "var(--warn-soft)"
                      : "var(--run-soft)",
                    color: reviewHasAttention
                      ? "var(--warn-fg)"
                      : "var(--run-fg)",
                  }}
                >
                  {reviewBadgeCount}
                </span>
              )}
            </button>
          )}
        </div>

        {!isReviews && (
          <div className="jjdr-pill inline-flex items-center rounded-full p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => onChangeStyle("holo_stamp")}
              className={`px-2.5 py-0.5 rounded-full cursor-pointer transition-colors ${
                styleMode === "holo_stamp" ? "jjdr-pill-active font-semibold" : ""
              }`}
              style={
                styleMode === "holo_stamp"
                  ? undefined
                  : { color: "var(--text-muted)" }
              }
            >
              Holo + Lever
            </button>
            <button
              type="button"
              onClick={() => onChangeStyle("gacha_dial")}
              className={`px-2.5 py-0.5 rounded-full cursor-pointer transition-colors ${
                styleMode === "gacha_dial" ? "jjdr-pill-active font-semibold" : ""
              }`}
              style={
                styleMode === "gacha_dial"
                  ? undefined
                  : { color: "var(--text-muted)" }
              }
            >
              Gacha Dial
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {isAllClearStage && (
          <ZenChillBackdropPicker
            config={chillConfig}
            peekSceneryOnly={peekSceneryOnly}
            photoVersion={photoVersion}
            onChange={onChangeChillConfig}
            onTogglePeekScenery={onTogglePeekScenery}
            onPhotoChanged={onPhotoChanged}
          />
        )}

        <button
          type="button"
          onClick={onToggleSfx}
          title={
            sfxEnabled
              ? "Zen tactile SFX ON (click to mute)"
              : "Zen tactile SFX muted (click to enable)"
          }
          className="jjdr-pill h-7 w-7 rounded-full inline-flex items-center justify-center cursor-pointer transition-colors"
          style={{
            color: sfxEnabled ? "var(--text-primary)" : "var(--text-faint)",
          }}
        >
          {sfxEnabled ? (
            <Volume2 className="w-3.5 h-3.5" />
          ) : (
            <VolumeX className="w-3.5 h-3.5" />
          )}
        </button>

        <button
          type="button"
          onClick={onOpenRecap}
          title="View Daily Work Recap & copy Standup Markdown"
          className="jjdr-pill inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-mono-code font-semibold tabular-nums cursor-pointer transition-transform active:scale-[0.98]"
          style={{ color: "var(--warn-fg)" }}
        >
          <Sparkles className="w-3 h-3" />
          {clearedToday} Cleared Today
        </button>
      </div>
    </div>
  );
});
