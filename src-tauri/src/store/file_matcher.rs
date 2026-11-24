use std::collections::HashSet;
use std::path::{Path, PathBuf};

use regex::{Regex, RegexBuilder};
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
    pub match_mode: String,
    pub regex_error: Option<String>,
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

pub struct MatchCollection {
    pub total_indexed: usize,
    pub matches: Vec<FileMatchItem>,
    pub match_mode: String,
    pub regex_error: Option<String>,
}

enum CompiledToken {
    Glob { re: Regex, basename_only: bool },
    Fuzzy(String),
}

enum QueryPlan {
    Empty,
    Regex(Regex),
    RegexError(String),
    Glob(Vec<CompiledToken>),
    Fuzzy(Vec<String>),
}

/// Detect explicit `/pattern/` or `/pattern/i` regex literals.
fn extract_slash_regex(trimmed: &str) -> Option<(String, bool)> {
    if trimmed.len() >= 3 && trimmed.starts_with('/') {
        if let Some(inner) = trimmed.strip_prefix('/').and_then(|s| s.strip_suffix("/i")) {
            if !inner.is_empty() {
                return Some((inner.to_string(), true));
            }
        }
        if let Some(inner) = trimmed.strip_prefix('/').and_then(|s| s.strip_suffix('/')) {
            if !inner.is_empty() {
                return Some((inner.to_string(), true));
            }
        }
    }
    None
}

/// Heuristic: detect clear regex constructs (anchors, alternation, char classes, escapes, `.*`, `.+`)
/// while leaving pure glob queries like `*.cpp` or `src/**/*.ts` to the Glob engine.
fn looks_like_regex(trimmed: &str) -> bool {
    if trimmed.contains(".*")
        || trimmed.contains(".+")
        || trimmed.contains("\\.")
        || trimmed.contains("\\d")
        || trimmed.contains("\\w")
        || trimmed.contains("\\s")
        || trimmed.contains('|')
        || trimmed.contains('^')
        || trimmed.contains('$')
    {
        return true;
    }
    if (trimmed.contains('[') && trimmed.contains(']'))
        || (trimmed.contains('(') && trimmed.contains(')'))
    {
        return true;
    }
    false
}

fn glob_token_to_regex(token: &str) -> Result<(Regex, bool), String> {
    let has_slash = token.contains('/');
    let mut pattern = String::with_capacity(token.len() * 2 + 8);
    pattern.push('^');

    let chars: Vec<char> = token.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        match chars[i] {
            '*' => {
                if i + 1 < chars.len() && chars[i + 1] == '*' {
                    // Consume consecutive `*`
                    while i + 1 < chars.len() && chars[i + 1] == '*' {
                        i += 1;
                    }
                    if i + 1 < chars.len() && chars[i + 1] == '/' {
                        pattern.push_str("(?:.*/)?");
                        i += 1;
                    } else {
                        pattern.push_str(".*");
                    }
                } else if has_slash {
                    pattern.push_str("[^/]*");
                } else {
                    pattern.push_str(".*");
                }
            }
            '?' => {
                if has_slash {
                    pattern.push_str("[^/]");
                } else {
                    pattern.push('.');
                }
            }
            ch => {
                pattern.push_str(&regex::escape(&ch.to_string()));
            }
        }
        i += 1;
    }
    pattern.push('$');

    let re = RegexBuilder::new(&pattern)
        .case_insensitive(true)
        .size_limit(1024 * 1024)
        .build()
        .map_err(|e| e.to_string())?;
    Ok((re, !has_slash))
}

