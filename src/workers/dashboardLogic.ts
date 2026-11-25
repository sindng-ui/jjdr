import type {
  AckedSessionSnapshot,
  AttentionBucket,
  DashboardCounts,
  DashboardWorkerResult,
  EnrichedSession,
  MatrixProjectLane,
  ProjectConfig,
  TerminalInfo,
  TerminalPreview,
  WorktreeCardMeta,
  WorktreeInfo,
} from "../types/domain";

export interface DashboardComputeInput {
  terminals: TerminalInfo[];
  previews: Record<string, TerminalPreview>;
  projects: ProjectConfig[];
  worktreesByProject: Record<string, WorktreeInfo[]>;
  ackTurns: Record<string, number>;
  ackedSnapshots?: Record<string, AckedSessionSnapshot>;
  queuedPrompts: Record<string, string[]>;
  worktreeMeta?: Record<string, WorktreeCardMeta>;
  worktreeOrderByProject?: Record<string, string[]>;
  stuckMinutesThreshold: number;
  searchQuery: string;
  activeGroup: string;
  selectedProjectId?: string | null;
  nowMs: number;
}

const BUCKET_RANK: Record<AttentionBucket, number> = {
  needs_you: 0,
  ready: 1,
  running: 2,
  idle: 3,
};

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

const SYSTEM_PATH_PREFIXES = [
  "c:/windows",
  "c:/program files",
  "c:/program files (x86)",
  "c:/programdata",
  "c:/system volume information",
  "c:/system32",
  "c:/syswow64",
  "c:/system",
  "c:/recovery",
];

/**
 * Returns true if the normalized path is an OS/system directory that should never
 * surface as an unassigned Mission Control card (e.g. failed helper commands in C:\Windows\System32).
 */
export function isSystemPath(path: string): boolean {
  const norm = normalizePath(path);
  if (!norm) return false;
  return SYSTEM_PATH_PREFIXES.some(
    (prefix) => norm === prefix || norm.startsWith(`${prefix}/`)
  );
}

/**
 * True only when herdr-core explicitly reports a live permission-approval prompt.
 * Prevents showing false "승인" buttons for Stuck (long working), Error, or general Question states.
 */
export function isPermissionApprovalPending(t: TerminalInfo | null | undefined): boolean {
  if (!t || t.state !== "live") return false;
  return t.status?.state === "blocked" && t.status?.kind === "permission";
}

const PLAIN_SHELL_NAMES = new Set([
  "shell",
  "pwsh",
  "powershell",
  "cmd",
  "bash",
  "zsh",
  "sh",
  "fish",
]);

function normalizeBinName(raw: string): string {
  const base = raw.replace(/\\/g, "/").split("/").pop() ?? raw;
  return base.replace(/\.exe$/i, "").trim().toLowerCase();
}

/**
 * True when a terminal is just a plain interactive shell (pwsh/cmd/bash)
 * with no AI CLI currently active in `status.app` or `foreground.name`.
 */
export function isPlainShellTerminal(t: TerminalInfo): boolean {
  const statusApp = t.status?.app ? normalizeBinName(t.status.app) : "";
  if (statusApp && !PLAIN_SHELL_NAMES.has(statusApp)) {
    return false;
  }
  const fgName = t.foreground?.name ? normalizeBinName(t.foreground.name) : "";
  if (fgName && !PLAIN_SHELL_NAMES.has(fgName)) {
    return false;
  }
  const labeledAgent = t.labels["jjdr.agent"]
    ? normalizeBinName(t.labels["jjdr.agent"])
    : "";
  if (labeledAgent) {
    return PLAIN_SHELL_NAMES.has(labeledAgent);
  }
  if (t.template) {
    return PLAIN_SHELL_NAMES.has(normalizeBinName(t.template));
  }
  if (t.argv.length > 0) {
    return PLAIN_SHELL_NAMES.has(normalizeBinName(t.argv[0]));
  }
  return true;
}

