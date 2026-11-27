use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use relay_protocol::{
    CancelReviewRequestBody, ClientMessage, CreateReviewRequestBody, HealthResponse,
    ServerMessage, SyncActiveRequestsBody, UpdateAssignmentStatusBody, PROTOCOL_VERSION,
};
use serde::Deserialize;
use serde_json::json;
use tokio::sync::mpsc;

use crate::auth::verify_team_key;
use crate::service::{now_ms, ServiceError};
use crate::{RelayApp, SERVER_VERSION};

#[derive(Debug, Deserialize)]
struct WsAuthQuery {
    team_key: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AuthoredQuery {
    limit: Option<usize>,
}

enum OutboundFrame {
    Server(ServerMessage),
    Ping,
}

pub fn build_router(app: Arc<RelayApp>) -> Router {
    Router::new()
        .route("/health", get(health_handler))
        .route("/ws", get(ws_handler))
        .route("/api/v1/peers", get(list_peers_handler))
        .route("/api/v1/reviews", post(create_review_handler))
        .route(
            "/api/v1/reviews/sync-active",
            post(sync_active_handler),
        )
        .route(
            "/api/v1/reviews/{request_id}/status",
            post(update_status_handler),
        )
        .route(
            "/api/v1/reviews/{request_id}/cancel",
            post(cancel_review_handler),
        )
        .route(
            "/api/v1/reviews/authored/{github_id}",
            get(list_authored_handler),
        )
        .route(
            "/api/v1/reviews/inbox/{github_id}",
            get(list_inbox_handler),
        )
        .with_state(app)
}

fn check_auth(app: &RelayApp, headers: &HeaderMap, query_key: Option<&str>) -> Result<(), Response> {
    let header_key = headers
        .get("x-team-key")
        .and_then(|v| v.to_str().ok())
        .or_else(|| {
            headers
                .get("authorization")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.strip_prefix("Bearer "))
        });

    let provided = header_key.or(query_key);
    if verify_team_key(&app.config.team_key, provided) {
        Ok(())
    } else {
        Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "unauthorized", "message": "invalid or missing team key" })),
        )
            .into_response())
    }
}

fn service_error_response(err: ServiceError) -> Response {
    match err {
        ServiceError::BadRequest(msg) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "bad_request", "message": msg })),
        )
            .into_response(),
        ServiceError::Forbidden(msg) => (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "forbidden", "message": msg })),
        )
            .into_response(),
        ServiceError::NotFound(msg) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "not_found", "message": msg })),
        )
            .into_response(),
        ServiceError::Conflict(msg) => (
            StatusCode::CONFLICT,
            Json(json!({ "error": "conflict", "message": msg })),
        )
            .into_response(),
        ServiceError::RateLimited { retry_after_secs } => (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({
                "error": "rate_limited",
                "message": format!("rate limit exceeded; retry after {}s", retry_after_secs),
                "retry_after_secs": retry_after_secs
            })),
        )
            .into_response(),
        ServiceError::Internal(msg) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "internal_error", "message": msg })),
        )
            .into_response(),
    }
}

async fn health_handler(State(app): State<Arc<RelayApp>>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        version: SERVER_VERSION.to_string(),
        protocol_version: PROTOCOL_VERSION,
        online_peers: app.service.hub.online_count().await,
        uptime_secs: app.started_at.elapsed().as_secs(),
    })
}

async fn list_peers_handler(
    State(app): State<Arc<RelayApp>>,
    headers: HeaderMap,
) -> Response {
    if let Err(resp) = check_auth(&app, &headers, None) {
        return resp;
    }
    match app.service.list_peers().await {
        Ok(peers) => Json(peers).into_response(),
        Err(err) => service_error_response(err),
    }
}

async fn create_review_handler(
    State(app): State<Arc<RelayApp>>,
    headers: HeaderMap,
    Json(body): Json<CreateReviewRequestBody>,
) -> Response {
    if let Err(resp) = check_auth(&app, &headers, None) {
        return resp;
    }
    match app.service.submit_review_request(body).await {
        Ok(res) => (StatusCode::CREATED, Json(res)).into_response(),
        Err(err) => service_error_response(err),
    }
}

async fn sync_active_handler(
    State(app): State<Arc<RelayApp>>,
    headers: HeaderMap,
    Json(body): Json<SyncActiveRequestsBody>,
) -> Response {
    if let Err(resp) = check_auth(&app, &headers, None) {
        return resp;
    }
    match app.service.sync_active_requests(body).await {
        Ok(res) => Json(res).into_response(),
        Err(err) => service_error_response(err),
    }
}