fn compile_query_plan(query: &str, force_regex: bool) -> QueryPlan {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return QueryPlan::Empty;
    }

    if force_regex {
        return match RegexBuilder::new(trimmed)
            .case_insensitive(true)
            .size_limit(2 * 1024 * 1024)
            .build()
        {
            Ok(re) => QueryPlan::Regex(re),
            Err(e) => QueryPlan::RegexError(e.to_string()),
        };
    }

    if let Some((pat, ci)) = extract_slash_regex(trimmed) {
        return match RegexBuilder::new(&pat)
            .case_insensitive(ci)
            .size_limit(2 * 1024 * 1024)
            .build()
        {
            Ok(re) => QueryPlan::Regex(re),
            Err(e) => QueryPlan::RegexError(e.to_string()),
        };
    }

    if looks_like_regex(trimmed) {
        return match RegexBuilder::new(trimmed)
            .case_insensitive(true)
            .size_limit(2 * 1024 * 1024)
            .build()
        {
            Ok(re) => QueryPlan::Regex(re),
            Err(e) => QueryPlan::RegexError(e.to_string()),
        };
    }

    let raw_tokens: Vec<&str> = trimmed.split_whitespace().filter(|t| !t.is_empty()).collect();
    let has_glob = raw_tokens.iter().any(|t| t.contains('*') || t.contains('?'));
    if has_glob {
        let mut compiled = Vec::with_capacity(raw_tokens.len());
        for tok in raw_tokens {
            if tok.contains('*') || tok.contains('?') {
                match glob_token_to_regex(tok) {
                    Ok((re, basename_only)) => compiled.push(CompiledToken::Glob { re, basename_only }),
                    Err(e) => return QueryPlan::RegexError(e),
                }
            } else {
                compiled.push(CompiledToken::Fuzzy(tok.to_lowercase()));
            }
        }
        return QueryPlan::Glob(compiled);
    }

    QueryPlan::Fuzzy(raw_tokens.into_iter().map(|t| t.to_lowercase()).collect())
}

fn score_regex_path(path: &str, re: &Regex) -> Option<i32> {
    let basename_start = path.rfind('/').map(|i| i + 1).unwrap_or(0);
    let basename = &path[basename_start..];

    if let Some(m) = re.find(basename) {
        let start_bonus = 60 - (m.start().min(50) as i32);
        let len_penalty = (path.len().min(120) as i32) / 3;
        return Some(260 + start_bonus - len_penalty);
    }
    if let Some(m) = re.find(path) {
        let start_bonus = 40 - (m.start().min(40) as i32);
        let len_penalty = (path.len().min(120) as i32) / 3;
        return Some(140 + start_bonus - len_penalty);
    }
    None
}

fn score_glob_tokens(path: &str, tokens: &[CompiledToken]) -> Option<i32> {
    let lower_path = path.to_lowercase();
    let basename_start = lower_path.rfind('/').map(|i| i + 1).unwrap_or(0);
    let basename = &lower_path[basename_start..];

    let mut total_score: i32 = 0;
    for tok in tokens {
        match tok {
            CompiledToken::Glob { re, basename_only } => {
                if *basename_only {
                    if re.is_match(basename) {
                        total_score += 200;
                    } else {
                        return None;
                    }
                } else if re.is_match(&lower_path) {
                    total_score += 180;
                } else {
                    return None;
                }
            }
            CompiledToken::Fuzzy(needle) => {
                if let Some(bn) = match_single_token(basename, needle) {
                    total_score += bn + 60;
                } else if let Some(full) = match_single_token(&lower_path, needle) {
                    total_score += full;
                } else {
                    return None;
                }
            }
        }
    }
    let depth = lower_path.matches('/').count() as i32;
    total_score -= depth * 8 + (lower_path.len().min(120) as i32) / 4;
    Some(total_score)
}