export function computeSessionDigest(
  t: TerminalInfo,
  previewLines: string[] = []
): string {
  const msg = t.status?.msg?.trim();
  if (msg) return msg;
  const last = previewLines[previewLines.length - 1]?.trim();
  return last || "";
}

export function classifyBucket(
  t: TerminalInfo,
  ackTurn: number,
  stuckMinutesThreshold: number,
  nowMs: number,
  ackedSnapshot?: AckedSessionSnapshot | null,
  currentDigest = ""
): { bucket: AttentionBucket; isStuck: boolean; stuckMinutes: number; unackedDone: boolean; elapsedMs: number } {
  const st = t.status?.state ?? "";
  const sinceMs = t.status_ms ?? t.created_ms ?? nowMs;
  const elapsedMs = Math.max(0, nowMs - sinceMs);

  if (t.state === "finished") {
    const failed = (t.exit_code ?? 0) !== 0;
    return {
      bucket: failed ? "needs_you" : "idle",
      isStuck: false,
      stuckMinutes: 0,
      unackedDone: false,
      elapsedMs,
    };
  }

  if (st === "blocked" || st === "error") {
    return {
      bucket: "needs_you",
      isStuck: false,
      stuckMinutes: 0,
      unackedDone: false,
      elapsedMs,
    };
  }

  if (st === "working") {
    const mins = Math.floor(elapsedMs / 60_000);
    const isStuck = stuckMinutesThreshold > 0 && mins >= stuckMinutesThreshold;
    // Keep actively working sessions in `running` so long-running AI tasks never intrude
    // into Zen Mode or trigger repeated background notifications; `isStuck` acts as a soft warning hint only.
    return {
      bucket: "running",
      isStuck,
      stuckMinutes: mins,
      unackedDone: false,
      elapsedMs,
    };
  }

  // Plain shell prompts (e.g. PS C:\repo>) increment `turn` on startup/commands
  // and must stay in `idle` (Standby) instead of turning Worktree cards green as "Ready".
  if (!isPlainShellTerminal(t)) {
    const ackedByTurn = t.turn > 0 && ackTurn >= t.turn;
    const ackedBySnapshot = Boolean(
      ackedSnapshot &&
        t.turn <= ackedSnapshot.turn &&
        (!ackedSnapshot.digest || currentDigest === ackedSnapshot.digest)
    );
    const alreadyAcked = ackedByTurn || ackedBySnapshot;
    const unackedDone = !alreadyAcked && t.turn > 0 && t.turn > ackTurn;
    if ((!alreadyAcked && st === "done") || unackedDone) {
      return {
        bucket: "ready",
        isStuck: false,
        stuckMinutes: 0,
        unackedDone,
        elapsedMs,
      };
    }
  }

  return {
    bucket: "idle",
    isStuck: false,
    stuckMinutes: 0,
    unackedDone: false,
    elapsedMs,
  };
}

function detectAgentLabel(t: TerminalInfo): string {
  if (t.labels["jjdr.agent"]) return t.labels["jjdr.agent"];
  if (t.template) return t.template;
  if (t.status?.app) return t.status.app;
  if (t.argv.length > 0) {
    const bin = t.argv[0].replace(/\\/g, "/").split("/").pop() ?? t.argv[0];
    return bin.replace(/\.exe$/i, "");
  }
  if (t.foreground?.name) return t.foreground.name;
  return "shell";
}

