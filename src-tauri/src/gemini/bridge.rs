#[cfg(not(test))]
use std::fs;
#[cfg(not(test))]
use std::path::PathBuf;
#[cfg(not(test))]
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(not(test))]
use std::sync::Arc;

#[cfg(not(test))]
use serde_json::json;
#[cfg(not(test))]
use tokio::net::UdpSocket;
#[cfg(not(test))]
use tokio::sync::RwLock;
#[cfg(not(test))]
use tracing::{info, warn};
#[cfg(not(test))]
use uuid::Uuid;

#[cfg(not(test))]
use crate::gemini::installer::{
    check_hooks_installed, gemini_bridge_dir, gemini_endpoint_path, gemini_settings_path,
    install_hooks_at, uninstall_hooks_at,
};
#[cfg(not(test))]
use crate::gemini::{is_gemini_terminal, GeminiBridgeStatus};
use crate::gemini::{GeminiHookPacket, GeminiStatusOverride, GeminiStatusSource};
#[cfg(not(test))]
use crate::herdr::events::{now_ms, TerminalStateHub};
use crate::herdr::types::Status;

#[cfg(not(test))]
#[derive(Debug, Default)]
struct BridgeDiagnostics {
    last_event_ms: Option<u64>,
    last_event_name: Option<String>,
    last_matched_terminal: Option<String>,
}

/// Embedded loopback UDP bridge runtime managed inside `AppState`.
#[cfg(not(test))]
pub struct GeminiBridgeRuntime {
    port: RwLock<u16>,
    token: String,
    endpoint_path: PathBuf,
    settings_path: PathBuf,
    events_received: AtomicU64,
    diag: RwLock<BridgeDiagnostics>,
}

#[cfg(not(test))]
impl GeminiBridgeRuntime {
    pub fn new() -> Arc<Self> {
        let endpoint_path = gemini_endpoint_path().unwrap_or_else(|_| {
            std::env::temp_dir()
                .join("jjdr")
                .join("gemini-bridge")
                .join("endpoint.json")
        });
        let settings_path = gemini_settings_path()
            .unwrap_or_else(|_| std::env::temp_dir().join(".gemini").join("settings.json"));

        Arc::new(Self {
            port: RwLock::new(0),
            token: Uuid::new_v4().to_string(),
            endpoint_path,
            settings_path,
            events_received: AtomicU64::new(0),
            diag: RwLock::new(BridgeDiagnostics::default()),
        })
    }

    pub async fn port(&self) -> u16 {
        *self.port.read().await
    }

    pub fn token(&self) -> &str {
        &self.token
    }

