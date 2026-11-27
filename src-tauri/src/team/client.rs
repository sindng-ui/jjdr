use std::path::Path;
use std::sync::{Arc, Mutex};

use relay_protocol::{ClientMessage, PresenceStatus};
use tokio::sync::{mpsc, watch, RwLock};

use crate::store::projects::PersistenceStore;
use crate::team::identity::{
    collect_project_repo_urls, detect_github_id_via_gh, load_or_create_device_id,
};
use crate::team::outbox::{OutboxPayload, RelayOutbox};
use crate::team::orchestrator::RelayOrchestratorEvent;
use crate::team::TeamConnectionSnapshot;

#[cfg(not(test))]
use std::time::Duration;
#[cfg(not(test))]
use chrono::Utc;
#[cfg(not(test))]
use futures_util::{SinkExt, StreamExt};
#[cfg(not(test))]
use relay_protocol::{normalize_github_id, ServerMessage};
#[cfg(not(test))]
use tauri::{AppHandle, Emitter};
#[cfg(not(test))]
use tokio_tungstenite::tungstenite::Message as WsMessage;
#[cfg(not(test))]
use tracing::{info, warn};
#[cfg(not(test))]
use crate::store::team_settings::TeamOrchestrationSettings;
#[cfg(not(test))]
use crate::team::http::build_ws_url;
#[cfg(not(test))]
use crate::team::{TeamReviewAssignedEvent, TeamReviewCancelledEvent, TeamStatusChangedEvent};

pub struct TeamRelayRuntime {
    device_id: String,
    pub(crate) outbox: Mutex<RelayOutbox>,
    snapshot: RwLock<TeamConnectionSnapshot>,
    detected_github_id: RwLock<Option<String>>,
    #[allow(dead_code)]
    ws_outbound: RwLock<Option<mpsc::UnboundedSender<ClientMessage>>>,
    orchestrator_tx: Mutex<Option<mpsc::UnboundedSender<RelayOrchestratorEvent>>>,
    config_tx: watch::Sender<u64>,
    #[allow(dead_code)]
    config_rx: watch::Receiver<u64>,
}

impl TeamRelayRuntime {
    pub fn new(config_dir: &Path) -> Arc<Self> {
        let device_id = load_or_create_device_id(config_dir);
        let outbox = RelayOutbox::load(config_dir);
        let outbox_pending = outbox.len();
        let (config_tx, config_rx) = watch::channel(0u64);

        Arc::new(Self {
            device_id: device_id.clone(),
            outbox: Mutex::new(outbox),
            snapshot: RwLock::new(TeamConnectionSnapshot {
                enabled: false,
                connected: false,
                state: "disabled".to_string(),
                relay_url: String::new(),
                device_id,
                github_id: None,
                effective_status: PresenceStatus::Offline,
                registered_repos: Vec::new(),
                peers: Vec::new(),
                outbox_pending,
                server_version: None,
                last_error: None,
                last_connected_ms: None,
            }),
            detected_github_id: RwLock::new(None),
            ws_outbound: RwLock::new(None),
            orchestrator_tx: Mutex::new(None),
            config_tx,
            config_rx,
        })
    }

    pub fn attach_orchestrator_tx(&self, tx: mpsc::UnboundedSender<RelayOrchestratorEvent>) {
        if let Ok(mut guard) = self.orchestrator_tx.lock() {
            *guard = Some(tx);
        }
    }

    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    pub fn notify_config_changed(&self) {
        let next = self.config_tx.borrow().wrapping_add(1);
        let _ = self.config_tx.send(next);
    }

    pub async fn snapshot(&self) -> TeamConnectionSnapshot {
        let outbox_pending = self.outbox.lock().map(|o| o.len()).unwrap_or(0);
        let mut snap = self.snapshot.read().await.clone();
        snap.outbox_pending = outbox_pending;
        snap
    }

    pub async fn detect_github_id(&self, store: &PersistenceStore) -> Result<String, String> {
        let projects = store.list_projects().await;
        let repos = collect_project_repo_urls(&projects).await;
        let detected = detect_github_id_via_gh(&repos).await?;
        *self.detected_github_id.write().await = Some(detected.clone());
        {
            let mut snap = self.snapshot.write().await;
            snap.github_id = Some(detected.clone());
            snap.registered_repos = repos;
        }
        Ok(detected)
    }

    /// Enqueue a status report or review request into persistent disk outbox when relay is down.
    pub fn enqueue_outbox(&self, payload: OutboxPayload) {
        if let Ok(mut guard) = self.outbox.lock() {
            guard.enqueue(payload);
        }
    }

