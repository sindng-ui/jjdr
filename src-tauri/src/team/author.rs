use std::collections::VecDeque;
use std::path::{Path, PathBuf};

use chrono::DateTime;
use relay_protocol::{
    normalize_github_id, normalize_repo_url, PeerInfo, PresenceStatus, ReviewRequestWithAssignments,
};
use serde::{Deserialize, Serialize};
use tokio::process::Command;

use crate::git::inspect::build_git_command;
use crate::team::identity::extract_host_from_normalized_repo;

pub const TRACK_B_MAX_AGE_MS: i64 = 15 * 60 * 1000;
pub const TRACK_B_CLOCK_SKEW_MS: i64 = 5 * 60 * 1000;
pub const PROMPTED_PR_MAX_ENTRIES: usize = 500;
pub const MAX_REVIEWERS_PER_REQUEST: usize = 2;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthorPrDetails {
    pub pr_number: u64,
    pub pr_url: String,
    pub pr_title: String,
    pub state: String,
    pub is_draft: bool,
    pub created_at_ms: Option<i64>,
    pub base_branch: String,
    pub head_branch: String,
    pub head_sha: String,
    pub author_id: String,
    pub already_requested_reviewers: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PrReviewCandidate {
    pub repo_url: String,
    pub project_id: String,
    pub project_name: String,
    pub worktree_path: String,
    pub pr_number: u64,
    pub pr_url: String,
    pub pr_title: String,
    pub base_branch: String,
    pub head_branch: String,
    pub head_sha: String,
    pub author_id: String,
    pub is_draft: bool,
    pub created_at_ms: Option<i64>,
    pub already_requested_reviewers: Vec<String>,
    pub eligible_for_auto_prompt: bool,
    pub skip_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmitTeamReviewInput {
    pub project_id: String,
    pub worktree_path: String,
    pub repo_url: String,
    pub pr_number: u64,
    pub pr_url: String,
    pub pr_title: String,
    pub base_branch: String,
    pub head_branch: String,
    pub head_sha: String,
    pub reviewer_ids: Vec<String>,
    #[serde(default = "default_true")]
    pub assign_on_github: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmitTeamReviewResult {
    pub request: Option<ReviewRequestWithAssignments>,
    pub reviewers_sent: Vec<String>,
    pub gh_assigned: bool,
    pub gh_error: Option<String>,
    pub queued_offline: bool,
    pub relay_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrackBEvaluation {
    pub eligible: bool,
    pub skip_reason: Option<String>,
}

/// Canonical persistence key for `prompted_pr_keys.json`.
pub fn make_prompted_pr_key(repo_url: &str, pr_number: u64, head_sha: &str) -> String {
    let norm_repo = normalize_repo_url(repo_url).unwrap_or_else(|| repo_url.trim().to_ascii_lowercase());
    format!("{}#{}#{}", norm_repo, pr_number, head_sha.trim().to_ascii_lowercase())
}

/// Persistent bounded FIFO store (`%APPDATA%/jjdr/prompted_pr_keys.json`) so Track B never
/// re-prompts for the same `(repo, pr_number, head_sha)` across app restarts.
pub struct PromptedPrStore {
    path: PathBuf,
    keys: VecDeque<String>,
}

impl PromptedPrStore {
    pub fn load(config_dir: &Path) -> Self {
        let path = config_dir.join("prompted_pr_keys.json");
        let list = std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
            .unwrap_or_default();
        let mut keys: VecDeque<String> = list.into_iter().collect();
        while keys.len() > PROMPTED_PR_MAX_ENTRIES {
            keys.pop_front();
        }
        Self { path, keys }
    }

    pub fn has(&self, key: &str) -> bool {
        self.keys.iter().any(|k| k == key)
    }

    pub fn mark(&mut self, key: String) {
        if self.has(&key) {
            return;
        }
        self.keys.push_back(key);
        while self.keys.len() > PROMPTED_PR_MAX_ENTRIES {
            self.keys.pop_front();
        }
        self.persist();
    }

    pub fn len(&self) -> usize {
        self.keys.len()
    }

    pub fn is_empty(&self) -> bool {
        self.keys.is_empty()
    }

    fn persist(&self) {
        if let Some(parent) = self.path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let vec: Vec<&String> = self.keys.iter().collect();
        if let Ok(text) = serde_json::to_string_pretty(&vec) {
            let _ = std::fs::write(&self.path, text);
        }
    }
}

/// Pure 3-stage Track B verification gate.
/// - Automatic (`manual == false`): requires author == my_github_id, state == OPEN, !is_draft,
///   createdAt within last 15 minutes (with 5m future clock-skew grace), and not already prompted.
/// - Manual (`manual == true`): only requires state == OPEN (allows Draft -> Ready or older PR re-request).
pub fn evaluate_track_b_candidate(
    details: &AuthorPrDetails,
    my_github_id: Option<&str>,
    now_ms: i64,
    already_prompted: bool,
    manual: bool,
) -> TrackBEvaluation {
    if !details.state.eq_ignore_ascii_case("OPEN") {
        return TrackBEvaluation {
            eligible: false,
            skip_reason: Some(format!("pr_not_open:{}", details.state.to_ascii_lowercase())),
        };
    }

    if manual {
        return TrackBEvaluation {
            eligible: true,
            skip_reason: None,
        };
    }

    let Some(me_norm) = my_github_id.and_then(normalize_github_id) else {
        return TrackBEvaluation {
            eligible: false,
            skip_reason: Some("github_id_missing".to_string()),
        };
    };

    let Some(author_norm) = normalize_github_id(&details.author_id) else {
        return TrackBEvaluation {
            eligible: false,
            skip_reason: Some("author_missing".to_string()),
        };
    };

    if author_norm != me_norm {
        return TrackBEvaluation {
            eligible: false,
            skip_reason: Some("not_author".to_string()),
        };
    }

    if details.is_draft {
        return TrackBEvaluation {
            eligible: false,
            skip_reason: Some("pr_is_draft".to_string()),
        };
    }

    match details.created_at_ms {
        Some(created_ms) => {
            let age_ms = now_ms - created_ms;
            if age_ms > TRACK_B_MAX_AGE_MS {
                return TrackBEvaluation {
                    eligible: false,
                    skip_reason: Some("older_than_15m".to_string()),
                };
            }
            if age_ms < -TRACK_B_CLOCK_SKEW_MS {
                return TrackBEvaluation {
                    eligible: false,
                    skip_reason: Some("invalid_future_timestamp".to_string()),
                };
            }
        }
        None => {
            return TrackBEvaluation {
                eligible: false,
                skip_reason: Some("missing_created_at".to_string()),
            };
        }
    }

    if already_prompted {
        return TrackBEvaluation {
            eligible: false,
            skip_reason: Some("already_prompted".to_string()),
        };
    }

    TrackBEvaluation {
        eligible: true,
        skip_reason: None,
    }
}

/// Sanitize and deduplicate selected reviewer GitHub IDs: excludes author self and caps at `max_count`.
pub fn normalize_selected_reviewers(
    raw_ids: &[String],
    author_id: Option<&str>,
    max_count: usize,
) -> Vec<String> {
    let author_norm = author_id.and_then(normalize_github_id);
    let mut out = Vec::new();
    for raw in raw_ids {
        let Some(norm) = normalize_github_id(raw) else {
            continue;
        };
        if author_norm.as_deref() == Some(norm.as_str()) {
            continue;
        }
        if out.iter().any(|existing: &String| existing == &norm) {
            continue;
        }
        out.push(norm);
        if out.len() >= max_count {
            break;
        }
    }
    out
}

/// Return any selected reviewer IDs that are NOT currently `PresenceStatus::Online` in `peers`.
/// Offline or paused teammates cannot be assigned new auto-review requests.
pub fn find_unavailable_reviewers(reviewers: &[String], peers: &[PeerInfo]) -> Vec<String> {
    let mut unavailable = Vec::new();
    for id in reviewers {
        let Some(norm) = normalize_github_id(id) else {
            unavailable.push(id.clone());
            continue;
        };
        let is_online = peers.iter().any(|p| {
            normalize_github_id(&p.github_id).as_deref() == Some(norm.as_str())
                && p.status == PresenceStatus::Online
        });
        if !is_online {
            unavailable.push(norm);
        }
    }
    unavailable
}

/// Resolve canonical normalized `origin` URL for a local Git repository path.
pub async fn resolve_project_repo_url(repo_path: &str) -> Result<String, String> {
    let path = Path::new(repo_path);
    if !path.exists() {
        return Err(format!("Repository path does not exist: {}", repo_path));
    }
    let mut cmd = build_git_command(path);
    cmd.args(["remote", "get-url", "origin"]);
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("failed to run git remote get-url origin: {}", e))?;
    if !output.status.success() {
        return Err("git remote 'origin' is not configured".to_string());
    }
    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    normalize_repo_url(&raw).ok_or_else(|| format!("cannot normalize origin URL: '{}'", raw))
}

#[derive(Debug, Deserialize)]
struct GhAuthorPrViewRaw {
    #[serde(default)]
    number: u64,
    #[serde(default)]
    url: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    state: String,
    #[serde(default, rename = "isDraft")]
    is_draft: bool,
    #[serde(default, rename = "createdAt")]
    created_at: String,
    #[serde(default, rename = "baseRefName")]
    base_ref_name: String,
    #[serde(default, rename = "headRefName")]
    head_ref_name: String,
    #[serde(default, rename = "headRefOid")]
    head_ref_oid: String,
    #[serde(default)]
    author: Option<GhLoginObj>,
    #[serde(default, rename = "reviewRequests")]
    review_requests: Vec<GhReviewRequestObj>,
}

#[derive(Debug, Deserialize)]
struct GhLoginObj {
    #[serde(default)]
    login: String,
}

#[derive(Debug, Deserialize)]
struct GhReviewRequestObj {
    #[serde(default)]
    login: Option<String>,
}

/// One-shot `gh pr view` for Track B verification (never polled).
pub async fn fetch_pr_for_author_review(
    repo_path: &str,
    normalized_repo_url: &str,
    pr_number: u64,
) -> Result<AuthorPrDetails, String> {
    let mut cmd = Command::new("gh");
    cmd.kill_on_drop(true);
    cmd.current_dir(Path::new(repo_path));
    cmd.args([
        "pr",
        "view",
        &pr_number.to_string(),
        "--json",
        "number,url,title,state,isDraft,createdAt,baseRefName,headRefName,headRefOid,author,reviewRequests",
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

    let raw: GhAuthorPrViewRaw = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("invalid gh pr view JSON: {}", e))?;

    let created_at_ms = DateTime::parse_from_rfc3339(raw.created_at.trim())
        .ok()
        .map(|dt| dt.timestamp_millis());

    let already_requested_reviewers = raw
        .review_requests
        .into_iter()
        .filter_map(|r| r.login)
        .filter_map(|l| normalize_github_id(&l))
        .collect();

    Ok(AuthorPrDetails {
        pr_number: if raw.number > 0 { raw.number } else { pr_number },
        pr_url: raw.url,
        pr_title: raw.title,
        state: raw.state.to_ascii_uppercase(),
        is_draft: raw.is_draft,
        created_at_ms,
        base_branch: raw.base_ref_name,
        head_branch: raw.head_ref_name,
        head_sha: raw.head_ref_oid,
        author_id: raw
            .author
            .and_then(|a| normalize_github_id(&a.login))
            .unwrap_or_default(),
        already_requested_reviewers,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MyOpenPrItem {
    pub pr_number: u64,
    pub pr_url: String,
    pub pr_title: String,
    pub base_branch: String,
    pub head_branch: String,
    pub head_sha: String,
    pub is_draft: bool,
    pub updated_at: String,
    pub already_requested_reviewers: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct GhOpenPrListRaw {
    #[serde(default)]
    number: u64,
    #[serde(default)]
    url: String,
    #[serde(default)]
    title: String,
    #[serde(default, rename = "isDraft")]
    is_draft: bool,
    #[serde(default, rename = "baseRefName")]
    base_ref_name: String,
    #[serde(default, rename = "headRefName")]
    head_ref_name: String,
    #[serde(default, rename = "headRefOid")]
    head_ref_oid: String,
    #[serde(default, rename = "updatedAt")]
    updated_at: String,
    #[serde(default, rename = "reviewRequests")]
    review_requests: Vec<GhReviewRequestObj>,
}

/// One-shot `gh pr list --author @me --state open --limit 20` (called only on explicit user click,
/// protected by a 20s per-project cache + 10s timeout + GHE `GH_HOST` support).
pub async fn list_my_open_prs_via_gh(
    repo_path: &str,
    normalized_repo_url: &str,
) -> Result<Vec<MyOpenPrItem>, String> {
    let mut cmd = Command::new("gh");
    cmd.kill_on_drop(true);
    cmd.current_dir(Path::new(repo_path));
    cmd.args([
        "pr",
        "list",
        "--author",
        "@me",
        "--state",
        "open",
        "--limit",
        "20",
        "--json",
        "number,url,title,isDraft,baseRefName,headRefName,headRefOid,updatedAt,reviewRequests",
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
        .map_err(|_| "gh pr list timed out (10s)".to_string())?
        .map_err(|e| format!("failed to run gh CLI: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "gh pr list failed".to_string()
        } else {
            stderr
        });
    }

    let rows: Vec<GhOpenPrListRaw> = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("invalid gh pr list JSON: {}", e))?;

    Ok(rows
        .into_iter()
        .filter(|r| r.number > 0)
        .map(|r| MyOpenPrItem {
            pr_number: r.number,
            pr_url: r.url,
            pr_title: r.title,
            base_branch: r.base_ref_name,
            head_branch: r.head_ref_name,
            head_sha: r.head_ref_oid,
            is_draft: r.is_draft,
            updated_at: r.updated_at,
            already_requested_reviewers: r
                .review_requests
                .into_iter()
                .filter_map(|req| req.login)
                .filter_map(|l| normalize_github_id(&l))
                .collect(),
        })
        .collect())
}

/// One-shot `gh pr edit <N> --add-reviewer <r1,r2>` against corporate GHE or GitHub.
pub async fn assign_pr_reviewers_via_gh(
    repo_path: &str,
    normalized_repo_url: &str,
    pr_number: u64,
    reviewers: &[String],
) -> Result<(), String> {
    if reviewers.is_empty() {
        return Ok(());
    }
    let mut cmd = Command::new("gh");
    cmd.kill_on_drop(true);
    cmd.current_dir(Path::new(repo_path));
    cmd.args([
        "pr",
        "edit",
        &pr_number.to_string(),
        "--add-reviewer",
        &reviewers.join(","),
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

    let output = tokio::time::timeout(std::time::Duration::from_secs(12), cmd.output())
        .await
        .map_err(|_| "gh pr edit timed out (12s)".to_string())?
        .map_err(|e| format!("failed to run gh CLI: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "gh pr edit --add-reviewer failed".to_string()
        } else {
            stderr
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn sample_pr(created_at_ms: Option<i64>) -> AuthorPrDetails {
        AuthorPrDetails {
            pr_number: 412,
            pr_url: "https://github.corp.local/team/jjdr/pull/412".to_string(),
            pr_title: "Add team auto-review Track B".to_string(),
            state: "OPEN".to_string(),
            is_draft: false,
            created_at_ms,
            base_branch: "main".to_string(),
            head_branch: "feat/track-b".to_string(),
            head_sha: "abc1234deadbeef".to_string(),
            author_id: "alice".to_string(),
            already_requested_reviewers: vec![],
        }
    }

    #[test]
    fn track_b_gate_accepts_recent_open_non_draft_own_pr_and_blocks_false_positives() {
        let now = 1_700_000_000_000i64;

        // 1. Happy path: own OPEN non-draft PR created 3m ago
        let ok = evaluate_track_b_candidate(
            &sample_pr(Some(now - 3 * 60 * 1000)),
            Some("Alice"),
            now,
            false,
            false,
        );
        assert!(ok.eligible);
        assert_eq!(ok.skip_reason, None);

        // 2. Despair: viewing someone else's PR
        let not_author = evaluate_track_b_candidate(
            &sample_pr(Some(now - 60_000)),
            Some("bob"),
            now,
            false,
            false,
        );
        assert!(!not_author.eligible);
        assert_eq!(not_author.skip_reason.as_deref(), Some("not_author"));

        // 3. Despair: old PR in scrollback after restart (16m old)
        let stale = evaluate_track_b_candidate(
            &sample_pr(Some(now - 16 * 60 * 1000)),
            Some("alice"),
            now,
            false,
            false,
        );
        assert!(!stale.eligible);
        assert_eq!(stale.skip_reason.as_deref(), Some("older_than_15m"));

        // 4. Edge: 2m future clock skew is tolerated, 10m future is rejected
        let skew_ok = evaluate_track_b_candidate(
            &sample_pr(Some(now + 2 * 60 * 1000)),
            Some("alice"),
            now,
            false,
            false,
        );
        assert!(skew_ok.eligible);
        let skew_bad = evaluate_track_b_candidate(
            &sample_pr(Some(now + 10 * 60 * 1000)),
            Some("alice"),
            now,
            false,
            false,
        );
        assert!(!skew_bad.eligible);
        assert_eq!(
            skew_bad.skip_reason.as_deref(),
            Some("invalid_future_timestamp")
        );

        // 5. Draft skipped automatically, but allowed manually
        let mut draft = sample_pr(Some(now - 60_000));
        draft.is_draft = true;
        let auto_draft = evaluate_track_b_candidate(&draft, Some("alice"), now, false, false);
        assert!(!auto_draft.eligible);
        assert_eq!(auto_draft.skip_reason.as_deref(), Some("pr_is_draft"));
        let manual_draft = evaluate_track_b_candidate(&draft, Some("alice"), now, false, true);
        assert!(manual_draft.eligible);

        // 6. Closed / Merged blocked even manually
        let mut merged = sample_pr(Some(now - 60_000));
        merged.state = "MERGED".to_string();
        assert!(!evaluate_track_b_candidate(&merged, Some("alice"), now, false, true).eligible);

        // 7. Already prompted same SHA blocked automatically, allowed manually
        let dup = evaluate_track_b_candidate(
            &sample_pr(Some(now - 60_000)),
            Some("alice"),
            now,
            true,
            false,
        );
        assert!(!dup.eligible);
        assert_eq!(dup.skip_reason.as_deref(), Some("already_prompted"));
    }

    #[test]
    fn normalize_reviewers_dedupes_excludes_self_and_caps_at_two() {
        let picked = normalize_selected_reviewers(
            &[
                "  @Alice ".to_string(),
                "Bob".to_string(),
                "bob".to_string(),
                "charlie".to_string(),
                "dave".to_string(),
                "".to_string(),
            ],
            Some("alice"),
            MAX_REVIEWERS_PER_REQUEST,
        );
        assert_eq!(picked, vec!["bob".to_string(), "charlie".to_string()]);
    }

    #[test]
    fn find_unavailable_reviewers_flags_offline_paused_and_unknown_users() {
        let peers = vec![
            PeerInfo {
                github_id: "minsu".to_string(),
                display_name: "Minsu".to_string(),
                status: PresenceStatus::Online,
                repo_urls: vec![],
                last_seen_ms: 1,
            },
            PeerInfo {
                github_id: "bob".to_string(),
                display_name: "Bob".to_string(),
                status: PresenceStatus::Paused,
                repo_urls: vec![],
                last_seen_ms: 1,
            },
            PeerInfo {
                github_id: "charlie".to_string(),
                display_name: "Charlie".to_string(),
                status: PresenceStatus::Offline,
                repo_urls: vec![],
                last_seen_ms: 1,
            },
        ];
        assert!(find_unavailable_reviewers(&["minsu".to_string()], &peers).is_empty());
        assert_eq!(
            find_unavailable_reviewers(
                &[
                    "minsu".to_string(),
                    "bob".to_string(),
                    "charlie".to_string(),
                    "ghost".to_string()
                ],
                &peers
            ),
            vec!["bob".to_string(), "charlie".to_string(), "ghost".to_string()]
        );
    }

    #[test]
    fn prompted_pr_store_persists_and_enforces_bounded_fifo_cap() {
        let dir = std::env::temp_dir().join(format!("jjdr_prompted_pr_{}", Uuid::new_v4()));
        {
            let mut store = PromptedPrStore::load(&dir);
            for i in 0..(PROMPTED_PR_MAX_ENTRIES + 5) {
                store.mark(make_prompted_pr_key(
                    "https://github.corp.local/team/jjdr.git",
                    i as u64,
                    "deadbeef",
                ));
            }
            assert_eq!(store.len(), PROMPTED_PR_MAX_ENTRIES);
            assert!(!store.has(&make_prompted_pr_key(
                "github.corp.local/team/jjdr",
                0,
                "deadbeef"
            )));
            assert!(store.has(&make_prompted_pr_key(
                "github.corp.local/team/jjdr",
                (PROMPTED_PR_MAX_ENTRIES + 4) as u64,
                "DEADBEEF"
            )));
        }

        let reloaded = PromptedPrStore::load(&dir);
        assert_eq!(reloaded.len(), PROMPTED_PR_MAX_ENTRIES);
        assert!(reloaded.has(&make_prompted_pr_key(
            "github.corp.local/team/jjdr",
            (PROMPTED_PR_MAX_ENTRIES + 4) as u64,
            "deadbeef"
        )));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
