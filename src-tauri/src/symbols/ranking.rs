use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

use crate::symbols::types::{SymbolKind, SymbolMatch};

pub struct RankingContext<'a> {
    pub current_rel_path: &'a str,
    pub current_line: u32,
    pub qualifier: Option<&'a str>,
    pub current_includes: &'a [String],
    pub current_usings: &'a [String],
}

pub struct CandidateSymbol {
    pub name: String,
    pub scope: String,
    pub kind: SymbolKind,
    pub relative_path: String,
    pub line: u32,
    pub col: u16,
    pub is_definition: bool,
    pub is_partial: bool,
}

fn file_dir(rel: &str) -> &str {
    match rel.rfind('/') {
        Some(idx) => &rel[..idx],
        None => "",
    }
}

fn file_stem(rel: &str) -> &str {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    match name.rfind('.') {
        Some(idx) => &name[..idx],
        None => name,
    }
}

fn file_ext(rel: &str) -> &str {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    match name.rfind('.') {
        Some(idx) => &name[idx + 1..],
        None => "",
    }
}

fn is_cpp_header(ext: &str) -> bool {
    matches!(
        ext.to_ascii_lowercase().as_str(),
        "h" | "hh" | "hpp" | "hxx" | "inl"
    )
}

fn is_cpp_source(ext: &str) -> bool {
    matches!(ext.to_ascii_lowercase().as_str(), "c" | "cc" | "cpp" | "cxx")
}

fn shared_dir_depth(a: &str, b: &str) -> i32 {
    let mut score = 0;
    for (sa, sb) in a.split('/').zip(b.split('/')) {
        if sa.eq_ignore_ascii_case(sb) {
            score += 4;
        } else {
            break;
        }
    }
    score.min(16)
}

pub fn score_candidate(cand: &CandidateSymbol, ctx: &RankingContext<'_>) -> i32 {
    let mut score: i32 = 0;
    let same_file = cand.relative_path.eq_ignore_ascii_case(ctx.current_rel_path);
    let exact_self = same_file && cand.line == ctx.current_line;

    // Deprioritize jumping right onto the exact same line the user clicked
    if exact_self {
        score -= 200;
    }

    // 1. Qualifier match (`Inventory::AddItem` / `Inventory.AddItem`)
    if let Some(q) = ctx.qualifier {
        if !q.is_empty() && !cand.scope.is_empty() {
            if cand.scope == q {
                score += 100;
            } else if cand.scope.eq_ignore_ascii_case(q) {
                score += 65;
            }
        }
    }

    // 2. `#include` match (C/C++)
    let cand_lower = cand.relative_path.to_ascii_lowercase();
    for inc in ctx.current_includes {
        let inc_norm = inc.replace('\\', "/").to_ascii_lowercase();
        if cand_lower == inc_norm || cand_lower.ends_with(&format!("/{}", inc_norm)) {
            score += 65;
            break;
        }
        // Also match corresponding .cpp of an included .h
        let inc_stem = file_stem(&inc_norm);
        if !inc_stem.is_empty()
            && file_stem(&cand_lower) == inc_stem
            && is_cpp_source(file_ext(&cand_lower))
        {
            score += 55;
            break;
        }
    }

    // 3. `using Namespace;` match (C#)
    if !ctx.current_usings.is_empty() {
        for u in ctx.current_usings {
            let last_seg = u.rsplit('.').next().unwrap_or(u);
            if !cand.scope.is_empty() && cand.scope.eq_ignore_ascii_case(last_seg) {
                score += 55;
                break;
            }
            if !last_seg.is_empty() && cand_lower.contains(&last_seg.to_ascii_lowercase()) {
                score += 24;
                break;
            }
        }
    }

    // 4. Proximity: `.h` <-> `.cpp` stem pair, same file, same directory
    let cur_ext = file_ext(ctx.current_rel_path);
    let cand_ext = file_ext(&cand.relative_path);
    let same_stem = !file_stem(ctx.current_rel_path).is_empty()
        && file_stem(ctx.current_rel_path).eq_ignore_ascii_case(file_stem(&cand.relative_path));

    if same_stem
        && ((is_cpp_header(cur_ext) && is_cpp_source(cand_ext))
            || (is_cpp_source(cur_ext) && is_cpp_header(cand_ext)))
    {
        score += 52;
    } else if same_file && !exact_self {
        score += 36;
    } else if file_dir(&cand.relative_path).eq_ignore_ascii_case(file_dir(ctx.current_rel_path)) {
        score += 30;
    } else {
        score += shared_dir_depth(file_dir(&cand.relative_path), file_dir(ctx.current_rel_path));
    }

    // 5. Definition vs declaration preference
    if cand.is_definition {
        score += 22;
    } else {
        score += 4;
    }

    // 6. Type declarations slightly boosted when no qualifier is given
    if ctx.qualifier.is_none()
        && matches!(
            cand.kind,
            SymbolKind::Class
                | SymbolKind::Struct
                | SymbolKind::Interface
                | SymbolKind::Record
                | SymbolKind::Enum
                | SymbolKind::Trait
        )
    {
        score += 10;
    }

    score
}

/// Read a single 1-based line from disk for picker preview (only called for top K matches).
pub fn read_line_preview(root: &Path, rel_path: &str, line_no: u32) -> String {
    if line_no == 0 {
        return String::new();
    }
    let full = root.join(rel_path);
    let Ok(file) = File::open(&full) else {
        return String::new();
    };
    let reader = BufReader::new(file);
    for (idx, line) in reader.lines().enumerate() {
        if idx + 1 == line_no as usize {
            if let Ok(text) = line {
                let trimmed = text.trim();
                if trimmed.chars().count() <= 140 {
                    return trimmed.to_string();
                }
                let mut s: String = trimmed.chars().take(140).collect();
                s.push('…');
                return s;
            }
            break;
        }
    }
    String::new()
}

pub fn rank_and_finalize(
    candidates: Vec<CandidateSymbol>,
    ctx: &RankingContext<'_>,
    effective_root: &Path,
    limit: usize,
) -> Vec<SymbolMatch> {
    let mut scored: Vec<(i32, CandidateSymbol)> = candidates
        .into_iter()
        .map(|c| {
            let s = score_candidate(&c, ctx);
            (s, c)
        })
        .collect();

    scored.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then_with(|| a.1.relative_path.cmp(&b.1.relative_path))
            .then_with(|| a.1.line.cmp(&b.1.line))
    });

    // Deduplicate identical (relative_path, line, name) entries
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::with_capacity(limit.min(scored.len()));
    for (score, cand) in scored {
        if !seen.insert((cand.relative_path.clone(), cand.line, cand.name.clone())) {
            continue;
        }
        let preview = read_line_preview(effective_root, &cand.relative_path, cand.line);
        out.push(SymbolMatch {
            name: cand.name,
            scope: cand.scope,
            kind: cand.kind,
            relative_path: cand.relative_path,
            line: cand.line,
            col: cand.col,
            is_definition: cand.is_definition,
            is_partial: cand.is_partial,
            score,
            preview,
        });
        if out.len() >= limit {
            break;
        }
    }
    out
}