    #[cfg(not(test))]
    async fn resolve_github_id(
        &self,
        team: &TeamOrchestrationSettings,
        repos: &[String],
    ) -> Result<String, String> {
        if let Some(manual) = normalize_github_id(&team.github_id_override) {
            return Ok(manual);
        }
        if let Some(cached) = self.detected_github_id.read().await.clone() {
            return Ok(cached);
        }
        let detected = detect_github_id_via_gh(repos).await?;
        *self.detected_github_id.write().await = Some(detected.clone());
        Ok(detected)
    }

    #[cfg(not(test))]
    pub fn spawn_supervisor(
        self: &Arc<Self>,
        app: AppHandle,
        store: Arc<PersistenceStore>,
    ) {
        let runtime = Arc::clone(self);
        let mut config_rx = self.config_rx.clone();

        tauri::async_runtime::spawn(async move {
            let mut backoff_secs = 1u64;

            loop {
                let team = store.get_settings().await.team;
                if !team.is_connectable() {
                    runtime.set_disabled_state(&app, &team).await;
                    backoff_secs = 1;
                    if config_rx.changed().await.is_err() {
                        break;
                    }
                    continue;
                }

                let projects = store.list_projects().await;
                let repos = collect_project_repo_urls(&projects).await;
                let base_url = team.normalized_relay_base_url().unwrap_or_default();

                let github_id = match runtime.resolve_github_id(&team, &repos).await {
                    Ok(id) => id,
                    Err(err) => {
                        runtime
                            .set_error_state(
                                &app,
                                &team,
                                &base_url,
                                repos,
                                format!("GitHub ID detection failed: {}", err),
                            )
                            .await;
                        if wait_backoff_or_config(&mut config_rx, &mut backoff_secs).await {
                            break;
                        }
                        continue;
                    }
                };

                let Some(ws_url) = build_ws_url(&base_url, &team.team_key) else {
                    if config_rx.changed().await.is_err() {
                        break;
                    }
                    continue;
                };

                runtime
                    .set_connecting_state(&app, &team, &base_url, &github_id, repos.clone())
                    .await;

                let ws_stream = match tokio::time::timeout(
                    Duration::from_secs(6),
                    tokio_tungstenite::connect_async(&ws_url),
                )
                .await
                {
                    Ok(Ok((stream, _))) => {
                        backoff_secs = 1;
                        stream
                    }
                    Ok(Err(err)) => {
                        runtime
                            .set_error_state(
                                &app,
                                &team,
                                &base_url,
                                repos,
                                format!("WebSocket connect failed: {}", err),
                            )
                            .await;
                        if wait_backoff_or_config(&mut config_rx, &mut backoff_secs).await {
                            break;
                        }
                        continue;
                    }
                    Err(_) => {
                        runtime
                            .set_error_state(
                                &app,
                                &team,
                                &base_url,
                                repos,
                                "WebSocket connect timed out (6s)".to_string(),
                            )
                            .await;
                        if wait_backoff_or_config(&mut config_rx, &mut backoff_secs).await {
                            break;
                        }
                        continue;
                    }
                };

                let conn_key = (
                    base_url.clone(),
                    team.team_key.trim().to_string(),
                    github_id.clone(),
                );
                let initial_status = if team.auto_review_paused {
                    PresenceStatus::Paused
                } else {
                    PresenceStatus::Online
                };

                let (mut ws_tx, mut ws_rx) = ws_stream.split();
                let (out_tx, mut out_rx) = mpsc::unbounded_channel::<ClientMessage>();
                *runtime.ws_outbound.write().await = Some(out_tx.clone());

                let _ = out_tx.send(ClientMessage::Hello {
                    github_id: github_id.clone(),
                    display_name: non_empty(&team.display_name),
                    status: initial_status,
                    repo_urls: repos.clone(),
                    client_version: Some(env!("CARGO_PKG_VERSION").to_string()),
                    device_id: Some(runtime.device_id.clone()),
                });

                let writer = tauri::async_runtime::spawn(async move {
                    while let Some(msg) = out_rx.recv().await {
                        if let Ok(text) = serde_json::to_string(&msg) {
                            if ws_tx.send(WsMessage::Text(text.into())).await.is_err() {
                                break;
                            }
                        }
                    }
                });

                info!("Connected to jjdr-relay at {} as @{}", base_url, github_id);

                loop {
                    tokio::select! {
                        changed = config_rx.changed() => {
                            if changed.is_err() {
                                break;
                            }
                            let latest = store.get_settings().await.team;
                            if !latest.is_connectable() {
                                break;
                            }
                            let latest_base = latest.normalized_relay_base_url().unwrap_or_default();
                            let latest_projects = store.list_projects().await;
                            let latest_repos = collect_project_repo_urls(&latest_projects).await;
                            let latest_gh = runtime
                                .resolve_github_id(&latest, &latest_repos)
                                .await
                                .unwrap_or_else(|_| github_id.clone());

                            if (latest_base, latest.team_key.trim().to_string(), latest_gh) != conn_key {
                                break;
                            }

                            let next_status = if latest.auto_review_paused {
                                PresenceStatus::Paused
                            } else {
                                PresenceStatus::Online
                            };
                            let _ = out_tx.send(ClientMessage::UpdatePresence {
                                status: next_status,
                                repo_urls: Some(latest_repos.clone()),
                                display_name: non_empty(&latest.display_name),
                            });
                            {
                                let mut snap = runtime.snapshot.write().await;
                                snap.effective_status = next_status;
                                snap.state = status_label(next_status);
                                snap.registered_repos = latest_repos;
                            }
                            runtime.emit_snapshot(&app).await;
                        }
                        frame = ws_rx.next() => {
                            let Some(Ok(msg)) = frame else {
                                break;
                            };
                            let WsMessage::Text(text) = msg else {
                                if matches!(msg, WsMessage::Close(_)) {
                                    break;
                                }
                                continue;
                            };
                            let Ok(parsed) = serde_json::from_str::<ServerMessage>(&text) else {
                                continue;
                            };
                            runtime
                                .handle_server_message(&app, &store, &out_tx, parsed)
                                .await;
                        }
                    }
                }

                *runtime.ws_outbound.write().await = None;
                drop(out_tx);
                writer.abort();

                let latest = store.get_settings().await.team;
                if !latest.is_connectable() {
                    runtime.set_disabled_state(&app, &latest).await;
                    continue;
                }

                runtime
                    .set_error_state(
                        &app,
                        &latest,
                        &base_url,
                        repos,
                        "Relay disconnected; reconnecting...".to_string(),
                    )
                    .await;

                if wait_backoff_or_config(&mut config_rx, &mut backoff_secs).await {
                    break;
                }
            }
        });
    }

