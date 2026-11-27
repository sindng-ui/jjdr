use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, UNIX_EPOCH};

use crate::store::file_index::scan_directory_files;
use crate::symbols::cache::{load_disk_cache, save_disk_cache};
use crate::symbols::interner::StringInterner;
use crate::symbols::parser::{
    detect_symbol_lang, parse_file_outline, ReusableSymbolParser, MAX_INDEXABLE_FILE_BYTES,
};
use crate::symbols::ranking::CandidateSymbol;
use crate::symbols::store::{ProgressCallback, ProjectSymbolIndex, WorktreeSymbolDelta};
use crate::symbols::types::{
    CompactSymbol, FileMetaEntry, IncludeResolveResult, OutlineSymbol, RawSymbol,
    SymbolIndexProgress, FLAG_IS_DEFINITION, FLAG_IS_PARTIAL,
};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Throttle background crawler: parse 32 files, then yield 6ms to protect Windows Defender / disk I/O.
const PARSE_BATCH_SIZE: usize = 32;
const PARSE_BATCH_YIELD_MS: u64 = 6;
/// Emit UI progress events at most every 450ms.
const PROGRESS_EMIT_INTERVAL: Duration = Duration::from_millis(450);

pub(crate) struct BuildOutcome {
    pub index: ProjectSymbolIndex,
    pub total_files: usize,
    pub from_cache: bool,
}

/// Instant single-file outline parser (works even when background indexing is OFF, 0 persistent RAM).
pub async fn compute_file_outline(
    abs_path: String,
    rel_path: String,
) -> Result<Vec<OutlineSymbol>, String> {
    tokio::task::spawn_blocking(move || {
        let meta = std::fs::metadata(&abs_path)
            .map_err(|e| format!("Failed to read file metadata: {}", e))?;
        if meta.len() > 2 * 1024 * 1024 {
            return Ok(Vec::new());
        }
        let bytes =
            std::fs::read(&abs_path).map_err(|e| format!("Failed to read file: {}", e))?;
        Ok(parse_file_outline(&rel_path, &bytes))
    })
    .await
    .map_err(|e| format!("Outline parser task failed: {}", e))?
}

/// Resolve a C/C++ `#include "..."` path to an actual file in the project/worktree (works even with index OFF).
pub async fn resolve_include_file(
    root_path: String,
    current_rel_path: String,
    include_target: String,
) -> Option<IncludeResolveResult> {
    let root_direct = root_path.clone();
    let cur_direct = current_rel_path.clone();
    let target_direct = include_target.clone();
    let direct = tokio::task::spawn_blocking(move || {
        let root = Path::new(&root_direct);
        let cleaned = target_direct.trim().replace('\\', "/");
        if cleaned.is_empty() {
            return None;
        }

        let mut candidates: Vec<PathBuf> = Vec::new();
        if let Some(parent) = Path::new(&cur_direct).parent() {
            candidates.push(root.join(parent).join(&cleaned));
        }
        candidates.push(root.join(&cleaned));
        for prefix in ["include", "inc", "src", "Source", "Public", "Private"] {
            candidates.push(root.join(prefix).join(&cleaned));
        }

        for cand in candidates {
            if cand.is_file() {
                if let Ok(canon) = cand.canonicalize() {
                    let root_canon = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
                    if let Ok(rel) = canon.strip_prefix(&root_canon) {
                        return Some(IncludeResolveResult {
                            relative_path: rel.to_string_lossy().replace('\\', "/"),
                            absolute_path: cand.to_string_lossy().to_string(),
                        });
                    }
                }
                let rel = cand
                    .strip_prefix(root)
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_else(|_| cleaned.clone());
                return Some(IncludeResolveResult {
                    relative_path: rel,
                    absolute_path: cand.to_string_lossy().to_string(),
                });
            }
        }
        None
    })
    .await
    .ok()
    .flatten();

    if direct.is_some() {
        return direct;
    }

    let cleaned = include_target.trim().replace('\\', "/");
    if cleaned.is_empty() {
        return None;
    }
    let all_files = scan_directory_files(&root_path).await.unwrap_or_default();
    let suffix = format!("/{}", cleaned.to_ascii_lowercase());
    let exact = cleaned.to_ascii_lowercase();
    let root = Path::new(&root_path);
    for rel in all_files {
        let lower = rel.to_ascii_lowercase();
        if lower == exact || lower.ends_with(&suffix) {
            let abs = root.join(&rel);
            if abs.is_file() {
                return Some(IncludeResolveResult {
                    relative_path: rel,
                    absolute_path: abs.to_string_lossy().to_string(),
                });
            }
        }
    }
    None
}

