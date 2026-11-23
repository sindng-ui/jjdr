use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tokio::process::Command;
use tokio::task::JoinSet;

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

fn build_git_command(cwd: &Path) -> Command {
    let mut cmd = Command::new("git");
    cmd.current_dir(cwd);
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

async fn run_git(cwd: &Path, args: &[&str]) -> Result<String, String> {
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

pub async fn detect_default_branch(repo_path: &Path) -> String {
    if let Ok(sym) = run_git(repo_path, &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).await {
        let trimmed = sym.trim();
        if let Some(name) = trimmed.strip_prefix("origin/") {
            return name.to_string();
        }
    }
    for candidate in ["main", "master"] {
        if run_git(repo_path, &["rev-parse", "--verify", candidate]).await.is_ok() {
            return candidate.to_string();
        }
    }
    run_git(repo_path, &["rev-parse", "--abbrev-ref", "HEAD"])
        .await
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| "main".to_string())
}

/// Parse `git worktree list --porcelain` output into raw worktree entries.
pub fn parse_worktree_porcelain(output: &str) -> Vec<(String, String, String, bool, bool)> {
    let mut entries = Vec::new();
    let mut cur_path = String::new();
    let mut cur_head = String::new();
    let mut cur_branch = String::new();
    let mut cur_bare = false;
    let mut cur_detached = false;

    for raw_line in output.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            if !cur_path.is_empty() {
                entries.push((
                    std::mem::take(&mut cur_path),
                    std::mem::take(&mut cur_head),
                    std::mem::take(&mut cur_branch),
                    cur_bare,
                    cur_detached,
                ));
                cur_bare = false;
                cur_detached = false;
            }
            continue;
        }
        if let Some(p) = line.strip_prefix("worktree ") {
            cur_path = p.trim().to_string();
        } else if let Some(h) = line.strip_prefix("HEAD ") {
            cur_head = h.trim().to_string();
        } else if let Some(b) = line.strip_prefix("branch ") {
            let b = b.trim();
            cur_branch = b.strip_prefix("refs/heads/").unwrap_or(b).to_string();
        } else if line == "bare" {
            cur_bare = true;
        } else if line == "detached" {
            cur_detached = true;
        }
    }
    if !cur_path.is_empty() {
        entries.push((cur_path, cur_head, cur_branch, cur_bare, cur_detached));
    }
    entries
}

/// Inspect all worktrees of a repository in parallel using Tokio tasks, including diff stats and merge overlap radar.
pub async fn list_worktrees_with_status(
    repo_path: &str,
    default_branch_override: Option<&str>,
) -> Result<Vec<WorktreeInfo>, String> {
    let root = PathBuf::from(repo_path);
    let porcelain = run_git(&root, &["worktree", "list", "--porcelain"]).await?;
    let parsed = parse_worktree_porcelain(&porcelain);

    let default_branch = match default_branch_override {
        Some(b) if !b.trim().is_empty() => b.to_string(),
        _ => detect_default_branch(&root).await,
    };

    let merged_set = fetch_merged_branches(&root, &default_branch).await;
    let main_norm = normalize_path(repo_path);

    let mut join_set = JoinSet::new();
    for (idx, (wt_path, head, branch, is_bare, is_detached)) in parsed.into_iter().enumerate() {
        let is_main = idx == 0 || normalize_path(&wt_path) == main_norm;
        let is_merged = !is_main && !branch.is_empty() && branch != default_branch && merged_set.contains(&branch);
        let default_b = default_branch.clone();
        join_set.spawn(async move {
            let (dirty_count, added_lines, deleted_lines, changed_files) = if is_bare {
                (0, 0, 0, Vec::new())
            } else {
                inspect_worktree_changes(Path::new(&wt_path), &default_b, is_main).await
            };
            (
                idx,
                WorktreeInfo {
                    path: wt_path,
                    head,
                    branch,
                    is_main,
                    is_bare,
                    is_detached,
                    is_merged,
                    dirty_count,
                    added_lines,
                    deleted_lines,
                    changed_files,
                    overlap_files: Vec::new(),
                },
            )
        });
    }

    let mut indexed = Vec::new();
    while let Some(res) = join_set.join_next().await {
        if let Ok(item) = res {
            indexed.push(item);
        }
    }
    indexed.sort_by_key(|(idx, _)| *idx);
    let mut worktrees: Vec<WorktreeInfo> = indexed.into_iter().map(|(_, w)| w).collect();

    compute_merge_overlaps(&mut worktrees);
    Ok(worktrees)
}

async fn fetch_merged_branches(root: &Path, default_branch: &str) -> HashSet<String> {
    let mut set = HashSet::new();
    if let Ok(out) = run_git(root, &["branch", "--merged", default_branch]).await {
        for line in out.lines() {
            let cleaned = line.trim().trim_start_matches(['*', '+']).trim();
            if !cleaned.is_empty() {
                set.insert(cleaned.to_string());
            }
        }
    }
    set
}