    #[cfg(not(test))]
    async fn handle_server_message(
        self: &Arc<Self>,
        app: &AppHandle,
        store: &Arc<PersistenceStore>,
        out_tx: &mpsc::UnboundedSender<ClientMessage>,
        parsed: ServerMessage,
    ) {
        match parsed {
            ServerMessage::Welcome {
                server_version,
                github_id: confirmed_id,
                peers,
                ..
            } => {
                let latest_team = store.get_settings().await.team;
                let eff = if latest_team.auto_review_paused {
                    PresenceStatus::Paused
                } else {
                    PresenceStatus::Online
                };
                {
                    let mut snap = self.snapshot.write().await;
                    snap.connected = true;
                    snap.state = status_label(eff);
                    snap.github_id = Some(confirmed_id);
                    snap.effective_status = eff;
                    snap.peers = peers;
                    snap.server_version = Some(server_version);
                    snap.last_error = None;
                    snap.last_connected_ms = Some(Utc::now().timestamp_millis());
                }
                let rt_flush = Arc::clone(self);
                let app_flush = app.clone();
                tauri::async_runtime::spawn(async move {
                    let flushed = rt_flush.flush_outbox(&latest_team).await;
                    if flushed > 0 {
                        info!("Flushed {} queued relay outbox item(s)", flushed);
                        rt_flush.emit_snapshot(&app_flush).await;
                    }
                });
                self.emit_snapshot(app).await;
            }
            ServerMessage::PeersUpdated { peers } => {
                {
                    let mut snap = self.snapshot.write().await;
                    snap.peers = peers;
                }
                self.emit_snapshot(app).await;
            }
            ServerMessage::ReviewAssigned {
                request,
                assignment,
            } => {
                let _ = out_tx.send(ClientMessage::AckDelivery {
                    request_id: request.request_id.clone(),
                });
                if let Ok(guard) = self.orchestrator_tx.lock() {
                    if let Some(ref orch_tx) = *guard {
                        let _ = orch_tx.send(RelayOrchestratorEvent::ReviewAssigned(request.clone()));
                    }
                }
                let _ = app.emit_to(
                    "main",
                    "jjdr:team-review-assigned",
                    TeamReviewAssignedEvent {
                        request,
                        assignment,
                    },
                );
            }
            ServerMessage::AssignmentStatusChanged {
                request_id,
                repo_url,
                pr_number,
                head_sha,
                reviewer_id,
                status,
                reject_reason,
                detail,
                worker_agent,
                updated_ms,
            } => {
                let _ = app.emit_to(
                    "main",
                    "jjdr:team-status-changed",
                    TeamStatusChangedEvent {
                        request_id,
                        repo_url,
                        pr_number,
                        head_sha,
                        reviewer_id,
                        status,
                        reject_reason,
                        detail,
                        worker_agent,
                        updated_ms,
                    },
                );
            }
            ServerMessage::ReviewCancelled {
                request_id,
                repo_url,
                pr_number,
                reviewer_id,
                reason,
                updated_ms,
            } => {
                if let Ok(guard) = self.orchestrator_tx.lock() {
                    if let Some(ref orch_tx) = *guard {
                        let _ = orch_tx.send(RelayOrchestratorEvent::ReviewCancelled {
                            request_id: request_id.clone(),
                        });
                    }
                }
                let _ = app.emit_to(
                    "main",
                    "jjdr:team-review-cancelled",
                    TeamReviewCancelledEvent {
                        request_id,
                        repo_url,
                        pr_number,
                        reviewer_id,
                        reason,
                        updated_ms,
                    },
                );
            }
            ServerMessage::Error { code, message } => {
                warn!("Relay WS error ({}): {}", code, message);
            }
            ServerMessage::Pong { .. } => {}
        }
    }

