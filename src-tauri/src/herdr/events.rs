use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, RwLock};
use tracing::{info, warn};

use super::client::HerdrClient;
use super::preview::spawn_preview_worker;
use super::protocol::{Frame, FrameKind};
use super::types::{StateBatchPayload, SubscribeResult, Terminal, TerminalPreview};

pub const STATE_BATCH_EVENT: &str = "jjdr:state-batch";
pub const DOC_CHANGED_EVENT: &str = "jjdr:doc-changed";

pub struct TerminalStateHub {
    pub terminals: RwLock<HashMap<String, Terminal>>,
    pub previews: RwLock<HashMap<String, TerminalPreview>>,
    pub seq: RwLock<u64>,
    dirty_terminals: RwLock<HashSet<String>>,
    removed_terminals: RwLock<HashSet<String>>,
    dirty_previews: RwLock<HashSet<String>>,
    full_sync_pending: RwLock<bool>,
    preview_tx: mpsc::UnboundedSender<String>,
    preview_rx: tokio::sync::Mutex<Option<mpsc::UnboundedReceiver<String>>>,
}

impl TerminalStateHub {
    pub fn new() -> Arc<Self> {
        let (preview_tx, preview_rx) = mpsc::unbounded_channel::<String>();
        Arc::new(Self {
            terminals: RwLock::new(HashMap::new()),
            previews: RwLock::new(HashMap::new()),
            seq: RwLock::new(0),
            dirty_terminals: RwLock::new(HashSet::new()),
            removed_terminals: RwLock::new(HashSet::new()),
            dirty_previews: RwLock::new(HashSet::new()),
            full_sync_pending: RwLock::new(true),
            preview_tx,
            preview_rx: tokio::sync::Mutex::new(Some(preview_rx)),
        })
    }

    pub async fn take_preview_rx(&self) -> Option<mpsc::UnboundedReceiver<String>> {
        self.preview_rx.lock().await.take()
    }

    pub async fn update_preview_if_changed(&self, addr: String, lines: Vec<String>) {
        let changed = {
            let prev_map = self.previews.read().await;
            prev_map.get(&addr).map(|p| &p.lines) != Some(&lines)
        };
        if changed {
            let preview = TerminalPreview {
                address: addr.clone(),
                lines,
                updated_ms: now_ms(),
            };
            self.previews.write().await.insert(addr.clone(), preview);
            self.dirty_previews.write().await.insert(addr);
        }
    }

    pub fn start_preview_worker(self: &Arc<Self>, client: Arc<HerdrClient>) {
        spawn_preview_worker(self.clone(), client);
    }

    pub async fn snapshot(&self, client: &HerdrClient) -> StateBatchPayload {
        let terminals = self.terminals.read().await.values().cloned().collect();
        let previews = self.previews.read().await.values().cloned().collect();
        let seq = *self.seq.read().await;
        StateBatchPayload {
            full_sync: true,
            terminals,
            removed_addresses: Vec::new(),
            previews,
            health: client.health().await,
            seq,
        }
    }

    pub fn request_preview(&self, address: String) {
        let _ = self.preview_tx.send(address);
    }

    /// Force an immediate `terminal.list` sync (used right after launching or periodically for turn/status freshness).
    pub async fn sync_terminals_now(&self, client: &HerdrClient) {
        if let Ok(val) = client.call("terminal.list", json!({})).await {
            if let Some(terms_val) = val.get("terminals") {
                if let Ok(terms) = serde_json::from_value::<Vec<Terminal>>(terms_val.clone()) {
                    let mut map = self.terminals.write().await;
                    let mut dirty = self.dirty_terminals.write().await;
                    let mut live_set = HashSet::new();
                    for t in terms {
                        let addr = t.address.clone();
                        let is_live = t.state == "live";
                        live_set.insert(addr.clone());
                        let changed = match map.get(&addr) {
                            Some(prev) => {
                                prev.state != t.state
                                    || prev.turn != t.turn
                                    || prev.status_ms != t.status_ms
                                    || prev.title != t.title
                                    || prev.status.as_ref().map(|s| &s.state)
                                        != t.status.as_ref().map(|s| &s.state)
                            }
                            None => true,
                        };
                        map.insert(addr.clone(), t);
                        if changed {
                            dirty.insert(addr.clone());
                        }
                        if is_live {
                            self.request_preview(addr);
                        }
                    }
                    // Mark previously-live terminals that disappeared from live list as finished
                    for (addr, prev) in map.iter_mut() {
                        if prev.state == "live" && !live_set.contains(addr) {
                            prev.state = "finished".to_string();
                            dirty.insert(addr.clone());
                        }
                    }
                }
            }
        }
    }