fn file_mtime_and_size(path: &Path) -> Option<(u64, u64)> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let size = meta.len();
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    Some((mtime, size))
}

pub(crate) fn build_project_index_blocking(
    project_id: &str,
    repo_path: &str,
    all_files: Vec<String>,
    cache_path: &Path,
    cancel_flag: &AtomicBool,
    on_progress: Option<ProgressCallback>,
) -> Result<BuildOutcome, String> {
    let started = Instant::now();
    let root = Path::new(repo_path);
    if !root.is_dir() {
        return Err(format!("Repository directory does not exist: {}", repo_path));
    }

    // 1. Filter repository files to supported source extensions
    let source_files: Vec<String> = all_files
        .into_iter()
        .filter(|rel| detect_symbol_lang(rel).is_some())
        .collect();
    let total_files = source_files.len();

    if cancel_flag.load(Ordering::SeqCst) {
        return Err("Cancelled".into());
    }

    // 2. Load incremental disk cache if available
    let cached = load_disk_cache(cache_path);
    let mut cached_syms_by_file: HashMap<u32, Vec<CompactSymbol>> = HashMap::new();
    if let Some(ref c) = cached {
        for sym in &c.symbols {
            cached_syms_by_file.entry(sym.file_id).or_default().push(*sym);
        }
    }

    let mut interner = StringInterner::with_capacity((total_files * 8).clamp(256, 200_000));
    let mut files_meta: HashMap<String, FileMetaEntry> = HashMap::with_capacity(total_files);
    let mut symbols: Vec<CompactSymbol> = Vec::with_capacity(total_files * 10);

    let mut to_parse: Vec<(String, u64, u64)> = Vec::new();
    let mut reused_files = 0usize;

    // 3. Partition into cache-hit (0 disk reads!) vs dirty/new files
    for rel in source_files {
        if cancel_flag.load(Ordering::SeqCst) {
            return Err("Cancelled".into());
        }
        let full = root.join(&rel);
        let Some((mtime, size)) = file_mtime_and_size(&full) else {
            continue;
        };
        if size > MAX_INDEXABLE_FILE_BYTES {
            continue;
        }

        if let Some(ref c) = cached {
            if let Some(prev_meta) = c.files.get(&rel) {
                if prev_meta.mtime_secs == mtime && prev_meta.file_size == size {
                    let new_file_id = interner.intern(&rel);
                    files_meta.insert(
                        rel,
                        FileMetaEntry {
                            file_id: new_file_id,
                            mtime_secs: mtime,
                            file_size: size,
                        },
                    );
                    if let Some(old_syms) = cached_syms_by_file.get(&prev_meta.file_id) {
                        for old in old_syms {
                            let name_id = interner.intern(c.interner.get(old.name_id));
                            let scope_id = interner.intern(c.interner.get(old.scope_id));
                            symbols.push(CompactSymbol {
                                name_id,
                                file_id: new_file_id,
                                scope_id,
                                line: old.line,
                                col: old.col,
                                kind: old.kind,
                                flags: old.flags,
                            });
                        }
                    }
                    reused_files += 1;
                    continue;
                }
            }
        }

        to_parse.push((rel, mtime, size));
    }

    // Free loaded cache structs before parsing dirty files to keep peak RAM minimal
    drop(cached_syms_by_file);
    drop(cached);

    let from_cache = to_parse.is_empty() && reused_files > 0;
    let mut parser = ReusableSymbolParser::new();
    let mut last_emit = Instant::now();
    let mut indexed_so_far = reused_files;

    if let Some(ref cb) = on_progress {
        cb(SymbolIndexProgress {
            project_id: project_id.to_string(),
            state: "indexing".to_string(),
            indexed_files: indexed_so_far,
            total_files,
            symbol_count: symbols.len(),
            from_cache,
            estimated_ram_bytes: 0,
            elapsed_ms: started.elapsed().as_millis() as u64,
            error: None,
        });
    }

    // 4. Parse dirty/new files in throttled batches so UI & Windows Defender stay smooth
    for (batch_idx, (rel, mtime, size)) in to_parse.into_iter().enumerate() {
        if cancel_flag.load(Ordering::SeqCst) {
            return Err("Cancelled".into());
        }
        let Some(lang) = detect_symbol_lang(&rel) else {
            continue;
        };
        let full = root.join(&rel);
        if let Ok(bytes) = std::fs::read(&full) {
            let parsed = parser.parse(lang, &bytes);
            let file_id = interner.intern(&rel);
            files_meta.insert(
                rel,
                FileMetaEntry {
                    file_id,
                    mtime_secs: mtime,
                    file_size: size,
                },
            );
            for raw in parsed.symbols {
                let name_id = interner.intern(&raw.name);
                let scope_id = interner.intern(&raw.scope);
                let mut flags = 0u8;
                if raw.is_definition {
                    flags |= FLAG_IS_DEFINITION;
                }
                if raw.is_partial {
                    flags |= FLAG_IS_PARTIAL;
                }
                symbols.push(CompactSymbol {
                    name_id,
                    file_id,
                    scope_id,
                    line: raw.line,
                    col: raw.col,
                    kind: raw.kind as u8,
                    flags,
                });
            }
        }

        indexed_so_far += 1;

        if (batch_idx + 1) % PARSE_BATCH_SIZE == 0 {
            if let Some(ref cb) = on_progress {
                if last_emit.elapsed() >= PROGRESS_EMIT_INTERVAL {
                    last_emit = Instant::now();
                    cb(SymbolIndexProgress {
                        project_id: project_id.to_string(),
                        state: "indexing".to_string(),
                        indexed_files: indexed_so_far,
                        total_files,
                        symbol_count: symbols.len(),
                        from_cache: false,
                        estimated_ram_bytes: 0,
                        elapsed_ms: started.elapsed().as_millis() as u64,
                        error: None,
                    });
                }
            }
            std::thread::sleep(Duration::from_millis(PARSE_BATCH_YIELD_MS));
        }
    }

    if cancel_flag.load(Ordering::SeqCst) {
        return Err("Cancelled".into());
    }

    // 5. Save updated disk cache if anything was newly parsed
    if !from_cache && !files_meta.is_empty() {
        let _ = save_disk_cache(cache_path, &interner, &files_meta, &symbols);
    }

    let file_count = files_meta.len();
    let index = ProjectSymbolIndex::from_parts(repo_path.to_string(), interner, file_count, symbols);

    Ok(BuildOutcome {
        index,
        total_files,
        from_cache,
    })
}

