use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

use crate::git::worktree::normalize_path;
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
}

impl AttachManager {
    pub fn new() -> Self {
        Self {
            active_channels: Mutex::new(HashMap::new()),
        }
    }

    pub async fn detach_all(&self, client: &Arc<HerdrClient>) {
        let channels: Vec<u32> = {
            let mut guard = self.active_channels.lock().await;
            let keys: Vec<u32> = guard.keys().copied().collect();
            guard.clear();
            keys
        };
        for ch in channels {
            let _ = client.send_frame(Frame::close(ch)).await;
            client.unregister_channel(ch).await;
        }
    }

    pub async fn detach(&self, client: &Arc<HerdrClient>, channel: u32) {
        self.active_channels.lock().await.remove(&channel);
        let _ = client.send_frame(Frame::close(channel)).await;
        client.unregister_channel(channel).await;
    }
}

#[derive(Debug, Deserialize)]
pub struct LaunchSessionInput {
    pub project_id: Option<String>,
    pub cwd: String,
    pub branch: Option<String>,
    pub argv: Vec<String>,
    pub initial_prompt: Option<String>,
    pub name: Option<String>,
    pub autonomous: Option<bool>,
}

/// Normalize CLI flags for interactive herdr-core execution and default autonomous (YOLO) mode.
pub fn normalize_agent_argv(
    mut argv: Vec<String>,
    initial_prompt: Option<String>,
    autonomous: bool,
) -> Vec<String> {
    if argv.is_empty() {
        return argv;
    }

    let bin = argv[0]
        .replace('\\', "/")
        .rsplit('/')
        .next()
        .unwrap_or(&argv[0])
        .trim_end_matches(".exe")
        .to_lowercase();

    if bin == "codex" && !argv.iter().any(|a| a == "--no-daemon") {
        argv.push("--no-daemon".into());
    }

    if autonomous {
        match bin.as_str() {
            "agy" | "claude" => {
                if !argv.iter().any(|a| a == "--dangerously-skip-permissions") {
                    argv.push("--dangerously-skip-permissions".into());
                }
            }
            "gemini" => {
                if !argv.iter().any(|a| a == "-y" || a == "--yolo") {
                    argv.push("-y".into());
                }
            }
            "codex" => {
                if !argv
                    .iter()
                    .any(|a| a == "--dangerously-bypass-approvals-and-sandbox" || a == "--yolo")
                {
                    argv.push("--dangerously-bypass-approvals-and-sandbox".into());
                }
            }
            _ => {}
        }
    }

    if let Some(prompt) = initial_prompt.filter(|p| !p.trim().is_empty()) {
        if bin == "agy" && !argv.iter().any(|a| a == "-i" || a == "--prompt-interactive") {
            argv.push("-i".into());
        }
        argv.push(prompt);
    }

    argv
}

