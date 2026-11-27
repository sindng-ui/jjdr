#![allow(dead_code)]

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use jjdr_relay::config::RelayConfig;
use jjdr_relay::RelayApp;
use relay_protocol::{ClientMessage, CreateReviewRequestBody, PresenceStatus, ServerMessage};
use tempfile::TempDir;
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

pub type WsStream = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

pub struct TestServer {
    pub addr: SocketAddr,
    pub team_key: String,
    pub app: Arc<RelayApp>,
    server_task: tokio::task::JoinHandle<()>,
    _temp_dir: Option<TempDir>,
    db_path: PathBuf,
}

impl TestServer {
    pub async fn start_with_config(mut cfg: RelayConfig, temp_dir: Option<TempDir>) -> Self {
        let db_path = cfg.db_path.clone();
        let team_key = cfg.team_key.clone();
        cfg.bind_addr = "127.0.0.1:0".to_string();

        let app = RelayApp::new(cfg).expect("init relay app");
        let router = app.router();
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind port 0");
        let addr = listener.local_addr().expect("local addr");

        let server_task = tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });

        Self {
            addr,
            team_key,
            app,
            server_task,
            _temp_dir: temp_dir,
            db_path,
        }
    }

    pub async fn start() -> Self {
        Self::start_custom(48, 100).await
    }

    pub async fn start_custom(ttl_hours: u64, rate_limit_per_min: u32) -> Self {
        Self::start_with_heartbeat(ttl_hours, rate_limit_per_min, 30, 60).await
    }

    pub async fn start_with_heartbeat(
        ttl_hours: u64,
        rate_limit_per_min: u32,
        ws_ping_interval_secs: u64,
        ws_pong_timeout_secs: u64,
    ) -> Self {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join("relay.db");
        let cfg = RelayConfig {
            bind_addr: "127.0.0.1:0".to_string(),
            db_path,
            team_key: "test-secret-key".to_string(),
            ttl_hours,
            ttl_sweep_interval_secs: 3600,
            rate_limit_per_min,
            max_reviewers_per_request: 5,
            ws_ping_interval_secs,
            ws_pong_timeout_secs,
        };
        Self::start_with_config(cfg, Some(dir)).await
    }

    pub fn http_url(&self, path: &str) -> String {
        format!("http://{}{}", self.addr, path)
    }

    pub fn ws_url(&self, key: &str) -> String {
        format!("ws://{}/ws?team_key={}", self.addr, key)
    }

    pub fn shutdown(mut self) -> (PathBuf, Option<TempDir>) {
        self.server_task.abort();
        (self.db_path.clone(), self._temp_dir.take())
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.server_task.abort();
    }
}

pub async fn connect_ws(server: &TestServer) -> WsStream {
    let (stream, _) = connect_async(server.ws_url(&server.team_key))
        .await
        .expect("ws connect");
    stream
}

pub async fn send_ws(ws: &mut WsStream, msg: &ClientMessage) {
    let text = serde_json::to_string(msg).expect("serialize client msg");
    ws.send(WsMessage::Text(text.into()))
        .await
        .expect("ws send");
}

pub async fn recv_ws_timeout(ws: &mut WsStream, ms: u64) -> Option<ServerMessage> {
    let fut = async {
        while let Some(frame) = ws.next().await {
            match frame {
                Ok(WsMessage::Text(t)) => {
                    let parsed: ServerMessage =
                        serde_json::from_str(&t).expect("valid server json");
                    return Some(parsed);
                }
                Ok(WsMessage::Close(_)) | Err(_) => return None,
                _ => continue,
            }
        }
        None
    };
    tokio::time::timeout(Duration::from_millis(ms), fut)
        .await
        .ok()
        .flatten()
}

pub async fn recv_until<F>(ws: &mut WsStream, ms: u64, mut pred: F) -> ServerMessage
where
    F: FnMut(&ServerMessage) -> bool,
{
    let deadline = tokio::time::Instant::now() + Duration::from_millis(ms);
    loop {
        let rem = deadline.saturating_duration_since(tokio::time::Instant::now());
        if rem.is_zero() {
            panic!("timed out waiting for expected ServerMessage");
        }
        let msg = recv_ws_timeout(ws, rem.as_millis() as u64)
            .await
            .expect("expected message before timeout/close");
        if pred(&msg) {
            return msg;
        }
    }
}

pub async fn hello_peer(
    server: &TestServer,
    github_id: &str,
    status: PresenceStatus,
    repos: &[&str],
) -> WsStream {
    hello_peer_device(server, github_id, status, repos, None).await
}

pub async fn hello_peer_device(
    server: &TestServer,
    github_id: &str,
    status: PresenceStatus,
    repos: &[&str],
    device_id: Option<&str>,
) -> WsStream {
    let mut ws = connect_ws(server).await;
    send_ws(
        &mut ws,
        &ClientMessage::Hello {
            github_id: github_id.to_string(),
            display_name: Some(format!("User {}", github_id)),
            status,
            repo_urls: repos.iter().map(|s| s.to_string()).collect(),
            client_version: Some("0.4.11".to_string()),
            device_id: device_id.map(|s| s.to_string()),
        },
    )
    .await;
    let welcome = recv_until(&mut ws, 2000, |m| {
        matches!(m, ServerMessage::Welcome { .. })
    })
    .await;
    assert!(matches!(welcome, ServerMessage::Welcome { .. }));
    ws
}

pub fn sample_review_body(
    author: &str,
    reviewers: &[&str],
    pr_number: u64,
    sha: &str,
    repo_url: &str,
) -> CreateReviewRequestBody {
    CreateReviewRequestBody {
        repo_url: repo_url.to_string(),
        pr_number,
        pr_url: format!("https://github.corp.company.com/team/jjdr/pull/{}", pr_number),
        pr_title: format!("feat: sample PR #{}", pr_number),
        base_branch: "main".to_string(),
        head_branch: format!("feat/pr-{}", pr_number),
        head_sha: sha.to_string(),
        author_id: author.to_string(),
        reviewers: reviewers.iter().map(|s| s.to_string()).collect(),
    }
}
