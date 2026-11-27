use std::path::Path;

use relay_protocol::{normalize_github_id, normalize_repo_list, normalize_repo_url};
use tokio::process::Command;
use uuid::Uuid;

use crate::git::inspect::build_git_command;
use crate::store::projects::ProjectConfig;

/// Load or create a stable per-PC UUID stored in `<config_dir>/device_id.txt`.
pub fn load_or_create_device_id(config_dir: &Path) -> String {
    let path = config_dir.join("device_id.txt");
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let trimmed = existing.trim();
        if trimmed.len() >= 8 && trimmed.len() <= 64 {
            return trimmed.to_string();
        }
    }
    let fresh = format!("pc-{}", Uuid::new_v4());
    let _ = std::fs::create_dir_all(config_dir);
    let _ = std::fs::write(&path, &fresh);
    fresh
}

/// Extract hostname (e.g. `github.corp.company.com`) from a normalized repo URL `host/org/repo`.
pub fn extract_host_from_normalized_repo(norm_repo: &str) -> Option<String> {
    let host = norm_repo.split('/').next()?.trim();
    if host.is_empty() {
        return None;
    }
    Some(host.to_string())
}

/// Collect canonical normalized `origin` remote URLs across all configured jjdr projects.
pub async fn collect_project_repo_urls(projects: &[ProjectConfig]) -> Vec<String> {
    let mut raw_urls = Vec::with_capacity(projects.len());
    for proj in projects {
        let path = Path::new(&proj.repo_path);
        if !path.exists() {
            continue;
        }
        let mut cmd = build_git_command(path);
        cmd.args(["remote", "get-url", "origin"]);
        if let Ok(output) = cmd.output().await {
            if output.status.success() {
                let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if let Some(norm) = normalize_repo_url(&url) {
                    raw_urls.push(norm);
                }
            }
        }
    }
    normalize_repo_list(raw_urls)
}

/// Auto-detect corporate GitHub / GHE login via a single `gh api user --jq .login` invocation.
/// When registered projects belong to a corporate GHE host (non-github.com), passes `GH_HOST`
/// automatically so enterprise SSO identities resolve cleanly.
pub async fn detect_github_id_via_gh(normalized_repos: &[String]) -> Result<String, String> {
    let preferred_host = normalized_repos
        .iter()
        .filter_map(|r| extract_host_from_normalized_repo(r))
        .find(|h| !h.eq_ignore_ascii_case("github.com"));

    if let Some(ref host) = preferred_host {
        if let Ok(id) = run_gh_whoami(Some(host)).await {
            return Ok(id);
        }
    }
    run_gh_whoami(None).await
}

async fn run_gh_whoami(gh_host: Option<&str>) -> Result<String, String> {
    let mut cmd = Command::new("gh");
    cmd.args(["api", "user", "--jq", ".login"]);
    if let Some(host) = gh_host {
        cmd.env("GH_HOST", host);
    }
    #[cfg(windows)]
    {
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let output = tokio::time::timeout(std::time::Duration::from_secs(6), cmd.output())
        .await
        .map_err(|_| "gh api user timed out (6s)".to_string())?
        .map_err(|e| format!("failed to run gh CLI: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "gh CLI returned non-zero status (run `gh auth login`)".to_string()
        } else {
            stderr
        });
    }

    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    normalize_github_id(&raw).ok_or_else(|| format!("invalid login from gh: '{}'", raw))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_id_is_created_once_and_persisted() {
        let dir = std::env::temp_dir().join(format!("jjdr_dev_id_test_{}", Uuid::new_v4()));
        let first = load_or_create_device_id(&dir);
        let second = load_or_create_device_id(&dir);
        assert!(first.starts_with("pc-"));
        assert_eq!(first, second);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn extracts_enterprise_host_from_normalized_repo() {
        assert_eq!(
            extract_host_from_normalized_repo("github.corp.company.com/team/jjdr").as_deref(),
            Some("github.corp.company.com")
        );
        assert_eq!(extract_host_from_normalized_repo(""), None);
    }
}
