use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::git::inspect::run_git;

pub const MAX_FILES_PER_PROJECT: usize = 30_000;

#[derive(Debug, Clone, Serialize)]
pub struct FileMatchItem {
    pub path: String,
    pub score: i32,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileSearchResult {
    pub root_path: String,
    pub total_indexed: usize,
    pub matches: Vec<FileMatchItem>,
    pub from_cache: bool,
}

pub async fn scan_directory_files(root_path: &str) -> Result<Vec<String>, String> {
    let root = PathBuf::from(root_path);
    if !root.exists() {
        return Err(format!("Directory does not exist: {}", root_path));
    }

    if let Ok(out) = run_git(
        &root,
        &["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    )
    .await
    {
        let mut files: Vec<String> = out
            .split('\0')
            .filter(|s| !s.is_empty())
            .take(MAX_FILES_PER_PROJECT)
            .map(|s| s.replace('\\', "/"))
            .collect();
        files.sort_unstable();
        files.dedup();
        return Ok(files);
    }

    tokio::task::spawn_blocking(move || walk_files_fallback(&root))
        .await
        .map_err(|e| format!("File walk failed: {}", e))
}

fn walk_files_fallback(root: &Path) -> Vec<String> {
    let skip_dirs = [
        ".git",
        "node_modules",
        "target",
        "dist",
        "build",
        ".next",
        ".turbo",
        ".venv",
        "__pycache__",
    ];
    let mut results = Vec::new();
    let mut stack = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if path.is_dir() {
                if !skip_dirs.contains(&name_str.as_ref()) {
                    stack.push(path);
                }
            } else if path.is_file() {
                if let Ok(rel) = path.strip_prefix(root) {
                    results.push(rel.to_string_lossy().replace('\\', "/"));
                    if results.len() >= MAX_FILES_PER_PROJECT {
                        results.sort_unstable();
                        return results;
                    }
                }
            }
        }
    }
    results.sort_unstable();
    results
}

pub fn score_and_collect(
    base_files: &[String],
    delta: Option<&(Vec<String>, HashSet<String>)>,
    query: &str,
    limit: usize,
) -> (usize, Vec<FileMatchItem>) {
    let trimmed = query.trim();
    let tokens: Vec<String> = trimmed
        .to_lowercase()
        .split_whitespace()
        .filter(|t| !t.is_empty())
        .map(String::from)
        .collect();

    let removed_opt = delta.map(|(_, r)| r);
    let added_slice: &[String] = delta.map(|(a, _)| a.as_slice()).unwrap_or(&[]);

    let total_indexed = base_files
        .len()
        .saturating_sub(removed_opt.map(|r| r.len()).unwrap_or(0))
        + added_slice.len();

    let mut scored: Vec<FileMatchItem> = Vec::with_capacity(limit.min(128));

    let mut consider = |path: &str| {
        if tokens.is_empty() {
            let depth = path.matches('/').count() as i32;
            let md_bonus = if is_markdown_ext(path) { 15 } else { 0 };
            let score = 100 - depth * 12 + md_bonus - (path.len().min(80) as i32 / 4);
            scored.push(FileMatchItem {
                path: path.to_string(),
                score,
            });
            return;
        }

        if let Some(score) = fuzzy_score_path(path, &tokens) {
            scored.push(FileMatchItem {
                path: path.to_string(),
                score,
            });
        }
    };

    for f in base_files {
        if let Some(removed) = removed_opt {
            if removed.contains(f) {
                continue;
            }
        }
        consider(f);
    }
    for f in added_slice {
        consider(f);
    }

    scored.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.path.cmp(&b.path)));
    scored.truncate(limit);
    (total_indexed, scored)
}

fn is_markdown_ext(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown") || lower.ends_with(".mdx")
}

/// VS Code-inspired fuzzy path matcher supporting multi-token queries with basename priority.
pub fn fuzzy_score_path(path: &str, tokens: &[String]) -> Option<i32> {
    let lower_path = path.to_lowercase();
    let basename_start = lower_path.rfind('/').map(|i| i + 1).unwrap_or(0);
    let basename = &lower_path[basename_start..];

    let mut total_score: i32 = 0;

    for token in tokens {
        if let Some(bn_score) = match_single_token(basename, token) {
            total_score += bn_score + 60;
        } else if let Some(full_score) = match_single_token(&lower_path, token) {
            total_score += full_score;
        } else {
            return None;
        }
    }

    total_score -= (lower_path.len().min(120) as i32) / 3;
    Some(total_score)
}

fn match_single_token(haystack: &str, needle: &str) -> Option<i32> {
    if haystack == needle {
        return Some(200);
    }
    if haystack.starts_with(needle) {
        return Some(150);
    }
    if let Some(pos) = haystack.find(needle) {
        let boundary_bonus = if pos == 0
            || matches!(
                haystack.as_bytes()[pos - 1],
                b'/' | b'_' | b'-' | b'.' | b' '
            ) {
            30
        } else {
            0
        };
        return Some(100 + boundary_bonus - (pos.min(50) as i32));
    }

    let h_chars: Vec<char> = haystack.chars().collect();
    let mut hi = 0usize;
    let mut score: i32 = 20;
    let mut prev_match: Option<usize> = None;

    for nc in needle.chars() {
        let mut found = None;
        for (idx, &hc) in h_chars.iter().enumerate().skip(hi) {
            if hc == nc {
                found = Some(idx);
                break;
            }
        }
        let pos = found?;
        if let Some(prev) = prev_match {
            if pos == prev + 1 {
                score += 14;
            }
        }
        if pos == 0 || matches!(h_chars[pos - 1], '/' | '_' | '-' | '.' | ' ') {
            score += 18;
        }
        prev_match = Some(pos);
        hi = pos + 1;
    }

    Some(score)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fuzzy_ranks_basename_matches_above_deep_path_matches() {
        let tokens = vec!["radar".to_string()];
        let s1 = fuzzy_score_path("src/components/board/RadarTile.tsx", &tokens).unwrap();
        let s2 = fuzzy_score_path("src/radar/deep/helper/index.ts", &tokens).unwrap();
        assert!(s1 > s2);
    }

    #[test]
    fn search_merges_base_and_delta_correctly() {
        let base = vec![
            "README.md".to_string(),
            "src/old.ts".to_string(),
            "src/App.tsx".to_string(),
        ];
        let mut removed = HashSet::new();
        removed.insert("src/old.ts".to_string());
        let delta = (vec!["docs/guide.md".to_string()], removed);

        let (total, matches) = score_and_collect(&base, Some(&delta), "md", 20);
        assert_eq!(total, 3);
        let paths: Vec<&str> = matches.iter().map(|m| m.path.as_str()).collect();
        assert!(paths.contains(&"README.md"));
        assert!(paths.contains(&"docs/guide.md"));
        assert!(!paths.contains(&"src/old.ts"));
    }
}