    pub async fn apply_full_snapshot(&self, terminals: Vec<Terminal>, seq: u64) {
        let mut map = self.terminals.write().await;
        map.clear();
        for t in terminals {
            let addr = t.address.clone();
            let should_preview = t.state == "live"
                && matches!(
                    t.status.as_ref().map(|s| s.state.as_str()),
                    Some("blocked" | "done" | "error" | "idle")
                );
            map.insert(addr.clone(), t);
            if should_preview {
                self.request_preview(addr);
            }
        }
        *self.seq.write().await = seq;
        *self.full_sync_pending.write().await = true;
    }

    pub async fn apply_event(&self, raw: &Value, app: &AppHandle) {
        let seq = raw.get("seq").and_then(|v| v.as_u64());
        if let Some(s) = seq {
            let mut cur = self.seq.write().await;
            if s <= *cur {
                return;
            }
            *cur = s;
        }

        let kind = raw
            .get("event")
            .or_else(|| raw.get("kind"))
            .or_else(|| raw.get("type"))
            .and_then(|v| v.as_str())
            .unwrap_or("");

        match kind {
            "heartbeat" | "" => return,
            "missed" => {
                if let Some(terms_val) = raw.get("terminals") {
                    if let Ok(terms) = serde_json::from_value::<Vec<Terminal>>(terms_val.clone()) {
                        let next_seq = seq.unwrap_or(0);
                        self.apply_full_snapshot(terms, next_seq).await;
                    }
                }
                return;
            }
            "doc" => {
                let _ = app.emit(DOC_CHANGED_EVENT, raw.clone());
                return;
            }
            "removed" => {
                if let Some(addr) = extract_address(raw) {
                    self.terminals.write().await.remove(&addr);
                    self.previews.write().await.remove(&addr);
                    self.removed_terminals.write().await.insert(addr);
                }
                return;
            }
            _ => {}
        }

        if let Some(term_val) = raw.get("terminal").filter(|v| v.is_object()) {
            if let Ok(term) = serde_json::from_value::<Terminal>(term_val.clone()) {
                let addr = term.address.clone();
                let trigger_preview = matches!(
                    kind,
                    "created" | "status" | "turn" | "finished" | "restarted"
                );
                self.terminals.write().await.insert(addr.clone(), term);
                self.dirty_terminals.write().await.insert(addr.clone());
                if trigger_preview {
                    self.request_preview(addr);
                }
                return;
            }
        }

        if let Some(addr) = extract_address(raw) {
            let mut map = self.terminals.write().await;
            if let Some(term) = map.get_mut(&addr) {
                let mut trigger_preview = false;
                if let Some(status_val) = raw.get("status") {
                    if status_val.is_null() {
                        term.status = None;
                    } else if let Ok(st) = serde_json::from_value(status_val.clone()) {
                        term.status = Some(st);
                        trigger_preview = true;
                    }
                }
                if let Some(ms) = raw.get("status_ms").and_then(|v| v.as_u64()) {
                    term.status_ms = Some(ms);
                }
                if let Some(turn) = raw.get("turn").and_then(|v| v.as_u64()) {
                    term.turn = turn;
                    trigger_preview = true;
                }
                if let Some(title) = raw.get("title").and_then(|v| v.as_str()) {
                    term.title = title.to_string();
                }
                if let Some(labels) = raw.get("labels").and_then(|v| v.as_object()) {
                    term.labels = labels
                        .iter()
                        .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                        .collect();
                }
                if let Some(state) = raw.get("state").and_then(|v| v.as_str()) {
                    term.state = state.to_string();
                    if state == "finished" {
                        trigger_preview = true;
                    }
                }
                if let Some(cols) = raw.get("cols").and_then(|v| v.as_u64()) {
                    term.cols = cols as u16;
                }
                if let Some(rows) = raw.get("rows").and_then(|v| v.as_u64()) {
                    term.rows = rows as u16;
                }
                if let Some(keep) = raw.get("keep").and_then(|v| v.as_bool()) {
                    term.keep = keep;
                }
                if kind == "finished" {
                    term.state = "finished".to_string();
                    term.exit_code = raw.get("exit_code").and_then(|v| v.as_i64()).map(|v| v as i32);
                    term.finished_ms = raw
                        .get("finished_ms")
                        .and_then(|v| v.as_u64())
                        .or_else(|| Some(now_ms()));
                    trigger_preview = true;
                }
                self.dirty_terminals.write().await.insert(addr.clone());
                if trigger_preview {
                    self.request_preview(addr);
                }
            }
        }
    }

