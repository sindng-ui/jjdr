import type {
  BgOverlayPayload,
  BgOverlayPosition,
  EnrichedSession,
  ThemeId,
} from "../types/domain";
import { cardKeyForSession } from "./worktreeSessions";

export interface BgOverlayPositionPreset {
  id: BgOverlayPosition;
  label: string;
  desc: string;
}

export const BG_OVERLAY_POSITION_PRESETS: BgOverlayPositionPreset[] = [
  {
    id: "top_center",
    label: "중앙 상단 (기본)",
    desc: "시선이 가장 먼저 닿는 화면 위쪽 중앙",
  },
  {
    id: "bottom_center",
    label: "중앙 하단",
    desc: "작업 표시줄 위쪽 중앙에 깔끔하게 표시",
  },
  {
    id: "bottom_right",
    label: "우하단",
    desc: "기존 알림처럼 오른쪽 하단 구석에 표시",
  },
];

export function normalizeBgOverlayPosition(pos?: string | null): BgOverlayPosition {
  if (pos === "bottom_center" || pos === "bottom_right") return pos;
  return "top_center";
}

export interface TopBgOverlaySelection {
  top: EnrichedSession | null;
  pendingCount: number;
}

/**
 * Selects the single highest-priority actionable card across ALL live sessions
 * (unfiltered by sidebar search/group so urgent alerts from other projects are never missed).
 * Priority: `needs_you` strictly above `ready`, then `priorityScore` descending,
 * deduplicated per worktree card.
 */
export function selectTopBgOverlayCandidate(
  allSessions: EnrichedSession[]
): TopBgOverlaySelection {
  const actionable = allSessions.filter(
    (s) =>
      s.terminal.state === "live" &&
      (s.bucket === "needs_you" || s.bucket === "ready")
  );
  if (actionable.length === 0) {
    return { top: null, pendingCount: 0 };
  }

  const sorted = [...actionable].sort((a, b) => {
    const bucketDiff = (a.bucket === "needs_you" ? 0 : 1) - (b.bucket === "needs_you" ? 0 : 1);
    if (bucketDiff !== 0) return bucketDiff;
    if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
    return a.address.localeCompare(b.address);
  });

  const seenCards = new Set<string>();
  const uniqueCards: EnrichedSession[] = [];
  for (const s of sorted) {
    const key = cardKeyForSession(s);
    if (!seenCards.has(key)) {
      seenCards.add(key);
      uniqueCards.push(s);
    }
  }

  return {
    top: uniqueCards[0] ?? null,
    pendingCount: uniqueCards.length,
  };
}

function summarizeSessionMessage(session: EnrichedSession): string {
  const statusMsg = session.terminal.status?.msg?.trim();
  if (statusMsg) return statusMsg;

  const lines = session.previewLines
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length > 0) {
    return lines[lines.length - 1];
  }

  if (session.bucket === "needs_you") {
    if (session.isStuck) {
      return `${session.stuckMinutes}분 이상 응답 대기 중 — 터미널을 확인해 주세요.`;
    }
    if (session.terminal.status?.state === "error") {
      return "오류가 발생했습니다. 터미널에서 원인을 확인해 주세요.";
    }
    return "승인 또는 입력을 기다리고 있습니다.";
  }

  return "작업이 완료되었습니다. 결과를 확인하고 다음 지시를 내려주세요.";
}

function resolveBadgeLabel(session: EnrichedSession): {
  badge: string;
  isApproval: boolean;
} {
  const st = session.terminal.status?.state;
  const kind = session.terminal.status?.kind;

  if (session.bucket === "needs_you") {
    if (st === "blocked" && kind === "permission") {
      return { badge: "APPROVAL", isApproval: true };
    }
    if (st === "blocked") {
      return { badge: "NEEDS INPUT", isApproval: true };
    }
    if (st === "error") {
      return { badge: "ERROR", isApproval: false };
    }
    if (session.isStuck) {
      return { badge: `STUCK ${session.stuckMinutes}m`, isApproval: false };
    }
    return { badge: "ACTION", isApproval: true };
  }

  return { badge: "READY", isApproval: false };
}

export function buildBgOverlayPayload(
  session: EnrichedSession,
  pendingCount: number,
  position: BgOverlayPosition,
  theme: ThemeId,
  isPreview = false
): BgOverlayPayload {
  const cardKey = cardKeyForSession(session);
  const message = summarizeSessionMessage(session).slice(0, 180);
  const { badge, isApproval } = resolveBadgeLabel(session);
  const stamp = `${cardKey}|${session.address}|${session.bucket}|${badge}|${session.terminal.turn}|${message.slice(0, 64)}`;

  return {
    card_key: cardKey,
    address: session.address,
    bucket: session.bucket,
    badge,
    project_name: session.projectName,
    project_color: session.projectColor,
    branch: session.branch || session.terminal.name || session.address,
    agent_label: session.agentLabel || "AI",
    message,
    pending_count: Math.max(1, pendingCount),
    is_approval: isApproval,
    position,
    theme,
    stamp,
    is_preview: isPreview,
  };
}

export function buildPreviewBgOverlayPayload(
  allSessions: EnrichedSession[],
  position: BgOverlayPosition,
  theme: ThemeId
): BgOverlayPayload {
  const { top, pendingCount } = selectTopBgOverlayCandidate(allSessions);
  if (top) {
    return buildBgOverlayPayload(top, pendingCount, position, theme, true);
  }

  return {
    card_key: "__preview__",
    address: "",
    bucket: "needs_you",
    badge: "APPROVAL",
    project_name: "jjdr",
    project_color: "#818cf8",
    branch: "feat/bg-priority-hud",
    agent_label: "claude",
    message: "백그라운드 최우선 카드 알림 미리보기입니다. 클릭하면 앱으로 바로 이동합니다.",
    pending_count: 3,
    is_approval: true,
    position,
    theme,
    stamp: `preview|${position}|${Date.now()}`,
    is_preview: true,
  };
}
