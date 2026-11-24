use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde_json::json;
use tracing::debug;

use super::client::HerdrClient;
use super::events::{now_ms, TerminalStateHub};
use super::protocol::extract_smart_preview_lines;
use super::types::ReadResult;

/// Background worker that fetches lightweight screen previews for live terminals.
/// Uses a per-call timeout and cooldown so high-output CLIs (e.g. Gemini CLI)
/// never stall the shared `hc connect` RPC pipeline.
pub fn spawn_preview_worker(hub: Arc<TerminalStateHub>, client: Arc<HerdrClient>) {
    tauri::async_runtime::spawn(async move {
        let maybe_rx = hub.take_preview_rx().await;
        let Some(mut preview_rx) = maybe_rx else {
            return;
        };

        let mut last_fetched: HashMap<String, u64> = HashMap::new();
        while let Some(addr) = preview_rx.recv().await {
            let now = now_ms();
            if let Some(&prev) = last_fetched.get(&addr) {
                if now.saturating_sub(prev) < 1500 {
                    continue;
                }
            }
            last_fetched.insert(addr.clone(), now);

            let read_fut = client.call("terminal.read", json!({ "terminal": addr, "lines": 0 }));
            match tokio::time::timeout(Duration::from_secs(3), read_fut).await {
                Ok(Ok(val)) => {
                    if let Ok(read_res) = serde_json::from_value::<ReadResult>(val) {
                        let lines = extract_preview_lines(&read_res.text, 16);
                        hub.update_preview_if_changed(addr, lines).await;
                    }
                }
                Ok(Err(e)) => {
                    debug!("preview fetch skipped for {}: {}", addr, e);
                }
                Err(_) => {
                    debug!("preview fetch timed out for {}", addr);
                }
            }
        }
    });
}

pub fn extract_preview_lines(raw_text: &str, max_lines: usize) -> Vec<String> {
    extract_smart_preview_lines(raw_text, max_lines)
}
