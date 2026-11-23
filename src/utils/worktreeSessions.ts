import type { EnrichedSession } from "../types/domain";
import { normalizePath } from "../workers/dashboardLogic";

const PLAIN_SHELL_LABELS = new Set([
  "shell",
  "pwsh",
  "powershell",
  "cmd",
  "bash",
  "zsh",
  "sh",
  "fish",
]);

export function isPlainShellSession(session: EnrichedSession): boolean {
  const lbl = (session.agentLabel || "").trim().toLowerCase();
  return lbl === "" || PLAIN_SHELL_LABELS.has(lbl);
}

export function cardKeyForSession(session: EnrichedSession): string {
  if (session.projectId) {
    return `wt::${session.projectId}::${normalizePath(session.worktreePath)}`;
  }
  return `ext::${session.address}`;
}

/**
 * Returns all LIVE sessions belonging to the same worktree as `current`,
 * stably ordered by creation time ascending so tab positions never jump
 * as AI sessions transition between working/ready/blocked states.
 */
export function getWorktreeLiveSessions(
  allSessions: EnrichedSession[],
  current: EnrichedSession | null
): EnrichedSession[] {
  if (!current) return [];
  if (!current.projectId) {
    return current.terminal.state === "live" ? [current] : [];
  }
  const targetNormPath = normalizePath(current.worktreePath);
  return allSessions
    .filter(
      (s) =>
        s.terminal.state === "live" &&
        s.projectId === current.projectId &&
        normalizePath(s.worktreePath) === targetNormPath
    )
    .sort((a, b) => {
      const diff = (a.terminal.created_ms || 0) - (b.terminal.created_ms || 0);
      if (diff !== 0) return diff;
      return a.address.localeCompare(b.address);
    });
}

/**
 * Picks the preferred live session for a worktree card:
 * 1) Last active tab remembered for this card (if still live)
 * 2) First live AI session (non-plain-shell)
 * 3) First live session (e.g. PowerShell)
 */
export function pickPreferredWorktreeSession(
  sessions: EnrichedSession[],
  rememberedAddress?: string | null
): EnrichedSession | null {
  const live = sessions.filter((s) => s.terminal.state === "live");
  if (live.length === 0) return sessions[0] ?? null;

  if (rememberedAddress) {
    const remembered = live.find((s) => s.address === rememberedAddress);
    if (remembered) return remembered;
  }

  const ai = live.find((s) => !isPlainShellSession(s));
  return ai ?? live[0];
}

export function getCycledSession(
  tabs: EnrichedSession[],
  currentAddress: string,
  delta: 1 | -1
): EnrichedSession | null {
  if (tabs.length <= 1) return null;
  const idx = tabs.findIndex((t) => t.address === currentAddress);
  const start = idx === -1 ? 0 : idx;
  const nextIdx = (start + delta + tabs.length) % tabs.length;
  return tabs[nextIdx] ?? null;
}
