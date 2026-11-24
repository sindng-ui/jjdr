use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tokio::process::Command;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeInfo {
    pub path: String,
    pub head: String,
    pub branch: String,
    pub is_main: bool,
    pub is_bare: bool,
    pub is_detached: bool,
    pub is_merged: bool,
    pub dirty_count: usize,
    pub added_lines: usize,
    pub deleted_lines: usize,
    pub changed_files: Vec<String>,
    pub overlap_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffDetail {
    pub worktree_path: String,
    pub branch: String,
    pub stat_summary: String,
    pub diff_text: String,
    pub changed_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoInspectInfo {
    pub canonical_path: String,
    pub suggested_name: String,
    pub current_branch: String,
    pub default_branch: String,
    pub branches: Vec<String>,
    pub detected_env_files: Vec<String>,
    pub suggested_verify_commands: Vec<String>,
    pub suggested_setup_commands: Vec<String>,
}

pub fn build_git_command(cwd: &Path) -> Command {
    let mut cmd = Command::new("git");
    cmd.current_dir(cwd);
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

pub async fn run_git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let output = build_git_command(cwd)
        .args(args)
        .output()
        .await
        .map_err(|e| format!("Failed to spawn git: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Err(if !stderr.is_empty() { stderr } else { stdout });
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Normalize path separators for consistent Windows/Unix comparison.
pub fn normalize_path(path: &str) -> String {
    let cleaned = path.replace('\\', "/");
    let trimmed = cleaned.trim_end_matches('/');
    #[cfg(windows)]
    {
        trimmed.to_lowercase()
    }
    #[cfg(not(windows))]
    {
        trimmed.to_string()
    }
}

pub async fn validate_git_repo(repo_path: &str) -> Result<String, String> {
    let path = Path::new(repo_path);
    if !path.exists() {
        return Err(format!("Path does not exist: {}", repo_path));
    }
    let root = run_git(path, &["rev-parse", "--show-toplevel"]).await?;
    Ok(root.trim().to_string())
}

pub async fn detect_current_branch(repo_path: &Path) -> String {
    run_git(repo_path, &["rev-parse", "--abbrev-ref", "HEAD"])
        .await
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "HEAD".to_string())
}

pub async fn list_local_branches(repo_path: &Path) -> Vec<String> {
    run_git(
        repo_path,
        &["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    )
    .await
    .map(|out| {
        out.lines()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from)
            .collect()
    })
    .unwrap_or_default()
}

pub async fn detect_default_branch(repo_path: &Path) -> String {
    if let Ok(sym) =
        run_git(repo_path, &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).await
    {
        let trimmed = sym.trim();
        if let Some(name) = trimmed.strip_prefix("origin/") {
            return name.to_string();
        }
    }
    for candidate in ["main", "master"] {
        if run_git(repo_path, &["rev-parse", "--verify", candidate])
            .await
            .is_ok()
        {
            return candidate.to_string();
        }
    }
    run_git(repo_path, &["rev-parse", "--abbrev-ref", "HEAD"])
        .await
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| "main".to_string())
}

pub async fn inspect_git_repo(repo_path: &str) -> Result<RepoInspectInfo, String> {
    let canonical = validate_git_repo(repo_path).await?;
    let root = PathBuf::from(&canonical);

    let suggested_name = root
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("project")
        .to_string();

    let (current_branch, default_branch, branches) = tokio::join!(
        detect_current_branch(&root),
        detect_default_branch(&root),
        list_local_branches(&root)
    );

    let env_candidates = [
        ".env",
        ".env.local",
        ".env.development",
        ".env.development.local",
        ".env.test",
    ];
    let mut detected_env_files = Vec::new();
    for rel in env_candidates {
        if root.join(rel).is_file() {
            detected_env_files.push(rel.to_string());
        }
    }

    let mut suggested_verify_commands = Vec::new();
    let mut suggested_setup_commands = Vec::new();

    if root.join("package.json").is_file() {
        if root.join("pnpm-lock.yaml").is_file() {
            suggested_setup_commands.push("pnpm install".into());
            suggested_verify_commands.push("pnpm test".into());
            suggested_verify_commands.push("pnpm build".into());
        } else if root.join("bun.lockb").is_file() || root.join("bun.lock").is_file() {
            suggested_setup_commands.push("bun install".into());
            suggested_verify_commands.push("bun test".into());
            suggested_verify_commands.push("bun run build".into());
        } else if root.join("yarn.lock").is_file() {
            suggested_setup_commands.push("yarn install".into());
            suggested_verify_commands.push("yarn test".into());
            suggested_verify_commands.push("yarn build".into());
        } else {
            suggested_setup_commands.push("npm ci".into());
            suggested_setup_commands.push("npm install".into());
            suggested_verify_commands.push("npm test".into());
            suggested_verify_commands.push("npm run build".into());
        }
    }
    if root.join("Cargo.toml").is_file() || root.join("src-tauri/Cargo.toml").is_file() {
        suggested_verify_commands.push("cargo test".into());
        suggested_verify_commands.push("cargo check".into());
    }
    if root.join("pyproject.toml").is_file() || root.join("requirements.txt").is_file() {
        suggested_setup_commands.push("uv sync".into());
        suggested_verify_commands.push("pytest".into());
    }
    if root.join("go.mod").is_file() {
        suggested_verify_commands.push("go test ./...".into());
    }

    Ok(RepoInspectInfo {
        canonical_path: canonical,
        suggested_name,
        current_branch,
        default_branch,
        branches,
        detected_env_files,
        suggested_verify_commands,
        suggested_setup_commands,
    })
}

pub async fn inspect_worktree_changes(
    wt_path: &Path,
    default_branch: &str,
    is_main: bool,
) -> (usize, usize, usize, Vec<String>) {
    if !wt_path.exists() {
        return (0, 0, 0, Vec::new());
    }

    let mut changed_set = HashSet::<String>::new();
    let mut dirty_count = 0usize;

    if let Ok(status_out) = run_git(wt_path, &["status", "--porcelain"]).await {
        for line in status_out.lines() {
            if line.len() > 3 {
                dirty_count += 1;
                let path_part = line[3..].trim();
                let final_path = path_part
                    .rsplit_once(" -> ")
                    .map(|(_, r)| r)
                    .unwrap_or(path_part)
                    .trim_matches('"');
                changed_set.insert(final_path.to_string());
            }
        }
    }

    let (mut added, mut deleted) = parse_numstat(
        &run_git(wt_path, &["diff", "--numstat", "HEAD"])
            .await
            .unwrap_or_default(),
        &mut changed_set,
    );

    if !is_main {
        let range = format!("{}...HEAD", default_branch);
        if let Ok(branch_numstat) = run_git(wt_path, &["diff", "--numstat", &range]).await {
            let (b_add, b_del) = parse_numstat(&branch_numstat, &mut changed_set);
            if added == 0 && deleted == 0 {
                added = b_add;
                deleted = b_del;
            }
        }
    }

    let mut files: Vec<String> = changed_set.into_iter().collect();
    files.sort();
    (dirty_count, added, deleted, files)
}

fn parse_numstat(output: &str, files_out: &mut HashSet<String>) -> (usize, usize) {
    let mut added = 0usize;
    let mut deleted = 0usize;
    for line in output.lines() {
        let mut parts = line.split('\t');
        let a = parts.next().unwrap_or("0").parse::<usize>().unwrap_or(0);
        let d = parts.next().unwrap_or("0").parse::<usize>().unwrap_or(0);
        if let Some(file) = parts.next() {
            let trimmed = file.trim();
            if !trimmed.is_empty() {
                files_out.insert(trimmed.to_string());
            }
        }
        added += a;
        deleted += d;
    }
    (added, deleted)
}

pub async fn get_worktree_diff(
    worktree_path: &str,
    default_branch: &str,
) -> Result<DiffDetail, String> {
    let wt = PathBuf::from(worktree_path);
    let branch = run_git(&wt, &["rev-parse", "--abbrev-ref", "HEAD"])
        .await
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    let stat = run_git(&wt, &["diff", "--shortstat", "HEAD"])
        .await
        .unwrap_or_default()
        .trim()
        .to_string();

    let mut diff_text = run_git(&wt, &["diff", "HEAD"]).await.unwrap_or_default();
    if diff_text.trim().is_empty() && !branch.is_empty() && branch != default_branch {
        let range = format!("{}...HEAD", default_branch);
        diff_text = run_git(&wt, &["diff", &range]).await.unwrap_or_default();
    }

    if diff_text.len() > 256 * 1024 {
        diff_text.truncate(256 * 1024);
        diff_text.push_str("\n\n... [Diff truncated at 256 KB for performance] ...");
    }

    let (_, _, _, changed_files) = inspect_worktree_changes(&wt, default_branch, false).await;

    Ok(DiffDetail {
        worktree_path: worktree_path.to_string(),
        branch,
        stat_summary: if stat.is_empty() {
            format!("{} files changed", changed_files.len())
        } else {
            stat
        },
        diff_text,
        changed_files,
    })
}