fn run_git_lines(cwd: &str, args: &[&str]) -> Vec<String> {
    let mut cmd = std::process::Command::new("git");
    cmd.arg("-C").arg(cwd).args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let Ok(out) = cmd.output() else {
        return Vec::new();
    };
    if !out.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(|l| l.trim_end_matches('\r').to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

pub(crate) fn build_worktree_delta_blocking(worktree_path: &str) -> WorktreeSymbolDelta {
    let mut overridden = HashSet::new();
    let mut deleted = HashSet::new();
    let mut symbols_by_name: HashMap<String, Vec<CandidateSymbol>> = HashMap::new();

    // 1. Dirty / untracked files in worktree
    for line in run_git_lines(worktree_path, &["status", "--porcelain", "-uall"]) {
        if line.len() < 4 {
            continue;
        }
        let status = &line[..2];
        let raw_path = line[3..].trim().trim_matches('"');
        let path_part = raw_path.rsplit(" -> ").next().unwrap_or(raw_path);
        let rel = path_part.replace('\\', "/");
        if status.contains('D') {
            deleted.insert(rel);
        } else {
            overridden.insert(rel);
        }
    }

    // 2. Also include files differing from previous commit in worktree
    for line in run_git_lines(worktree_path, &["diff", "--name-only", "HEAD~1", "HEAD"]) {
        let rel = line.trim().replace('\\', "/");
        if !rel.is_empty() && !deleted.contains(&rel) {
            overridden.insert(rel);
        }
    }

    let root = Path::new(worktree_path);
    let mut parser = ReusableSymbolParser::new();

    for rel in &overridden {
        let Some(lang) = detect_symbol_lang(rel) else {
            continue;
        };
        let full = root.join(rel);
        let Ok(meta) = std::fs::metadata(&full) else {
            continue;
        };
        if !meta.is_file() || meta.len() > MAX_INDEXABLE_FILE_BYTES {
            continue;
        }
        let Ok(bytes) = std::fs::read(&full) else {
            continue;
        };
        let parsed = parser.parse(lang, &bytes);
        for RawSymbol {
            name,
            scope,
            line,
            col,
            kind,
            is_definition,
            is_partial,
        } in parsed.symbols
        {
            symbols_by_name
                .entry(name.clone())
                .or_default()
                .push(CandidateSymbol {
                    name,
                    scope,
                    kind,
                    relative_path: rel.clone(),
                    line,
                    col,
                    is_definition,
                    is_partial,
                });
        }
    }

    WorktreeSymbolDelta {
        overridden_files: overridden,
        deleted_files: deleted,
        symbols_by_name,
        updated_at: Instant::now(),
    }
}
