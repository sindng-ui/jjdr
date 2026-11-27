use std::sync::Arc;

use tauri::{AppHandle, Emitter, State};

use crate::symbols::store::{compute_file_outline, resolve_include_file, ProgressCallback};
use crate::symbols::types::{
    IncludeResolveResult, OutlineSymbol, SymbolCacheStats, SymbolIndexStatus, SymbolMatch,
};
use crate::AppState;

/// Lazily start background symbol indexing for a single project ONLY when Settings `symbol_index_enabled` is ON.
#[tauri::command]
pub async fn warm_project_symbol_index(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    worktree_path: Option<String>,
) -> Result<SymbolIndexStatus, String> {
    let settings = state.store.get_settings().await;
    if !settings.symbol_index_enabled {
        return Ok(SymbolIndexStatus {
            project_id,
            state: "disabled".to_string(),
            indexed_files: 0,
            total_files: 0,
            symbol_count: 0,
            from_cache: false,
            estimated_ram_bytes: 0,
            elapsed_ms: 0,
            error: None,
        });
    }

    let projects = state.store.list_projects().await;
    let proj = projects
        .into_iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| "Project not found".to_string())?;

    let cb: ProgressCallback = Arc::new(move |progress| {
        let _ = app.emit_to("main", "jjdr:symbol-index-progress", progress);
    });

    Ok(state
        .symbol_index
        .warm_project(proj.id, proj.repo_path, worktree_path, Some(cb))
        .await)
}

#[tauri::command]
pub async fn get_symbol_index_status(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<SymbolIndexStatus, String> {
    let settings = state.store.get_settings().await;
    if !settings.symbol_index_enabled {
        return Ok(SymbolIndexStatus {
            project_id,
            state: "disabled".to_string(),
            indexed_files: 0,
            total_files: 0,
            symbol_count: 0,
            from_cache: false,
            estimated_ram_bytes: 0,
            elapsed_ms: 0,
            error: None,
        });
    }
    Ok(state.symbol_index.get_status(&project_id).await)
}

#[tauri::command]
pub async fn get_symbol_cache_stats(
    state: State<'_, AppState>,
) -> Result<SymbolCacheStats, String> {
    Ok(state.symbol_index.cache_stats().await)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn lookup_symbol_definitions(
    state: State<'_, AppState>,
    project_id: String,
    worktree_path: Option<String>,
    current_rel_path: String,
    current_line: u32,
    symbol_name: String,
    qualifier: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<SymbolMatch>, String> {
    let settings = state.store.get_settings().await;
    if !settings.symbol_index_enabled {
        return Ok(Vec::new());
    }

    let projects = state.store.list_projects().await;
    let proj = projects
        .into_iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| "Project not found".to_string())?;

    Ok(state
        .symbol_index
        .lookup_definitions(
            &proj.id,
            &proj.repo_path,
            worktree_path.as_deref(),
            &current_rel_path,
            current_line,
            &symbol_name,
            qualifier.as_deref(),
            limit.unwrap_or(25),
        )
        .await)
}

/// Instant single-file symbol outline (Ctrl+Shift+O). Works even when background indexing is OFF.
#[tauri::command]
pub async fn get_file_symbol_outline(
    abs_path: String,
    rel_path: String,
) -> Result<Vec<OutlineSymbol>, String> {
    compute_file_outline(abs_path, rel_path).await
}

/// Resolve a C/C++ `#include "..."` path to a file inside the project/worktree (works even with index OFF).
#[tauri::command]
pub async fn resolve_include_path(
    root_path: String,
    current_rel_path: String,
    include_target: String,
) -> Result<Option<IncludeResolveResult>, String> {
    Ok(resolve_include_file(root_path, current_rel_path, include_target).await)
}

#[tauri::command]
pub async fn clear_symbol_index_cache(
    state: State<'_, AppState>,
    clear_disk: Option<bool>,
) -> Result<SymbolCacheStats, String> {
    state
        .symbol_index
        .clear_cache(clear_disk.unwrap_or(false))
        .await;
    Ok(state.symbol_index.cache_stats().await)
}