function matchProjectAndWorktree(
  t: TerminalInfo,
  projects: ProjectConfig[],
  worktreesByProject: Record<string, WorktreeInfo[]>
): { project: ProjectConfig | null; worktree: WorktreeInfo | null } {
  const labeledProjId = t.labels["jjdr.project"];
  const labeledWt = t.labels["jjdr.worktree"]
    ? normalizePath(t.labels["jjdr.worktree"])
    : "";
  const termCwd = normalizePath(t.cwd || t.foreground?.cwd || "");

  // 1st pass: exact label match
  if (labeledProjId) {
    const proj = projects.find((p) => p.id === labeledProjId) ?? null;
    if (proj) {
      const wts = worktreesByProject[proj.id] ?? [];
      const wt =
        wts.find((w) => normalizePath(w.path) === labeledWt) ??
        wts.find((w) => termCwd.startsWith(normalizePath(w.path))) ??
        null;
      return { project: proj, worktree: wt };
    }
  }

  // 2nd pass: longest-prefix CWD match across all registered projects & worktrees
  // (Automatically rehydrates sessions launched externally via `hc` CLI or `herdr-app`)
  let bestProj: ProjectConfig | null = null;
  let bestWt: WorktreeInfo | null = null;
  let bestLen = -1;

  for (const proj of projects) {
    const wts = worktreesByProject[proj.id] ?? [];
    for (const wt of wts) {
      const normWt = normalizePath(wt.path);
      if (
        normWt &&
        (termCwd === normWt || termCwd.startsWith(normWt + "/")) &&
        normWt.length > bestLen
      ) {
        bestLen = normWt.length;
        bestProj = proj;
        bestWt = wt;
      }
    }
    const normRepo = normalizePath(proj.repo_path);
    if (
      normRepo &&
      (termCwd === normRepo || termCwd.startsWith(normRepo + "/")) &&
      normRepo.length > bestLen
    ) {
      bestLen = normRepo.length;
      bestProj = proj;
      bestWt = null;
    }
  }

  return { project: bestProj, worktree: bestWt };
}

function fuzzyMatches(haystack: string, needle: string): boolean {
  if (!needle) return true;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase().trim();
  if (!n) return true;
  if (h.includes(n)) return true;
  let hi = 0;
  for (let ni = 0; ni < n.length; ni++) {
    const idx = h.indexOf(n[ni], hi);
    if (idx === -1) return false;
    hi = idx + 1;
  }
  return true;
}

