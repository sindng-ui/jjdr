import type {
  AutoMissionInfo,
  MissionKind,
  WorktreeCardMeta,
} from "../types/domain";

export const MISSION_KINDS: readonly MissionKind[] = [
  "dev",
  "review",
  "fix",
  "refactor",
];

export interface MissionKindStyle {
  label: string;
  shortLabel: string;
  bg: string;
  fg: string;
  border: string;
}

export const MISSION_KIND_META: Record<MissionKind, MissionKindStyle> = {
  dev: {
    label: "Dev",
    shortLabel: "Dev",
    bg: "var(--run-soft)",
    fg: "var(--run-fg)",
    border: "var(--run-border)",
  },
  review: {
    label: "Review",
    shortLabel: "Review",
    bg: "var(--accent-soft)",
    fg: "var(--accent)",
    border: "var(--accent-border)",
  },
  fix: {
    label: "Fix",
    shortLabel: "Fix",
    bg: "var(--warn-soft)",
    fg: "var(--warn-fg)",
    border: "var(--warn-border)",
  },
  refactor: {
    label: "Refactor",
    shortLabel: "Refactor",
    bg: "var(--ready-soft)",
    fg: "var(--ready-fg)",
    border: "var(--ready-border)",
  },
};

export interface ParsedMissionSignal {
  kind: MissionKind | null;
  prNumber: number | null;
  prUrl: string | null;
}

export interface EffectiveMission {
  kind: MissionKind | null;
  prNumber: number | null;
  prUrl: string | null;
  isAutoKind: boolean;
  isAutoPr: boolean;
  hasAny: boolean;
  sourceLabel: string;
}

