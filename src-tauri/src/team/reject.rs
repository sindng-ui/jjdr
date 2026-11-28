use std::path::Path;

use relay_protocol::{normalize_github_id, RejectReason, ReviewRequestPayload};
use serde::Deserialize;
use tokio::process::Command;

use crate::store::team_settings::TeamOrchestrationSettings;
use crate::team::identity::extract_host_from_normalized_repo;

#[derive(Debug, Clone, Default)]
pub struct PrLiveMeta {
    pub state: String, // "OPEN" | "CLOSED" | "MERGED"
    pub is_draft: bool,
    pub labels: Vec<String>,
    pub base_branch: String,
    pub head_branch: String,
    pub head_sha: String,
    pub author_login: String,
}

#[derive(Debug, Deserialize)]
struct GhPrViewRaw {
    #[serde(default)]
    state: String,
    #[serde(default, rename = "isDraft")]
    is_draft: bool,
    #[serde(default)]
    labels: Vec<GhLabelRaw>,
    #[serde(default, rename = "baseRefName")]
    base_ref_name: String,
    #[serde(default, rename = "headRefName")]
    head_ref_name: String,
    #[serde(default, rename = "headRefOid")]
    head_ref_oid: String,
    #[serde(default)]
    author: Option<GhAuthorRaw>,
}

#[derive(Debug, Deserialize)]
struct GhLabelRaw {
    #[serde(default)]
    name: String,
}

#[derive(Debug, Deserialize)]
struct GhAuthorRaw {
    #[serde(default)]
    login: String,
}

/// One-shot `gh pr view` verification (never polled) to check PR liveness, labels, and draft state.
pub async fn fetch_pr_live_meta(
    repo_path: &str,
    normalized_repo_url: &str,
    pr_number: u64,
) -> Result<PrLiveMeta, String> {
    let mut cmd = Command::new("gh");
    cmd.kill_on_drop(true);
    cmd.current_dir(Path::new(repo_path));
    cmd.args([
        "pr",
        "view",
        &pr_number.to_string(),
        "--json",
        "state,isDraft,labels,baseRefName,headRefName,headRefOid,author",
    ]);
    if let Some(host) = extract_host_from_normalized_repo(normalized_repo_url) {
        if !host.eq_ignore_ascii_case("github.com") {
            cmd.env("GH_HOST", host);
        }
    }
    #[cfg(windows)]
    {
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let output = tokio::time::timeout(std::time::Duration::from_secs(10), cmd.output())
        .await
        .map_err(|_| "gh pr view timed out (10s)".to_string())?
        .map_err(|e| format!("failed to run gh CLI: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "gh pr view failed".to_string()
        } else {
            stderr
        });
    }

    let raw: GhPrViewRaw = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("invalid gh pr view JSON: {}", e))?;

    Ok(PrLiveMeta {
        state: raw.state.to_ascii_uppercase(),
        is_draft: raw.is_draft,
        labels: raw.labels.into_iter().map(|l| l.name).collect(),
        base_branch: raw.base_ref_name,
        head_branch: raw.head_ref_name,
        head_sha: raw.head_ref_oid,
        author_login: raw.author.map(|a| a.login).unwrap_or_default(),
    })
}

