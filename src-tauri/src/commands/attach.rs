use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

use crate::herdr::client::HerdrClient;
use crate::herdr::protocol::{Frame, FrameKind};
use crate::herdr::types::AttachResult;
use crate::AppState;

pub const TERM_DATA_EVENT: &str = "jjdr:term-data";
pub const TERM_CLOSED_EVENT: &str = "jjdr:term-closed";

#[derive(Debug, Clone, Serialize)]
pub struct TermDataEvent {
    pub channel: u32,
    pub address: String,
    pub data_b64: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TermClosedEvent {
    pub channel: u32,
    pub address: String,
}

pub struct AttachManager {
    active_channels: Mutex<HashMap<u32, String>>,
    generation: AtomicU64,
}

impl AttachManager {
    pub fn new() -> Self {
        Self {
            active_channels: Mutex::new(HashMap::new()),
            generation: AtomicU64::new(0),
        }
    }

    pub fn next_generation(&self) -> u64 {
        self.generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub fn current_generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }

    /// Synchronously detach all channels (used on app exit).
    pub async fn detach_all(&self, client: &Arc<HerdrClient>) {
        let channels = self.take_all_channels().await;
        for ch in channels {
            let _ = client.send_frame(Frame::close(ch)).await;
            client.unregister_channel(ch).await;
        }
    }

    /// Non-blocking detach so switching cards rapidly never stalls on closing old channels.
    pub async fn detach_all_background(&self, client: &Arc<HerdrClient>) {
        let channels = self.take_all_channels().await;
        if channels.is_empty() {
            return;
        }
        let client_bg = client.clone();
        tokio::spawn(async move {
            for ch in channels {
                let _ = client_bg.send_frame(Frame::close(ch)).await;
                client_bg.unregister_channel(ch).await;
            }
        });
    }

    async fn take_all_channels(&self) -> Vec<u32> {
        let mut guard = self.active_channels.lock().await;
        let keys: Vec<u32> = guard.keys().copied().collect();
        guard.clear();
        keys
    }

    pub async fn detach(&self, client: &Arc<HerdrClient>, channel: u32) {
        self.active_channels.lock().await.remove(&channel);
        let client_bg = client.clone();
        tokio::spawn(async move {
            let _ = client_bg.send_frame(Frame::close(channel)).await;
            client_bg.unregister_channel(channel).await;
        });
    }