const PR_URL_RE =
  /https?:\/\/[^\s<>"'`)\]]+\/(?:pull|pulls|merge_requests|pull-requests)\/(\d{1,7})(?:[/#?][^\s<>"'`)\]]*)?/i;
const GH_PR_CMD_RE =
  /\bgh\s+pr\s+(?:view|diff|checkout|review|comment|checks|merge|edit|ready|create)\b(?:\s+#?(\d{1,7})\b)?/i;
const EXPLICIT_PR_RE =
  /(?:^|[\s([{"'`/])(?:pr|mr|pull[\s-]*request|merge[\s-]*request)\s*(?:no\.?|num(?:ber)?|#|[-:])?\s*(\d{1,7})(?=$|[\s)\].,;:!?/"'`]|번|을|를|의|에|도|이|가|와|과|은|는|에서|로)/i;
const KO_PR_RE = /(\d{1,7})\s*번\s*(?:pr|mr|풀\s*리퀘|피알)/i;
const HASH_PR_CONTEXT_RE =
  /(?:pr|mr|pull[\s-]*request|merge[\s-]*request|리뷰|review|피알|풀리퀘)/i;
const HASH_NUM_RE = /(?:^|[\s([{"'`])#(\d{1,7})(?=$|[\s)\].,;:!?/"'`]|번|을|를|의|에|도)/;

const REVIEW_RE =
  /리뷰|코드\s*리뷰|검토|피드백|코멘트|\breview(?:ing|ed)?\b|\blgtm\b|\bcode\s*review\b|\baudit\b|\bgh\s+pr\s+(?:view|diff|review|comment|checkout)\b/i;
const FIX_RE =
  /수정|고쳐|고치|버그|오류|에러|크래시|핫픽스|디버그|디버깅|안\s*됨|안\s*돼|안\s*되|실패|깨짐|\bfix(?:es|ed|ing)?\b|\bbug(?:fix)?\b|\bhotfix\b|\bcrash(?:es|ing)?\b|\bdebug(?:ging)?\b|\bpatch\b/i;
const REFACTOR_RE =
  /리팩토링|리팩터|정리|최적화|성능\s*개선|테스트\s*(?:추가|작성|보강)|문서화|분석|조사|\brefactor(?:ing)?\b|\bcleanup\b|\boptimi[sz](?:e|ation)\b|\bperf\b|\bchore\b|\binvestigat(?:e|ion)\b/i;
const DEV_RE =
  /개발|구현|추가|만들어|만들|생성|신규|기능|작성|도입|\bfeat(?:ure)?\b|\bimplement(?:ation|ing)?\b|\bbuild(?:ing)?\b|\bcreate\b|\bdevelop(?:ment)?\b|\badd(?:ing)?\b/i;

const BRANCH_PR_RE = /(?:^|[/\-_])(?:pr|mr|review)[/\-_#]?(\d{1,7})(?:$|[/\-_])/i;

export function normalizeMissionKind(raw?: string | null): MissionKind | null {
  if (!raw) return null;
  const low = raw.trim().toLowerCase();
  if (low === "dev" || low === "review" || low === "fix" || low === "refactor") {
    return low;
  }
  return null;
}

export function normalizePrNumber(
  raw?: number | string | null
): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || raw <= 0 || raw > 9_999_999) return null;
    return raw;
  }
  const cleaned = raw.trim().replace(/^#/, "");
  if (!/^\d{1,7}$/.test(cleaned)) return null;
  const n = Number.parseInt(cleaned, 10);
  return n > 0 && n <= 9_999_999 ? n : null;
}

export function normalizePrUrl(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/[),.;:!?]+$/, "");
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return null;
  return trimmed;
}

/**
 * Extract PR number / URL and mission kind (review/fix/refactor/dev) from free-form text
 * (user prompt or AI terminal preview output). Zero external I/O, single-pass regex.
 */
export function parseMissionFromText(text: string): ParsedMissionSignal {
  const trimmed = text.trim();
  if (!trimmed) {
    return { kind: null, prNumber: null, prUrl: null };
  }

  let prUrl: string | null = null;
  let prNumber: number | null = null;

  const urlMatch = trimmed.match(PR_URL_RE);
  if (urlMatch) {
    prUrl = normalizePrUrl(urlMatch[0]);
    prNumber = normalizePrNumber(urlMatch[1]);
  }

  if (prNumber === null) {
    const ghMatch = trimmed.match(GH_PR_CMD_RE);
    if (ghMatch?.[1]) {
      prNumber = normalizePrNumber(ghMatch[1]);
    }
  }
  if (prNumber === null) {
    const explicit = trimmed.match(EXPLICIT_PR_RE);
    if (explicit?.[1]) {
      prNumber = normalizePrNumber(explicit[1]);
    }
  }
  if (prNumber === null) {
    const ko = trimmed.match(KO_PR_RE);
    if (ko?.[1]) {
      prNumber = normalizePrNumber(ko[1]);
    }
  }
  if (prNumber === null && HASH_PR_CONTEXT_RE.test(trimmed)) {
    const hash = trimmed.match(HASH_NUM_RE);
    if (hash?.[1]) {
      prNumber = normalizePrNumber(hash[1]);
    }
  }

  let kind: MissionKind | null = null;
  if (REVIEW_RE.test(trimmed)) {
    kind = "review";
  } else if (FIX_RE.test(trimmed)) {
    kind = "fix";
  } else if (REFACTOR_RE.test(trimmed)) {
    kind = "refactor";
  } else if (DEV_RE.test(trimmed)) {
    kind = "dev";
  }

  return { kind, prNumber, prUrl };
}

/**
 * Fallback mission hint inferred from Git branch naming conventions (e.g. fix/login, feat/oauth, pr-114).
 */
export function parseMissionFromBranch(branch?: string | null): ParsedMissionSignal {
  const b = (branch ?? "").trim();
  if (!b) return { kind: null, prNumber: null, prUrl: null };

  const prMatch = b.match(BRANCH_PR_RE);
  const prNumber = prMatch?.[1] ? normalizePrNumber(prMatch[1]) : null;

  const low = b.toLowerCase();
  let kind: MissionKind | null = null;
  if (/^(?:review|pr)[/\-_]/.test(low)) {
    kind = "review";
  } else if (/^(?:fix|bugfix|hotfix)[/\-_]/.test(low)) {
    kind = "fix";
  } else if (/^(?:refactor|chore|test|docs|perf)[/\-_]/.test(low)) {
    kind = "refactor";
  } else if (/^(?:feat|feature)[/\-_]/.test(low)) {
    kind = "dev";
  }

  return { kind, prNumber, prUrl: null };
}

/**
 * Merge newly detected auto-mission signal into previous runtime state for a worktree.
 * - New user prompt replaces prior auto-detected mission when it carries fresh signal.
 * - Live terminal preview enriches missing PR# / URL / kind without overriding explicit prompt kind.
 */
export function mergeAutoMission(
  prev: AutoMissionInfo | undefined,
  signal: ParsedMissionSignal,
  source: "prompt" | "preview",
  nowMs = Date.now()
): AutoMissionInfo | null {
  if (!signal.kind && signal.prNumber === null && !signal.prUrl) {
    return null;
  }

  if (source === "prompt") {
    return {
      kind: signal.kind ?? prev?.kind ?? null,
      prNumber:
        signal.prNumber !== null
          ? signal.prNumber
          : signal.kind
          ? null
          : prev?.prNumber ?? null,
      prUrl:
        signal.prUrl ??
        (signal.prNumber !== null || signal.kind ? null : prev?.prUrl ?? null),
      source: "prompt",
      updatedAt: nowMs,
    };
  }

  // source === "preview": enrich PR info (especially when AI runs `gh pr view 114` or `gh pr create`),
  // and fill kind only when no prompt-derived kind is already set.
  const nextKind =
    prev?.source === "prompt" && prev.kind
      ? prev.kind
      : prev?.kind ?? signal.kind ?? null;
  const nextPrNumber = signal.prNumber ?? prev?.prNumber ?? null;
  const nextPrUrl =
    signal.prUrl ??
    (signal.prNumber !== null &&
    prev?.prNumber !== null &&
    signal.prNumber !== prev?.prNumber
      ? null
      : prev?.prUrl ?? null);

  if (
    prev &&
    prev.kind === nextKind &&
    prev.prNumber === nextPrNumber &&
    prev.prUrl === nextPrUrl
  ) {
    return null;
  }

  return {
    kind: nextKind,
    prNumber: nextPrNumber,
    prUrl: nextPrUrl,
    source: prev?.source === "prompt" ? "prompt" : "preview",
    updatedAt: nowMs,
  };
}

/**
 * Resolve final effective mission badges for any worktree card:
 * Priority: Manual Override (WorktreeCardMeta) > Runtime Auto (Prompt/Preview) > Live Preview > Branch hint.
 */
export function resolveEffectiveMission(
  meta: WorktreeCardMeta | undefined,
  autoInfo: AutoMissionInfo | undefined,
  options?: {
    branch?: string | null;
    statusMsg?: string | null;
    previewLines?: string[];
  }
): EffectiveMission {
  const manualKind = normalizeMissionKind(meta?.mission_kind);
  const manualPr = normalizePrNumber(meta?.pr_number);
  const manualUrl = normalizePrUrl(meta?.pr_url);

  let liveSignal: ParsedMissionSignal | null = null;
  const needsAutoKind = !manualKind && !autoInfo?.kind;
  const needsAutoPr = manualPr === null && !autoInfo?.prNumber;
  if (
    (needsAutoKind || needsAutoPr) &&
    (options?.statusMsg || (options?.previewLines && options.previewLines.length > 0))
  ) {
    const sample = [
      options.statusMsg ?? "",
      ...(options.previewLines?.slice(-6) ?? []),
    ]
      .filter(Boolean)
      .join("\n");
    if (sample) {
      liveSignal = parseMissionFromText(sample);
    }
  }

  const branchSignal =
    (!manualKind && !autoInfo?.kind && !liveSignal?.kind) ||
    (manualPr === null && !autoInfo?.prNumber && !liveSignal?.prNumber)
      ? parseMissionFromBranch(options?.branch)
      : null;

  const kind =
    manualKind ?? autoInfo?.kind ?? liveSignal?.kind ?? branchSignal?.kind ?? null;
  const prNumber =
    manualPr ??
    autoInfo?.prNumber ??
    liveSignal?.prNumber ??
    branchSignal?.prNumber ??
    null;

  // Use manual URL first, or auto/live URL only if it matches the resolved PR number (or no manual override conflicts)
  let prUrl: string | null = manualUrl;
  if (!prUrl) {
    const candidateUrl = autoInfo?.prUrl ?? liveSignal?.prUrl ?? null;
    if (candidateUrl) {
      if (manualPr === null || autoInfo?.prNumber === manualPr || liveSignal?.prNumber === manualPr) {
        prUrl = candidateUrl;
      }
    }
  }

  const isAutoKind = Boolean(kind && !manualKind);
  const isAutoPr = Boolean(prNumber !== null && manualPr === null);

  let sourceLabel = "Manual";
  if (isAutoKind || isAutoPr) {
    if (autoInfo?.source === "prompt") {
      sourceLabel = "Auto-detected from prompt";
    } else if (autoInfo?.source === "preview" || liveSignal?.kind || liveSignal?.prNumber) {
      sourceLabel = "Auto-detected from AI output";
    } else {
      sourceLabel = "Auto-detected from branch";
    }
  }

  return {
    kind,
    prNumber,
    prUrl,
    isAutoKind,
    isAutoPr,
    hasAny: Boolean(kind || prNumber !== null),
    sourceLabel,
  };
}
