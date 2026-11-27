use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::{Mutex, RwLock};

use crate::git::inspect::normalize_path;
use crate::store::file_index::scan_directory_files;
use crate::symbols::cache::{clear_disk_cache_dir, measure_disk_cache, repo_cache_path};
use crate::symbols::indexer::{build_project_index_blocking, build_worktree_delta_blocking};
use crate::symbols::interner::StringInterner;
use crate::symbols::parser::{detect_symbol_lang, ReusableSymbolParser};
use crate::symbols::ranking::{rank_and_finalize, CandidateSymbol, RankingContext};
use crate::symbols::types::{
    CompactSymbol, SymbolCacheStats, SymbolIndexProgress, SymbolIndexStatus, SymbolKind,
    SymbolMatch,
};

pub use crate::symbols::indexer::{compute_file_outline, resolve_include_file};

/// Keep at most 2 large projects (e.g. C# 20k + C++ 10k) resident in RAM at once.
const MAX_RAM_PROJECTS: usize = 2;
/// Refresh worktree dirty delta if older than 25s.
const WORKTREE_DELTA_TTL: Duration = Duration::from_secs(25);

pub(crate) struct WorktreeSymbolDelta {
    pub overridden_files: HashSet<String>,
    pub deleted_files: HashSet<String>,
    pub symbols_by_name: HashMap<String, Vec<CandidateSymbol>>,
    pub updated_at: Instant,
}

pub(crate) struct ProjectSymbolIndex {
    pub(crate) repo_path: String,
    pub(crate) interner: StringInterner,
    pub(crate) symbols: Vec<CompactSymbol>,
    pub(crate) by_name: HashMap<u32, Vec<u32>>,
    pub(crate) by_name_lower: HashMap<String, Vec<u32>>,
    pub(crate) estimated_ram_bytes: u64,
    pub(crate) last_accessed: Instant,
    pub(crate) worktree_deltas: HashMap<String, WorktreeSymbolDelta>,
}

impl ProjectSymbolIndex {
    pub(crate) fn from_parts(
        repo_path: String,
        interner: StringInterner,
        file_count: usize,
        symbols: Vec<CompactSymbol>,
    ) -> Self {
        let mut by_name: HashMap<u32, Vec<u32>> = HashMap::with_capacity(interner.len() / 2 + 16);
        let mut by_name_lower: HashMap<String, Vec<u32>> =
            HashMap::with_capacity(interner.len() / 2 + 16);
        let mut seen_name_ids: HashSet<u32> = HashSet::with_capacity(interner.len());

        for (idx, sym) in symbols.iter().enumerate() {
            by_name.entry(sym.name_id).or_default().push(idx as u32);
            if seen_name_ids.insert(sym.name_id) {
                let lower = interner.get(sym.name_id).to_ascii_lowercase();
                if !lower.is_empty() {
                    by_name_lower.entry(lower).or_default().push(sym.name_id);
                }
            }
        }

        let sym_bytes = (symbols.capacity() * std::mem::size_of::<CompactSymbol>()) as u64;
        let inv_bytes = (by_name.len() * 40 + symbols.len() * 4) as u64;
        let file_bytes = (file_count * 16) as u64;
        let estimated_ram_bytes = interner.estimated_bytes() + sym_bytes + inv_bytes + file_bytes;

        Self {
            repo_path,
            interner,
            symbols,
            by_name,
            by_name_lower,
            estimated_ram_bytes,
            last_accessed: Instant::now(),
            worktree_deltas: HashMap::new(),
        }
    }
}

pub type ProgressCallback = Arc<dyn Fn(SymbolIndexProgress) + Send + Sync>;

