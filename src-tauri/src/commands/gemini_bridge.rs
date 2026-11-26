use tauri::State;

use crate::gemini::{GeminiBridgeStatus, GeminiHookPacket};
use crate::AppState;

#[tauri::command]
pub async fn get_gemini_bridge_status(
    state: State<'_, AppState>,
) -> Result<GeminiBridgeStatus, String> {
    Ok(state.gemini_bridge.status(&state.hub).await)
}

#[tauri::command]
pub async fn install_gemini_bridge_hooks(
    state: State<'_, AppState>,
) -> Result<GeminiBridgeStatus, String> {
    state.gemini_bridge.install_hooks().await?;
    Ok(state.gemini_bridge.status(&state.hub).await)
}

#[tauri::command]
pub async fn uninstall_gemini_bridge_hooks(
    state: State<'_, AppState>,
) -> Result<GeminiBridgeStatus, String> {
    state.gemini_bridge.uninstall_hooks()?;
    Ok(state.gemini_bridge.status(&state.hub).await)
}

#[tauri::command]
pub async fn test_gemini_bridge_event(
    state: State<'_, AppState>,
    event_name: Option<String>,
) -> Result<GeminiBridgeStatus, String> {
    let packet = GeminiHookPacket {
        token: state.gemini_bridge.token().to_string(),
        hook_event_name: event_name.unwrap_or_else(|| "AfterAgent".to_string()),
        prompt_response: "Bridge loopback self-test OK".to_string(),
        ..Default::default()
    };
    state.gemini_bridge.handle_packet(packet, &state.hub).await;
    Ok(state.gemini_bridge.status(&state.hub).await)
}
