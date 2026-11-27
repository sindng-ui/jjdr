import type { TeamOrchestrationSettings } from "../types/domain";

export const DEFAULT_AUTO_REVIEW_PROMPT = `You are performing an automated code review for PR #{{pr_number}} ({{pr_url}}).
Title: {{pr_title}}
Branch: {{head_branch}} -> {{base_branch}} (commit {{head_sha}}, author @{{author}})

Instructions:
1. Review the diff against origin/{{base_branch}} carefully for bugs, edge cases, regressions, security issues, and performance problems.
2. Do NOT modify or commit repository code, and do NOT approve or merge the PR.
3. Post your structured review comment directly on PR #{{pr_number}} (comment-only via \`gh pr comment\` or \`gh pr review --comment\`).
4. Save the full markdown review report to \`{{review_report_path}}\` so the reviewer can inspect it in jjdr's built-in Markdown Viewer.`;

export const REVIEW_PROMPT_VARIABLES = [
  { token: "{{pr_number}}", desc: "PR #" },
  { token: "{{pr_url}}", desc: "PR URL" },
  { token: "{{pr_title}}", desc: "PR Title" },
  { token: "{{repo_name}}", desc: "Repo" },
  { token: "{{base_branch}}", desc: "Base" },
  { token: "{{head_branch}}", desc: "Head" },
  { token: "{{head_sha}}", desc: "Commit SHA" },
  { token: "{{author}}", desc: "Author ID" },
  { token: "{{review_report_path}}", desc: "MD Report Path" },
] as const;

export function createDefaultTeamSettings(): TeamOrchestrationSettings {
  return {
    enabled: false,
    relay_url: "",
    team_key: "",
    bypass_proxy: true,
    github_id_override: "",
    display_name: "",
    auto_review_paused: false,
    primary_agent: "",
    primary_model: "",
    fallback_agent: "",
    fallback_model: "",
    global_max_auto_review_workers: 2,
    per_project_max_workers: 1,
    ack_teardown_mode: "on_ack",
    review_prompt_template: DEFAULT_AUTO_REVIEW_PROMPT,
    reject_excluded_labels: ["wip", "no-ai-review"],
    reject_excluded_branches: [],
    reject_disabled_project_ids: [],
    reject_allowed_authors: [],
    reject_blocked_authors: [],
    reject_max_queue_size: 5,
  };
}

export function normalizeTeamSettings(
  raw?: Partial<TeamOrchestrationSettings> | null
): TeamOrchestrationSettings {
  const def = createDefaultTeamSettings();
  if (!raw) return def;
  return {
    enabled: Boolean(raw.enabled),
    relay_url: typeof raw.relay_url === "string" ? raw.relay_url : def.relay_url,
    team_key: typeof raw.team_key === "string" ? raw.team_key : def.team_key,
    bypass_proxy: raw.bypass_proxy ?? def.bypass_proxy,
    github_id_override:
      typeof raw.github_id_override === "string" ? raw.github_id_override : "",
    display_name: typeof raw.display_name === "string" ? raw.display_name : "",
    auto_review_paused: Boolean(raw.auto_review_paused),
    primary_agent: typeof raw.primary_agent === "string" ? raw.primary_agent : "",
    primary_model: typeof raw.primary_model === "string" ? raw.primary_model : "",
    fallback_agent:
      typeof raw.fallback_agent === "string" ? raw.fallback_agent : "",
    fallback_model:
      typeof raw.fallback_model === "string" ? raw.fallback_model : "",
    global_max_auto_review_workers: clampInt(
      raw.global_max_auto_review_workers,
      1,
      5,
      def.global_max_auto_review_workers
    ),
    per_project_max_workers: clampInt(
      raw.per_project_max_workers,
      1,
      3,
      def.per_project_max_workers
    ),
    ack_teardown_mode:
      raw.ack_teardown_mode === "immediate" ? "immediate" : "on_ack",
    review_prompt_template:
      typeof raw.review_prompt_template === "string" &&
      raw.review_prompt_template.trim().length > 0
        ? raw.review_prompt_template
        : def.review_prompt_template,
    reject_excluded_labels: Array.isArray(raw.reject_excluded_labels)
      ? raw.reject_excluded_labels
      : def.reject_excluded_labels,
    reject_excluded_branches: Array.isArray(raw.reject_excluded_branches)
      ? raw.reject_excluded_branches
      : def.reject_excluded_branches,
    reject_disabled_project_ids: Array.isArray(raw.reject_disabled_project_ids)
      ? raw.reject_disabled_project_ids
      : def.reject_disabled_project_ids,
    reject_allowed_authors: Array.isArray(raw.reject_allowed_authors)
      ? raw.reject_allowed_authors
      : def.reject_allowed_authors,
    reject_blocked_authors: Array.isArray(raw.reject_blocked_authors)
      ? raw.reject_blocked_authors
      : def.reject_blocked_authors,
    reject_max_queue_size: clampInt(
      raw.reject_max_queue_size,
      1,
      20,
      def.reject_max_queue_size
    ),
  };
}

export function clampInt(
  val: number | undefined | null,
  min: number,
  max: number,
  fallback: number
): number {
  if (typeof val !== "number" || !Number.isFinite(val)) return fallback;
  return Math.max(min, Math.min(max, Math.round(val)));
}

/** Parse comma/newline-separated tokens into a deduplicated clean string array. */
export function parseCsvTokens(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,\n]/)) {
    const cleaned = part.trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

export function formatCsvTokens(list?: string[] | null): string {
  if (!list || list.length === 0) return "";
  return list.join(", ");
}

/** Validate relay URL & key before saving/testing when enabled. */
export function validateTeamSettings(
  team: TeamOrchestrationSettings
): string | null {
  if (!team.enabled) return null;
  if (!team.relay_url.trim()) {
    return "Relay 서버 주소를 입력해 주세요 (예: http://10.0.0.10:8787)";
  }
  if (!team.team_key.trim()) {
    return "Team Key를 입력해 주세요";
  }
  return null;
}
