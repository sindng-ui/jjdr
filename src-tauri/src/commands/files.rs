use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;
use tauri::State;

use crate::store::file_index::FileSearchResult;
use crate::AppState;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const MAX_READ_BYTES: u64 = 2 * 1024 * 1024; // 2 MB cap for instant viewer load

#[derive(Debug, Clone, Serialize)]
pub struct TextFileContent {
    pub path: String,
    pub content: String,
    pub size_bytes: u64,
    pub truncated: bool,
    pub is_binary: bool,
}

/// Quietly warm the shared project base + optional worktree delta index in background.
/// Only invoked for projects the user has actually focused.
#[tauri::command]
pub async fn warm_project_file_index(
    state: State<'_, AppState>,
    project_id: String,
    worktree_path: Option<String>,
) -> Result<(), String> {
    let projects = state.store.list_projects().await;
    if let Some(proj) = projects.into_iter().find(|p| p.id == project_id) {
        state
            .file_index
            .warm_background(proj.id, proj.repo_path, worktree_path);
    }
    Ok(())
}

/// Fuzzy-search files within a project/worktree natively in Rust using shared Base + Delta cache.
/// Returns only top `limit` matches so WebView stays featherweight.
#[tauri::command]
pub async fn search_project_files(
    state: State<'_, AppState>,
    project_id: String,
    worktree_path: Option<String>,
    query: String,
    limit: Option<usize>,
    use_regex: Option<bool>,
) -> Result<FileSearchResult, String> {
    let projects = state.store.list_projects().await;
    let proj = projects
        .into_iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| "Project not found".to_string())?;

    state
        .file_index
        .search(
            &proj.id,
            &proj.repo_path,
            worktree_path.as_deref(),
            &query,
            limit.unwrap_or(80),
            use_regex.unwrap_or(false),
        )
        .await
}

fn looks_binary(bytes: &[u8]) -> bool {
    let probe = &bytes[..bytes.len().min(8192)];
    probe.contains(&0u8)
}

#[tauri::command]
pub async fn read_text_file(path: String) -> Result<TextFileContent, String> {
    let trimmed = path.trim().to_string();
    if trimmed.is_empty() {
        return Err("File path cannot be empty".into());
    }
    let meta = tokio::fs::metadata(&trimmed)
        .await
        .map_err(|e| format!("Cannot read file metadata: {}", e))?;
    if !meta.is_file() {
        return Err("Target path is not a file".into());
    }
    let size_bytes = meta.len();
    let raw = tokio::fs::read(&trimmed)
        .await
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let truncated = size_bytes > MAX_READ_BYTES;
    let slice = if raw.len() as u64 > MAX_READ_BYTES {
        &raw[..MAX_READ_BYTES as usize]
    } else {
        &raw[..]
    };

    if looks_binary(slice) {
        return Ok(TextFileContent {
            path: trimmed,
            content: String::new(),
            size_bytes,
            truncated,
            is_binary: true,
        });
    }

    let content = String::from_utf8_lossy(slice).to_string();

    Ok(TextFileContent {
        path: trimmed,
        content,
        size_bytes,
        truncated,
        is_binary: false,
    })
}

#[tauri::command]
pub fn open_with_default_app(path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("File path cannot be empty".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let win_path = trimmed.replace('/', "\\");
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &win_path])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Failed to open with default app: {}", e))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(trimmed)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
        return Ok(());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(trimmed)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
        return Ok(());
    }
}

