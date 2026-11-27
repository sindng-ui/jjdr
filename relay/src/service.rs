use std::collections::HashSet;
use std::time::Duration;

use chrono::Utc;
use relay_protocol::{
    normalize_github_id, normalize_repo_list, normalize_repo_url, CancelReviewRequestBody,
    CancelReviewRequestResponse, CreateReviewRequestBody, CreateReviewRequestResponse, PeerInfo,
    PresenceStatus, RejectReason, ReviewAssignmentStatus, ReviewRequestPayload,
    ReviewRequestWithAssignments, ReviewerInboxItem, ServerMessage, SyncActiveRequestsBody,
    SyncActiveRequestsResponse,
};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::auth::SlidingWindowLimiter;
use crate::config::RelayConfig;
use crate::db::{DbError, RelayDb};
use crate::hub::RelayHub;

#[derive(Debug, Clone)]
pub enum ServiceError {
    BadRequest(String),
    Forbidden(String),
    NotFound(String),
    Conflict(String),
    RateLimited { retry_after_secs: u64 },
    Internal(String),
}

impl std::fmt::Display for ServiceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BadRequest(m)
            | Self::Forbidden(m)
            | Self::NotFound(m)
            | Self::Conflict(m)
            | Self::Internal(m) => write!(f, "{}", m),
            Self::RateLimited { retry_after_secs } => {
                write!(f, "rate limit exceeded; retry after {}s", retry_after_secs)
            }
        }
    }
}

impl From<DbError> for ServiceError {
    fn from(err: DbError) -> Self {
        match err {
            DbError::NotFound(m) => Self::NotFound(m),
            DbError::Forbidden(m) => Self::Forbidden(m),
            DbError::Conflict(m) => Self::Conflict(m),
            DbError::Internal(m) => Self::Internal(m),
        }
    }
}

pub fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

fn sanitize_device_id(raw: Option<String>) -> String {
    raw.map(|s| s.trim().chars().take(64).collect::<String>())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| format!("ephemeral-{}", Uuid::new_v4()))
}

pub struct RelayService {
    pub config: RelayConfig,
    pub db: RelayDb,
    pub hub: RelayHub,
    limiter: SlidingWindowLimiter,
}

impl RelayService {
    pub fn new(config: RelayConfig, db: RelayDb, hub: RelayHub) -> Self {
        let limiter =
            SlidingWindowLimiter::new(config.rate_limit_per_min, Duration::from_secs(60));
        Self {
            config,
            db,
            hub,
            limiter,
        }
    }

    pub fn check_rate_limit(&self, key: &str) -> Result<(), ServiceError> {
        self.limiter
            .check_and_record(key)
            .map_err(|retry_after_secs| ServiceError::RateLimited { retry_after_secs })
    }

    pub async fn list_peers(&self) -> Result<Vec<PeerInfo>, ServiceError> {
        let stored = self.db.list_peers().await?;
        let online = self.hub.online_user_ids().await;
        Ok(stored
            .into_iter()
            .map(|p| {
                let connected = online.contains(&p.github_id);
                p.to_peer_info(connected)
            })
            .collect())
    }

    /// Handle WebSocket `Hello`: register peer/device, broadcast directory, and return un-ACKed items.
    pub async fn handle_ws_hello(
        &self,
        raw_github_id: &str,
        display_name: Option<String>,
        status: PresenceStatus,
        repo_urls: Vec<String>,
        raw_device_id: Option<String>,
        tx: mpsc::UnboundedSender<ServerMessage>,
    ) -> Result<(String, String, u64, Vec<PeerInfo>, Vec<ReviewerInboxItem>), ServiceError> {
        let github_id = normalize_github_id(raw_github_id)
            .ok_or_else(|| ServiceError::BadRequest("invalid github_id".to_string()))?;
        let device_id = sanitize_device_id(raw_device_id);

        let desired_paused = matches!(status, PresenceStatus::Paused);
        let normalized_repos = normalize_repo_list(repo_urls);
        let ts = now_ms();

        self.db
            .upsert_peer(
                github_id.clone(),
                display_name,
                Some(desired_paused),
                Some(normalized_repos),
                ts,
            )
            .await?;

        let conn_id = self.hub.register(&github_id, &device_id, tx).await;
        let peers = self.list_peers().await?;

        let _ = self.sweep_expired_assignments().await;

        // Re-push both `pending_offline` and previously un-ACKed `dispatched` assignments.
        let pending_items = if desired_paused {
            Vec::new()
        } else {
            self.db
                .list_undelivered_for_reviewer(github_id.clone(), now_ms())
                .await?
        };

        self.hub
            .broadcast(ServerMessage::PeersUpdated {
                peers: peers.clone(),
            })
            .await;

        Ok((github_id, device_id, conn_id, peers, pending_items))
    }