pub fn score_and_collect(
    base_files: &[String],
    delta: Option<&(Vec<String>, HashSet<String>)>,
    query: &str,
    limit: usize,
    use_regex: bool,
) -> MatchCollection {
    let removed_opt = delta.map(|(_, r)| r);
    let added_slice: &[String] = delta.map(|(a, _)| a.as_slice()).unwrap_or(&[]);

    let total_indexed = base_files
        .len()
        .saturating_sub(removed_opt.map(|r| r.len()).unwrap_or(0))
        + added_slice.len();

    let plan = compile_query_plan(query, use_regex);
    let match_mode = match &plan {
        QueryPlan::Empty | QueryPlan::Fuzzy(_) => "fuzzy",
        QueryPlan::Glob(_) => "glob",
        QueryPlan::Regex(_) | QueryPlan::RegexError(_) => "regex",
    }
    .to_string();

    if let QueryPlan::RegexError(err) = plan {
        return MatchCollection {
            total_indexed,
            matches: Vec::new(),
            match_mode,
            regex_error: Some(err),
        };
    }

    let mut scored: Vec<FileMatchItem> = Vec::with_capacity(limit.min(128));

    let mut consider = |path: &str| {
        let opt_score = match &plan {
            QueryPlan::Empty => {
                let depth = path.matches('/').count() as i32;
                let md_bonus = if is_markdown_ext(path) { 15 } else { 0 };
                Some(100 - depth * 12 + md_bonus - (path.len().min(80) as i32 / 4))
            }
            QueryPlan::Regex(re) => score_regex_path(path, re),
            QueryPlan::Glob(tokens) => score_glob_tokens(path, tokens),
            QueryPlan::Fuzzy(tokens) => fuzzy_score_path(path, tokens),
            QueryPlan::RegexError(_) => None,
        };
        if let Some(score) = opt_score {
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
    MatchCollection {
        total_indexed,
        matches: scored,
        match_mode,
        regex_error: None,
    }
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

        let res = score_and_collect(&base, Some(&delta), "md", 20, false);
        assert_eq!(res.total_indexed, 3);
        assert_eq!(res.match_mode, "fuzzy");
        let paths: Vec<&str> = res.matches.iter().map(|m| m.path.as_str()).collect();
        assert!(paths.contains(&"README.md"));
        assert!(paths.contains(&"docs/guide.md"));
        assert!(!paths.contains(&"src/old.ts"));
    }

    #[test]
    fn supports_glob_patterns_like_star_cpp_and_mixed_tokens() {
        let base = vec![
            "src/render/Engine.cpp".to_string(),
            "src/render/Engine.hpp".to_string(),
            "src/audio/Mixer.cpp".to_string(),
            "tests/main.rs".to_string(),
        ];
        let cpp_only = score_and_collect(&base, None, "*.cpp", 20, false);
        assert_eq!(cpp_only.match_mode, "glob");
        let paths: Vec<&str> = cpp_only.matches.iter().map(|m| m.path.as_str()).collect();
        assert_eq!(paths.len(), 2);
        assert!(paths.contains(&"src/render/Engine.cpp"));
        assert!(paths.contains(&"src/audio/Mixer.cpp"));

        let mixed = score_and_collect(&base, None, "*.cpp render", 20, false);
        assert_eq!(mixed.match_mode, "glob");
        assert_eq!(mixed.matches.len(), 1);
        assert_eq!(mixed.matches[0].path, "src/render/Engine.cpp");
    }

    #[test]
    fn supports_explicit_and_slash_regex_with_safe_error_reporting() {
        let base = vec![
            "src/components/board/RadarTile.tsx".to_string(),
            "src/components/board/ProjectTray.tsx".to_string(),
            "src/main.cpp".to_string(),
        ];
        let slash = score_and_collect(&base, None, "/radar.*\\.tsx$/i", 20, false);
        assert_eq!(slash.match_mode, "regex");
        assert!(slash.regex_error.is_none());
        assert_eq!(slash.matches.len(), 1);
        assert_eq!(slash.matches[0].path, "src/components/board/RadarTile.tsx");

        let forced = score_and_collect(&base, None, "tray|main", 20, true);
        assert_eq!(forced.match_mode, "regex");
        assert_eq!(forced.matches.len(), 2);

        let broken = score_and_collect(&base, None, "[unclosed", 20, true);
        assert_eq!(broken.match_mode, "regex");
        assert!(broken.regex_error.is_some());
        assert!(broken.matches.is_empty());
    }
}