async fn inspect_worktree_changes(
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

    // For non-main feature worktrees, also include committed changes vs default branch for merge overlap radar.
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

/// Merge Overlap Radar: detect relative file paths modified across 2+ distinct worktrees of the same repo.
pub fn compute_merge_overlaps(worktrees: &mut [WorktreeInfo]) {
    let mut file_counts: HashMap<String, usize> = HashMap::new();
    for wt in worktrees.iter() {
        for f in &wt.changed_files {
            *file_counts.entry(f.clone()).or_insert(0) += 1;
        }
    }
    for wt in worktrees.iter_mut() {
        wt.overlap_files = wt
            .changed_files
            .iter()
            .filter(|f| file_counts.get(*f).copied().unwrap_or(0) >= 2)
            .cloned()
            .collect();
    }
}

pub async fn create_worktree(
    repo_path: &str,
    branch_name: &str,
    base_branch: Option<&str>,
    custom_dir: Option<&str>,
) -> Result<String, String> {
    let root = PathBuf::from(repo_path);
    let sanitized_branch = branch_name.trim();
    if sanitized_branch.is_empty() {
        return Err("Branch name cannot be empty".into());
    }

    let target_dir = if let Some(dir) = custom_dir.filter(|s| !s.trim().is_empty()) {
        PathBuf::from(dir)
    } else {
        let repo_name = root
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("repo");
        let parent = root.parent().unwrap_or(&root);
        let slug = sanitized_branch.replace(['/', '\\', ' '], "-");
        parent.join(format!("{}-wt-{}", repo_name, slug))
    };

    let target_str = target_dir.to_string_lossy().to_string();

    // Check if branch already exists locally
    let branch_ref = format!("refs/heads/{}", sanitized_branch);
    let exists = run_git(&root, &["show-ref", "--verify", "--quiet", &branch_ref])
        .await
        .is_ok();

    if exists {
        run_git(&root, &["worktree", "add", &target_str, sanitized_branch]).await?;
    } else {
        // Default to the repository's current checked-out branch (HEAD)
        let base = match base_branch.filter(|b| !b.trim().is_empty()) {
            Some(b) => b.to_string(),
            None => detect_current_branch(&root).await,
        };
        run_git(
            &root,
            &["worktree", "add", "-b", sanitized_branch, &target_str, &base],
        )
        .await?;
    }

    Ok(target_str)
}

pub async fn remove_worktree(
    repo_path: &str,
    worktree_path: &str,
    branch_name: Option<&str>,
    force: bool,
    delete_branch: bool,
) -> Result<(), String> {
    let root = PathBuf::from(repo_path);
    let wt = PathBuf::from(worktree_path);

    if !force && wt.exists() {
        if let Ok(status) = run_git(&wt, &["status", "--porcelain"]).await {
            if !status.trim().is_empty() {
                return Err(
                    "Worktree has uncommitted changes. Commit/stash them or enable Force Remove."
                        .into(),
                );
            }
        }
    }

    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(worktree_path);
    run_git(&root, &args).await?;
    let _ = run_git(&root, &["worktree", "prune"]).await;

    if delete_branch {
        if let Some(b) = branch_name.filter(|s| !s.trim().is_empty()) {
            let flag = if force { "-D" } else { "-d" };
            let _ = run_git(&root, &["branch", flag, b]).await;
        }
    }
    Ok(())
}

pub async fn get_worktree_diff(worktree_path: &str, default_branch: &str) -> Result<DiffDetail, String> {
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

    // Cap diff payload to 256 KB so UI stays instantaneous
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_worktrees() {
        let sample = "\
worktree K:/repo/app
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main

worktree K:/repo/app-wt-auth
HEAD 2222222222222222222222222222222222222222
branch refs/heads/feat/auth

worktree K:/repo/app-wt-det
HEAD 3333333333333333333333333333333333333333
detached
";
        let parsed = parse_worktree_porcelain(sample);
        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[0].2, "main");
        assert_eq!(parsed[1].2, "feat/auth");
        assert!(parsed[2].4);
    }

    #[test]
    fn detects_merge_overlap_across_worktrees() {
        let mut wts = vec![
            WorktreeInfo {
                path: "a".into(),
                head: "".into(),
                branch: "feat/a".into(),
                is_main: false,
                is_bare: false,
                is_detached: false,
                is_merged: false,
                dirty_count: 2,
                added_lines: 10,
                deleted_lines: 2,
                changed_files: vec!["src/App.tsx".into(), "src/a.ts".into()],
                overlap_files: vec![],
            },
            WorktreeInfo {
                path: "b".into(),
                head: "".into(),
                branch: "feat/b".into(),
                is_main: false,
                is_bare: false,
                is_detached: false,
                is_merged: false,
                dirty_count: 2,
                added_lines: 5,
                deleted_lines: 1,
                changed_files: vec!["src/App.tsx".into(), "src/b.ts".into()],
                overlap_files: vec![],
            },
        ];
        compute_merge_overlaps(&mut wts);
        assert_eq!(wts[0].overlap_files, vec!["src/App.tsx"]);
        assert_eq!(wts[1].overlap_files, vec!["src/App.tsx"]);
    }
}
