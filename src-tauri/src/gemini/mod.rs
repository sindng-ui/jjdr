pub mod bridge;
pub mod installer;
pub mod screen;
pub mod state;

use serde::{Deserialize, Serialize};

use crate::herdr::types::{Status, Terminal};

/// Hook event packet received over 127.0.0.1 UDP from Gemini CLI hooks.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GeminiHookPacket {
    #[serde(default)]
    pub token: String,
    #[serde(default)]
    pub terminal_id: String,
    #[serde(default)]
    pub jjdr_addr: String,
    #[serde(default)]
    pub hook_event_name: String,
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub notification_type: String,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub tool_name: String,
    #[serde(default)]
    pub prompt_response: String,
}

/// Source of a synthesized Gemini status override.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GeminiStatusSource {
    Hook,
    Screen,
}

/// Synthesized status entry overlaid onto a live Gemini terminal in `TerminalStateHub`.
#[derive(Debug, Clone)]
pub struct GeminiStatusOverride {
    pub status: Status,
    pub status_ms: u64,
    pub synthetic_turn: u64,
    pub source: GeminiStatusSource,
    pub last_event_name: String,
}

/// Diagnostic snapshot exposed to the frontend Settings modal.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GeminiBridgeStatus {
    pub running: bool,
    pub port: u16,
    pub hooks_installed: bool,
    pub settings_path: String,
    pub endpoint_path: String,
    pub events_received: u64,
    pub last_event_ms: Option<u64>,
    pub last_event_name: Option<String>,
    pub last_matched_terminal: Option<String>,
    pub active_gemini_terminals: usize,
}

fn normalize_bin(raw: &str) -> String {
    raw.replace('\\', "/")
        .rsplit('/')
        .next()
        .unwrap_or(raw)
        .trim_end_matches(".exe")
        .trim_end_matches(".cmd")
        .trim_end_matches(".bat")
        .trim()
        .to_lowercase()
}

/// Returns true when a `herdr-core` terminal is running Gemini CLI.
pub fn is_gemini_terminal(t: &Terminal) -> bool {
    if let Some(agent) = t.labels.get("jjdr.agent") {
        if normalize_bin(agent) == "gemini" {
            return true;
        }
    }
    if let Some(status) = t.status.as_ref() {
        if let Some(app) = status.app.as_deref() {
            if normalize_bin(app) == "gemini" {
                return true;
            }
        }
    }
    if let Some(first) = t.argv.first() {
        if normalize_bin(first) == "gemini" {
            return true;
        }
    }
    if let Some(fg) = t.foreground.as_ref() {
        if normalize_bin(&fg.name) == "gemini" {
            return true;
        }
        if fg
            .argv
            .iter()
            .take(6)
            .any(|arg| arg.to_lowercase().contains("gemini-cli") || normalize_bin(arg) == "gemini")
        {
            return true;
        }
    }
    false
}