async fn update_status_handler(
    State(app): State<Arc<RelayApp>>,
    headers: HeaderMap,
    Path(request_id): Path<String>,
    Json(body): Json<UpdateAssignmentStatusBody>,
) -> Response {
    if let Err(resp) = check_auth(&app, &headers, None) {
        return resp;
    }
    match app
        .service
        .report_assignment_status(
            &request_id,
            &body.reviewer_id,
            body.status,
            body.reject_reason,
            body.detail,
            body.worker_agent,
            body.device_id,
        )
        .await
    {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(err) => service_error_response(err),
    }
}

async fn cancel_review_handler(
    State(app): State<Arc<RelayApp>>,
    headers: HeaderMap,
    Path(request_id): Path<String>,
    Json(body): Json<CancelReviewRequestBody>,
) -> Response {
    if let Err(resp) = check_auth(&app, &headers, None) {
        return resp;
    }
    match app.service.cancel_review_request(&request_id, body).await {
        Ok(res) => Json(res).into_response(),
        Err(err) => service_error_response(err),
    }
}

async fn list_authored_handler(
    State(app): State<Arc<RelayApp>>,
    headers: HeaderMap,
    Path(github_id): Path<String>,
    Query(query): Query<AuthoredQuery>,
) -> Response {
    if let Err(resp) = check_auth(&app, &headers, None) {
        return resp;
    }
    match app
        .service
        .list_authored(&github_id, query.limit.unwrap_or(30))
        .await
    {
        Ok(items) => Json(items).into_response(),
        Err(err) => service_error_response(err),
    }
}

async fn list_inbox_handler(
    State(app): State<Arc<RelayApp>>,
    headers: HeaderMap,
    Path(github_id): Path<String>,
) -> Response {
    if let Err(resp) = check_auth(&app, &headers, None) {
        return resp;
    }
    match app.service.list_inbox(&github_id).await {
        Ok(items) => Json(items).into_response(),
        Err(err) => service_error_response(err),
    }
}

async fn ws_handler(
    State(app): State<Arc<RelayApp>>,
    headers: HeaderMap,
    Query(query): Query<WsAuthQuery>,
    ws: WebSocketUpgrade,
) -> Response {
    if let Err(resp) = check_auth(&app, &headers, query.team_key.as_deref()) {
        return resp;
    }
    ws.on_upgrade(move |socket| handle_ws_connection(app, socket))
}

