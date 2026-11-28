import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pause,
  Play,
  Plus,
  RefreshCw,
  Users,
} from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import {
  listAuthoredTeamReviews,
  listAutoReviewJobs,
  reconnectTeamRelay,
  saveSettings,
} from "../../services/tauriBridge";
import { normalizeTeamSettings } from "../../utils/teamSettings";
import {
  sortIncomingAutoReviews,
  sortOutgoingReviews,
} from "../../utils/zenReviews";
import { ZenOutgoingReviewsColumn } from "./ZenOutgoingReviewsColumn";
import { ZenIncomingReviewsColumn } from "./ZenIncomingReviewsColumn";

const AUTO_REFRESH_COOLDOWN_MS = 5_000;
let lastAutoRefreshMs = 0;

export const ZenReviewsView = React.memo(function ZenReviewsView() {
  const projects = useAppStore((s) => s.projects);
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const teamSnapshot = useAppStore((s) => s.teamSnapshot);
  const authoredReviews = useAppStore((s) => s.authoredReviews);
  const setAuthoredReviews = useAppStore((s) => s.setAuthoredReviews);
  const autoReviewJobs = useAppStore((s) => s.autoReviewJobs);
  const setAutoReviewJobs = useAppStore((s) => s.setAutoReviewJobs);

  const setManualModalOpen = useUiStore((s) => s.setManualReviewModalOpen);
  const setSelectedAddress = useUiStore((s) => s.setSelectedAddress);
  const setAttachedAddress = useUiStore((s) => s.setAttachedAddress);
  const requestTerminalFocus = useUiStore((s) => s.requestTerminalFocus);
  const showToast = useUiStore((s) => s.showToast);

  const [refreshing, setRefreshing] = useState(false);

  const peers = teamSnapshot?.peers ?? [];
  const relayConnected = teamSnapshot?.connected ?? false;
  const isPaused = settings.team?.auto_review_paused ?? false;

  const sortedOutgoing = useMemo(
    () => sortOutgoingReviews(authoredReviews, peers),
    [authoredReviews, peers]
  );
  const sortedIncoming = useMemo(
    () => sortIncomingAutoReviews(autoReviewJobs),
    [autoReviewJobs]
  );

  const onlinePeers = useMemo(
    () => peers.filter((p) => p.status === "online"),
    [peers]
  );
  const pausedPeers = useMemo(
    () => peers.filter((p) => p.status === "paused"),
    [peers]
  );

  const handleRefresh = useCallback(
    async (force = true) => {
      const now = Date.now();
      if (!force && now - lastAutoRefreshMs < AUTO_REFRESH_COOLDOWN_MS) {
        return;
      }
      lastAutoRefreshMs = now;
      setRefreshing(true);
      try {
        if (!useAppStore.getState().teamSnapshot?.connected) {
          await reconnectTeamRelay().catch(() => null);
        }
        const [authored, jobs] = await Promise.all([
          listAuthoredTeamReviews().catch(() => null),
          listAutoReviewJobs().catch(() => null),
        ]);
        if (authored) setAuthoredReviews(authored);
        if (jobs) setAutoReviewJobs(jobs);
      } finally {
        setRefreshing(false);
      }
    },
    [setAuthoredReviews, setAutoReviewJobs]
  );

  // Cooldown-guarded one-shot refresh on entering Reviews tab (zero background polling)
  useEffect(() => {
    void handleRefresh(false);
  }, [handleRefresh]);

  const handleOpenManualModal = useCallback(() => {
    setManualModalOpen(true);
  }, [setManualModalOpen]);

  const handleTogglePause = useCallback(async () => {
    const normalized = normalizeTeamSettings(settings.team);
    const nextPaused = !normalized.auto_review_paused;
    const nextSettings = {
      ...settings,
      team: { ...normalized, auto_review_paused: nextPaused },
    };
    setSettings(nextSettings);
    try {
      await saveSettings(nextSettings);
      showToast(
        nextPaused
          ? "자동 리뷰 수신 일시정지 (Paused)"
          : "자동 리뷰 수신 재개 (Receiving ON)",
        "info",
        1800
      );
    } catch (err) {
      showToast(`설정 저장 실패: ${String(err)}`, "error");
    }
  }, [settings, setSettings, showToast]);

  const handlePeekTerminal = useCallback(
    (address: string) => {
      setSelectedAddress(address);
      setAttachedAddress(address);
      requestTerminalFocus();
    },
    [setSelectedAddress, setAttachedAddress, requestTerminalFocus]
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 pt-3">
      {/* Compact 1-Line Top Control Bar */}
      <div
        className="rounded-2xl px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap shrink-0"
        style={{
          background: "var(--card-bg)",
          border: "1px solid var(--card-border)",
        }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setManualModalOpen(true)}
            disabled={!relayConnected}
            title={
              relayConnected
                ? "내 오픈 PR 목록 또는 PR 번호로 수동 리뷰 요청"
                : "Relay 연결 후 리뷰 요청 가능"
            }
            className="jjdr-primary-btn inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Request Review</span>
          </button>

          <button
            type="button"
            onClick={() => void handleRefresh(true)}
            title="리뷰 현황 새로고침"
            className="jjdr-pill inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-semibold cursor-pointer"
            style={{ color: "var(--text-secondary)" }}
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>

          <span
            className="text-[11px] font-mono-code hidden md:inline"
            style={{ color: "var(--text-faint)" }}
          >
            Ctrl+Shift+R / Esc · Inbox 복귀 · 새 승인/완료 도착 시 자동 전환
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Online Peers Strip */}
          <div
            className="jjdr-pill inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-mono-code"
            style={{ color: "var(--text-secondary)" }}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{
                background: relayConnected
                  ? isPaused
                    ? "var(--warn-fg)"
                    : "var(--ready-fg)"
                  : "var(--action-fg)",
              }}
            />
            <Users className="w-3 h-3 shrink-0" style={{ color: "var(--text-muted)" }} />
            <span>
              {relayConnected ? `Online ${onlinePeers.length}` : "Relay Offline"}
            </span>
            {onlinePeers.slice(0, 4).map((p) => (
              <span
                key={p.github_id}
                className="px-1.5 py-0.2 rounded-full text-[10px]"
                style={{
                  background: "var(--ready-soft)",
                  color: "var(--ready-fg)",
                }}
              >
                @{p.github_id}
              </span>
            ))}
            {pausedPeers.slice(0, 2).map((p) => (
              <span
                key={p.github_id}
                className="px-1.5 py-0.2 rounded-full text-[10px]"
                style={{
                  background: "var(--warn-soft)",
                  color: "var(--warn-fg)",
                }}
              >
                @{p.github_id} ⏸
              </span>
            ))}
          </div>

          {/* 1-Click Auto-Review Receiving Toggle */}
          <button
            type="button"
            onClick={() => void handleTogglePause()}
            className="jjdr-pill inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold cursor-pointer"
            style={{
              background: isPaused ? "var(--warn-soft)" : "var(--ready-soft)",
              borderColor: isPaused ? "var(--warn-border)" : "var(--ready-border)",
              color: isPaused ? "var(--warn-fg)" : "var(--ready-fg)",
            }}
            title="클릭하여 자동 리뷰 수신 일시정지 / 재개"
          >
            {isPaused ? (
              <>
                <Play className="w-3 h-3" />
                <span>Paused</span>
              </>
            ) : (
              <>
                <Pause className="w-3 h-3" />
                <span>Receiving ON</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 2-Column Reviews Board: Left Outgoing | Right Incoming */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ZenOutgoingReviewsColumn
          reviews={sortedOutgoing}
          peers={peers}
          projects={projects}
          relayConnected={relayConnected}
          onOpenManualModal={handleOpenManualModal}
        />
        <ZenIncomingReviewsColumn
          jobs={sortedIncoming}
          onPeekTerminal={handlePeekTerminal}
        />
      </div>
    </div>
  );
});
