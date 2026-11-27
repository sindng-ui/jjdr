use relay_protocol::PeerInfo;
use tauri::State;

use crate::team::http::test_relay_connection;
use crate::team::{RelayTestResult, TeamConnectionSnapshot};
use crate::AppState;

#[tauri::command]
pub async fn get_team_status(state: State<'_, AppState>) -> Result<TeamConnectionSnapshot, String> {
    Ok(state.team_relay.snapshot().await)
}

#[tauri::command]
pub async fn test_team_relay_connection(
    relay_url: String,
    team_key: String,
    bypass_proxy: bool,
) -> Result<RelayTestResult, String> {
    Ok(test_relay_connection(&relay_url, &team_key, bypass_proxy).await)
}

#[tauri::command]
pub async fn detect_team_github_id(state: State<'_, AppState>) -> Result<String, String> {
    state.team_relay.detect_github_id(&state.store).await
}

#[tauri::command]
pub async fn reconnect_team_relay(
    state: State<'_, AppState>,
) -> Result<TeamConnectionSnapshot, String> {
    state.team_relay.notify_config_changed();
    Ok(state.team_relay.snapshot().await)
}

#[tauri::command]
pub async fn list_team_peers(state: State<'_, AppState>) -> Result<Vec<PeerInfo>, String> {
    Ok(state.team_relay.snapshot().await.peers)
}

#[tauri::command]
pub async fn flush_team_outbox(state: State<'_, AppState>) -> Result<usize, String> {
    let team = state.store.get_settings().await.team;
    Ok(state.team_relay.flush_outbox(&team).await)
}
