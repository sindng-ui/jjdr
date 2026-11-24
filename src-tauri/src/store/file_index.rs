use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::{Mutex, RwLock};

use crate::git::inspect::normalize_path;

pub use super::file_matcher::{
    fuzzy_score_path, scan_directory_files, score_and_collect, FileMatchItem, FileSearchResult,
};

const MAX_CACHED_PROJECTS: usize = 6;
const BASE_TTL: Duration = Duration::from_secs(90);
const DELTA_TTL: Duration = Duration::from_secs(25);

pub struct WorktreeDelta {
    pub added: Vec<String>,
    pub removed: HashSet<String>,
    updated_at: Instant,
}

struct ProjectFileCacheEntry {
    repo_path: String,
    base_files: Arc<Vec<String>>,
    base_set: Arc<HashSet<String>>,
    updated_at: Instant,
    last_accessed: Instant,
    worktree_deltas: HashMap<String, WorktreeDelta>,
}

/// Memory-efficient LRU file index:
/// - Lazily warms only projects the user has actually focused.
/// - Stores one shared `base_files` list per project and only tiny `added/removed` deltas
///   for sibling worktrees of the same project.
pub struct FileIndexStore {
    entries: RwLock<HashMap<String, ProjectFileCacheEntry>>,
    inflight: Mutex<HashSet<String>>,
}

impl FileIndexStore {
    pub fn new() -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
            inflight: Mutex::new(HashSet::new()),
        }
    }

    pub fn warm_background(
        self: &Arc<Self>,
        project_id: String,
        repo_path: String,
        worktree_path: Option<String>,
    ) {
        let store = self.clone();
        tokio::spawn(async move {
            let norm_repo = normalize_path(&repo_path);
            let norm_wt = worktree_path
                .as_deref()
                .map(normalize_path)
                .filter(|p| !p.is_empty() && p != &norm_repo);

            {
                let guard = store.entries.read().await;
                if let Some(entry) = guard.get(&project_id) {
                    let base_fresh = entry.updated_at.elapsed() < BASE_TTL;
                    let delta_fresh = match &norm_wt {
                        None => true,
                        Some(wt_key) => entry
                            .worktree_deltas
                            .get(wt_key)
                            .map(|d| d.updated_at.elapsed() < DELTA_TTL)
                            .unwrap_or(false),
                    };
                    if base_fresh && delta_fresh {
                        return;
                    }
                }
            }

            let lock_key = format!("{}::{}", project_id, norm_wt.as_deref().unwrap_or("base"));
            {
                let mut inflight = store.inflight.lock().await;
                if !inflight.insert(lock_key.clone()) {
                    return;
                }
            }

            let _ = store
                .ensure_indexed(&project_id, &repo_path, worktree_path.as_deref())
                .await;

            store.inflight.lock().await.remove(&lock_key);
        });
    }

    pub async fn search(
        self: &Arc<Self>,
        project_id: &str,
        repo_path: &str,
        worktree_path: Option<&str>,
        query: &str,
        limit: usize,
        use_regex: bool,
    ) -> Result<FileSearchResult, String> {
        let effective_root = worktree_path
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(repo_path);
        let norm_repo = normalize_path(repo_path);
        let norm_wt = {
            let n = normalize_path(effective_root);
            if n == norm_repo {
                None
            } else {
                Some(n)
            }
        };

        let mut from_cache = false;
        let snapshot: Option<(Arc<Vec<String>>, Option<(Vec<String>, HashSet<String>)>, bool)> = {
            let mut guard = self.entries.write().await;
            if let Some(entry) = guard.get_mut(project_id) {
                entry.last_accessed = Instant::now();
                let base_stale = entry.updated_at.elapsed() >= BASE_TTL;
                match &norm_wt {
                    None => {
                        from_cache = true;
                        Some((entry.base_files.clone(), None, base_stale))
                    }
                    Some(wt_key) => {
                        if let Some(delta) = entry.worktree_deltas.get(wt_key) {
                            from_cache = true;
                            let delta_stale = base_stale || delta.updated_at.elapsed() >= DELTA_TTL;
                            Some((
                                entry.base_files.clone(),
                                Some((delta.added.clone(), delta.removed.clone())),
                                delta_stale,
                            ))
                        } else {
                            None
                        }
                    }
                }
            } else {
                None
            }
        };

        let (base_files, delta_opt) = match snapshot {
            Some((base, delta, stale)) => {
                if stale {
                    self.warm_background(
                        project_id.to_string(),
                        repo_path.to_string(),
                        worktree_path.map(String::from),
                    );
                }
                (base, delta)
            }
            None => {
                self.ensure_indexed(project_id, repo_path, worktree_path)
                    .await?;
                let guard = self.entries.read().await;
                let entry = guard
                    .get(project_id)
                    .ok_or_else(|| "Failed to load file index".to_string())?;
                let delta = norm_wt.as_ref().and_then(|k| {
                    entry
                        .worktree_deltas
                        .get(k)
                        .map(|d| (d.added.clone(), d.removed.clone()))
                });
                (entry.base_files.clone(), delta)
            }
        };

        let limit = limit.clamp(1, 200);
        let collected =
            score_and_collect(&base_files, delta_opt.as_ref(), query, limit, use_regex);

        Ok(FileSearchResult {
            root_path: effective_root.to_string(),
            total_indexed: collected.total_indexed,
            matches: collected.matches,
            from_cache,
            match_mode: collected.match_mode,
            regex_error: collected.regex_error,
        })
    }

    async fn ensure_indexed(
        &self,
        project_id: &str,
        repo_path: &str,
        worktree_path: Option<&str>,
    ) -> Result<(), String> {
        let norm_repo = normalize_path(repo_path);
        let need_base = {
            let guard = self.entries.read().await;
            guard
                .get(project_id)
                .map(|e| {
                    e.updated_at.elapsed() >= BASE_TTL || normalize_path(&e.repo_path) != norm_repo
                })
                .unwrap_or(true)
        };

        if need_base {
            let files = scan_directory_files(repo_path).await?;
            let set: HashSet<String> = files.iter().cloned().collect();
            let now = Instant::now();
            let mut guard = self.entries.write().await;
            guard.insert(
                project_id.to_string(),
                ProjectFileCacheEntry {
                    repo_path: repo_path.to_string(),
                    base_files: Arc::new(files),
                    base_set: Arc::new(set),
                    updated_at: now,
                    last_accessed: now,
                    worktree_deltas: HashMap::new(),
                },
            );
            evict_lru_if_needed(&mut guard, project_id);
        }

        if let Some(wt_path) = worktree_path.filter(|s| !s.trim().is_empty()) {
            let norm_wt = normalize_path(wt_path);
            if norm_wt != norm_repo {
                let base_set_opt = {
                    let guard = self.entries.read().await;
                    guard.get(project_id).map(|e| e.base_set.clone())
                };
                if let Some(base_set) = base_set_opt {
                    let wt_files = scan_directory_files(wt_path).await?;
                    let delta = compute_worktree_delta(&base_set, wt_files);
                    let mut guard = self.entries.write().await;
                    if let Some(entry) = guard.get_mut(project_id) {
                        entry.last_accessed = Instant::now();
                        entry.worktree_deltas.insert(norm_wt, delta);
                    }
                }
            }
        }

        Ok(())
    }
}

