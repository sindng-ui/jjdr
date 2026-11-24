use std::path::PathBuf;

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
pub fn open_in_vscode(path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("File path cannot be empty".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let win_path = trimmed.replace('/', "\\");

        let direct = std::process::Command::new("cmd")
            .args(["/C", "code", &win_path])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
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
                std::process::Command::new(&bin)
                    .arg(&win_path)
                    .creation_flags(CREATE_NO_WINDOW)
                    .spawn()
                    .map_err(|e| format!("Failed to launch VS Code: {}", e))?;
                return Ok(());
            }
        }
        return Err("VS Code(`code`)를 찾을 수 없습니다. PATH를 확인해주세요.".into());
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("code")
            .arg(trimmed)
            .spawn()
            .map_err(|e| format!("Failed to launch VS Code: {}", e))?;
        Ok(())
    }
}