export function computeDashboard(
  input: DashboardComputeInput
): DashboardWorkerResult {
  const {
    terminals,
    previews,
    projects,
    worktreesByProject,
    ackTurns,
    ackedSnapshots = {},
    queuedPrompts,
    worktreeMeta = {},
    worktreeOrderByProject = {},
    stuckMinutesThreshold,
    searchQuery,
    activeGroup,
    selectedProjectId,
    nowMs,
  } = input;

  const groupSet = new Set<string>(["All"]);
  for (const p of projects) {
    if (p.group) groupSet.add(p.group);
  }

  const allSessions: EnrichedSession[] = [];
  const enrichedFiltered: EnrichedSession[] = [];
  const globalCounts: DashboardCounts = {
    needsYou: 0,
    ready: 0,
    running: 0,
    idle: 0,
    total: 0,
  };
  const counts: DashboardCounts = {
    needsYou: 0,
    ready: 0,
    running: 0,
    idle: 0,
    total: 0,
  };

  for (const t of terminals) {
    // Hide all finished/exited terminals (both clean and failed) so dead processes
    // never linger as phantom red "Failed" cards or inflate Attention counts.
    if (t.state !== "live") {
      continue;
    }

    const { project, worktree } = matchProjectAndWorktree(
      t,
      projects,
      worktreesByProject
    );

    // Filter out unassigned OS/system-directory helper processes (e.g. C:\Windows\System32)
    if (!project && !t.labels["jjdr.project"]) {
      const effectiveCwd = t.cwd || t.foreground?.cwd || "";
      if (isSystemPath(effectiveCwd)) {
        continue;
      }
    }

    const projectGroup = project?.group || "Unassigned";
    const ackTurn = ackTurns[t.address] ?? 0;
    const previewLines = previews[t.address]?.lines ?? [];
    const currentDigest = computeSessionDigest(t, previewLines);
    const { bucket, isStuck, stuckMinutes, unackedDone, elapsedMs } =
      classifyBucket(
        t,
        ackTurn,
        stuckMinutesThreshold,
        nowMs,
        ackedSnapshots[t.address],
        currentDigest
      );

    const agentLabel = detectAgentLabel(t);
    const branch =
      t.labels["jjdr.branch"] || worktree?.branch || "(external)";
    const projectName = project?.name || "External / hc";
    const projectColor = project?.color || "#6c788a";

    // Priority score: blocked/error highest, then stuck, then ready, then running, then idle.
    // Within the same bucket, AI sessions rank ahead of plain PowerShell tabs.
    let priorityScore = BUCKET_RANK[bucket] * 1_000_000;
    if (t.status?.state === "blocked") priorityScore -= 200_000;
    else if (t.status?.state === "error") priorityScore -= 150_000;
    else if (isStuck) priorityScore -= 100_000;
    if (!isPlainShellTerminal(t)) priorityScore -= 10_000;
    // Prefer more recently updated sessions within the same bucket without modulo wrap-around
    priorityScore += Math.min(9_999, Math.floor(elapsedMs / 1000));

    const session: EnrichedSession = {
      address: t.address,
      terminal: t,
      bucket,
      priorityScore,
      isStuck,
      stuckMinutes,
      unackedDone,
      projectId: project?.id ?? null,
      projectName,
      projectColor,
      projectGroup,
      worktreePath: worktree?.path || t.cwd,
      branch,
      worktree,
      previewLines,
      queuedCount: queuedPrompts[t.address]?.length ?? 0,
      agentLabel,
      elapsedMs,
    };

    allSessions.push(session);

    if (activeGroup && activeGroup !== "All" && projectGroup !== activeGroup) {
      continue;
    }
    if (selectedProjectId && session.projectId !== selectedProjectId) {
      continue;
    }
    const normWtPath = normalizePath(worktree?.path || t.cwd);
    const meta = worktreeMeta[normWtPath];
    const searchBlob = `${t.address} ${t.name ?? ""} ${t.title} ${projectName} ${branch} ${meta?.display_name ?? ""} ${meta?.note ?? ""} ${agentLabel} ${t.cwd} ${t.status?.msg ?? ""}`;
    if (!fuzzyMatches(searchBlob, searchQuery)) {
      continue;
    }

    enrichedFiltered.push(session);
  }

  allSessions.sort((a, b) => a.priorityScore - b.priorityScore);
  enrichedFiltered.sort((a, b) => a.priorityScore - b.priorityScore);

  // Deduplicate by Worktree card so Queue mode & global counters show strictly 1 card per Worktree
  // (using its highest-priority representative session), never duplicating a card across Ready & Standby.
  const dedupeByWorktreeCard = (sortedList: EnrichedSession[]): EnrichedSession[] => {
    const grouped = new Map<string, { rep: EnrichedSession; count: number }>();
    for (const s of sortedList) {
      const cardKey = s.projectId
        ? `wt::${s.projectId}::${normalizePath(s.worktreePath)}`
        : `ext::${s.address}`;
      const existing = grouped.get(cardKey);
      if (existing) {
        existing.count += 1;
      } else {
        grouped.set(cardKey, { rep: s, count: 1 });
      }
    }
    return Array.from(grouped.values()).map(({ rep, count }) =>
      count > 1 ? { ...rep, worktreeSessionCount: count } : rep
    );
  };

  const globalCards = dedupeByWorktreeCard(allSessions);
  for (const c of globalCards) {
    globalCounts.total += 1;
    if (c.bucket === "needs_you") globalCounts.needsYou += 1;
    else if (c.bucket === "ready") globalCounts.ready += 1;
    else if (c.bucket === "running") globalCounts.running += 1;
    else globalCounts.idle += 1;
  }

  const queueCards = dedupeByWorktreeCard(enrichedFiltered);
  const byBucket: Record<AttentionBucket, EnrichedSession[]> = {
    needs_you: [],
    ready: [],
    running: [],
    idle: [],
  };
  for (const c of queueCards) {
    byBucket[c.bucket].push(c);
    counts.total += 1;
    if (c.bucket === "needs_you") counts.needsYou += 1;
    else if (c.bucket === "ready") counts.ready += 1;
    else if (c.bucket === "running") counts.running += 1;
    else counts.idle += 1;
  }

  // Build Project x Worktree board lanes (always include at least the main repo cell even without extra worktrees)
  const sessionsByWt = new Map<string, EnrichedSession[]>();
  const unassignedSessions: EnrichedSession[] = [];

  for (const s of enrichedFiltered) {
    if (!s.projectId) {
      unassignedSessions.push(s);
      continue;
    }
    const key = `${s.projectId}::${normalizePath(s.worktreePath)}`;
    const list = sessionsByWt.get(key);
    if (list) list.push(s);
    else sessionsByWt.set(key, [s]);
  }

  const matrixLanes: MatrixProjectLane[] = [];
  for (const proj of projects) {
    if (activeGroup && activeGroup !== "All" && proj.group !== activeGroup) {
      continue;
    }
    if (selectedProjectId && proj.id !== selectedProjectId) {
      continue;
    }
    const rawWts = worktreesByProject[proj.id] ?? [];
    const normRepo = normalizePath(proj.repo_path);
    const baseWts: WorktreeInfo[] =
      rawWts.length > 0
        ? rawWts.map((w, idx) =>
            w.is_main || normalizePath(w.path) === normRepo || (idx === 0 && !rawWts.some((item) => item.is_main))
              ? { ...w, is_main: true }
              : w
          )
        : [
            {
              path: proj.repo_path,
              head: "",
              branch: proj.default_branch || "main",
              is_main: true,
              is_bare: false,
              is_detached: false,
              is_merged: false,
              dirty_count: 0,
              added_lines: 0,
              deleted_lines: 0,
              changed_files: [],
              overlap_files: [],
            },
          ];

    const customOrder = worktreeOrderByProject[proj.id];
    const wts: WorktreeInfo[] =
      customOrder && customOrder.length > 0
        ? [...baseWts].sort((a, b) => {
            const ia = customOrder.indexOf(normalizePath(a.path));
            const ib = customOrder.indexOf(normalizePath(b.path));
            if (ia === -1 && ib === -1) return 0;
            if (ia === -1) return 1;
            if (ib === -1) return -1;
            return ia - ib;
          })
        : baseWts;

    const cells = wts
      .filter((wt) => {
        if (!searchQuery.trim()) return true;
        const normWt = normalizePath(wt.path);
        const meta = worktreeMeta[normWt];
        const blob = `${proj.name} ${wt.branch} ${meta?.display_name ?? ""} ${meta?.note ?? ""} ${wt.path}`;
        const key = `${proj.id}::${normWt}`;
        return fuzzyMatches(blob, searchQuery) || (sessionsByWt.get(key)?.length ?? 0) > 0;
      })
      .map((wt) => {
        const key = `${proj.id}::${normalizePath(wt.path)}`;
        const wtSessions = sessionsByWt.get(key) ?? [];
        const topBucket: AttentionBucket =
          wtSessions.length > 0
            ? wtSessions.reduce<AttentionBucket>(
                (best, cur) =>
                  BUCKET_RANK[cur.bucket] < BUCKET_RANK[best] ? cur.bucket : best,
                "idle"
              )
            : "idle";
        return { worktree: wt, sessions: wtSessions, topBucket };
      });
    if (cells.length > 0 || !searchQuery.trim()) {
      matrixLanes.push({ project: proj, cells });
    }
  }

  return {
    allSessions,
    sessions: queueCards,
    byBucket,
    matrixLanes,
    unassignedSessions,
    counts,
    globalCounts,
    groups: Array.from(groupSet),
  };
}