    pub fn write_endpoint_file(&self, port: u16) -> Result<(), String> {
        if let Ok(dir) = gemini_bridge_dir() {
            let _ = fs::create_dir_all(&dir);
        }
        if let Some(parent) = self.endpoint_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create bridge dir: {}", e))?;
        }
        let body = json!({
            "port": port,
            "token": self.token,
            "updated_ms": now_ms(),
        });
        let tmp = self.endpoint_path.with_extension("json.tmp");
        fs::write(&tmp, body.to_string()).map_err(|e| format!("Failed to write endpoint: {}", e))?;
        if fs::rename(&tmp, &self.endpoint_path).is_err() {
            fs::copy(&tmp, &self.endpoint_path)
                .map_err(|e| format!("Failed to update endpoint: {}", e))?;
            let _ = fs::remove_file(&tmp);
        }
        Ok(())
    }

    /// Start the loopback-only UDP listener (`127.0.0.1:0`).
    /// Consumes near-zero CPU (event-driven recv) and zero threads when idle.
    pub fn start(self: &Arc<Self>, hub: Arc<TerminalStateHub>) {
        let runtime = self.clone();
        tauri::async_runtime::spawn(async move {
            let socket = match UdpSocket::bind("127.0.0.1:0").await {
                Ok(s) => s,
                Err(err) => {
                    warn!("Gemini CLI bridge failed to bind loopback UDP socket: {}", err);
                    return;
                }
            };
            let local_port = match socket.local_addr() {
                Ok(addr) => addr.port(),
                Err(err) => {
                    warn!("Gemini CLI bridge failed to read local UDP port: {}", err);
                    return;
                }
            };

            *runtime.port.write().await = local_port;
            if let Err(err) = runtime.write_endpoint_file(local_port) {
                warn!("Gemini CLI bridge failed to write endpoint.json: {}", err);
            } else {
                runtime.ensure_hooks_on_startup();
                info!(
                    "Embedded Gemini CLI UDP bridge listening on 127.0.0.1:{}",
                    local_port
                );
            }

            let mut buf = vec![0u8; 8192];
            loop {
                match socket.recv_from(&mut buf).await {
                    Ok((len, _peer)) => {
                        if let Ok(packet) = serde_json::from_slice::<GeminiHookPacket>(&buf[..len])
                        {
                            runtime.handle_packet(packet, &hub).await;
                        }
                    }
                    Err(err) => {
                        warn!("Gemini CLI bridge UDP recv error: {}", err);
                        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                    }
                }
            }
        });
    }

    pub async fn handle_packet(&self, packet: GeminiHookPacket, hub: &TerminalStateHub) -> bool {
        if !verify_packet_token(&packet, &self.token) {
            return false;
        }
        let Some((status, bump_turn)) = map_hook_packet_to_status(&packet) else {
            return false;
        };

        let ts = now_ms();
        let matched = hub
            .apply_gemini_event(
                &packet.terminal_id,
                &packet.jjdr_addr,
                &packet.cwd,
                status,
                bump_turn,
                ts,
                GeminiStatusSource::Hook,
                &packet.hook_event_name,
            )
            .await;

        self.events_received.fetch_add(1, Ordering::Relaxed);
        let mut diag = self.diag.write().await;
        diag.last_event_ms = Some(ts);
        diag.last_event_name = Some(packet.hook_event_name);
        if let Some(addr) = matched {
            diag.last_matched_terminal = Some(addr);
        }
        true
    }

    pub async fn status(&self, hub: &TerminalStateHub) -> GeminiBridgeStatus {
        let port = *self.port.read().await;
        let hooks_installed = check_hooks_installed(&self.settings_path);
        let diag = self.diag.read().await;
        let active_gemini_terminals = {
            let map = hub.terminals.read().await;
            map.values()
                .filter(|t| t.state == "live" && is_gemini_terminal(t))
                .count()
        };

        GeminiBridgeStatus {
            running: port > 0,
            port,
            hooks_installed,
            settings_path: self.settings_path.to_string_lossy().to_string(),
            endpoint_path: self.endpoint_path.to_string_lossy().to_string(),
            events_received: self.events_received.load(Ordering::Relaxed),
            last_event_ms: diag.last_event_ms,
            last_event_name: diag.last_event_name.clone(),
            last_matched_terminal: diag.last_matched_terminal.clone(),
            active_gemini_terminals,
        }
    }

    pub async fn install_hooks(&self) -> Result<(), String> {
        let port = *self.port.read().await;
        if port > 0 {
            self.write_endpoint_file(port)?;
        }
        if let Some(flag) = self.opt_out_flag_path() {
            let _ = fs::remove_file(flag);
        }
        install_hooks_at(&self.settings_path, &self.endpoint_path)
    }

    pub fn uninstall_hooks(&self) -> Result<(), String> {
        if let Some(flag) = self.opt_out_flag_path() {
            if let Some(parent) = flag.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let _ = fs::write(flag, "1");
        }
        uninstall_hooks_at(&self.settings_path)
    }

    fn opt_out_flag_path(&self) -> Option<PathBuf> {
        self.endpoint_path
            .parent()
            .map(|p| p.join("hooks_disabled.flag"))
    }

    /// Auto-install ultra-light 3-event hooks on startup unless the user explicitly opted out.
    pub fn ensure_hooks_on_startup(&self) {
        if self
            .opt_out_flag_path()
            .map(|p| p.exists())
            .unwrap_or(false)
        {
            return;
        }
        if let Err(err) = install_hooks_at(&self.settings_path, &self.endpoint_path) {
            warn!("Gemini CLI bridge auto-hook setup skipped: {}", err);
        }
    }
}