    #[cfg(not(test))]
    async fn emit_snapshot(&self, app: &AppHandle) {
        let snap = self.snapshot().await;
        let _ = app.emit_to("main", "jjdr:team-state-changed", snap);
    }

    #[cfg(not(test))]
    async fn set_disabled_state(&self, app: &AppHandle, team: &TeamOrchestrationSettings) {
        {
            let mut snap = self.snapshot.write().await;
            snap.enabled = team.enabled;
            snap.connected = false;
            snap.state = "disabled".to_string();
            snap.relay_url = team.relay_url.clone();
            snap.effective_status = PresenceStatus::Offline;
            snap.peers.clear();
            snap.last_error = if team.enabled && !team.is_connectable() {
                Some("Relay URL and Team Key are required".to_string())
            } else {
                None
            };
        }
        self.emit_snapshot(app).await;
    }

    #[cfg(not(test))]
    async fn set_connecting_state(
        &self,
        app: &AppHandle,
        team: &TeamOrchestrationSettings,
        base_url: &str,
        github_id: &str,
        repos: Vec<String>,
    ) {
        {
            let mut snap = self.snapshot.write().await;
            snap.enabled = team.enabled;
            snap.connected = false;
            snap.state = "connecting".to_string();
            snap.relay_url = base_url.to_string();
            snap.github_id = Some(github_id.to_string());
            snap.registered_repos = repos;
            snap.last_error = None;
        }
        self.emit_snapshot(app).await;
    }

    #[cfg(not(test))]
    async fn set_error_state(
        &self,
        app: &AppHandle,
        team: &TeamOrchestrationSettings,
        base_url: &str,
        repos: Vec<String>,
        err: String,
    ) {
        {
            let mut snap = self.snapshot.write().await;
            snap.enabled = team.enabled;
            snap.connected = false;
            snap.state = "error".to_string();
            snap.relay_url = base_url.to_string();
            snap.effective_status = PresenceStatus::Offline;
            snap.registered_repos = repos;
            snap.last_error = Some(err);
        }
        self.emit_snapshot(app).await;
    }
}

#[cfg(not(test))]
fn non_empty(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(not(test))]
fn status_label(st: PresenceStatus) -> String {
    if st == PresenceStatus::Paused {
        "paused".to_string()
    } else {
        "connected".to_string()
    }
}

#[cfg(not(test))]
async fn wait_backoff_or_config(
    config_rx: &mut watch::Receiver<u64>,
    backoff_secs: &mut u64,
) -> bool {
    tokio::select! {
        _ = tokio::time::sleep(Duration::from_secs((*backoff_secs).min(30))) => {
            *backoff_secs = (*backoff_secs * 2).min(30);
            false
        }
        res = config_rx.changed() => {
            *backoff_secs = 1;
            res.is_err()
        }
    }
}