    pub async fn address_for_channel(&self, channel: u32) -> Option<String> {
        self.active_channels.lock().await.get(&channel).cloned()
    }
}

#[tauri::command]
pub async fn attach_terminal(
    app: AppHandle,
    state: State<'_, AppState>,
    address: String,
    cols: u16,
    rows: u16,
    keep_existing: Option<bool>,
) -> Result<AttachResult, String> {
    let my_gen = state.attach.next_generation();

    if !keep_existing.unwrap_or(false) {
        state.attach.detach_all_background(&state.herdr).await;
    }

    let val = state
        .herdr
        .call(
            "terminal.attach",
            json!({
                "terminal": address,
                "cols": cols.max(20),
                "rows": rows.max(5),
                "history": 30,
                "display": {
                    "bg": "#0e1322",
                    "fg": "#eef2ff",
                    "cursor": "#818cf8"
                }
            }),
        )
        .await
        .map_err(|e| e.to_string())?;

    let attach_res: AttachResult = serde_json::from_value(val).map_err(|e| e.to_string())?;
    let channel = attach_res.channel;

    // Drop stale attach if the user already flipped to a newer card.
    if !keep_existing.unwrap_or(false) && state.attach.current_generation() != my_gen {
        let client_bg = state.herdr.clone();
        tokio::spawn(async move {
            let _ = client_bg.send_frame(Frame::close(channel)).await;
            client_bg.unregister_channel(channel).await;
        });
        return Ok(attach_res);
    }

    let mut rx = state
        .herdr
        .register_channel(channel)
        .await
        .map_err(|e| e.to_string())?;

    state
        .attach
        .active_channels
        .lock()
        .await
        .insert(channel, address.clone());

    let client = state.herdr.clone();
    let addr_clone = address.clone();
    tokio::spawn(async move {
        let mut buf = Vec::<u8>::with_capacity(16384);
        let mut uncredited: u32 = 0;
        let started_at = tokio::time::Instant::now();
        let mut first_paint_done = false;
        let mut flush_tick = tokio::time::interval(Duration::from_millis(16));
        flush_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            tokio::select! {
                maybe_frame = rx.recv() => {
                    match maybe_frame {
                        Some(frame) => match frame.kind {
                            FrameKind::Data => {
                                uncredited = uncredited.saturating_add(frame.payload.len() as u32);
                                buf.extend_from_slice(&frame.payload);
                                // Coalesce initial screen dump into one atomic chunk so tabs swap without scrolling flash
                                let chunk_limit = if first_paint_done { 16384 } else { 65536 };
                                if buf.len() >= chunk_limit {
                                    emit_term_chunk(&app, channel, &addr_clone, &mut buf);
                                    first_paint_done = true;
                                }
                                if uncredited >= 8192 {
                                    let _ = client.send_frame(Frame::credit(channel, uncredited)).await;
                                    uncredited = 0;
                                }
                            }
                            FrameKind::Close => {
                                if !buf.is_empty() {
                                    emit_term_chunk(&app, channel, &addr_clone, &mut buf);
                                }
                                let _ = app.emit_to("main", TERM_CLOSED_EVENT, TermClosedEvent { channel, address: addr_clone.clone() });
                                break;
                            }
                            _ => {}
                        },
                        None => {
                            if !buf.is_empty() {
                                emit_term_chunk(&app, channel, &addr_clone, &mut buf);
                            }
                            let _ = app.emit_to("main", TERM_CLOSED_EVENT, TermClosedEvent { channel, address: addr_clone.clone() });
                            break;
                        }
                    }
                }
                _ = flush_tick.tick() => {
                    if !buf.is_empty() {
                        // Allow up to 32ms for initial screen burst to coalesce into a single paint
                        if first_paint_done || started_at.elapsed() >= Duration::from_millis(32) {
                            emit_term_chunk(&app, channel, &addr_clone, &mut buf);
                            first_paint_done = true;
                        }
                    }
                    if uncredited > 0 {
                        let _ = client.send_frame(Frame::credit(channel, uncredited)).await;
                        uncredited = 0;
                    }
                }
            }
        }
        client.unregister_channel(channel).await;
    });

    Ok(attach_res)
}

fn emit_term_chunk(app: &AppHandle, channel: u32, address: &str, buf: &mut Vec<u8>) {
    let encoded = BASE64.encode(&buf);
    buf.clear();
    // Target main window only so secondary webviews never receive terminal stream payloads
    let _ = app.emit_to(
        "main",
        TERM_DATA_EVENT,
        TermDataEvent {
            channel,
            address: address.to_string(),
            data_b64: encoded,
        },
    );
}

#[tauri::command]
pub async fn detach_terminal(state: State<'_, AppState>, channel: u32) -> Result<(), String> {
    state.attach.detach(&state.herdr, channel).await;
    Ok(())
}

#[tauri::command]
pub async fn write_terminal_input(
    state: State<'_, AppState>,
    channel: u32,
    data: String,
) -> Result<(), String> {
    let has_enter = data.contains('\r') || data.contains('\n');
    let has_ctrl_c = data.contains('\x03');
    // Standalone Esc only (ignore ANSI escape sequences like arrow keys `\x1b[A`)
    let is_standalone_esc = data == "\x1b";
    state
        .herdr
        .send_frame(Frame::data(channel, data.into_bytes()))
        .await
        .map_err(|e| e.to_string())?;
    if has_enter || has_ctrl_c || is_standalone_esc {
        if let Some(addr) = state.attach.address_for_channel(channel).await {
            if has_ctrl_c {
                state.hub.notify_gemini_user_interrupted(&addr, false).await;
            } else if is_standalone_esc {
                state.hub.notify_gemini_user_interrupted(&addr, true).await;
            } else if has_enter {
                state.hub.notify_gemini_user_approved(&addr).await;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn resize_terminal(
    state: State<'_, AppState>,
    channel: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state
        .herdr
        .send_frame(Frame::resize(channel, cols.max(20), rows.max(5)))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn focus_terminal(
    state: State<'_, AppState>,
    channel: u32,
    focused: bool,
) -> Result<(), String> {
    state
        .herdr
        .send_frame(Frame::focus(channel, focused))
        .await
        .map_err(|e| e.to_string())
}
