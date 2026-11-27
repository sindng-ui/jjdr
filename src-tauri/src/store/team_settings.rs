use serde::{Deserialize, Serialize};

pub const DEFAULT_AUTO_REVIEW_PROMPT: &str = "\
You are performing an automated code review for PR #{{pr_number}} ({{pr_url}}).
Title: {{pr_title}}
Branch: {{head_branch}} -> {{base_branch}} (commit {{head_sha}}, author @{{author}})

Instructions:
1. Review the diff against origin/{{base_branch}} carefully for bugs, edge cases, regressions, security issues, and performance problems.
2. Do NOT modify or commit repository code, and do NOT approve or merge the PR.
3. Post your structured review comment directly on PR #{{pr_number}} (comment-only via `gh pr comment` or `gh pr review --comment`).
4. Save the full markdown review report to `{{review_report_path}}` so the reviewer can inspect it in jjdr's built-in Markdown Viewer.";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TeamOrchestrationSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub relay_url: String,
    #[serde(default)]
    pub team_key: String,
    /// Bypass system/corporate HTTP proxy for direct LAN/intranet relay IP connections.
    #[serde(default = "default_true")]
    pub bypass_proxy: bool,
    /// Optional manual override for corporate GHE login ID (auto-detected via `gh api user` when empty).
    #[serde(default)]
    pub github_id_override: String,
    #[serde(default)]
    pub display_name: String,
    /// Global pause toggle synced to relay (Layer-1 rejects incoming requests while paused).
    #[serde(default)]
    pub auto_review_paused: bool,

    /// Primary AI CLI for ephemeral auto-review workers (empty = inherit project default_agent).
    #[serde(default)]
    pub primary_agent: String,
    #[serde(default)]
    pub primary_model: String,
    /// Fallback AI CLI used once if the primary AI hits rate-limit / quota exhaustion.
    #[serde(default)]
    pub fallback_agent: String,
    #[serde(default)]
    pub fallback_model: String,

    /// Global concurrent cap across all projects on this PC (1..=5).
    #[serde(default = "default_global_max_workers")]
    pub global_max_auto_review_workers: u32,
    /// Per-project concurrent cap (1..=3).
    #[serde(default = "default_per_project_max_workers")]
    pub per_project_max_workers: u32,
    /// Ephemeral worktree cleanup timing: "on_ack" (default) | "immediate".
    #[serde(default = "default_ack_teardown_mode")]
    pub ack_teardown_mode: String,

    #[serde(default = "default_review_prompt")]
    pub review_prompt_template: String,

    // Layer-2 local reject rules
    #[serde(default = "default_excluded_labels")]
    pub reject_excluded_labels: Vec<String>,
    #[serde(default)]
    pub reject_excluded_branches: Vec<String>,
    #[serde(default)]
    pub reject_disabled_project_ids: Vec<String>,
    #[serde(default)]
    pub reject_allowed_authors: Vec<String>,
    #[serde(default)]
    pub reject_blocked_authors: Vec<String>,
    #[serde(default = "default_max_queue_size")]
    pub reject_max_queue_size: u32,
}

fn default_true() -> bool {
    true
}
fn default_global_max_workers() -> u32 {
    2
}
fn default_per_project_max_workers() -> u32 {
    1
}
fn default_ack_teardown_mode() -> String {
    "on_ack".to_string()
}
fn default_review_prompt() -> String {
    DEFAULT_AUTO_REVIEW_PROMPT.to_string()
}
fn default_excluded_labels() -> Vec<String> {
    vec!["wip".to_string(), "no-ai-review".to_string()]
}
fn default_max_queue_size() -> u32 {
    5
}

impl Default for TeamOrchestrationSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            relay_url: String::new(),
            team_key: String::new(),
            bypass_proxy: true,
            github_id_override: String::new(),
            display_name: String::new(),
            auto_review_paused: false,
            primary_agent: String::new(),
            primary_model: String::new(),
            fallback_agent: String::new(),
            fallback_model: String::new(),
            global_max_auto_review_workers: default_global_max_workers(),
            per_project_max_workers: default_per_project_max_workers(),
            ack_teardown_mode: default_ack_teardown_mode(),
            review_prompt_template: default_review_prompt(),
            reject_excluded_labels: default_excluded_labels(),
            reject_excluded_branches: Vec::new(),
            reject_disabled_project_ids: Vec::new(),
            reject_allowed_authors: Vec::new(),
            reject_blocked_authors: Vec::new(),
            reject_max_queue_size: default_max_queue_size(),
        }
    }
}

impl TeamOrchestrationSettings {
    pub fn normalized_relay_base_url(&self) -> Option<String> {
        let trimmed = self.relay_url.trim().trim_end_matches('/');
        if trimmed.is_empty() {
            return None;
        }
        if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
            Some(trimmed.to_string())
        } else {
            Some(format!("http://{}", trimmed))
        }
    }

    pub fn is_connectable(&self) -> bool {
        self.enabled
            && self.normalized_relay_base_url().is_some()
            && !self.team_key.trim().is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::projects::AppSettings;

    #[test]
    fn legacy_settings_json_without_team_deserializes_with_safe_defaults() {
        let legacy = r#"{
            "theme": "aurora",
            "radar_density": "balanced",
            "stuck_minutes": 5,
            "notify_on_blocked": false,
            "notify_on_done": false,
            "show_merge_overlap": true,
            "prompt_presets": []
        }"#;
        let parsed: AppSettings = serde_json::from_str(legacy).expect("parse legacy settings");
        assert!(!parsed.team.enabled);
        assert!(parsed.team.bypass_proxy);
        assert_eq!(parsed.team.global_max_auto_review_workers, 2);
        assert_eq!(parsed.team.per_project_max_workers, 1);
        assert_eq!(parsed.team.ack_teardown_mode, "on_ack");
        assert_eq!(parsed.team.reject_max_queue_size, 5);
        assert!(parsed.team.reject_excluded_labels.contains(&"wip".to_string()));
        assert!(parsed.team.review_prompt_template.contains("{{review_report_path}}"));
    }

    #[test]
    fn normalizes_relay_url_with_and_without_scheme() {
        let mut s = TeamOrchestrationSettings::default();
        s.relay_url = "  10.20.30.40:8787/ ".to_string();
        assert_eq!(
            s.normalized_relay_base_url().as_deref(),
            Some("http://10.20.30.40:8787")
        );
        s.relay_url = "https://relay.corp.local:8443///".to_string();
        assert_eq!(
            s.normalized_relay_base_url().as_deref(),
            Some("https://relay.corp.local:8443")
        );
    }
}