#[tauri::command]
pub async fn launch_session(
    state: State<'_, AppState>,
    input: LaunchSessionInput,
) -> Result<String, String> {
    let cwd = if input.cwd.trim().is_empty() {
        dirs::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string())
    } else {
        input.cwd
    };

    let is_plain_shell = input.argv.is_empty();
    let autonomous = input.autonomous.unwrap_or(true);
    let argv = if is_plain_shell {
        Vec::new()
    } else {
        normalize_agent_argv(input.argv, input.initial_prompt, autonomous)
    };

    let mut labels = serde_json::Map::new();
    labels.insert("jjdr.worktree".into(), json!(normalize_path(&cwd)));
    labels.insert(
        "jjdr.agent".into(),
        json!(if is_plain_shell { "shell" } else { argv[0].as_str() }),
    );
    if let Some(pid) = input.project_id {
        labels.insert("jjdr.project".into(), json!(pid));
    }
    if let Some(br) = input.branch {
        labels.insert("jjdr.branch".into(), json!(br));
    }

    let mut params = json!({
        "cwd": cwd,
        "labels": labels,
        "outlive_parent": true,
        "no_parent": true,
        "keep": true,
        "wait": false
    });
    // Omitting `argv` lets herdr-core launch the OS default shell (PowerShell/pwsh on Windows)
    if !argv.is_empty() {
        params["argv"] = json!(argv);
    }
    if let Some(name) = input.name.filter(|s| !s.trim().is_empty()) {
        params["name"] = json!(name);
    }

    let res = state
        .herdr
        .call("terminal.run", params)
        .await
        .map_err(|e| e.to_string())?;

    let address = res
        .get("terminal")
        .and_then(|t| t.get("address"))
        .or_else(|| res.get("address"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    state.hub.sync_terminals_now(&state.herdr).await;

    Ok(address)
}

#[tauri::command]
pub async fn send_terminal_text(
    state: State<'_, AppState>,
    address: String,
    text: String,
    force: Option<bool>,
) -> Result<(), String> {
    state
        .herdr
        .call(
            "terminal.send",
            json!({
                "terminal": address,
                "text": text,
                "force": force.unwrap_or(false)
            }),
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn send_terminal_keys(
    state: State<'_, AppState>,
    address: String,
    keys: Vec<String>,
) -> Result<(), String> {
    state
        .herdr
        .call(
            "terminal.keys",
            json!({
                "terminal": address,
                "keys": keys
            }),
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn interrupt_terminal(
    state: State<'_, AppState>,
    address: String,
) -> Result<(), String> {
    state
        .herdr
        .call("terminal.interrupt", json!({ "terminal": address }))
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn kill_terminal(
    state: State<'_, AppState>,
    address: String,
    remove: Option<bool>,
) -> Result<(), String> {
    let _ = state
        .herdr
        .call("terminal.kill", json!({ "terminal": address }))
        .await;
    if remove.unwrap_or(true) {
        let _ = state
            .herdr
            .call("terminal.rm", json!({ "terminal": address }))
            .await;
    }
    Ok(())
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
    // Hybrid Mode C: by default detach any prior attached terminal immediately to keep WebView memory flat.
    if !keep_existing.unwrap_or(false) {
        state.attach.detach_all(&state.herdr).await;
    }

    let val = state
        .herdr
        .call(
            "terminal.attach",
            json!({
                "terminal": address,
                "cols": cols.max(20),
                "rows": rows.max(5),
                "history": 400,
                "display": {
                    "bg": "#0b0c0e",
                    "fg": "#f4f4f5",
                    "cursor": "#e4e4e7"
                }
            }),
        )
        .await
        .map_err(|e| e.to_string())?;

    let attach_res: AttachResult = serde_json::from_value(val).map_err(|e| e.to_string())?;
    let channel = attach_res.channel;

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

    // Stream raw bytes in 16ms coalesced batches so xterm.js renders smoothly at 60fps.
    let client = state.herdr.clone();
    let addr_clone = address.clone();
    tokio::spawn(async move {
        let mut buf = Vec::<u8>::with_capacity(8192);
        let mut uncredited: u32 = 0;
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
                                if buf.len() >= 16384 {
                                    emit_term_chunk(&app, channel, &addr_clone, &mut buf);
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
                                let _ = app.emit(TERM_CLOSED_EVENT, TermClosedEvent { channel, address: addr_clone.clone() });
                                break;
                            }
                            _ => {}
                        },
                        None => {
                            if !buf.is_empty() {
                                emit_term_chunk(&app, channel, &addr_clone, &mut buf);
                            }
                            let _ = app.emit(TERM_CLOSED_EVENT, TermClosedEvent { channel, address: addr_clone.clone() });
                            break;
                        }
                    }
                }
                _ = flush_tick.tick() => {
                    if !buf.is_empty() {
                        emit_term_chunk(&app, channel, &addr_clone, &mut buf);
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
    let _ = app.emit(
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
    state
        .herdr
        .send_frame(Frame::data(channel, data.into_bytes()))
        .await
        .map_err(|e| e.to_string())
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

#[tauri::command]
pub async fn popout_external_terminal(address: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        // Prefer Windows Terminal if available, fallback to cmd start
        let wt = std::process::Command::new("wt.exe")
            .args(["hc", "attach", &address])
            .spawn();
        if wt.is_err() {
            std::process::Command::new("cmd")
                .args(["/C", "start", "hc", "attach", &address])
                .spawn()
                .map_err(|e| format!("Failed to open external terminal: {}", e))?;
        }
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        let _ = address;
        Err("External terminal popout is currently configured for Windows.".into())
    }
}