    pub async fn handle_ws_presence_update(
        &self,
        github_id: &str,
        status: PresenceStatus,
        repo_urls: Option<Vec<String>>,
        display_name: Option<String>,
    ) -> Result<Vec<ReviewerInboxItem>, ServiceError> {
        let desired_paused = matches!(status, PresenceStatus::Paused);
        let norm_repos = repo_urls.map(normalize_repo_list);

        self.db
            .upsert_peer(
                github_id.to_string(),
                display_name,
                Some(desired_paused),
                norm_repos,
                now_ms(),
            )
            .await?;

        let pending_items = if desired_paused {
            Vec::new()
        } else {
            self.db
                .list_undelivered_for_reviewer(github_id.to_string(), now_ms())
                .await?
        };

        let peers = self.list_peers().await?;
        self.hub
            .broadcast(ServerMessage::PeersUpdated { peers })
            .await;

        Ok(pending_items)
    }

    pub async fn handle_ack_delivery(
        &self,
        request_id: &str,
        github_id: &str,
        device_id: &str,
    ) -> Result<(), ServiceError> {
        let (outcome, changed) = self
            .db
            .ack_delivery_atomic(
                request_id.to_string(),
                github_id.to_string(),
                device_id.to_string(),
                now_ms(),
            )
            .await?;

        if changed {
            self.hub
                .send_to_user(
                    &outcome.request.author_id,
                    ServerMessage::AssignmentStatusChanged {
                        request_id: outcome.request.request_id,
                        repo_url: outcome.request.repo_url,
                        pr_number: outcome.request.pr_number,
                        head_sha: outcome.request.head_sha,
                        reviewer_id: outcome.assignment.reviewer_id,
                        status: outcome.assignment.status,
                        reject_reason: None,
                        detail: None,
                        worker_agent: None,
                        updated_ms: outcome.assignment.updated_ms,
                    },
                )
                .await;
        }
        Ok(())
    }

    pub async fn handle_ws_disconnect(&self, github_id: &str, conn_id: u64) {
        let went_offline = self.hub.unregister(github_id, conn_id).await;
        let _ = self
            .db
            .touch_peer_last_seen(github_id.to_string(), now_ms())
            .await;
        if went_offline {
            if let Ok(peers) = self.list_peers().await {
                self.hub
                    .broadcast(ServerMessage::PeersUpdated { peers })
                    .await;
            }
        }
    }

