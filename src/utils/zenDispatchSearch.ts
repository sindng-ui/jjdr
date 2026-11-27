import type { AutoMissionInfo, WorktreeCardMeta } from "../types/domain";
import type { ZenDispatchWorker } from "./zenDispatch";
import { getWorkerPersona } from "./workerPersona";
import {
  MISSION_KIND_META,
  resolveEffectiveMission,
  type EffectiveMission,
} from "./missionDetector";

export interface DispatchSearchMatch {
  worker: ZenDispatchWorker;
  deckIndex: number;
  score: number;
  displayName: string;
  note: string;
  personaName: string;
  mission: EffectiveMission;
}

const KIND_ALIASES: Record<string, string[]> = {
  dev: ["dev", "개발", "구현", "기능", "feat"],
  review: ["review", "리뷰", "코드리뷰", "검토"],
  fix: ["fix", "수정", "버그", "핫픽스", "bug"],
  refactor: ["refactor", "리팩토링", "리팩터", "정리", "최적화"],
};

function normalizeSearchToken(raw: string): string {
  return raw.trim().toLowerCase();
}

function extractPrQueryDigits(token: string): string | null {
  const m = /^(?:pr|mr)?#?(\d{1,7})$/i.exec(token);
  return m ? m[1] : null;
}

/**
 * Filter and rank standby workers inside the current Assign deck by:
 * PR number, display name (alias), branch name, project name, persona name, note, or mission kind.
 * Empty query returns the full deck in its original priority order.
 */
export function filterDispatchWorkers(
  deck: ZenDispatchWorker[],
  rawQuery: string,
  worktreeMeta: Record<string, WorktreeCardMeta>,
  autoMissionByWorktree: Record<string, AutoMissionInfo>
): DispatchSearchMatch[] {
  const tokens = rawQuery
    .trim()
    .split(/\s+/)
    .map(normalizeSearchToken)
    .filter(Boolean);

  const results: DispatchSearchMatch[] = [];

  for (let deckIndex = 0; deckIndex < deck.length; deckIndex++) {
    const worker = deck[deckIndex];
    const meta = worktreeMeta[worker.normWtPath];
    const autoMission = autoMissionByWorktree[worker.normWtPath];
    const displayName = meta?.display_name?.trim() || "";
    const note = meta?.note?.trim() || "";
    const persona = getWorkerPersona(worker.normWtPath);
    const mission = resolveEffectiveMission(meta, autoMission, {
      branch: worker.worktree.branch,
      statusMsg: worker.aiSession?.terminal.status?.msg,
      previewLines: worker.aiSession?.previewLines,
    });

    if (tokens.length === 0) {
      results.push({
        worker,
        deckIndex,
        score: 0,
        displayName,
        note,
        personaName: persona.name,
        mission,
      });
      continue;
    }

    const lowName = displayName.toLowerCase();
    const lowBranch = (worker.worktree.branch || "").toLowerCase();
    const lowProject = worker.project.name.toLowerCase();
    const lowPersona = persona.name.toLowerCase();
    const lowNote = note.toLowerCase();
    const lowStatus = (worker.aiSession?.terminal.status?.msg || "").toLowerCase();
    const prDigits = mission.prNumber !== null ? String(mission.prNumber) : "";
    const prText = prDigits ? `pr #${prDigits} pr${prDigits} #${prDigits}` : "";
    const kindTerms = mission.kind
      ? [MISSION_KIND_META[mission.kind].label.toLowerCase(), ...(KIND_ALIASES[mission.kind] ?? [])]
      : [];

    let totalScore = 0;
    let allMatched = true;

    for (const tok of tokens) {
      let best = 0;

      const qDigits = extractPrQueryDigits(tok);
      if (qDigits && prDigits) {
        if (prDigits === qDigits) {
          best = Math.max(best, 100);
        } else if (prDigits.includes(qDigits)) {
          best = Math.max(best, 85);
        }
      }
      if (prText && prText.includes(tok)) {
        best = Math.max(best, 85);
      }

      if (lowName && lowName.includes(tok)) {
        best = Math.max(best, lowName.startsWith(tok) ? 90 : 80);
      }
      if (lowBranch && lowBranch.includes(tok)) {
        best = Math.max(best, lowBranch.startsWith(tok) ? 78 : 70);
      }
      if (kindTerms.some((term) => term.includes(tok))) {
        best = Math.max(best, 65);
      }
      if (lowProject.includes(tok)) {
        best = Math.max(best, lowProject.startsWith(tok) ? 64 : 58);
      }
      if (lowPersona.includes(tok)) {
        best = Math.max(best, lowPersona.startsWith(tok) ? 60 : 54);
      }
      if (lowNote && lowNote.includes(tok)) {
        best = Math.max(best, 48);
      }
      if (lowStatus && lowStatus.includes(tok)) {
        best = Math.max(best, 35);
      }

      if (best === 0) {
        allMatched = false;
        break;
      }
      totalScore += best;
    }

    if (allMatched) {
      results.push({
        worker,
        deckIndex,
        score: totalScore,
        displayName,
        note,
        personaName: persona.name,
        mission,
      });
    }
  }

  if (tokens.length > 0) {
    results.sort((a, b) => b.score - a.score || a.deckIndex - b.deckIndex);
  }

  return results;
}