/// Constant-shape token check for incoming loopback UDP packets.
pub fn verify_packet_token(packet: &GeminiHookPacket, expected_token: &str) -> bool {
    !expected_token.is_empty() && packet.token == expected_token
}

/// Translate a verified Gemini CLI hook payload into a `herdr-core`-compatible `Status`
/// plus a boolean indicating whether a turn just completed (`synthetic_turn += 1`).
pub fn map_hook_packet_to_status(packet: &GeminiHookPacket) -> Option<(Status, bool)> {
    let event = packet.hook_event_name.trim();
    match event {
        "BeforeAgent" => Some((
            Status {
                state: "working".to_string(),
                app: Some("gemini".to_string()),
                kind: None,
                msg: Some("Thinking...".to_string()),
                progress: None,
                title: None,
            },
            false,
        )),
        "BeforeTool" => {
            let msg = if packet.tool_name.trim().is_empty() {
                "Running tool...".to_string()
            } else {
                format!("Running {}...", packet.tool_name.trim())
            };
            Some((
                Status {
                    state: "working".to_string(),
                    app: Some("gemini".to_string()),
                    kind: None,
                    msg: Some(msg),
                    progress: None,
                    title: None,
                },
                false,
            ))
        }
        "AfterTool" => Some((
            Status {
                state: "working".to_string(),
                app: Some("gemini".to_string()),
                kind: None,
                msg: Some("Processing tool result...".to_string()),
                progress: None,
                title: None,
            },
            false,
        )),
        "Notification" => {
            let ntype = packet.notification_type.trim().to_lowercase();
            let raw_msg = packet.message.trim();
            let msg_low = raw_msg.to_lowercase();
            let is_perm = ntype.contains("permission")
                || msg_low.contains("permission")
                || msg_low.contains("allow")
                || msg_low.contains("approve")
                || msg_low.contains("confirm");
            let kind = if is_perm { "permission" } else { "question" };
            let msg = if raw_msg.is_empty() {
                if is_perm {
                    "Tool permission required".to_string()
                } else {
                    "Waiting for input".to_string()
                }
            } else {
                raw_msg.chars().take(140).collect()
            };
            Some((
                Status {
                    state: "blocked".to_string(),
                    app: Some("gemini".to_string()),
                    kind: Some(kind.to_string()),
                    msg: Some(msg),
                    progress: None,
                    title: None,
                },
                false,
            ))
        }
        "AfterAgent" => {
            let first_line = packet
                .prompt_response
                .lines()
                .map(|l| l.trim())
                .find(|l| !l.is_empty())
                .unwrap_or("Turn complete");
            let msg: String = first_line.chars().take(140).collect();
            Some((
                Status {
                    state: "done".to_string(),
                    app: Some("gemini".to_string()),
                    kind: None,
                    msg: Some(msg),
                    progress: None,
                    title: None,
                },
                true,
            ))
        }
        "SessionStart" | "SessionEnd" => Some((
            Status {
                state: "idle".to_string(),
                app: Some("gemini".to_string()),
                kind: None,
                msg: Some("Ready for prompt".to_string()),
                progress: None,
                title: None,
            },
            false,
        )),
        _ => None,
    }
}

