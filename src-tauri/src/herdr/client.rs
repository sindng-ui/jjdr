use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, Mutex, RwLock};
use tracing::{debug, info, warn};

use super::protocol::{read_frame, write_frame, Frame, FrameKind, RPC_CHANNEL};
use super::types::{HelloResult, HerdrHealth};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Error)]
pub enum HerdrError {
    #[error("hc binary not found in PATH")]
    HcNotFound,
    #[error("not connected to herdr-core")]
    NotConnected,
    #[error("RPC error ({code}): {message}")]
    Rpc {
        code: i64,
        message: String,
        kind: Option<String>,
        hint: Option<String>,
    },
    #[error("request timed out")]
    Timeout,
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("protocol error: {0}")]
    Protocol(String),
    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),
}

struct ActiveConnection {
    tx: mpsc::UnboundedSender<Frame>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, HerdrError>>>>>,
    channels: Arc<RwLock<HashMap<u32, mpsc::UnboundedSender<Frame>>>>,
    early_frames: Arc<Mutex<HashMap<u32, Vec<Frame>>>>,
    child: Arc<Mutex<Option<Child>>>,
}

pub struct HerdrClient {
    conn: RwLock<Option<Arc<ActiveConnection>>>,
    next_id: AtomicU64,
    health: RwLock<HerdrHealth>,
    connect_lock: Mutex<()>,
}

impl HerdrClient {
    pub fn new() -> Self {
        Self {
            conn: RwLock::new(None),
            next_id: AtomicU64::new(1),
            health: RwLock::new(HerdrHealth::default()),
            connect_lock: Mutex::new(()),
        }
    }

    pub async fn health(&self) -> HerdrHealth {
        self.health.read().await.clone()
    }

    pub async fn is_connected(&self) -> bool {
        self.conn.read().await.is_some()
    }

    /// Check whether `hc` exists and attempt to ensure herdr-core daemon is running.
    pub async fn ensure_daemon(&self) -> Result<(), HerdrError> {
        let mut status_cmd = build_hc_command();
        status_cmd.args(["server", "status", "--json"]);
        let output = match status_cmd.output().await {
            Ok(out) => out,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                self.set_health(HerdrHealth {
                    connected: false,
                    hc_found: false,
                    error: Some("hc CLI was not found in PATH.".into()),
                    hint: Some("Install herdr-core so `hc` is available in PATH.".into()),
                    ..Default::default()
                })
                .await;
                return Err(HerdrError::HcNotFound);
            }
            Err(err) => return Err(HerdrError::Io(err)),
        };

        if output.status.success() {
            return Ok(());
        }

        // Daemon might not be running yet; try starting it cleanly once.
        let stderr_text = String::from_utf8_lossy(&output.stderr).to_string();
        if stderr_text.contains("os error 5") || stderr_text.contains("elevated") {
            self.set_health(HerdrHealth {
                connected: false,
                hc_found: true,
                error: Some("Cannot access herdr-core pipe (permission/elevation mismatch).".into()),
                hint: Some(
                    "Ensure herdr-core and jjdr run under the same Windows privilege level."
                        .into(),
                ),
                ..Default::default()
            })
            .await;
            return Err(HerdrError::Protocol(stderr_text));
        }