/// Pure Layer-2 local reject policy evaluator.
pub fn evaluate_layer2_reject(
    team: &TeamOrchestrationSettings,
    project_id: &str,
    request: &ReviewRequestPayload,
    pr_meta: Option<&PrLiveMeta>,
    current_queued_count: usize,
) -> Option<(RejectReason, String)> {
    // 1. Project-level opt-out
    if team
        .reject_disabled_project_ids
        .iter()
        .any(|id| id == project_id)
    {
        return Some((
            RejectReason::ProjectDisabled,
            "Auto-review is disabled for this project on reviewer PC".to_string(),
        ));
    }

    // 2. Live PR state (Closed / Merged / Draft)
    if let Some(meta) = pr_meta {
        if meta.state.eq_ignore_ascii_case("MERGED") {
            return Some((
                RejectReason::PrMerged,
                format!("PR #{} is already merged", request.pr_number),
            ));
        }
        if meta.state.eq_ignore_ascii_case("CLOSED") {
            return Some((
                RejectReason::PrClosed,
                format!("PR #{} is already closed", request.pr_number),
            ));
        }
        if meta.is_draft {
            return Some((
                RejectReason::PrDraft,
                format!("PR #{} is marked as Draft", request.pr_number),
            ));
        }

        // 3. Excluded PR labels
        for label in &meta.labels {
            if team
                .reject_excluded_labels
                .iter()
                .any(|ex| ex.eq_ignore_ascii_case(label.trim()))
            {
                return Some((
                    RejectReason::ExcludedLabel,
                    format!("PR has excluded label '{}'", label),
                ));
            }
        }
    }

    // 4. Author allowlist & blocklist
    let author_norm = normalize_github_id(&request.author_id).unwrap_or_else(|| request.author_id.to_ascii_lowercase());
    if team
        .reject_blocked_authors
        .iter()
        .filter_map(|a| normalize_github_id(a))
        .any(|b| b == author_norm)
    {
        return Some((
            RejectReason::AuthorNotAllowed,
            format!("Author @{} is in reviewer's blocked list", author_norm),
        ));
    }
    let allowlist: Vec<String> = team
        .reject_allowed_authors
        .iter()
        .filter_map(|a| normalize_github_id(a))
        .collect();
    if !allowlist.is_empty() && !allowlist.iter().any(|a| a == &author_norm) {
        return Some((
            RejectReason::AuthorNotAllowed,
            format!("Author @{} is not in reviewer's allowlist", author_norm),
        ));
    }

    // 5. Excluded branch glob patterns (checks both head and base branches)
    let head_b = pr_meta
        .map(|m| m.head_branch.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(&request.head_branch);
    let base_b = pr_meta
        .map(|m| m.base_branch.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(&request.base_branch);
    for pat in &team.reject_excluded_branches {
        let p = pat.trim();
        if p.is_empty() {
            continue;
        }
        if glob_matches(p, head_b) || glob_matches(p, base_b) {
            return Some((
                RejectReason::ExcludedBranch,
                format!("Branch matches excluded pattern '{}'", p),
            ));
        }
    }

    // 6. Local FIFO queue cap
    let max_q = team.reject_max_queue_size.max(1) as usize;
    if current_queued_count >= max_q {
        return Some((
            RejectReason::QueueFull,
            format!("Reviewer local queue is full ({}/{})", current_queued_count, max_q),
        ));
    }

    None
}

/// Lightweight case-insensitive glob matcher supporting `*` and `?`.
pub fn glob_matches(pattern: &str, text: &str) -> bool {
    let p: Vec<char> = pattern.to_ascii_lowercase().chars().collect();
    let t: Vec<char> = text.to_ascii_lowercase().chars().collect();
    let (mut pi, mut ti) = (0usize, 0usize);
    let (mut star_idx, mut match_idx) = (None, 0usize);

    while ti < t.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == t[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star_idx = Some(pi);
            match_idx = ti;
            pi += 1;
        } else if let Some(si) = star_idx {
            pi = si + 1;
            match_idx += 1;
            ti = match_idx;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

/// Render pre-defined review prompt template with PR metadata variables and optional recovery note.
pub fn render_review_prompt(
    template: &str,
    request: &ReviewRequestPayload,
    repo_name: &str,
    report_path: &str,
    extra_notice: Option<&str>,
) -> String {
    let mut rendered = template
        .replace("{{pr_number}}", &request.pr_number.to_string())
        .replace("{{pr_url}}", &request.pr_url)
        .replace("{{pr_title}}", &request.pr_title)
        .replace("{{repo_name}}", repo_name)
        .replace("{{base_branch}}", &request.base_branch)
        .replace("{{head_branch}}", &request.head_branch)
        .replace("{{head_sha}}", &request.head_sha)
        .replace("{{author}}", &request.author_id)
        .replace("{{review_report_path}}", report_path);

    if let Some(notice) = extra_notice.filter(|s| !s.trim().is_empty()) {
        rendered = format!("[RECOVERY NOTICE] {}\n\n{}", notice.trim(), rendered);
    }
    rendered
}

/// Build CLI argv for an auto-review worker with optional `--model` and `--continue` support.
pub fn build_review_agent_argv(
    agent_id: &str,
    model: &str,
    continue_session: bool,
) -> Vec<String> {
    let bin = agent_id.trim();
    let bin = if bin.is_empty() { "claude" } else { bin };
    let mut argv: Vec<String> = bin.split_whitespace().map(|s| s.to_string()).collect();
    if argv.is_empty() {
        argv.push("claude".to_string());
    }

    let base_bin = argv[0]
        .replace('\\', "/")
        .rsplit('/')
        .next()
        .unwrap_or(&argv[0])
        .to_ascii_lowercase();

    if continue_session && matches!(base_bin.as_str(), "claude" | "agy") {
        if !argv.iter().any(|a| a == "--continue" || a == "-c") {
            argv.push("--continue".to_string());
        }
    }

    let m = model.trim();
    if !m.is_empty() && !argv.iter().any(|a| a == "--model" || a == "-m") {
        match base_bin.as_str() {
            "gemini" => {
                argv.push("-m".to_string());
                argv.push(m.to_string());
            }
            _ => {
                argv.push("--model".to_string());
                argv.push(m.to_string());
            }
        }
    }

    argv
}

/// Returns true if an agent CLI supports `--continue` session resumption across reboots.
pub fn agent_supports_continue(agent_id: &str) -> bool {
    let base = agent_id
        .trim()
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(base.as_str(), "claude" | "agy")
}

/// Detect genuine API rate-limit / quota exhaustion errors from terminal preview/status lines.
/// Ignores diff lines (`+`/`-`) so reviewing code that mentions "rate limit" does not false-trigger.
pub fn detect_quota_exhausted(status_msg: Option<&str>, preview_lines: &[String]) -> Option<String> {
    let mut candidates: Vec<&str> = Vec::new();
    if let Some(m) = status_msg {
        candidates.push(m);
    }
    for line in preview_lines.iter().rev().take(12) {
        let trimmed = line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with('+')
            || trimmed.starts_with('-')
            || trimmed.starts_with("@@")
        {
            continue;
        }
        candidates.push(trimmed);
    }

    for text in candidates {
        let low = text.to_ascii_lowercase();
        let matched = low.contains("rate limit exceeded")
            || low.contains("rate_limit_error")
            || low.contains("resource_exhausted")
            || low.contains("quota exceeded")
            || low.contains("usage limit reached")
            || low.contains("you've hit your limit")
            || low.contains("credit balance is too low")
            || (low.contains("429") && (low.contains("error") || low.contains("too many requests") || low.contains("quota")));
        if matched {
            return Some(text.chars().take(160).collect());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_req() -> ReviewRequestPayload {
        ReviewRequestPayload {
            request_id: "req-1".into(),
            repo_url: "github.corp.com/team/jjdr".into(),
            pr_number: 412,
            pr_url: "https://github.corp.com/team/jjdr/pull/412".into(),
            pr_title: "feat: add relay".into(),
            base_branch: "main".into(),
            head_branch: "feat/relay".into(),
            head_sha: "abcdef12".into(),
            author_id: "alice".into(),
            created_ms: 1000,
        }
    }

    fn open_meta() -> PrLiveMeta {
        PrLiveMeta {
            state: "OPEN".into(),
            is_draft: false,
            labels: vec!["enhancement".into()],
            base_branch: "main".into(),
            head_branch: "feat/relay".into(),
            head_sha: "abcdef12".into(),
            author_login: "alice".into(),
        }
    }

    #[test]
    fn layer2_reject_covers_all_rules_and_happy_pass() {
        let mut cfg = TeamOrchestrationSettings::default();
        let req = sample_req();
        let meta = open_meta();

        // Happy pass
        assert_eq!(evaluate_layer2_reject(&cfg, "p1", &req, Some(&meta), 0), None);

        // Project disabled
        cfg.reject_disabled_project_ids = vec!["p1".into()];
        assert_eq!(
            evaluate_layer2_reject(&cfg, "p1", &req, Some(&meta), 0).map(|x| x.0),
            Some(RejectReason::ProjectDisabled)
        );
        cfg.reject_disabled_project_ids.clear();

        // Merged / Closed / Draft
        let mut m = open_meta();
        m.state = "MERGED".into();
        assert_eq!(
            evaluate_layer2_reject(&cfg, "p1", &req, Some(&m), 0).map(|x| x.0),
            Some(RejectReason::PrMerged)
        );
        m.state = "CLOSED".into();
        assert_eq!(
            evaluate_layer2_reject(&cfg, "p1", &req, Some(&m), 0).map(|x| x.0),
            Some(RejectReason::PrClosed)
        );
        m.state = "OPEN".into();
        m.is_draft = true;
        assert_eq!(
            evaluate_layer2_reject(&cfg, "p1", &req, Some(&m), 0).map(|x| x.0),
            Some(RejectReason::PrDraft)
        );

        // Excluded label (case-insensitive)
        m.is_draft = false;
        m.labels = vec!["WIP".into()];
        assert_eq!(
            evaluate_layer2_reject(&cfg, "p1", &req, Some(&m), 0).map(|x| x.0),
            Some(RejectReason::ExcludedLabel)
        );

        // Excluded branch glob
        cfg.reject_excluded_branches = vec!["feat/*".into()];
        assert_eq!(
            evaluate_layer2_reject(&cfg, "p1", &req, Some(&meta), 0).map(|x| x.0),
            Some(RejectReason::ExcludedBranch)
        );
        cfg.reject_excluded_branches.clear();

        // Author blocklist and allowlist
        cfg.reject_blocked_authors = vec!["@Alice".into()];
        assert_eq!(
            evaluate_layer2_reject(&cfg, "p1", &req, Some(&meta), 0).map(|x| x.0),
            Some(RejectReason::AuthorNotAllowed)
        );
        cfg.reject_blocked_authors.clear();
        cfg.reject_allowed_authors = vec!["bob".into()];
        assert_eq!(
            evaluate_layer2_reject(&cfg, "p1", &req, Some(&meta), 0).map(|x| x.0),
            Some(RejectReason::AuthorNotAllowed)
        );
        cfg.reject_allowed_authors.clear();

        // Queue full
        cfg.reject_max_queue_size = 2;
        assert_eq!(
            evaluate_layer2_reject(&cfg, "p1", &req, Some(&meta), 2).map(|x| x.0),
            Some(RejectReason::QueueFull)
        );
    }

    #[test]
    fn glob_matches_wildcards_accurately() {
        assert!(glob_matches("release/*", "release/v1.2"));
        assert!(glob_matches("*-wip", "feat/login-WIP"));
        assert!(glob_matches("hotfix/??", "hotfix/01"));
        assert!(!glob_matches("release/*", "main"));
    }

    #[test]
    fn renders_prompt_variables_and_recovery_notice() {
        let out = render_review_prompt(
            "PR #{{pr_number}} by @{{author}} -> {{review_report_path}}",
            &sample_req(),
            "jjdr",
            ".jjdr-review/pr-412.md",
            Some("Resumed after reboot"),
        );
        assert!(out.starts_with("[RECOVERY NOTICE] Resumed after reboot"));
        assert!(out.contains("PR #412 by @alice -> .jjdr-review/pr-412.md"));
    }

    #[test]
    fn builds_review_agent_argv_with_model_and_continue_flags() {
        assert_eq!(
            build_review_agent_argv("claude", "claude-sonnet-4-5", true),
            vec!["claude", "--continue", "--model", "claude-sonnet-4-5"]
        );
        assert_eq!(
            build_review_agent_argv("gemini", "gemini-2.5-pro", true),
            vec!["gemini", "-m", "gemini-2.5-pro"]
        );
        assert_eq!(
            build_review_agent_argv("codex", "o3", false),
            vec!["codex", "--model", "o3"]
        );
        assert!(agent_supports_continue("claude"));
        assert!(agent_supports_continue("agy"));
        assert!(!agent_supports_continue("gemini"));
    }

    #[test]
    fn detects_quota_errors_without_false_positives_on_code_diffs() {
        // Real error -> detected
        assert!(detect_quota_exhausted(
            None,
            &["Error: 429 Too Many Requests - rate limit exceeded".into()]
        )
        .is_some());
        assert!(detect_quota_exhausted(Some("RESOURCE_EXHAUSTED: quota exceeded"), &[]).is_some());

        // Code diff line mentioning rate limit -> NOT detected!
        assert!(detect_quota_exhausted(
            None,
            &[
                "+  return Err(\"429 rate limit exceeded\");".into(),
                "-  // quota exceeded check".into(),
                "Reviewing diff... looks clean".into()
            ]
        )
        .is_none());
    }
}