/// Helper to build a `GeminiStatusOverride` cleanly.
pub fn build_override(
    status: Status,
    status_ms: u64,
    synthetic_turn: u64,
    source: GeminiStatusSource,
    event_name: &str,
) -> GeminiStatusOverride {
    GeminiStatusOverride {
        status,
        status_ms,
        synthetic_turn,
        source,
        last_event_name: event_name.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_before_agent_notification_and_after_agent_accurately() {
        let before = GeminiHookPacket {
            hook_event_name: "BeforeAgent".into(),
            ..Default::default()
        };
        let (st, bump) = map_hook_packet_to_status(&before).unwrap();
        assert_eq!(st.state, "working");
        assert!(!bump);

        let notif = GeminiHookPacket {
            hook_event_name: "Notification".into(),
            notification_type: "ToolPermission".into(),
            message: "Allow run_shell_command?".into(),
            ..Default::default()
        };
        let (st, bump) = map_hook_packet_to_status(&notif).unwrap();
        assert_eq!(st.state, "blocked");
        assert_eq!(st.kind.as_deref(), Some("permission"));
        assert!(!bump);

        let after = GeminiHookPacket {
            hook_event_name: "AfterAgent".into(),
            prompt_response: "Implemented the requested change.\nAll tests pass.".into(),
            ..Default::default()
        };
        let (st, bump) = map_hook_packet_to_status(&after).unwrap();
        assert_eq!(st.state, "done");
        assert_eq!(st.msg.as_deref(), Some("Implemented the requested change."));
        assert!(bump);
    }

    #[test]
    fn validates_loopback_token_strictly() {
        let expected = "sec-token-123";
        let bad = GeminiHookPacket {
            token: "wrong-token".into(),
            hook_event_name: "BeforeAgent".into(),
            ..Default::default()
        };
        assert!(!verify_packet_token(&bad, expected));
        assert!(!verify_packet_token(&bad, ""));

        let good = GeminiHookPacket {
            token: expected.into(),
            hook_event_name: "AfterAgent".into(),
            prompt_response: "Ready!".into(),
            ..Default::default()
        };
        assert!(verify_packet_token(&good, expected));

        let ov = build_override(
            map_hook_packet_to_status(&good).unwrap().0,
            1_700_000_000_000,
            2,
            GeminiStatusSource::Hook,
            "AfterAgent",
        );
        assert_eq!(ov.status.state, "done");
        assert_eq!(ov.synthetic_turn, 2);
        assert_eq!(ov.source, GeminiStatusSource::Hook);
    }

    #[test]
    fn distinguishes_permission_vs_question_notifications_and_fallbacks() {
        let q = GeminiHookPacket {
            hook_event_name: "Notification".into(),
            notification_type: "UserPrompt".into(),
            message: "Which port should the server listen on?".into(),
            ..Default::default()
        };
        let (st, bump) = map_hook_packet_to_status(&q).unwrap();
        assert_eq!(st.state, "blocked");
        assert_eq!(st.kind.as_deref(), Some("question"));
        assert!(!bump);

        let empty_perm = GeminiHookPacket {
            hook_event_name: "Notification".into(),
            notification_type: "ToolPermission".into(),
            message: "".into(),
            ..Default::default()
        };
        let (st, _) = map_hook_packet_to_status(&empty_perm).unwrap();
        assert_eq!(st.kind.as_deref(), Some("permission"));
        assert_eq!(st.msg.as_deref(), Some("Tool permission required"));

        let empty_after = GeminiHookPacket {
            hook_event_name: "AfterAgent".into(),
            prompt_response: "   \n  ".into(),
            ..Default::default()
        };
        let (st, bump) = map_hook_packet_to_status(&empty_after).unwrap();
        assert_eq!(st.state, "done");
        assert_eq!(st.msg.as_deref(), Some("Turn complete"));
        assert!(bump);
    }

    #[test]
    fn maps_session_events_and_ignores_unknown_events() {
        let s = GeminiHookPacket {
            hook_event_name: "SessionStart".into(),
            ..Default::default()
        };
        let (st, bump) = map_hook_packet_to_status(&s).unwrap();
        assert_eq!(st.state, "idle");
        assert!(!bump);

        let unknown = GeminiHookPacket {
            hook_event_name: "PreCompress".into(),
            ..Default::default()
        };
        assert!(map_hook_packet_to_status(&unknown).is_none());
    }
}
