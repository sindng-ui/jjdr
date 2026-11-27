pub mod client;
pub mod http;
pub mod identity;
pub mod outbox;

use relay_protocol::{
    PeerInfo, PresenceStatus, RejectReason, ReviewAssignmentStatus, ReviewAssignmentView,
    ReviewRequestPayload,
};
use serde::{Deserialize, Serialize};

/// Connection state snapshot exposed to frontend Settings & status badges.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamConnectionSnapshot {
    pub enabled: bool,
    pub connected: bool,
    pub state: String, // "disabled" | "connecting" | "connected" | "paused" | "error"
    pub relay_url: String,
    pub device_id: String,
    pub github_id: Option<String>,
    pub effective_status: PresenceStatus,
    pub registered_repos: Vec<String>,
    pub peers: Vec<PeerInfo>,
    pub outbox_pending: usize,
    pub server_version: Option<String>,
    pub last_error: Option<String>,
    pub last_connected_ms: Option<i64>,
}

/// Result returned by `[Test Connection]` in Team Orchestration settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelayTestResult {
    pub ok: bool,
    pub health_ok: bool,
    pub auth_ok: bool,
    pub latency_ms: u64,
    pub server_version: Option<String>,
    pub protocol_version: Option<u32>,
    pub online_peers: usize,
    pub total_peers: usize,
    pub error: Option<String>,
}

/// Tauri event payload: `jjdr:team-review-assigned` (consumed by Phase 3 auto-review engine).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamReviewAssignedEvent {
    pub request: ReviewRequestPayload,
    pub assignment: ReviewAssignmentView,
}

/// Tauri event payload: `jjdr:team-status-changed` (consumed by Phase 4 author mini-status bar).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamStatusChangedEvent {
    pub request_id: String,
    pub repo_url: String,
    pub pr_number: u64,
    pub head_sha: String,
    pub reviewer_id: String,
    pub status: ReviewAssignmentStatus,
    pub reject_reason: Option<RejectReason>,
    pub detail: Option<String>,
    pub worker_agent: Option<String>,
    pub updated_ms: i64,
}

/// Tauri event payload: `jjdr:team-review-cancelled`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamReviewCancelledEvent {
    pub request_id: String,
    pub repo_url: String,
    pub pr_number: u64,
    pub reviewer_id: String,
    pub reason: Option<String>,
    pub updated_ms: i64,
}