#[tauri::command]
pub fn open_in_vscode(path: String, line: Option<u32>) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("File path cannot be empty".into());
    }
    let line_target = line.filter(|&l| l > 0);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let win_path = trimmed.replace('/', "\\");
        let goto_arg = line_target.map(|l| format!("{}:{}", win_path, l));

        let direct = if let Some(ref goto) = goto_arg {
            std::process::Command::new("cmd")
                .args(["/C", "code", "-g", goto])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
        } else {
            std::process::Command::new("cmd")
                .args(["/C", "code", &win_path])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
        };
        if direct.is_ok() {
            return Ok(());
        }

        let mut candidates: Vec<PathBuf> = Vec::new();
        if let Ok(local_app) = std::env::var("LOCALAPPDATA") {
            candidates.push(
                PathBuf::from(local_app)
                    .join("Programs")
                    .join("Microsoft VS Code")
                    .join("bin")
                    .join("code.cmd"),
            );
        }
        if let Ok(prog_files) = std::env::var("ProgramFiles") {
            candidates.push(
                PathBuf::from(prog_files)
                    .join("Microsoft VS Code")
                    .join("bin")
                    .join("code.cmd"),
            );
        }
        for bin in candidates {
            if bin.is_file() {
                let mut cmd = std::process::Command::new(&bin);
                if let Some(ref goto) = goto_arg {
                    cmd.args(["-g", goto]);
                } else {
                    cmd.arg(&win_path);
                }
                cmd.creation_flags(CREATE_NO_WINDOW)
                    .spawn()
                    .map_err(|e| format!("Failed to launch VS Code: {}", e))?;
                return Ok(());
            }
        }
        return Err("VS Code(`code`)를 찾을 수 없습니다. PATH를 확인해주세요.".into());
    }
    #[cfg(not(windows))]
    {
        let mut cmd = std::process::Command::new("code");
        if let Some(l) = line_target {
            cmd.args(["-g", &format!("{}:{}", trimmed, l)]);
        } else {
            cmd.arg(trimmed);
        }
        cmd.spawn()
            .map_err(|e| format!("Failed to launch VS Code: {}", e))?;
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceTextMatch {
    pub relative_path: String,
    pub line: u32,
    pub col: u16,
    pub line_text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceTextSearchResult {
    pub root_path: String,
    pub matches: Vec<WorkspaceTextMatch>,
    pub truncated: bool,
    pub elapsed_ms: u64,
    pub regex_error: Option<String>,
}

const MAX_WORKSPACE_SEARCH_MATCHES: usize = 400;
const MAX_MATCHES_PER_FILE: usize = 40;
const MAX_LINE_PREVIEW_CHARS: usize = 220;
const MAX_UNTRACKED_SCAN_FILES: usize = 200;

/// Monotonic search generation token: whenever a newer Ctrl+Shift+F query arrives,
/// any still-running older `git grep` child process is killed immediately.
static WORKSPACE_SEARCH_GEN: AtomicU64 = AtomicU64::new(0);

fn truncate_preview_line(raw: &str) -> String {
    let trimmed = raw.trim_end_matches(['\r', '\n']);
    if trimmed.chars().count() <= MAX_LINE_PREVIEW_CHARS {
        return trimmed.to_string();
    }
    let mut out: String = trimmed.chars().take(MAX_LINE_PREVIEW_CHARS).collect();
    out.push('…');
    out
}

fn parse_git_grep_line(line_str: &str) -> Option<(String, u32, u16, &str)> {
    // Format with `--column`: relative/path:line:col:content
    let first_colon = line_str.find(':')?;
    let rest1 = &line_str[first_colon + 1..];
    let second_colon = rest1.find(':')?;
    let line_no = rest1[..second_colon].parse::<u32>().ok()?;
    let rest2 = &rest1[second_colon + 1..];
    let (col, content) = if let Some(third_colon) = rest2.find(':') {
        if let Ok(col_1based) = rest2[..third_colon].parse::<u32>() {
            (
                col_1based.saturating_sub(1).min(u16::MAX as u32) as u16,
                &rest2[third_colon + 1..],
            )
        } else {
            (0, rest2)
        }
    } else {
        (0, rest2)
    };
    Some((line_str[..first_colon].replace('\\', "/"), line_no, col, content))
}

fn scan_untracked_files_for_search(
    root: &str,
    re: &regex::Regex,
    matches: &mut Vec<WorkspaceTextMatch>,
    max_matches: usize,
    my_gen: u64,
    started: std::time::Instant,
    timeout: std::time::Duration,
) -> bool {
    if matches.len() >= max_matches
        || started.elapsed() > timeout
        || WORKSPACE_SEARCH_GEN.load(Ordering::Relaxed) != my_gen
    {
        return matches.len() >= max_matches;
    }

    let mut cmd = std::process::Command::new("git");
    cmd.args(["-C", root, "ls-files", "--others", "--exclude-standard"]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let Ok(out) = cmd.output() else {
        return false;
    };
    if !out.status.success() {
        return false;
    }

    let root_path = std::path::Path::new(root);
    let mut truncated = false;
    for rel_raw in String::from_utf8_lossy(&out.stdout)
        .lines()
        .take(MAX_UNTRACKED_SCAN_FILES)
    {
        if started.elapsed() > timeout
            || WORKSPACE_SEARCH_GEN.load(Ordering::Relaxed) != my_gen
        {
            break;
        }
        if matches.len() >= max_matches {
            truncated = true;
            break;
        }
        let rel = rel_raw.trim_end_matches('\r').replace('\\', "/");
        if rel.is_empty() {
            continue;
        }
        let full = root_path.join(&rel);
        let Ok(meta) = std::fs::metadata(&full) else {
            continue;
        };
        if !meta.is_file() || meta.len() > 512 * 1024 {
            continue;
        }
        let Ok(bytes) = std::fs::read(&full) else {
            continue;
        };
        if looks_binary(&bytes) {
            continue;
        }
        let text = String::from_utf8_lossy(&bytes);
        let mut per_file = 0usize;
        for (idx, line) in text.lines().enumerate() {
            if let Some(m) = re.find(line) {
                let col = line[..m.start()].chars().count().min(u16::MAX as usize) as u16;
                matches.push(WorkspaceTextMatch {
                    relative_path: rel.clone(),
                    line: (idx + 1) as u32,
                    col,
                    line_text: truncate_preview_line(line),
                });
                per_file += 1;
                if matches.len() >= max_matches {
                    truncated = true;
                    break;
                }
                if per_file >= MAX_MATCHES_PER_FILE {
                    break;
                }
            }
        }
    }
    truncated
}

fn run_git_grep_search(
    root: &str,
    query: &str,
    use_regex: bool,
    case_sensitive: bool,
    whole_word: bool,
    max_matches: usize,
    re: &regex::Regex,
    my_gen: u64,
) -> Option<(Vec<WorkspaceTextMatch>, bool)> {
    use std::io::{BufRead, BufReader};
    use std::process::Stdio;
    use std::time::{Duration, Instant};

    if WORKSPACE_SEARCH_GEN.load(Ordering::Relaxed) != my_gen {
        return Some((Vec::new(), false));
    }

    let mut cmd = std::process::Command::new("git");
    cmd.args([
        "-C",
        root,
        "grep",
        "--threads=4",
        "-n",
        "--column",
        "-I",
        "--no-color",
        "--max-count",
        &MAX_MATCHES_PER_FILE.to_string(),
    ]);
    if use_regex {
        cmd.arg("-E");
    } else {
        cmd.arg("-F");
    }
    if !case_sensitive {
        cmd.arg("-i");
    }
    if whole_word {
        cmd.arg("-w");
    }
    cmd.arg("-e").arg(query);
    cmd.stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().ok()?;
    let stdout = child.stdout.take()?;
    let mut reader = BufReader::new(stdout);
    let mut matches = Vec::with_capacity(max_matches.min(128));
    let mut truncated = false;
    let mut cancelled = false;
    let started = Instant::now();
    let timeout = Duration::from_secs(6);
    let mut buf = Vec::with_capacity(512);

    loop {
        if WORKSPACE_SEARCH_GEN.load(Ordering::Relaxed) != my_gen {
            cancelled = true;
            let _ = child.kill();
            break;
        }
        if started.elapsed() > timeout {
            truncated = true;
            let _ = child.kill();
            break;
        }
        buf.clear();
        match reader.read_until(b'\n', &mut buf) {
            Ok(0) => break,
            Ok(_) => {
                let line_str = String::from_utf8_lossy(&buf);
                let Some((rel_path, line_no, col, content)) = parse_git_grep_line(&line_str) else {
                    continue;
                };
                matches.push(WorkspaceTextMatch {
                    relative_path: rel_path,
                    line: line_no,
                    col,
                    line_text: truncate_preview_line(content),
                });
                if matches.len() >= max_matches {
                    truncated = true;
                    let _ = child.kill();
                    break;
                }
            }
            Err(_) => break,
        }
    }

    let status = child.wait().ok();
    if cancelled {
        return Some((Vec::new(), false));
    }
    // git grep exits 0 (matches), 1 (no matches), >1 (not a git repo or error)
    if let Some(st) = status {
        if !truncated && !matches!(st.code(), Some(0) | Some(1)) {
            return None;
        }
    }

    // Fast supplemental scan of untracked files only when tracked results did not fill cap
    if !truncated && matches.len() < max_matches {
        if scan_untracked_files_for_search(
            root,
            re,
            &mut matches,
            max_matches,
            my_gen,
            started,
            timeout,
        ) {
            truncated = true;
        }
    }

    Some((matches, truncated))
}

fn run_fallback_text_search(
    root: &str,
    files: Vec<String>,
    re: &regex::Regex,
    max_matches: usize,
    my_gen: u64,
) -> (Vec<WorkspaceTextMatch>, bool) {
    use std::path::Path;
    use std::time::{Duration, Instant};

    let root_path = Path::new(root);
    let mut matches = Vec::with_capacity(max_matches.min(128));
    let mut truncated = false;
    let started = Instant::now();
    let timeout = Duration::from_secs(6);

    for rel in files {
        if WORKSPACE_SEARCH_GEN.load(Ordering::Relaxed) != my_gen {
            return (Vec::new(), false);
        }
        if started.elapsed() > timeout || matches.len() >= max_matches {
            truncated = true;
            break;
        }
        let full = root_path.join(&rel);
        let Ok(meta) = std::fs::metadata(&full) else {
            continue;
        };
        if !meta.is_file() || meta.len() > 512 * 1024 {
            continue;
        }
        let Ok(bytes) = std::fs::read(&full) else {
            continue;
        };
        if looks_binary(&bytes) {
            continue;
        }
        let text = String::from_utf8_lossy(&bytes);
        let mut per_file = 0usize;
        for (idx, line) in text.lines().enumerate() {
            if let Some(m) = re.find(line) {
                let col = line[..m.start()].chars().count().min(u16::MAX as usize) as u16;
                matches.push(WorkspaceTextMatch {
                    relative_path: rel.clone(),
                    line: (idx + 1) as u32,
                    col,
                    line_text: truncate_preview_line(line),
                });
                per_file += 1;
                if matches.len() >= max_matches {
                    truncated = true;
                    break;
                }
                if per_file >= MAX_MATCHES_PER_FILE {
                    break;
                }
            }
        }
    }

    (matches, truncated)
}

/// Fast workspace-wide text / regex search (Ctrl+Shift+F inside CodeViewerModal).
/// Uses native `git grep` (multithreaded, .gitignore-aware) with safe fallback and hard caps
/// so 20k+ file repos stay responsive without memory spikes.
#[tauri::command]
pub async fn search_workspace_text(
    root_path: String,
    query: String,
    use_regex: Option<bool>,
    case_sensitive: Option<bool>,
    whole_word: Option<bool>,
    max_results: Option<usize>,
) -> Result<WorkspaceTextSearchResult, String> {
    let trimmed_root = root_path.trim().to_string();
    if trimmed_root.is_empty() {
        return Err("Root path cannot be empty".into());
    }
    let q = query.trim().to_string();
    if q.is_empty() {
        return Ok(WorkspaceTextSearchResult {
            root_path: trimmed_root,
            matches: Vec::new(),
            truncated: false,
            elapsed_ms: 0,
            regex_error: None,
        });
    }

    let is_regex = use_regex.unwrap_or(false);
    let is_case = case_sensitive.unwrap_or(false);
    let is_word = whole_word.unwrap_or(false);
    let limit = max_results
        .unwrap_or(MAX_WORKSPACE_SEARCH_MATCHES)
        .clamp(1, MAX_WORKSPACE_SEARCH_MATCHES);

    let pattern = if is_regex {
        if is_word {
            format!(r"\b(?:{})\b", q)
        } else {
            q.clone()
        }
    } else {
        let escaped = regex::escape(&q);
        if is_word {
            format!(r"\b{}\b", escaped)
        } else {
            escaped
        }
    };

    let compiled = match regex::RegexBuilder::new(&pattern)
        .case_insensitive(!is_case)
        .size_limit(4 * 1024 * 1024)
        .build()
    {
        Ok(r) => r,
        Err(e) => {
            return Ok(WorkspaceTextSearchResult {
                root_path: trimmed_root,
                matches: Vec::new(),
                truncated: false,
                elapsed_ms: 0,
                regex_error: Some(e.to_string()),
            });
        }
    };

    let my_gen = WORKSPACE_SEARCH_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let started = std::time::Instant::now();
    let root_clone = trimmed_root.clone();
    let compiled_clone = compiled.clone();
    let git_res = tokio::task::spawn_blocking(move || {
        run_git_grep_search(
            &root_clone,
            &q,
            is_regex,
            is_case,
            is_word,
            limit,
            &compiled_clone,
            my_gen,
        )
    })
    .await
    .map_err(|e| format!("Workspace search worker failed: {}", e))?;

    let (matches, truncated) = match git_res {
        Some(res) => res,
        None => {
            let files = crate::store::file_index::scan_directory_files(&trimmed_root)
                .await
                .unwrap_or_default();
            let root_fb = trimmed_root.clone();
            tokio::task::spawn_blocking(move || {
                run_fallback_text_search(&root_fb, files, &compiled, limit, my_gen)
            })
            .await
            .map_err(|e| format!("Workspace fallback search worker failed: {}", e))?
        }
    };

    Ok(WorkspaceTextSearchResult {
        root_path: trimmed_root,
        matches,
        truncated,
        elapsed_ms: started.elapsed().as_millis() as u64,
        regex_error: None,
    })
}
