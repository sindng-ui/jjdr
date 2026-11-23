import type {
  AttentionBucket,
  DashboardCounts,
  DashboardWorkerResult,
  EnrichedSession,
  MatrixProjectLane,
  ProjectConfig,
  TerminalInfo,
  TerminalPreview,
  WorktreeInfo,
} from "../types/domain";

export interface DashboardComputeInput {
  terminals: TerminalInfo[];
  previews: Record<string, TerminalPreview>;
  projects: ProjectConfig[];
  worktreesByProject: Record<string, WorktreeInfo[]>;
  ackTurns: Record<string, number>;
  queuedPrompts: Record<string, string[]>;
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

export function classifyBucket(
  t: TerminalInfo,
  ackTurn: number,
  stuckMinutesThreshold: number,
  nowMs: number
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
    return {
      bucket: isStuck ? "needs_you" : "running",
      isStuck,
      stuckMinutes: mins,
      unackedDone: false,
      elapsedMs,
    };
  }

  const unackedDone = t.turn > 0 && t.turn > ackTurn;
  if (st === "done" || unackedDone) {
    return {
      bucket: "ready",
      isStuck: false,
      stuckMinutes: 0,
      unackedDone,
      elapsedMs,
    };
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
    queuedPrompts,
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
    // Hide cleanly finished historical terminals from active Mission Control cards
    if (t.state === "finished" && (t.exit_code ?? 0) === 0) {
      continue;
    }

    const { project, worktree } = matchProjectAndWorktree(
      t,
      projects,
      worktreesByProject
    );

    const projectGroup = project?.group || "Unassigned";
    const ackTurn = ackTurns[t.address] ?? 0;
    const { bucket, isStuck, stuckMinutes, unackedDone, elapsedMs } =
      classifyBucket(t, ackTurn, stuckMinutesThreshold, nowMs);

    const agentLabel = detectAgentLabel(t);
    const branch =
      t.labels["jjdr.branch"] || worktree?.branch || "(external)";
    const projectName = project?.name || "External / hc";
    const projectColor = project?.color || "#6c788a";
    const previewLines = previews[t.address]?.lines ?? [];

    // Priority score: blocked/error highest, then stuck, then ready, then running, then idle
    let priorityScore = BUCKET_RANK[bucket] * 1_000_000;
    if (t.status?.state === "blocked") priorityScore -= 200_000;
    else if (t.status?.state === "error") priorityScore -= 150_000;
    else if (isStuck) priorityScore -= 100_000;
    priorityScore -= Math.min(99_999, Math.floor((t.status_ms ?? t.created_ms) / 1000) % 99_999);

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
    globalCounts.total += 1;
    if (bucket === "needs_you") globalCounts.needsYou += 1;
    else if (bucket === "ready") globalCounts.ready += 1;
    else if (bucket === "running") globalCounts.running += 1;
    else globalCounts.idle += 1;

    if (activeGroup && activeGroup !== "All" && projectGroup !== activeGroup) {
      continue;
    }
    if (selectedProjectId && session.projectId !== selectedProjectId) {
      continue;
    }
    const searchBlob = `${t.address} ${t.name ?? ""} ${t.title} ${projectName} ${branch} ${agentLabel} ${t.cwd} ${t.status?.msg ?? ""}`;
    if (!fuzzyMatches(searchBlob, searchQuery)) {
      continue;
    }

    enrichedFiltered.push(session);
    counts.total += 1;
    if (bucket === "needs_you") counts.needsYou += 1;
    else if (bucket === "ready") counts.ready += 1;
    else if (bucket === "running") counts.running += 1;
    else counts.idle += 1;
  }

  allSessions.sort((a, b) => a.priorityScore - b.priorityScore);
  enrichedFiltered.sort((a, b) => a.priorityScore - b.priorityScore);

  const byBucket: Record<AttentionBucket, EnrichedSession[]> = {
    needs_you: [],
    ready: [],
    running: [],
    idle: [],
  };
  for (const s of enrichedFiltered) {
    byBucket[s.bucket].push(s);
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
    const wts: WorktreeInfo[] =
      rawWts.length > 0
        ? rawWts
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

    const cells = wts
      .filter((wt) => {
        if (!searchQuery.trim()) return true;
        const blob = `${proj.name} ${wt.branch} ${wt.path}`;
        const key = `${proj.id}::${normalizePath(wt.path)}`;
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
    sessions: enrichedFiltered,
    byBucket,
    matrixLanes,
    unassignedSessions,
    counts,
    globalCounts,
    groups: Array.from(groupSet),
  };
}