    /// Submit a PR review request from an author to 1..N reviewers with atomic Layer-1 validation.
    pub async fn submit_review_request(
        &self,
        body: CreateReviewRequestBody,
    ) -> Result<CreateReviewRequestResponse, ServiceError> {
        let author_id = normalize_github_id(&body.author_id)
            .ok_or_else(|| ServiceError::BadRequest("invalid author_id".to_string()))?;

        self.check_rate_limit(&format!("review:{}", author_id))?;

        let repo_url = normalize_repo_url(&body.repo_url)
            .ok_or_else(|| ServiceError::BadRequest("invalid repo_url".to_string()))?;
        if body.pr_number == 0 {
            return Err(ServiceError::BadRequest(
                "pr_number must be > 0".to_string(),
            ));
        }
        let head_sha = body.head_sha.trim().to_string();
        if head_sha.len() < 7 || head_sha.len() > 64 {
            return Err(ServiceError::BadRequest(
                "head_sha must be 7..64 characters".to_string(),
            ));
        }
        let pr_url = body.pr_url.trim().to_string();
        if !pr_url.starts_with("http://") && !pr_url.starts_with("https://") {
            return Err(ServiceError::BadRequest(
                "pr_url must start with http:// or https://".to_string(),
            ));
        }

        let mut seen = HashSet::new();
        let mut reviewers = Vec::new();
        for raw in body.reviewers {
            let Some(norm) = normalize_github_id(&raw) else {
                return Err(ServiceError::BadRequest(format!(
                    "invalid reviewer github_id: '{}'",
                    raw
                )));
            };
            if norm == author_id {
                continue;
            }
            if seen.insert(norm.clone()) {
                reviewers.push(norm);
            }
        }

        if reviewers.is_empty() {
            return Err(ServiceError::BadRequest(
                "at least one valid non-author reviewer is required".to_string(),
            ));
        }
        if reviewers.len() > self.config.max_reviewers_per_request {
            return Err(ServiceError::BadRequest(format!(
                "too many reviewers (max {})",
                self.config.max_reviewers_per_request
            )));
        }

        let _ = self.sweep_expired_assignments().await;

        let ts = now_ms();
        let expires_ms = ts.saturating_add(self.config.ttl_ms());
        let request = ReviewRequestPayload {
            request_id: Uuid::new_v4().to_string(),
            repo_url,
            pr_number: body.pr_number,
            pr_url,
            pr_title: body.pr_title.trim().chars().take(300).collect(),
            base_branch: body.base_branch.trim().chars().take(128).collect(),
            head_branch: body.head_branch.trim().chars().take(128).collect(),
            head_sha,
            author_id,
            created_ms: ts,
        };

        let online_set = self.hub.online_user_ids().await;
        let (saved_request, mut assignments) = self
            .db
            .create_review_request_atomic(request, reviewers, online_set, expires_ms)
            .await?;

        // Push exclusively to the single primary device socket of each online reviewer.
        for assignment in &mut assignments {
            if assignment.status == ReviewAssignmentStatus::Dispatched {
                let sent_device = self
                    .hub
                    .send_to_primary_device(
                        &assignment.reviewer_id,
                        ServerMessage::ReviewAssigned {
                            request: saved_request.clone(),
                            assignment: assignment.clone(),
                        },
                    )
                    .await;
                if sent_device.is_none() {
                    let _ = self
                        .db
                        .revert_dispatched_to_pending_offline(
                            saved_request.request_id.clone(),
                            assignment.reviewer_id.clone(),
                            now_ms(),
                        )
                        .await;
                    assignment.status = ReviewAssignmentStatus::PendingOffline;
                }
            }
        }

        Ok(CreateReviewRequestResponse {
            request: saved_request,
            assignments,
        })
    }

    pub async fn report_assignment_status(
        &self,
        request_id: &str,
        raw_reviewer_id: &str,
        status: ReviewAssignmentStatus,
        reject_reason: Option<RejectReason>,
        detail: Option<String>,
        worker_agent: Option<String>,
        device_id: Option<String>,
    ) -> Result<(), ServiceError> {
        let reviewer_id = normalize_github_id(raw_reviewer_id)
            .ok_or_else(|| ServiceError::BadRequest("invalid reviewer_id".to_string()))?;

        if matches!(
            status,
            ReviewAssignmentStatus::Cancelled
                | ReviewAssignmentStatus::Expired
                | ReviewAssignmentStatus::PendingOffline
                | ReviewAssignmentStatus::Dispatched
        ) {
            return Err(ServiceError::BadRequest(format!(
                "reviewers cannot directly report status '{}'",
                status.as_str()
            )));
        }

        let detail_clean = detail.map(|s| s.trim().chars().take(500).collect());
        let agent_clean = worker_agent.map(|s| s.trim().chars().take(128).collect());
        let device_clean = device_id
            .map(|s| s.trim().chars().take(64).collect::<String>())
            .filter(|s| !s.is_empty());

        let outcome = self
            .db
            .update_assignment_status(
                request_id.to_string(),
                reviewer_id,
                status,
                reject_reason,
                detail_clean,
                agent_clean,
                device_clean,
                now_ms(),
            )
            .await?;

        self.hub
            .send_to_user(
                &outcome.request.author_id,
                ServerMessage::AssignmentStatusChanged {
                    request_id: outcome.request.request_id,
                    repo_url: outcome.request.repo_url,
                    pr_number: outcome.request.pr_number,
                    head_sha: outcome.request.head_sha,
                    reviewer_id: outcome.assignment.reviewer_id,
                    status: outcome.assignment.status,
                    reject_reason: outcome.assignment.reject_reason,
                    detail: outcome.assignment.detail,
                    worker_agent: outcome.assignment.worker_agent,
                    updated_ms: outcome.assignment.updated_ms,
                },
            )
            .await;

        Ok(())
    }