        info!("herdr-core daemon not active; attempting `hc server start`");
        let mut start_cmd = build_hc_command();
        start_cmd.args(["server", "start"]);
        let _ = start_cmd.output().await;
        Ok(())
    }

    pub async fn connect(&self) -> Result<HelloResult, HerdrError> {
        let _guard = self.connect_lock.lock().await;
        self.disconnect_inner().await;

        self.ensure_daemon().await?;

        let mut cmd = build_hc_command();
        cmd.args(["connect"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Err(HerdrError::HcNotFound);
            }
            Err(e) => return Err(HerdrError::Io(e)),
        };

        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| HerdrError::Protocol("missing hc stdin".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| HerdrError::Protocol("missing hc stdout".into()))?;
        let stderr = child.stderr.take();

        if let Some(err_stream) = stderr {
            tokio::spawn(async move {
                let mut reader = BufReader::new(err_stream);
                let mut line = String::new();
                while let Ok(n) = reader.read_line(&mut line).await {
                    if n == 0 {
                        break;
                    }
                    debug!("hc connect stderr: {}", line.trim());
                    line.clear();
                }
            });
        }

        // Plain-mode handshake requesting switch to framed binary mode.
        let hello_id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let hello_req = json!({
            "jsonrpc": "2.0",
            "id": hello_id,
            "method": "hello",
            "params": {
                "framed": true
            }
        });
        let mut req_line = serde_json::to_string(&hello_req)?;
        req_line.push('\n');
        stdin.write_all(req_line.as_bytes()).await?;
        stdin.flush().await?;

        let mut buf_stdout = BufReader::new(stdout);
        let mut reply_line = String::new();
        let read_res = tokio::time::timeout(
            Duration::from_secs(8),
            buf_stdout.read_line(&mut reply_line),
        )
        .await;

        match read_res {
            Ok(Ok(0)) => {
                let _ = child.kill().await;
                let msg = "hc connect closed before hello reply".to_string();
                self.set_disconnected_error(msg.clone(), None).await;
                return Err(HerdrError::Protocol(msg));
            }
            Ok(Ok(_)) => {}
            Ok(Err(e)) => {
                let _ = child.kill().await;
                self.set_disconnected_error(e.to_string(), None).await;
                return Err(HerdrError::Io(e));
            }
            Err(_) => {
                let _ = child.kill().await;
                let msg = "Timed out waiting for herdr-core hello handshake".to_string();
                self.set_disconnected_error(msg.clone(), None).await;
                return Err(HerdrError::Timeout);
            }
        }

        let reply_val: Value = serde_json::from_str(reply_line.trim())?;
        if let Some(err) = reply_val.get("error") {
            let _ = child.kill().await;
            let parsed = parse_rpc_error(err);
            self.set_disconnected_error(parsed.to_string(), None).await;
            return Err(parsed);
        }

        let hello: HelloResult = serde_json::from_value(
            reply_val
                .get("result")
                .cloned()
                .ok_or_else(|| HerdrError::Protocol("missing hello result".into()))?,
        )?;

        if !hello.framed {
            let _ = child.kill().await;
            let msg = "herdr-core declined framed mode".to_string();
            self.set_disconnected_error(msg.clone(), None).await;
            return Err(HerdrError::Protocol(msg));
        }

        let (tx, mut rx) = mpsc::unbounded_channel::<Frame>();
        let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, HerdrError>>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let channels: Arc<RwLock<HashMap<u32, mpsc::UnboundedSender<Frame>>>> =
            Arc::new(RwLock::new(HashMap::new()));
        let early_frames: Arc<Mutex<HashMap<u32, Vec<Frame>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let child_arc = Arc::new(Mutex::new(Some(child)));

        let active = Arc::new(ActiveConnection {
            tx,
            pending: pending.clone(),
            channels: channels.clone(),
            early_frames: early_frames.clone(),
            child: child_arc.clone(),
        });

        // Writer loop
        tokio::spawn(async move {
            while let Some(frame) = rx.recv().await {
                if let Err(err) = write_frame(&mut stdin, &frame).await {
                    warn!("herdr framed writer ended: {}", err);
                    break;
                }
            }
        });

        // Reader loop
        let pending_r = pending.clone();
        let channels_r = channels.clone();
        let early_r = early_frames.clone();
        tokio::spawn(async move {
            loop {
                match read_frame(&mut buf_stdout).await {
                    Ok(frame) => {
                        if frame.channel == RPC_CHANNEL && frame.kind == FrameKind::Data {
                            handle_rpc_frame(&pending_r, &frame.payload).await;
                        } else {
                            let target = { channels_r.read().await.get(&frame.channel).cloned() };
                            if let Some(ch_tx) = target {
                                let _ = ch_tx.send(frame);
                            } else {
                                // Buffer frames that arrive before register_channel (e.g. first paint on attach)
                                let mut early = early_r.lock().await;
                                let entry = early.entry(frame.channel).or_default();
                                if entry.len() < 1024 {
                                    entry.push(frame);
                                }
                            }
                        }
                    }
                    Err(err) => {
                        warn!("herdr framed reader ended: {}", err);
                        break;
                    }
                }
            }
            // Wake up any awaiting RPC calls with disconnect error
            let mut map = pending_r.lock().await;
            for (_, waiter) in map.drain() {
                let _ = waiter.send(Err(HerdrError::NotConnected));
            }
            channels_r.write().await.clear();
            early_r.lock().await.clear();
        });

        *self.conn.write().await = Some(active);
        self.set_health(HerdrHealth {
            connected: true,
            hc_found: true,
            version: Some(hello.version.clone()),
            core_name: Some(hello.core.name.clone()),
            error: None,
            hint: None,
        })
        .await;

        info!(
            "Connected to herdr-core {} (core={})",
            hello.version, hello.core.name
        );
        Ok(hello)
    }

    pub async fn call(&self, method: &str, params: Value) -> Result<Value, HerdrError> {
        let active = self
            .conn
            .read()
            .await
            .clone()
            .ok_or(HerdrError::NotConnected)?;

        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let req = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });
        let bytes = serde_json::to_vec(&req)?;

        let (resp_tx, resp_rx) = oneshot::channel();
        active.pending.lock().await.insert(id, resp_tx);

        if active.tx.send(Frame::data(RPC_CHANNEL, bytes)).is_err() {
            active.pending.lock().await.remove(&id);
            return Err(HerdrError::NotConnected);
        }

        match tokio::time::timeout(Duration::from_secs(20), resp_rx).await {
            Ok(Ok(res)) => res,
            Ok(Err(_)) => Err(HerdrError::NotConnected),
            Err(_) => {
                active.pending.lock().await.remove(&id);
                Err(HerdrError::Timeout)
            }
        }
    }

    pub async fn send_frame(&self, frame: Frame) -> Result<(), HerdrError> {
        let active = self
            .conn
            .read()
            .await
            .clone()
            .ok_or(HerdrError::NotConnected)?;
        active
            .tx
            .send(frame)
            .map_err(|_| HerdrError::NotConnected)
    }

    pub async fn register_channel(
        &self,
        channel: u32,
    ) -> Result<mpsc::UnboundedReceiver<Frame>, HerdrError> {
        let active = self
            .conn
            .read()
            .await
            .clone()
            .ok_or(HerdrError::NotConnected)?;
        let (tx, rx) = mpsc::unbounded_channel();
        // Register first, then flush any early frames so ordering is preserved.
        let buffered = active.early_frames.lock().await.remove(&channel);
        if let Some(frames) = buffered {
            for f in frames {
                let _ = tx.send(f);
            }
        }
        active.channels.write().await.insert(channel, tx);
        Ok(rx)
    }

    pub async fn unregister_channel(&self, channel: u32) {
        if let Some(active) = self.conn.read().await.clone() {
            active.channels.write().await.remove(&channel);
            active.early_frames.lock().await.remove(&channel);
        }
    }

    /// Gracefully disconnect only our `hc connect` bridge so herdr-core and all AI sessions keep running.
    pub async fn disconnect(&self) {
        let _guard = self.connect_lock.lock().await;
        self.disconnect_inner().await;
    }

    async fn disconnect_inner(&self) {
        let prev = self.conn.write().await.take();
        if let Some(active) = prev {
            active.channels.write().await.clear();
            let mut child_guard = active.child.lock().await;
            if let Some(mut c) = child_guard.take() {
                let _ = c.kill().await;
            }
        }
    }

    pub async fn set_disconnected_error(&self, error: String, hint: Option<String>) {
        let mut h = self.health.write().await;
        h.connected = false;
        h.error = Some(error);
        h.hint = hint;
    }

    async fn set_health(&self, health: HerdrHealth) {
        *self.health.write().await = health;
    }
}

