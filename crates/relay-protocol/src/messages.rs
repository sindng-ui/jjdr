use serde::{Deserialize, Serialize};

use crate::types::{
    ActiveAssignmentCheck, PeerInfo, PresenceStatus, RejectReason, ReviewAssignmentStatus,
    ReviewAssignmentView, ReviewRequestPayload,
};

/// WebSocket messages sent from jjdr client -> jjdr-relay server.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    Hello {
        github_id: String,
        #[serde(default)]
        display_name: Option<String>,
        #[serde(default = "default_online_status")]
        status: PresenceStatus,
        #[serde(default)]
        repo_urls: Vec<String>,
        #[serde(default)]
        client_version: Option<String>,
        /// Stable per-PC device identifier used to prevent duplicate execution across multiple PCs.
        #[serde(default)]
        device_id: Option<String>,
    },
    UpdatePresence {
        status: PresenceStatus,
        #[serde(default)]
        repo_urls: Option<Vec<String>>,
        #[serde(default)]
        display_name: Option<String>,
    },
    /// Explicit At-Least-Once receipt confirmation for a pushed ReviewAssigned event.
    AckDelivery {
        request_id: String,
    },
    ReportStatus {
        request_id: String,
        status: ReviewAssignmentStatus,
        #[serde(default)]
        reject_reason: Option<RejectReason>,
        #[serde(default)]
        detail: Option<String>,
        #[serde(default)]
        worker_agent: Option<String>,
    },
    Ping {
        #[serde(default)]
        ts_ms: i64,
    },
}

fn default_online_status() -> PresenceStatus {
    PresenceStatus::Online
}

/// WebSocket messages sent from jjdr-relay server -> jjdr client.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    Welcome {
        server_version: String,
        protocol_version: u32,
        github_id: String,
        peers: Vec<PeerInfo>,
    },
    PeersUpdated {
        peers: Vec<PeerInfo>,
    },
    ReviewAssigned {
        request: ReviewRequestPayload,
        assignment: ReviewAssignmentView,
    },
    AssignmentStatusChanged {
        request_id: String,
        repo_url: String,
        pr_number: u64,
        head_sha: String,
        reviewer_id: String,
        status: ReviewAssignmentStatus,
        reject_reason: Option<RejectReason>,
        detail: Option<String>,
        worker_agent: Option<String>,
        updated_ms: i64,
    },
    ReviewCancelled {
        request_id: String,
        repo_url: String,
        pr_number: u64,
        reviewer_id: String,
        reason: Option<String>,
        updated_ms: i64,
    },
    Pong {
        ts_ms: i64,
        server_ms: i64,
    },
    Error {
        code: String,
        message: String,
    },
}

/// REST payload: POST /api/v1/reviews
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CreateReviewRequestBody {
    pub repo_url: String,
    pub pr_number: u64,
    pub pr_url: String,
    pub pr_title: String,
    pub base_branch: String,
    pub head_branch: String,
    pub head_sha: String,
    pub author_id: String,
    pub reviewers: Vec<String>,
}

/// REST response: POST /api/v1/reviews
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CreateReviewRequestResponse {
    pub request: ReviewRequestPayload,
    pub assignments: Vec<ReviewAssignmentView>,
}

/// REST payload: POST /api/v1/reviews/{request_id}/status
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpdateAssignmentStatusBody {
    pub reviewer_id: String,
    pub status: ReviewAssignmentStatus,
    #[serde(default)]
    pub reject_reason: Option<RejectReason>,
    #[serde(default)]
    pub detail: Option<String>,
    #[serde(default)]
    pub worker_agent: Option<String>,
    #[serde(default)]
    pub device_id: Option<String>,
}

/// REST payload: POST /api/v1/reviews/sync-active
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncActiveRequestsBody {
    pub reviewer_id: String,
    #[serde(default)]
    pub device_id: Option<String>,
    pub request_ids: Vec<String>,
}

/// REST response: POST /api/v1/reviews/sync-active
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncActiveRequestsResponse {
    pub results: Vec<ActiveAssignmentCheck>,
}

/// REST payload: POST /api/v1/reviews/{request_id}/cancel
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CancelReviewRequestBody {
    pub author_id: String,
    /// When omitted or empty, cancels all non-terminal assignments of the request.
    #[serde(default)]
    pub reviewer_ids: Vec<String>,
    #[serde(default)]
    pub reason: Option<String>,
}

/// REST response: POST /api/v1/reviews/{request_id}/cancel
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CancelReviewRequestResponse {
    pub request_id: String,
    pub cancelled_reviewers: Vec<String>,
    pub skipped_terminal_reviewers: Vec<String>,
}

/// REST response: GET /health
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
    pub protocol_version: u32,
    pub online_peers: usize,
    pub uptime_secs: u64,
}
