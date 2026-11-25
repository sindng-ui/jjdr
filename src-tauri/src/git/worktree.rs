use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use tokio::sync::Semaphore;
use tokio::task::JoinSet;

/// Bound concurrent `git` inspection processes across all projects/worktrees so Windows
/// process creation & Defender scanning never cause CPU/UI spikes.
fn git_inspect_semaphore() -> Arc<Semaphore> {
    static SEM: OnceLock<Arc<Semaphore>> = OnceLock::new();
    SEM.get_or_init(|| Arc::new(Semaphore::new(4))).clone()
}

pub use super::inspect::{
    detect_current_branch, detect_default_branch, get_worktree_diff, inspect_git_repo,
    inspect_worktree_changes, list_local_branches, normalize_path, run_git, validate_git_repo,
    DiffDetail, RepoInspectInfo, WorktreeInfo,
};

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
        let is_merged =
            !is_main && !branch.is_empty() && branch != default_branch && merged_set.contains(&branch);
        let default_b = default_branch.clone();
        let sem = git_inspect_semaphore();
        join_set.spawn(async move {
            let _permit = sem.acquire_owned().await.ok();
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

    let branch_ref = format!("refs/heads/{}", sanitized_branch);
    let exists = run_git(&root, &["show-ref", "--verify", "--quiet", &branch_ref])
        .await
        .is_ok();

    if exists {
        run_git(&root, &["worktree", "add", &target_str, sanitized_branch]).await?;
    } else {
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

async fn is_worktree_registered(root: &Path, worktree_path: &str) -> bool {
    let target = normalize_path(worktree_path);
    match run_git(root, &["worktree", "list", "--porcelain"]).await {
        Ok(out) => parse_worktree_porcelain(&out)
            .into_iter()
            .any(|(p, _, _, _, _)| normalize_path(&p) == target),
        Err(_) => false,
    }
}

/// Build a sibling temporary trash path on the same filesystem so `rename` is O(1) even for 100k+ files.
pub fn build_trash_dir_path(worktree_path: &Path, nonce: u128) -> PathBuf {
    let parent = worktree_path
        .parent()
        .unwrap_or_else(|| Path::new("."));
    let name = worktree_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("worktree");
    parent.join(format!(".{}.jjdr-trash-{}", name, nonce))
}

/// Remove a detached trash directory quietly in the background (with retry on transient Windows locks).
async fn remove_dir_in_background(dir: PathBuf) {
    let retry_delays_ms = [400u64, 1000, 2000, 4000, 8000];
    for delay_ms in retry_delays_ms {
        if !dir.exists() {
            return;
        }
        if tokio::fs::remove_dir_all(&dir).await.is_ok() || !dir.exists() {
            return;
        }
        #[cfg(windows)]
        {
            // Fallback to native Windows `rd /s /q` which handles long paths / read-only attributes reliably
            let mut cmd = tokio::process::Command::new("cmd");
            cmd.args(["/C", "rd", "/s", "/q"])
                .arg(&dir)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .creation_flags(0x08000000); // CREATE_NO_WINDOW
            let _ = cmd.status().await;
            if !dir.exists() {
                return;
            }
        }
        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
    }
}

/// Remove a worktree resiliently and rapidly on Windows:
/// 1) Fast path: O(1) rename the directory to a sibling trash path -> `git worktree prune` + branch delete
///    finishes in <0.5s, then physically deletes the renamed folder in a detached background task.
/// 2) Fallback path: if an active OS handle blocks rename, retry `git worktree remove` with backoff.
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

    // Fast path: O(1) same-volume rename -> immediate git prune -> async physical folder wipe
    if wt.exists() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let trash_dir = build_trash_dir_path(&wt, nonce);

        // Give Windows handles a tiny retry window (2 quick attempts) for O(1) rename
        let mut renamed = tokio::fs::rename(&wt, &trash_dir).await.is_ok();
        if !renamed {
            tokio::time::sleep(Duration::from_millis(300)).await;
            renamed = tokio::fs::rename(&wt, &trash_dir).await.is_ok();
        }

        if renamed {
            let _ = run_git(&root, &["worktree", "prune"]).await;
            if delete_branch {
                if let Some(b) = branch_name.filter(|s| !s.trim().is_empty()) {
                    let flag = if force { "-D" } else { "-d" };
                    let _ = run_git(&root, &["branch", flag, b]).await;
                }
            }
            // Physically wipe the detached trash folder completely in the background
            tokio::spawn(remove_dir_in_background(trash_dir));
            return Ok(());
        }
    }

    let retry_delays_ms = [300u64, 600, 1000, 1500, 2000];
    let mut last_err: Option<String> = None;

    for (attempt, delay_ms) in retry_delays_ms.iter().enumerate() {
        let mut args = vec!["worktree", "remove"];
        if force || attempt >= 2 {
            args.push("--force");
        }
        args.push(worktree_path);

        match run_git(&root, &args).await {
            Ok(_) => {
                last_err = None;
                break;
            }
            Err(err) => {
                // Check if the worktree actually disappeared despite a transient Windows lock error.
                let _ = run_git(&root, &["worktree", "prune"]).await;
                let still_exists = wt.exists();
                let still_reg = is_worktree_registered(&root, worktree_path).await;

                if !still_exists && !still_reg {
                    last_err = None;
                    break;
                }

                // If Git metadata is already gone or force is enabled, try removing lingering dir directly.
                if still_exists && (!still_reg || force) {
                    let _ = tokio::fs::remove_dir_all(&wt).await;
                    let _ = run_git(&root, &["worktree", "prune"]).await;
                    if !wt.exists() && !is_worktree_registered(&root, worktree_path).await {
                        last_err = None;
                        break;
                    }
                }

                last_err = Some(err);
                tokio::time::sleep(Duration::from_millis(*delay_ms)).await;
            }
        }
    }

    if let Some(err) = last_err {
        // Final state verification: if directory & git registration are gone, treat as success.
        let _ = run_git(&root, &["worktree", "prune"]).await;
        if wt.exists() || is_worktree_registered(&root, worktree_path).await {
            return Err(err);
        }
    }

    let _ = run_git(&root, &["worktree", "prune"]).await;

    if delete_branch {
        if let Some(b) = branch_name.filter(|s| !s.trim().is_empty()) {
            let flag = if force { "-D" } else { "-d" };
            let _ = run_git(&root, &["branch", flag, b]).await;
        }
    }
    Ok(())
}

/// Safely rename a non-main worktree's checked-out Git branch using `git branch -m`.
pub async fn rename_worktree_branch(
    repo_path: &str,
    old_branch: &str,
    new_branch: &str,
) -> Result<(), String> {
    let old_b = old_branch.trim();
    let new_b = new_branch.trim();
    if old_b.is_empty() || new_b.is_empty() {
        return Err("Branch name cannot be empty".into());
    }
    if old_b == new_b {
        return Ok(());
    }

    let root = PathBuf::from(repo_path);
    run_git(&root, &["check-ref-format", "--branch", new_b])
        .await
        .map_err(|_| format!("Invalid Git branch name: {}", new_b))?;

    run_git(&root, &["branch", "-m", old_b, new_b]).await?;
    Ok(())
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

    #[test]
    fn builds_sibling_trash_dir_on_same_parent() {
        let wt = Path::new("K:/repo/app-wt-auth");
        let trash = build_trash_dir_path(wt, 12345);
        assert_eq!(trash, PathBuf::from("K:/repo/.app-wt-auth.jjdr-trash-12345"));
    }
}
