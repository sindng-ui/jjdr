use std::sync::Arc;

use serde_json::json;
use tauri::{AppHandle, Manager, State};

use crate::herdr::types::{HerdrHealth, StateBatchPayload, TemplateInfo, TemplatesResult};
use crate::store::projects::{AppSettings, PersistedBundle, PersistedUiState};
use crate::AppState;

#[tauri::command]
pub async fn get_initial_state(state: State<'_, AppState>) -> Result<StateBatchPayload, String> {
    Ok(state.hub.snapshot(&state.herdr).await)
}

#[tauri::command]
pub async fn get_herdr_health(state: State<'_, AppState>) -> Result<HerdrHealth, String> {
    Ok(state.herdr.health().await)
}

#[tauri::command]
pub async fn reconnect_herdr(state: State<'_, AppState>) -> Result<HerdrHealth, String> {
    // Disconnect cleanly so the supervisor reconnects and re-subscribes `events.subscribe` immediately,
    // or establish connection directly if currently idle.
    let _ = state.herdr.connect().await;
    state.hub.sync_terminals_now(&state.herdr).await;
    Ok(state.herdr.health().await)
}

#[tauri::command]
pub async fn list_templates(state: State<'_, AppState>) -> Result<Vec<TemplateInfo>, String> {
    let val = state
        .herdr
        .call("templates.list", json!({}))
        .await
        .map_err(|e| e.to_string())?;
    let parsed: TemplatesResult = serde_json::from_value(val).unwrap_or_default();
    Ok(parsed.templates)
}

#[tauri::command]
pub async fn load_persisted_bundle(state: State<'_, AppState>) -> Result<PersistedBundle, String> {
    Ok(state.store.load_bundle(&state.herdr).await)
}

#[tauri::command]
pub async fn save_ui_state(
    state: State<'_, AppState>,
    ui_state: PersistedUiState,
) -> Result<(), String> {
    state.store.save_ui_state(&state.herdr, ui_state).await;
    Ok(())
}

#[tauri::command]
pub async fn save_settings(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<(), String> {
    state.store.save_settings(&state.herdr, settings).await;
    Ok(())
}

#[tauri::command]
pub async fn update_tray_summary(
    app: AppHandle,
    needs_you: usize,
    ready: usize,
    running: usize,
) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("jjdr-tray") {
        let tooltip = format!(
            "jjdr — Needs You: {} | Ready: {} | Running: {}",
            needs_you, ready, running
        );
        let _ = tray.set_tooltip(Some(tooltip));
    }
    Ok(())
}

#[tauri::command]
pub async fn request_preview_refresh(
    state: State<'_, AppState>,
    address: String,
) -> Result<(), String> {
    let hub: Arc<_> = state.hub.clone();
    hub.request_preview(address);
    Ok(())
}

#[tauri::command]
pub fn window_minimize(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.minimize().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn window_toggle_maximize(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        let is_max = win.is_maximized().unwrap_or(false);
        if is_max {
            win.unmaximize().map_err(|e| e.to_string())?;
        } else {
            win.maximize().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn window_close(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn window_start_dragging(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.start_dragging().map_err(|e| e.to_string())?;
    }
    Ok(())
}