    pub async fn cancel_review_request(
        &self,
        request_id: &str,
        body: CancelReviewRequestBody,
    ) -> Result<CancelReviewRequestResponse, ServiceError> {
        let author_id = normalize_github_id(&body.author_id)
            .ok_or_else(|| ServiceError::BadRequest("invalid author_id".to_string()))?;

        let mut norm_reviewers = Vec::new();
        for raw in body.reviewer_ids {
            let norm = normalize_github_id(&raw).ok_or_else(|| {
                ServiceError::BadRequest(format!("invalid reviewer_id: '{}'", raw))
            })?;
            norm_reviewers.push(norm);
        }

        let reason_clean = body.reason.map(|s| s.trim().chars().take(300).collect());
        let outcome = self
            .db
            .cancel_review_request(
                request_id.to_string(),
                author_id,
                norm_reviewers,
                reason_clean.clone(),
                now_ms(),
            )
            .await?;

        for reviewer_id in &outcome.cancelled_reviewers {
            self.hub
                .send_to_user(
                    reviewer_id,
                    ServerMessage::ReviewCancelled {
                        request_id: outcome.request.request_id.clone(),
                        repo_url: outcome.request.repo_url.clone(),
                        pr_number: outcome.request.pr_number,
                        reviewer_id: reviewer_id.clone(),
                        reason: reason_clean.clone(),
                        updated_ms: outcome.updated_ms,
                    },
                )
                .await;
        }

        Ok(CancelReviewRequestResponse {
            request_id: outcome.request.request_id,
            cancelled_reviewers: outcome.cancelled_reviewers,
            skipped_terminal_reviewers: outcome.skipped_terminal_reviewers,
        })
    }

    pub async fn sync_active_requests(
        &self,
        body: SyncActiveRequestsBody,
    ) -> Result<SyncActiveRequestsResponse, ServiceError> {
        let reviewer_id = normalize_github_id(&body.reviewer_id)
            .ok_or_else(|| ServiceError::BadRequest("invalid reviewer_id".to_string()))?;
        if body.request_ids.len() > 200 {
            return Err(ServiceError::BadRequest(
                "too many request_ids in sync-active (max 200)".to_string(),
            ));
        }
        let _ = self.sweep_expired_assignments().await;
        let device_clean = body
            .device_id
            .map(|s| s.trim().chars().take(64).collect::<String>())
            .filter(|s| !s.is_empty());

        let results = self
            .db
            .sync_active_requests(reviewer_id, device_clean, body.request_ids, now_ms())
            .await?;
        Ok(SyncActiveRequestsResponse { results })
    }

    pub async fn sweep_expired_assignments(&self) -> Result<usize, ServiceError> {
        let expired = self.db.expire_stale_assignments(now_ms()).await?;
        let count = expired.len();
        for rec in expired {
            self.hub
                .send_to_user(
                    &rec.author_id,
                    ServerMessage::AssignmentStatusChanged {
                        request_id: rec.request_id,
                        repo_url: rec.repo_url,
                        pr_number: rec.pr_number,
                        head_sha: rec.head_sha,
                        reviewer_id: rec.reviewer_id,
                        status: ReviewAssignmentStatus::Expired,
                        reject_reason: Some(RejectReason::ExpiredTtl),
                        detail: Some(
                            "Review request expired before reviewer confirmed delivery".into(),
                        ),
                        worker_agent: None,
                        updated_ms: rec.updated_ms,
                    },
                )
                .await;
        }
        Ok(count)
    }

    pub async fn list_authored(
        &self,
        raw_author_id: &str,
        limit: usize,
    ) -> Result<Vec<ReviewRequestWithAssignments>, ServiceError> {
        let author_id = normalize_github_id(raw_author_id)
            .ok_or_else(|| ServiceError::BadRequest("invalid author_id".to_string()))?;
        Ok(self
            .db
            .list_authored_requests(author_id, limit.clamp(1, 100))
            .await?)
    }

    pub async fn list_inbox(
        &self,
        raw_reviewer_id: &str,
    ) -> Result<Vec<ReviewerInboxItem>, ServiceError> {
        let reviewer_id = normalize_github_id(raw_reviewer_id)
            .ok_or_else(|| ServiceError::BadRequest("invalid reviewer_id".to_string()))?;
        let _ = self.sweep_expired_assignments().await;
        Ok(self.db.list_reviewer_inbox(reviewer_id).await?)
    }
}