    async fn flush_batch(
        &self,
        app: &AppHandle,
        client: &HerdrClient,
        last_connected: &mut Option<bool>,
    ) {
        let health = client.health().await;
        let health_changed = *last_connected != Some(health.connected);
        *last_connected = Some(health.connected);

        let full_sync = {
            let mut f = self.full_sync_pending.write().await;
            let prev = *f;
            *f = false;
            prev
        };

        let dirty_addrs: Vec<String> = {
            let mut d = self.dirty_terminals.write().await;
            d.drain().collect()
        };
        let removed: Vec<String> = {
            let mut r = self.removed_terminals.write().await;
            r.drain().collect()
        };
        let dirty_prevs: Vec<String> = {
            let mut p = self.dirty_previews.write().await;
            p.drain().collect()
        };

        if !full_sync
            && !health_changed
            && dirty_addrs.is_empty()
            && removed.is_empty()
            && dirty_prevs.is_empty()
        {
            return;
        }

        let terminals = if full_sync {
            self.terminals.read().await.values().cloned().collect()
        } else {
            let map = self.terminals.read().await;
            dirty_addrs
                .iter()
                .filter_map(|a| map.get(a).cloned())
                .collect()
        };

        let previews = if full_sync {
            self.previews.read().await.values().cloned().collect()
        } else {
            let map = self.previews.read().await;
            dirty_prevs
                .iter()
                .filter_map(|a| map.get(a).cloned())
                .collect()
        };

        let payload = StateBatchPayload {
            full_sync,
            terminals,
            removed_addresses: removed,
            previews,
            health,
            seq: *self.seq.read().await,
        };

        let _ = app.emit(STATE_BATCH_EVENT, payload);
    }
}

/// Spawn the background connection + `events.subscribe` + 30ms coalescing emitter loop.
pub fn spawn_herdr_supervisor(
    app: AppHandle,
    client: Arc<HerdrClient>,
    hub: Arc<TerminalStateHub>,
) {
    hub.start_preview_worker(client.clone());

    let app_emit = app.clone();
    let client_emit = client.clone();
    let hub_emit = hub.clone();
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_millis(30));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut last_connected: Option<bool> = None;
        loop {
            ticker.tick().await;
            hub_emit
                .flush_batch(&app_emit, &client_emit, &mut last_connected)
                .await;
        }
    });

    // Periodic lightweight sync (3.5s) to keep turn/status fresh without contending with attach RPCs.
    let hub_prev = hub.clone();
    let client_prev = client.clone();
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_millis(3500));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            ticker.tick().await;
            if !client_prev.is_connected().await {
                continue;
            }
            hub_prev.sync_terminals_now(&client_prev).await;
        }
    });

    tauri::async_runtime::spawn(async move {
        let mut backoff_ms: u64 = 500;
        loop {
            match client.connect().await {
                Ok(_hello) => {
                    backoff_ms = 500;
                    if let Err(err) = run_subscribe_session(&app, &client, &hub).await {
                        warn!("herdr subscribe session ended: {}", err);
                    }
                    client
                        .set_disconnected_error(
                            "Connection to herdr-core lost; reconnecting...".into(),
                            None,
                        )
                        .await;
                    *hub.full_sync_pending.write().await = true;
                }
                Err(err) => {
                    warn!("herdr connect attempt failed: {}", err);
                    *hub.full_sync_pending.write().await = true;
                }
            }
            tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
            backoff_ms = (backoff_ms * 2).min(8000);
        }
    });
}

async fn run_subscribe_session(
    app: &AppHandle,
    client: &Arc<HerdrClient>,
    hub: &Arc<TerminalStateHub>,
) -> Result<(), String> {
    let res = client
        .call("events.subscribe", json!({}))
        .await
        .map_err(|e| e.to_string())?;

    let sub: SubscribeResult = serde_json::from_value(res).map_err(|e| e.to_string())?;
    let channel = sub
        .channel
        .ok_or_else(|| "events.subscribe returned no framed channel".to_string())?;

    let mut rx = client
        .register_channel(channel)
        .await
        .map_err(|e| e.to_string())?;

    info!(
        "Subscribed to herdr-core events on channel {} ({} live terminals)",
        channel,
        sub.terminals.len()
    );
    hub.apply_full_snapshot(sub.terminals, sub.seq).await;

    let mut line_buf = Vec::<u8>::new();
    let mut uncredited_bytes: u32 = 0;

    while let Some(frame) = rx.recv().await {
        match frame.kind {
            FrameKind::Data => {
                uncredited_bytes = uncredited_bytes.saturating_add(frame.payload.len() as u32);
                line_buf.extend_from_slice(&frame.payload);

                while let Some(pos) = line_buf.iter().position(|&b| b == b'\n') {
                    let line: Vec<u8> = line_buf.drain(..=pos).collect();
                    let trimmed = std::str::from_utf8(&line).unwrap_or("").trim();
                    if !trimmed.is_empty() {
                        if let Ok(val) = serde_json::from_str::<Value>(trimmed) {
                            hub.apply_event(&val, app).await;
                        }
                    }
                }

                if uncredited_bytes >= 4096 {
                    let _ = client
                        .send_frame(Frame::credit(channel, uncredited_bytes))
                        .await;
                    uncredited_bytes = 0;
                }
            }
            FrameKind::Close => {
                info!("herdr-core closed events channel {}", channel);
                break;
            }
            _ => {}
        }
    }

    client.unregister_channel(channel).await;
    Ok(())
}

fn extract_address(val: &Value) -> Option<String> {
    val.get("address")
        .or_else(|| val.get("terminal"))
        .and_then(|v| v.as_str())
        .map(String::from)
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