async fn handle_ws_connection(app: Arc<RelayApp>, socket: WebSocket) {
    let (mut ws_tx, mut ws_rx) = socket.split();
    let (msg_tx, mut msg_rx) = mpsc::unbounded_channel::<ServerMessage>();
    let (frame_tx, mut frame_rx) = mpsc::unbounded_channel::<OutboundFrame>();

    // Forward hub ServerMessages into the unified outbound writer channel.
    let forward_tx = frame_tx.clone();
    let forward_task = tokio::spawn(async move {
        while let Some(msg) = msg_rx.recv().await {
            if forward_tx.send(OutboundFrame::Server(msg)).is_err() {
                break;
            }
        }
    });

    let writer_task = tokio::spawn(async move {
        while let Some(frame) = frame_rx.recv().await {
            let ws_frame = match frame {
                OutboundFrame::Server(msg) => match serde_json::to_string(&msg) {
                    Ok(text) => Message::Text(text.into()),
                    Err(err) => {
                        tracing::warn!("Failed to serialize WS message: {}", err);
                        continue;
                    }
                },
                OutboundFrame::Ping => Message::Ping(Vec::new().into()),
            };
            if ws_tx.send(ws_frame).await.is_err() {
                break;
            }
        }
    });

    let ping_interval_secs = app.config.ws_ping_interval_secs.max(1);
    let pong_timeout = Duration::from_secs(app.config.ws_pong_timeout_secs.max(ping_interval_secs + 1));
    let mut heartbeat = tokio::time::interval(Duration::from_secs(ping_interval_secs));
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    heartbeat.tick().await; // consume immediate initial tick

    let mut last_activity = Instant::now();
    // (github_id, device_id, conn_id)
    let mut registered: Option<(String, String, u64)> = None;

    loop {
        let incoming = tokio::select! {
            _ = heartbeat.tick() => {
                if last_activity.elapsed() >= pong_timeout {
                    tracing::info!(
                        "Reaping unresponsive half-open WebSocket (peer={:?})",
                        registered.as_ref().map(|r| &r.0)
                    );
                    break;
                }
                if frame_tx.send(OutboundFrame::Ping).is_err() {
                    break;
                }
                continue;
            }
            next_msg = ws_rx.next() => next_msg,
        };

        let Some(frame_res) = incoming else {
            break;
        };
        let msg = match frame_res {
            Ok(m) => m,
            Err(_) => break,
        };

        last_activity = Instant::now();

        let text = match msg {
            Message::Text(t) => t,
            Message::Close(_) => break,
            Message::Ping(_) | Message::Pong(_) | Message::Binary(_) => continue,
        };

        let parsed: ClientMessage = match serde_json::from_str(&text) {
            Ok(c) => c,
            Err(err) => {
                let _ = msg_tx.send(ServerMessage::Error {
                    code: "invalid_json".to_string(),
                    message: format!("malformed message: {}", err),
                });
                continue;
            }
        };

        match parsed {
            ClientMessage::Hello {
                github_id,
                display_name,
                status,
                repo_urls,
                device_id,
                ..
            } => {
                if let Some((prev_id, _, prev_conn)) = registered.take() {
                    app.service.handle_ws_disconnect(&prev_id, prev_conn).await;
                }
                match app
                    .service
                    .handle_ws_hello(
                        &github_id,
                        display_name,
                        status,
                        repo_urls,
                        device_id,
                        msg_tx.clone(),
                    )
                    .await
                {
                    Ok((norm_id, norm_device, conn_id, peers, pending_items)) => {
                        registered = Some((norm_id.clone(), norm_device, conn_id));
                        let _ = msg_tx.send(ServerMessage::Welcome {
                            server_version: SERVER_VERSION.to_string(),
                            protocol_version: PROTOCOL_VERSION,
                            github_id: norm_id,
                            peers,
                        });
                        for item in pending_items {
                            let _ = msg_tx.send(ServerMessage::ReviewAssigned {
                                request: item.request,
                                assignment: item.assignment,
                            });
                        }
                    }
                    Err(err) => {
                        let _ = msg_tx.send(ServerMessage::Error {
                            code: "hello_failed".to_string(),
                            message: err.to_string(),
                        });
                    }
                }
            }
            ClientMessage::UpdatePresence {
                status,
                repo_urls,
                display_name,
            } => {
                let Some((ref github_id, _, _)) = registered else {
                    let _ = msg_tx.send(ServerMessage::Error {
                        code: "not_authenticated".to_string(),
                        message: "send hello before update_presence".to_string(),
                    });
                    continue;
                };
                match app
                    .service
                    .handle_ws_presence_update(github_id, status, repo_urls, display_name)
                    .await
                {
                    Ok(pending_items) => {
                        for item in pending_items {
                            let _ = msg_tx.send(ServerMessage::ReviewAssigned {
                                request: item.request,
                                assignment: item.assignment,
                            });
                        }
                    }
                    Err(err) => {
                        let _ = msg_tx.send(ServerMessage::Error {
                            code: "presence_failed".to_string(),
                            message: err.to_string(),
                        });
                    }
                }
            }
            ClientMessage::AckDelivery { request_id } => {
                let Some((ref github_id, ref device_id, _)) = registered else {
                    let _ = msg_tx.send(ServerMessage::Error {
                        code: "not_authenticated".to_string(),
                        message: "send hello before ack_delivery".to_string(),
                    });
                    continue;
                };
                if let Err(err) = app
                    .service
                    .handle_ack_delivery(&request_id, github_id, device_id)
                    .await
                {
                    let code = match err {
                        ServiceError::Forbidden(_) => "forbidden",
                        ServiceError::Conflict(_) => "conflict",
                        ServiceError::NotFound(_) => "not_found",
                        _ => "ack_failed",
                    };
                    let _ = msg_tx.send(ServerMessage::Error {
                        code: code.to_string(),
                        message: err.to_string(),
                    });
                }
            }
            ClientMessage::ReportStatus {
                request_id,
                status,
                reject_reason,
                detail,
                worker_agent,
            } => {
                let Some((ref github_id, ref device_id, _)) = registered else {
                    let _ = msg_tx.send(ServerMessage::Error {
                        code: "not_authenticated".to_string(),
                        message: "send hello before report_status".to_string(),
                    });
                    continue;
                };
                if let Err(err) = app
                    .service
                    .report_assignment_status(
                        &request_id,
                        github_id,
                        status,
                        reject_reason,
                        detail,
                        worker_agent,
                        Some(device_id.clone()),
                    )
                    .await
                {
                    let code = match err {
                        ServiceError::Forbidden(_) => "forbidden",
                        ServiceError::Conflict(_) => "conflict",
                        ServiceError::NotFound(_) => "not_found",
                        _ => "status_failed",
                    };
                    let _ = msg_tx.send(ServerMessage::Error {
                        code: code.to_string(),
                        message: err.to_string(),
                    });
                }
            }
            ClientMessage::Ping { ts_ms } => {
                let _ = msg_tx.send(ServerMessage::Pong {
                    ts_ms,
                    server_ms: now_ms(),
                });
            }
        }
    }

    if let Some((github_id, _, conn_id)) = registered {
        app.service.handle_ws_disconnect(&github_id, conn_id).await;
    }
    drop(msg_tx);
    drop(frame_tx);
    let _ = forward_task.await;
    let _ = writer_task.await;
}
