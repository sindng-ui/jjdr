use serde::{Deserialize, Serialize};

/// Online availability state reported by a jjdr client to the relay hub.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PresenceStatus {
    Online,
    Paused,
    Offline,
}

impl PresenceStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Online => "online",
            Self::Paused => "paused",
            Self::Offline => "offline",
        }
    }

    pub fn parse(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "online" => Self::Online,
            "paused" => Self::Paused,
            _ => Self::Offline,
        }
    }
}

/// Directory entry for a registered jjdr team member.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PeerInfo {
    pub github_id: String,
    pub display_name: String,
    pub status: PresenceStatus,
    /// Normalized repository URLs currently configured on this peer's jjdr.
    pub repo_urls: Vec<String>,
    pub last_seen_ms: i64,
}

/// Immutable PR metadata attached to a review request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReviewRequestPayload {
    pub request_id: String,
    pub repo_url: String,
    pub pr_number: u64,
    pub pr_url: String,
    pub pr_title: String,
    pub base_branch: String,
    pub head_branch: String,
    pub head_sha: String,
    pub author_id: String,
    pub created_ms: i64,
}

/// Lifecycle state for a single (request_id, reviewer_id) assignment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewAssignmentStatus {
    /// Stored in offline mailbox; reviewer had no active socket when submitted.
    PendingOffline,
    /// Pushed to an online reviewer socket; waiting for explicit client AckDelivery (At-Least-Once).
    Dispatched,
    /// Confirmed received by reviewer jjdr client (claimed by device_id).
    Delivered,
    Queued,
    Reviewing,
    Completed,
    Rejected,
    Failed,
    Cancelled,
    Expired,
}

impl ReviewAssignmentStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PendingOffline => "pending_offline",
            Self::Dispatched => "dispatched",
            Self::Delivered => "delivered",
            Self::Queued => "queued",
            Self::Reviewing => "reviewing",
            Self::Completed => "completed",
            Self::Rejected => "rejected",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::Expired => "expired",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "pending_offline" => Some(Self::PendingOffline),
            "dispatched" => Some(Self::Dispatched),
            "delivered" => Some(Self::Delivered),
            "queued" => Some(Self::Queued),
            "reviewing" => Some(Self::Reviewing),
            "completed" => Some(Self::Completed),
            "rejected" => Some(Self::Rejected),
            "failed" => Some(Self::Failed),
            "cancelled" => Some(Self::Cancelled),
            "expired" => Some(Self::Expired),
            _ => None,
        }
    }

    /// Returns true if the assignment is already finished and should not be overwritten by late cancels.
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Completed | Self::Rejected | Self::Failed | Self::Cancelled | Self::Expired
        )
    }

    /// Returns true if an identical (repo, pr, head_sha, reviewer) request should be blocked as a duplicate.
    pub fn blocks_duplicate_sha(self) -> bool {
        matches!(
            self,
            Self::PendingOffline
                | Self::Dispatched
                | Self::Delivered
                | Self::Queued
                | Self::Reviewing
                | Self::Completed
        )
    }
}

/// Standardized reason code for both Layer-1 (Relay) and Layer-2 (Reviewer jjdr) rejections.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RejectReason {
    // Layer-1 (Relay)
    DuplicateSha,
    ReviewerOffline,
    ReviewerPaused,
    RepoNotRegistered,
    ExpiredTtl,
    // Layer-2 (Reviewer jjdr)
    PrClosed,
    PrMerged,
    PrDraft,
    ExcludedLabel,
    ExcludedBranch,
    ProjectDisabled,
    AuthorNotAllowed,
    QueueFull,
    GhAuthError,
    QuotaExhausted,
    UserDeclined,
    Custom,
}

impl RejectReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::DuplicateSha => "duplicate_sha",
            Self::ReviewerOffline => "reviewer_offline",
            Self::ReviewerPaused => "reviewer_paused",
            Self::RepoNotRegistered => "repo_not_registered",
            Self::ExpiredTtl => "expired_ttl",
            Self::PrClosed => "pr_closed",
            Self::PrMerged => "pr_merged",
            Self::PrDraft => "pr_draft",
            Self::ExcludedLabel => "excluded_label",
            Self::ExcludedBranch => "excluded_branch",
            Self::ProjectDisabled => "project_disabled",
            Self::AuthorNotAllowed => "author_not_allowed",
            Self::QueueFull => "queue_full",
            Self::GhAuthError => "gh_auth_error",
            Self::QuotaExhausted => "quota_exhausted",
            Self::UserDeclined => "user_declined",
            Self::Custom => "custom",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "duplicate_sha" => Some(Self::DuplicateSha),
            "reviewer_offline" => Some(Self::ReviewerOffline),
            "reviewer_paused" => Some(Self::ReviewerPaused),
            "repo_not_registered" => Some(Self::RepoNotRegistered),
            "expired_ttl" => Some(Self::ExpiredTtl),
            "pr_closed" => Some(Self::PrClosed),
            "pr_merged" => Some(Self::PrMerged),
            "pr_draft" => Some(Self::PrDraft),
            "excluded_label" => Some(Self::ExcludedLabel),
            "excluded_branch" => Some(Self::ExcludedBranch),
            "project_disabled" => Some(Self::ProjectDisabled),
            "author_not_allowed" => Some(Self::AuthorNotAllowed),
            "queue_full" => Some(Self::QueueFull),
            "gh_auth_error" => Some(Self::GhAuthError),
            "quota_exhausted" => Some(Self::QuotaExhausted),
            "user_declined" => Some(Self::UserDeclined),
            "custom" => Some(Self::Custom),
            _ => None,
        }
    }
}

/// Assignment view returned to author mini-status bar and reviewer inbox.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReviewAssignmentView {
    pub request_id: String,
    pub reviewer_id: String,
    pub status: ReviewAssignmentStatus,
    pub reject_reason: Option<RejectReason>,
    pub detail: Option<String>,
    pub worker_agent: Option<String>,
    #[serde(default)]
    pub claimed_by_device_id: Option<String>,
    pub known_peer: bool,
    pub created_ms: i64,
    pub updated_ms: i64,
    pub expires_ms: i64,
}

/// Result entry for POST /api/v1/reviews/sync-active so reconnecting/rebooting reviewers
/// detect cancellations or expirations that happened while offline.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActiveAssignmentCheck {
    pub request_id: String,
    /// None when the request_id does not exist on the relay (e.g. wiped DB).
    pub status: Option<ReviewAssignmentStatus>,
    /// True when the reviewer must immediately abort/teardown any local job for this request.
    pub should_abort: bool,
    pub reason: Option<String>,
    pub claimed_by_device_id: Option<String>,
    pub updated_ms: i64,
}

/// Combined request and per-reviewer assignment statuses.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReviewRequestWithAssignments {
    pub request: ReviewRequestPayload,
    pub assignments: Vec<ReviewAssignmentView>,
}

/// Reviewer inbox item delivered on reconnect or queried via REST.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReviewerInboxItem {
    pub request: ReviewRequestPayload,
    pub assignment: ReviewAssignmentView,
}