async fn handle_rpc_frame(
    pending: &Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, HerdrError>>>>>,
    payload: &[u8],
) {
    let val: Value = match serde_json::from_slice(payload) {
        Ok(v) => v,
        Err(err) => {
            warn!("failed to parse RPC frame JSON: {}", err);
            return;
        }
    };

    if let Some(id) = val.get("id").and_then(|v| v.as_u64()) {
        let waiter = pending.lock().await.remove(&id);
        if let Some(tx) = waiter {
            if let Some(err_obj) = val.get("error") {
                let _ = tx.send(Err(parse_rpc_error(err_obj)));
            } else {
                let result = val.get("result").cloned().unwrap_or(Value::Null);
                let _ = tx.send(Ok(result));
            }
        }
    }
}

fn parse_rpc_error(err: &Value) -> HerdrError {
    let code = err.get("code").and_then(|v| v.as_i64()).unwrap_or(-32000);
    let message = err
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown RPC error")
        .to_string();
    let kind = err
        .get("data")
        .and_then(|d| d.get("kind"))
        .and_then(|v| v.as_str())
        .map(String::from);
    let hint = err
        .get("data")
        .and_then(|d| d.get("hint"))
        .and_then(|v| v.as_str())
        .map(String::from);
    HerdrError::Rpc {
        code,
        message,
        kind,
        hint,
    }
}

pub fn build_hc_command() -> Command {
    let mut cmd = Command::new("hc");
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}