fn evict_lru_if_needed(map: &mut HashMap<String, ProjectFileCacheEntry>, keep_id: &str) {
    while map.len() > MAX_CACHED_PROJECTS {
        let oldest = map
            .iter()
            .filter(|(k, _)| k.as_str() != keep_id)
            .min_by_key(|(_, v)| v.last_accessed)
            .map(|(k, _)| k.clone());
        if let Some(k) = oldest {
            map.remove(&k);
        } else {
            break;
        }
    }
}

pub fn compute_worktree_delta(
    base_set: &HashSet<String>,
    wt_files: Vec<String>,
) -> WorktreeDelta {
    let mut added = Vec::new();
    let mut seen_in_wt: HashSet<String> = HashSet::with_capacity(wt_files.len());
    for f in wt_files {
        if !base_set.contains(&f) {
            added.push(f.clone());
        }
        seen_in_wt.insert(f);
    }
    let mut removed = HashSet::new();
    for base_f in base_set.iter() {
        if !seen_in_wt.contains(base_f) {
            removed.insert(base_f.clone());
        }
    }
    added.sort_unstable();
    WorktreeDelta {
        added,
        removed,
        updated_at: Instant::now(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computes_minimal_delta_for_sibling_worktree() {
        let base: HashSet<String> = ["README.md", "src/App.tsx", "src/old.ts"]
            .into_iter()
            .map(String::from)
            .collect();
        let wt = vec![
            "README.md".into(),
            "src/App.tsx".into(),
            "src/new_feature.ts".into(),
        ];
        let delta = compute_worktree_delta(&base, wt);
        assert_eq!(delta.added, vec!["src/new_feature.ts"]);
        assert!(delta.removed.contains("src/old.ts"));
        assert_eq!(delta.removed.len(), 1);
    }
}