pub struct SymbolIndexStore {
    cache_dir: PathBuf,
    entries: RwLock<HashMap<String, ProjectSymbolIndex>>,
    statuses: RwLock<HashMap<String, SymbolIndexStatus>>,
    active_jobs: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl SymbolIndexStore {
    pub fn new(local_dir: &Path) -> Self {
        let cache_dir = local_dir.join("symbol_cache");
        let _ = std::fs::create_dir_all(&cache_dir);
        Self {
            cache_dir,
            entries: RwLock::new(HashMap::new()),
            statuses: RwLock::new(HashMap::new()),
            active_jobs: Mutex::new(HashMap::new()),
        }
    }

    pub async fn get_status(&self, project_id: &str) -> SymbolIndexStatus {
        if let Some(st) = self.statuses.read().await.get(project_id) {
            return st.clone();
        }
        SymbolIndexStatus {
            project_id: project_id.to_string(),
            state: "idle".to_string(),
            indexed_files: 0,
            total_files: 0,
            symbol_count: 0,
            from_cache: false,
            estimated_ram_bytes: 0,
            elapsed_ms: 0,
            error: None,
        }
    }

    pub async fn cache_stats(&self) -> SymbolCacheStats {
        let entries = self.entries.read().await;
        let ram_projects = entries.len();
        let ram_symbols: usize = entries.values().map(|e| e.symbols.len()).sum();
        let ram_estimated_bytes: u64 = entries.values().map(|e| e.estimated_ram_bytes).sum();
        drop(entries);

        let active_jobs = self.active_jobs.lock().await.len();
        let cache_dir = self.cache_dir.clone();
        let (disk_cache_files, disk_cache_bytes) =
            tokio::task::spawn_blocking(move || measure_disk_cache(&cache_dir))
                .await
                .unwrap_or((0, 0));

        SymbolCacheStats {
            ram_projects,
            ram_symbols,
            ram_estimated_bytes,
            disk_cache_files,
            disk_cache_bytes,
            active_jobs,
        }
    }

    /// Cancel all background jobs, evict RAM immediately, and optionally delete disk cache files.
    pub async fn clear_cache(&self, clear_disk: bool) {
        {
            let mut jobs = self.active_jobs.lock().await;
            for (_, token) in jobs.drain() {
                token.store(true, Ordering::SeqCst);
            }
        }
        self.entries.write().await.clear();
        self.statuses.write().await.clear();

        if clear_disk {
            let cache_dir = self.cache_dir.clone();
            let _ = tokio::task::spawn_blocking(move || clear_disk_cache_dir(&cache_dir)).await;
        }
    }

    /// Trigger lazy background symbol indexing for a single project (called when Settings ON + Ctrl+P opens).
    pub async fn warm_project(
        self: &Arc<Self>,
        project_id: String,
        repo_path: String,
        worktree_path: Option<String>,
        on_progress: Option<ProgressCallback>,
    ) -> SymbolIndexStatus {
        let norm_repo = normalize_path(&repo_path);

        // If already in RAM for the same repo, refresh LRU touch & optional worktree delta only
        {
            let mut entries = self.entries.write().await;
            if let Some(entry) = entries.get_mut(&project_id) {
                if normalize_path(&entry.repo_path) == norm_repo {
                    entry.last_accessed = Instant::now();
                    let status = self.get_status(&project_id).await;
                    drop(entries);
                    if let Some(wt) = worktree_path {
                        let store = self.clone();
                        let pid = project_id.clone();
                        let rp = repo_path.clone();
                        tokio::spawn(async move {
                            let _ = store.ensure_worktree_delta(&pid, &rp, &wt).await;
                        });
                    }
                    return status;
                }
            }
        }

        // Prevent duplicate concurrent indexing jobs for the same project
        let cancel_flag = {
            let mut jobs = self.active_jobs.lock().await;
            if jobs.contains_key(&project_id) {
                return self.get_status(&project_id).await;
            }
            let flag = Arc::new(AtomicBool::new(false));
            jobs.insert(project_id.clone(), flag.clone());
            flag
        };

        let initial_status = SymbolIndexStatus {
            project_id: project_id.clone(),
            state: "loading_cache".to_string(),
            indexed_files: 0,
            total_files: 0,
            symbol_count: 0,
            from_cache: false,
            estimated_ram_bytes: 0,
            elapsed_ms: 0,
            error: None,
        };
        self.update_status(&project_id, initial_status.clone(), on_progress.as_ref())
            .await;

        let store = self.clone();
        let pid = project_id.clone();
        let rp = repo_path.clone();
        let wt_opt = worktree_path.clone();

        tokio::spawn(async move {
            let started = Instant::now();
            let all_files = scan_directory_files(&rp).await.unwrap_or_default();
            let cache_path = repo_cache_path(&store.cache_dir, &normalize_path(&rp));
            let pid_worker = pid.clone();
            let rp_worker = rp.clone();
            let flag_worker = cancel_flag.clone();
            let cb_worker = on_progress.clone();

            let build_res = tokio::task::spawn_blocking(move || {
                build_project_index_blocking(
                    &pid_worker,
                    &rp_worker,
                    all_files,
                    &cache_path,
                    &flag_worker,
                    cb_worker,
                )
            })
            .await;

            store.active_jobs.lock().await.remove(&pid);

            if cancel_flag.load(Ordering::SeqCst) {
                let st = SymbolIndexStatus {
                    project_id: pid.clone(),
                    state: "cancelled".to_string(),
                    indexed_files: 0,
                    total_files: 0,
                    symbol_count: 0,
                    from_cache: false,
                    estimated_ram_bytes: 0,
                    elapsed_ms: started.elapsed().as_millis() as u64,
                    error: None,
                };
                store.update_status(&pid, st, on_progress.as_ref()).await;
                return;
            }

            match build_res {
                Ok(Ok(outcome)) => {
                    let sym_count = outcome.index.symbols.len();
                    let ram_bytes = outcome.index.estimated_ram_bytes;
                    let total_files = outcome.total_files;
                    let from_cache = outcome.from_cache;

                    {
                        let mut entries = store.entries.write().await;
                        entries.insert(pid.clone(), outcome.index);
                        evict_lru_projects(&mut entries, &pid);
                    }

                    if let Some(wt) = wt_opt {
                        let _ = store.ensure_worktree_delta(&pid, &rp, &wt).await;
                    }

                    let st = SymbolIndexStatus {
                        project_id: pid.clone(),
                        state: "ready".to_string(),
                        indexed_files: total_files,
                        total_files,
                        symbol_count: sym_count,
                        from_cache,
                        estimated_ram_bytes: ram_bytes,
                        elapsed_ms: started.elapsed().as_millis() as u64,
                        error: None,
                    };
                    store.update_status(&pid, st, on_progress.as_ref()).await;
                }
                Ok(Err(err_msg)) => {
                    let st = SymbolIndexStatus {
                        project_id: pid.clone(),
                        state: "error".to_string(),
                        indexed_files: 0,
                        total_files: 0,
                        symbol_count: 0,
                        from_cache: false,
                        estimated_ram_bytes: 0,
                        elapsed_ms: started.elapsed().as_millis() as u64,
                        error: Some(err_msg),
                    };
                    store.update_status(&pid, st, on_progress.as_ref()).await;
                }
                Err(join_err) => {
                    let st = SymbolIndexStatus {
                        project_id: pid.clone(),
                        state: "error".to_string(),
                        indexed_files: 0,
                        total_files: 0,
                        symbol_count: 0,
                        from_cache: false,
                        estimated_ram_bytes: 0,
                        elapsed_ms: started.elapsed().as_millis() as u64,
                        error: Some(format!("Symbol indexer task panicked: {}", join_err)),
                    };
                    store.update_status(&pid, st, on_progress.as_ref()).await;
                }
            }
        });

        initial_status
    }

    async fn update_status(
        &self,
        project_id: &str,
        status: SymbolIndexStatus,
        cb: Option<&ProgressCallback>,
    ) {
        self.statuses
            .write()
            .await
            .insert(project_id.to_string(), status.clone());
        if let Some(callback) = cb {
            callback(status);
        }
    }

    async fn ensure_worktree_delta(
        &self,
        project_id: &str,
        repo_path: &str,
        worktree_path: &str,
    ) -> Result<(), String> {
        let norm_repo = normalize_path(repo_path);
        let norm_wt = normalize_path(worktree_path);
        if norm_wt.is_empty() || norm_wt == norm_repo {
            return Ok(());
        }

        {
            let entries = self.entries.read().await;
            if let Some(entry) = entries.get(project_id) {
                if let Some(delta) = entry.worktree_deltas.get(&norm_wt) {
                    if delta.updated_at.elapsed() < WORKTREE_DELTA_TTL {
                        return Ok(());
                    }
                }
            } else {
                return Ok(());
            }
        }

        let wt_clone = worktree_path.to_string();
        let delta = tokio::task::spawn_blocking(move || build_worktree_delta_blocking(&wt_clone))
            .await
            .map_err(|e| format!("Worktree delta worker failed: {}", e))?;

        let mut entries = self.entries.write().await;
        if let Some(entry) = entries.get_mut(project_id) {
            entry.worktree_deltas.insert(norm_wt, delta);
        }
        Ok(())
    }

    /// Look up symbol definitions across Base + optional Worktree Dirty Delta, ranked by C#/C++ context.
    #[allow(clippy::too_many_arguments)]
    pub async fn lookup_definitions(
        &self,
        project_id: &str,
        repo_path: &str,
        worktree_path: Option<&str>,
        current_rel_path: &str,
        current_line: u32,
        symbol_name: &str,
        qualifier: Option<&str>,
        limit: usize,
    ) -> Vec<SymbolMatch> {
        let trimmed = symbol_name.trim();
        if trimmed.is_empty() {
            return Vec::new();
        }

        let effective_root_str = worktree_path
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(repo_path);
        let norm_repo = normalize_path(repo_path);
        let norm_wt = {
            let n = normalize_path(effective_root_str);
            if n == norm_repo {
                None
            } else {
                Some(n)
            }
        };

        if let Some(wt_str) = worktree_path {
            let _ = self.ensure_worktree_delta(project_id, repo_path, wt_str).await;
        }

        // Extract `#include` / `using` context from the currently open file (<1ms)
        let cur_abs = Path::new(effective_root_str).join(current_rel_path);
        let cur_rel_owned = current_rel_path.replace('\\', "/");
        let (cur_includes, cur_usings) = tokio::task::spawn_blocking(move || {
            let Some(lang) = detect_symbol_lang(&cur_rel_owned) else {
                return (Vec::new(), Vec::new());
            };
            let Ok(bytes) = std::fs::read(&cur_abs) else {
                return (Vec::new(), Vec::new());
            };
            let mut parser = ReusableSymbolParser::new();
            let parsed = parser.parse(lang, &bytes);
            (parsed.includes, parsed.usings)
        })
        .await
        .unwrap_or_default();

        // Collect candidates from RAM Base + Worktree Delta
        let mut candidates: Vec<CandidateSymbol> = Vec::new();
        {
            let mut entries = self.entries.write().await;
            if let Some(entry) = entries.get_mut(project_id) {
                entry.last_accessed = Instant::now();
                let delta_opt = norm_wt.as_deref().and_then(|k| entry.worktree_deltas.get(k));

                let mut name_ids: Vec<u32> = Vec::new();
                if let Some(exact_id) = entry.interner.lookup(trimmed) {
                    name_ids.push(exact_id);
                } else if let Some(ci_ids) = entry.by_name_lower.get(&trimmed.to_ascii_lowercase())
                {
                    name_ids.extend_from_slice(ci_ids);
                }

                for nid in name_ids {
                    if let Some(indices) = entry.by_name.get(&nid) {
                        for &sym_idx in indices {
                            let sym = entry.symbols[sym_idx as usize];
                            let rel = entry.interner.get(sym.file_id);
                            if let Some(delta) = delta_opt {
                                if delta.overridden_files.contains(rel)
                                    || delta.deleted_files.contains(rel)
                                {
                                    continue;
                                }
                            }
                            candidates.push(CandidateSymbol {
                                name: entry.interner.get(sym.name_id).to_string(),
                                scope: entry.interner.get(sym.scope_id).to_string(),
                                kind: SymbolKind::from_u8(sym.kind),
                                relative_path: rel.to_string(),
                                line: sym.line,
                                col: sym.col,
                                is_definition: sym.is_definition(),
                                is_partial: sym.is_partial(),
                            });
                        }
                    }
                }

                if let Some(delta) = delta_opt {
                    if let Some(list) = delta.symbols_by_name.get(trimmed) {
                        for c in list {
                            candidates.push(CandidateSymbol {
                                name: c.name.clone(),
                                scope: c.scope.clone(),
                                kind: c.kind,
                                relative_path: c.relative_path.clone(),
                                line: c.line,
                                col: c.col,
                                is_definition: c.is_definition,
                                is_partial: c.is_partial,
                            });
                        }
                    }
                }
            }
        }

        if candidates.is_empty() {
            return Vec::new();
        }

        let root_path = PathBuf::from(effective_root_str);
        let cur_rel_for_rank = current_rel_path.replace('\\', "/");
        let qual_owned = qualifier.map(|s| s.to_string());
        let cap = limit.clamp(1, 50);

        tokio::task::spawn_blocking(move || {
            let ctx = RankingContext {
                current_rel_path: &cur_rel_for_rank,
                current_line,
                qualifier: qual_owned.as_deref(),
                current_includes: &cur_includes,
                current_usings: &cur_usings,
            };
            rank_and_finalize(candidates, &ctx, &root_path, cap)
        })
        .await
        .unwrap_or_default()
    }
}

fn evict_lru_projects(entries: &mut HashMap<String, ProjectSymbolIndex>, keep_id: &str) {
    while entries.len() > MAX_RAM_PROJECTS {
        let oldest = entries
            .iter()
            .filter(|(id, _)| id.as_str() != keep_id)
            .min_by_key(|(_, e)| e.last_accessed)
            .map(|(id, _)| id.clone());
        match oldest {
            Some(evict_id) => {
                entries.remove(&evict_id);
            }
            None => break,
        }
    }
}
