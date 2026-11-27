use std::collections::HashSet;

use relay_protocol::{
    ActiveAssignmentCheck, RejectReason, ReviewAssignmentStatus, ReviewAssignmentView,
    ReviewRequestPayload, ReviewRequestWithAssignments, ReviewerInboxItem,
};
use rusqlite::{params, TransactionBehavior};

use super::mappers::{
    fetch_assignment_tx, fetch_assignments_for_request_conn, fetch_assignments_for_request_tx,
    fetch_peer_tx, fetch_request_tx, has_blocking_duplicate_tx, map_inbox_row, map_request_row,
    map_sql,
};
use super::{CancelOutcome, DbError, ExpiredAssignmentRecord, RelayDb, StatusUpdateOutcome};

impl RelayDb {
    /// Atomically evaluates Layer-1 Reject rules and inserts the review request + assignments.
    /// Online reviewers receive `Dispatched` (waiting for explicit client `AckDelivery`),
    /// while offline reviewers receive `PendingOffline`.
    pub async fn create_review_request_atomic(
        &self,
        request: ReviewRequestPayload,
        reviewers: Vec<String>,
        online_set: HashSet<String>,
        expires_ms: i64,
    ) -> Result<(ReviewRequestPayload, Vec<ReviewAssignmentView>), DbError> {
        self.run(move |conn| {
            let tx = conn
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(map_sql)?;

            tx.execute(
                "INSERT INTO review_requests (
                    request_id, repo_url, pr_number, pr_url, pr_title,
                    base_branch, head_branch, head_sha, author_id, created_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    request.request_id,
                    request.repo_url,
                    request.pr_number as i64,
                    request.pr_url,
                    request.pr_title,
                    request.base_branch,
                    request.head_branch,
                    request.head_sha,
                    request.author_id,
                    request.created_ms,
                ],
            )
            .map_err(map_sql)?;

            let mut assignments = Vec::with_capacity(reviewers.len());

            for reviewer_id in reviewers {
                let peer = fetch_peer_tx(&tx, &reviewer_id)?;
                let known_peer = peer.is_some();

                let duplicate_exists = has_blocking_duplicate_tx(
                    &tx,
                    &request.repo_url,
                    request.pr_number,
                    &request.head_sha,
                    &reviewer_id,
                )?;

                let (status, reject_reason, detail) = if duplicate_exists {
                    (
                        ReviewAssignmentStatus::Rejected,
                        Some(RejectReason::DuplicateSha),
                        Some(format!(
                            "PR #{} at commit {} is already active or completed for @{}",
                            request.pr_number, request.head_sha, reviewer_id
                        )),
                    )
                } else if let Some(ref p) = peer {
                    if p.desired_paused {
                        (
                            ReviewAssignmentStatus::Rejected,
                            Some(RejectReason::ReviewerPaused),
                            Some(format!("@{} has auto-review paused", reviewer_id)),
                        )
                    } else if !p.repo_urls.is_empty()
                        && !p.repo_urls.iter().any(|r| r == &request.repo_url)
                    {
                        (
                            ReviewAssignmentStatus::Rejected,
                            Some(RejectReason::RepoNotRegistered),
                            Some(format!(
                                "@{} does not have {} registered in jjdr",
                                reviewer_id, request.repo_url
                            )),
                        )
                    } else if online_set.contains(&reviewer_id) {
                        (ReviewAssignmentStatus::Dispatched, None, None)
                    } else {
                        (ReviewAssignmentStatus::PendingOffline, None, None)
                    }
                } else {
                    (ReviewAssignmentStatus::PendingOffline, None, None)
                };

                tx.execute(
                    "INSERT INTO review_assignments (
                        request_id, reviewer_id, repo_url, pr_number, head_sha,
                        status, reject_reason, detail, worker_agent, claimed_by_device_id,
                        known_peer, created_ms, updated_ms, expires_ms
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, NULL, ?9, ?10, ?11, ?12)",
                    params![
                        request.request_id,
                        reviewer_id,
                        request.repo_url,
                        request.pr_number as i64,
                        request.head_sha,
                        status.as_str(),
                        reject_reason.map(|r| r.as_str()),
                        detail,
                        known_peer as i64,
                        request.created_ms,
                        request.created_ms,
                        expires_ms,
                    ],
                )
                .map_err(map_sql)?;

                assignments.push(ReviewAssignmentView {
                    request_id: request.request_id.clone(),
                    reviewer_id,
                    status,
                    reject_reason,
                    detail,
                    worker_agent: None,
                    claimed_by_device_id: None,
                    known_peer,
                    created_ms: request.created_ms,
                    updated_ms: request.created_ms,
                    expires_ms,
                });
            }

            tx.commit().map_err(map_sql)?;
            Ok((request, assignments))
        })
        .await
    }

    /// List all unexpired un-ACKed assignments (`pending_offline` or `dispatched`) for a
    /// reconnecting reviewer. Marks them `dispatched` (NOT `delivered`) so At-Least-Once
    /// delivery persists until the client explicitly sends `AckDelivery` or a status report.
    pub async fn list_undelivered_for_reviewer(
        &self,
        reviewer_id: String,
        now_ms: i64,
    ) -> Result<Vec<ReviewerInboxItem>, DbError> {
        self.run(move |conn| {
            let tx = conn
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(map_sql)?;

            let mut stmt = tx
                .prepare(
                    "SELECT
                        r.request_id, r.repo_url, r.pr_number, r.pr_url, r.pr_title,
                        r.base_branch, r.head_branch, r.head_sha, r.author_id, r.created_ms,
                        a.reviewer_id, a.status, a.reject_reason, a.detail, a.worker_agent,
                        a.claimed_by_device_id, a.known_peer, a.created_ms, a.updated_ms, a.expires_ms
                     FROM review_assignments a
                     JOIN review_requests r ON r.request_id = a.request_id
                     WHERE a.reviewer_id = ?1
                       AND a.status IN ('pending_offline', 'dispatched')
                       AND a.expires_ms > ?2
                     ORDER BY a.created_ms ASC",
                )
                .map_err(map_sql)?;

            let mut items: Vec<ReviewerInboxItem> = stmt
                .query_map(params![reviewer_id, now_ms], map_inbox_row)
                .map_err(map_sql)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(map_sql)?;
            drop(stmt);

            for item in &mut items {
                tx.execute(
                    "UPDATE review_assignments
                     SET status = 'dispatched', known_peer = 1, updated_ms = ?1
                     WHERE request_id = ?2 AND reviewer_id = ?3
                       AND status IN ('pending_offline', 'dispatched')",
                    params![now_ms, item.request.request_id, item.assignment.reviewer_id],
                )
                .map_err(map_sql)?;
                item.assignment.status = ReviewAssignmentStatus::Dispatched;
                item.assignment.known_peer = true;
                item.assignment.updated_ms = now_ms;
            }

            tx.commit().map_err(map_sql)?;
            Ok(items)
        })
        .await
    }

    /// Explicitly confirm delivery from a reviewer device (`AckDelivery`), atomically claiming
    /// `claimed_by_device_id` and transitioning `pending_offline|dispatched -> delivered`.
    /// Returns `(outcome, changed)` so callers only broadcast to the author on actual transition.
    pub async fn ack_delivery_atomic(
        &self,
        request_id: String,
        reviewer_id: String,
        device_id: String,
        now_ms: i64,
    ) -> Result<(StatusUpdateOutcome, bool), DbError> {
        self.run(move |conn| {
            let tx = conn
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(map_sql)?;

            let request = fetch_request_tx(&tx, &request_id)?
                .ok_or_else(|| DbError::NotFound(format!("request {} not found", request_id)))?;

            let existing = fetch_assignment_tx(&tx, &request_id, &reviewer_id)?.ok_or_else(|| {
                DbError::Forbidden(format!(
                    "@{} is not an assigned reviewer for request {}",
                    reviewer_id, request_id
                ))
            })?;

            if let Some(ref owner) = existing.claimed_by_device_id {
                if owner != &device_id {
                    return Err(DbError::Conflict(format!(
                        "assignment already claimed by another device ({})",
                        owner
                    )));
                }
            }

            if existing.status.is_terminal() {
                return Err(DbError::Conflict(format!(
                    "assignment is already terminal ({})",
                    existing.status.as_str()
                )));
            }

            if matches!(
                existing.status,
                ReviewAssignmentStatus::Delivered
                    | ReviewAssignmentStatus::Queued
                    | ReviewAssignmentStatus::Reviewing
            ) {
                tx.commit().map_err(map_sql)?;
                return Ok((
                    StatusUpdateOutcome {
                        request,
                        assignment: existing,
                    },
                    false,
                ));
            }

            tx.execute(
                "UPDATE review_assignments
                 SET status = 'delivered', claimed_by_device_id = ?1, known_peer = 1, updated_ms = ?2
                 WHERE request_id = ?3 AND reviewer_id = ?4",
                params![device_id, now_ms, request_id, reviewer_id],
            )
            .map_err(map_sql)?;

            tx.commit().map_err(map_sql)?;

            Ok((
                StatusUpdateOutcome {
                    request,
                    assignment: ReviewAssignmentView {
                        request_id,
                        reviewer_id,
                        status: ReviewAssignmentStatus::Delivered,
                        reject_reason: existing.reject_reason,
                        detail: existing.detail,
                        worker_agent: existing.worker_agent,
                        claimed_by_device_id: Some(device_id),
                        known_peer: true,
                        created_ms: existing.created_ms,
                        updated_ms: now_ms,
                        expires_ms: existing.expires_ms,
                    },
                },
                true,
            ))
        })
        .await
    }

    /// Roll a `dispatched` assignment back to `pending_offline` if the immediate WS send failed.
    pub async fn revert_dispatched_to_pending_offline(
        &self,
        request_id: String,
        reviewer_id: String,
        now_ms: i64,
    ) -> Result<(), DbError> {
        self.run(move |conn| {
            conn.execute(
                "UPDATE review_assignments
                 SET status = 'pending_offline', updated_ms = ?1
                 WHERE request_id = ?2 AND reviewer_id = ?3 AND status = 'dispatched'",
                params![now_ms, request_id, reviewer_id],
            )
            .map_err(map_sql)?;
            Ok(())
        })
        .await
    }

    /// Update assignment status with strict reviewer ownership, device claim isolation,
    /// and terminal immutability checks.
    pub async fn update_assignment_status(
        &self,
        request_id: String,
        reviewer_id: String,
        next_status: ReviewAssignmentStatus,
        reject_reason: Option<RejectReason>,
        detail: Option<String>,
        worker_agent: Option<String>,
        device_id: Option<String>,
        now_ms: i64,
    ) -> Result<StatusUpdateOutcome, DbError> {
        self.run(move |conn| {
            let tx = conn
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(map_sql)?;

            let request = fetch_request_tx(&tx, &request_id)?
                .ok_or_else(|| DbError::NotFound(format!("request {} not found", request_id)))?;

            let existing = fetch_assignment_tx(&tx, &request_id, &reviewer_id)?.ok_or_else(|| {
                DbError::Forbidden(format!(
                    "@{} is not an assigned reviewer for request {}",
                    reviewer_id, request_id
                ))
            })?;

            if existing.status.is_terminal() {
                return Err(DbError::Conflict(format!(
                    "assignment is already terminal ({})",
                    existing.status.as_str()
                )));
            }

            if let (Some(ref owner), Some(ref caller)) =
                (&existing.claimed_by_device_id, &device_id)
            {
                if owner != caller {
                    return Err(DbError::Conflict(format!(
                        "assignment already claimed by another device ({})",
                        owner
                    )));
                }
            }

            let final_agent = worker_agent.or(existing.worker_agent.clone());
            let final_device = existing.claimed_by_device_id.clone().or(device_id);

            tx.execute(
                "UPDATE review_assignments
                 SET status = ?1, reject_reason = ?2, detail = ?3, worker_agent = ?4,
                     claimed_by_device_id = ?5, updated_ms = ?6
                 WHERE request_id = ?7 AND reviewer_id = ?8",
                params![
                    next_status.as_str(),
                    reject_reason.map(|r| r.as_str()),
                    detail,
                    final_agent,
                    final_device,
                    now_ms,
                    request_id,
                    reviewer_id,
                ],
            )
            .map_err(map_sql)?;

            tx.commit().map_err(map_sql)?;

            Ok(StatusUpdateOutcome {
                request,
                assignment: ReviewAssignmentView {
                    request_id,
                    reviewer_id,
                    status: next_status,
                    reject_reason,
                    detail,
                    worker_agent: final_agent,
                    claimed_by_device_id: final_device,
                    known_peer: existing.known_peer,
                    created_ms: existing.created_ms,
                    updated_ms: now_ms,
                    expires_ms: existing.expires_ms,
                },
            })
        })
        .await
    }

    /// Cancel non-terminal assignments of a request. Only the original author may cancel.
    pub async fn cancel_review_request(
        &self,
        request_id: String,
        author_id: String,
        target_reviewers: Vec<String>,
        reason: Option<String>,
        now_ms: i64,
    ) -> Result<CancelOutcome, DbError> {
        self.run(move |conn| {
            let tx = conn
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(map_sql)?;

            let request = fetch_request_tx(&tx, &request_id)?
                .ok_or_else(|| DbError::NotFound(format!("request {} not found", request_id)))?;

            if request.author_id != author_id {
                return Err(DbError::Forbidden(format!(
                    "only author @{} can cancel request {}",
                    request.author_id, request_id
                )));
            }

            let all_assignments = fetch_assignments_for_request_tx(&tx, &request_id)?;
            let target_set: HashSet<String> = target_reviewers.into_iter().collect();

            let mut cancelled = Vec::new();
            let mut skipped = Vec::new();

            for a in all_assignments {
                if !target_set.is_empty() && !target_set.contains(&a.reviewer_id) {
                    continue;
                }
                if a.status.is_terminal() {
                    skipped.push(a.reviewer_id);
                    continue;
                }

                tx.execute(
                    "UPDATE review_assignments
                     SET status = 'cancelled', detail = ?1, updated_ms = ?2
                     WHERE request_id = ?3 AND reviewer_id = ?4",
                    params![reason, now_ms, request_id, a.reviewer_id],
                )
                .map_err(map_sql)?;
                cancelled.push(a.reviewer_id);
            }

            tx.commit().map_err(map_sql)?;

            Ok(CancelOutcome {
                request,
                cancelled_reviewers: cancelled,
                skipped_terminal_reviewers: skipped,
                updated_ms: now_ms,
            })
        })
        .await
    }

    /// Expire all un-ACKed (`pending_offline` or `dispatched`) assignments past their TTL deadline.
    pub async fn expire_stale_assignments(
        &self,
        now_ms: i64,
    ) -> Result<Vec<ExpiredAssignmentRecord>, DbError> {
        self.run(move |conn| {
            let tx = conn
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(map_sql)?;

            let mut stmt = tx
                .prepare(
                    "SELECT a.request_id, a.repo_url, a.pr_number, a.head_sha, r.author_id, a.reviewer_id
                     FROM review_assignments a
                     JOIN review_requests r ON r.request_id = a.request_id
                     WHERE a.status IN ('pending_offline', 'dispatched') AND a.expires_ms <= ?1",
                )
                .map_err(map_sql)?;

            let rows = stmt
                .query_map(params![now_ms], |row| {
                    Ok(ExpiredAssignmentRecord {
                        request_id: row.get(0)?,
                        repo_url: row.get(1)?,
                        pr_number: row.get::<_, i64>(2)? as u64,
                        head_sha: row.get(3)?,
                        author_id: row.get(4)?,
                        reviewer_id: row.get(5)?,
                        updated_ms: now_ms,
                    })
                })
                .map_err(map_sql)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(map_sql)?;
            drop(stmt);

            for rec in &rows {
                tx.execute(
                    "UPDATE review_assignments
                     SET status = 'expired', reject_reason = 'expired_ttl',
                         detail = 'Review request expired before reviewer confirmed delivery', updated_ms = ?1
                     WHERE request_id = ?2 AND reviewer_id = ?3
                       AND status IN ('pending_offline', 'dispatched')",
                    params![now_ms, rec.request_id, rec.reviewer_id],
                )
                .map_err(map_sql)?;
            }

            tx.commit().map_err(map_sql)?;
            Ok(rows)
        })
        .await
    }

    /// Reconcile a reviewer's local active request IDs against authoritative relay DB state
    /// (catches cancellations/expirations/other-device claims that occurred while offline/sleeping).
    pub async fn sync_active_requests(
        &self,
        reviewer_id: String,
        device_id: Option<String>,
        request_ids: Vec<String>,
        now_ms: i64,
    ) -> Result<Vec<ActiveAssignmentCheck>, DbError> {
        self.run(move |conn| {
            let tx = conn
                .transaction_with_behavior(TransactionBehavior::Deferred)
                .map_err(map_sql)?;
            let mut results = Vec::with_capacity(request_ids.len());

            for req_id in request_ids {
                match fetch_assignment_tx(&tx, &req_id, &reviewer_id)? {
                    None => results.push(ActiveAssignmentCheck {
                        request_id: req_id,
                        status: None,
                        should_abort: true,
                        reason: Some("assignment not found on relay".to_string()),
                        claimed_by_device_id: None,
                        updated_ms: now_ms,
                    }),
                    Some(a) => {
                        let claimed_elsewhere = match (&a.claimed_by_device_id, &device_id) {
                            (Some(owner), Some(caller)) => owner != caller,
                            _ => false,
                        };
                        let (should_abort, reason) = if claimed_elsewhere {
                            (
                                true,
                                Some(format!(
                                    "claimed by another device ({})",
                                    a.claimed_by_device_id.as_deref().unwrap_or("")
                                )),
                            )
                        } else if matches!(
                            a.status,
                            ReviewAssignmentStatus::Cancelled
                                | ReviewAssignmentStatus::Expired
                                | ReviewAssignmentStatus::Rejected
                                | ReviewAssignmentStatus::Failed
                        ) {
                            (
                                true,
                                a.detail
                                    .clone()
                                    .or_else(|| Some(format!("status is {}", a.status.as_str()))),
                            )
                        } else {
                            (false, a.detail.clone())
                        };

                        results.push(ActiveAssignmentCheck {
                            request_id: req_id,
                            status: Some(a.status),
                            should_abort,
                            reason,
                            claimed_by_device_id: a.claimed_by_device_id,
                            updated_ms: a.updated_ms,
                        });
                    }
                }
            }

            Ok(results)
        })
        .await
    }

    pub async fn list_authored_requests(
        &self,
        author_id: String,
        limit: usize,
    ) -> Result<Vec<ReviewRequestWithAssignments>, DbError> {
        self.run(move |conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT request_id, repo_url, pr_number, pr_url, pr_title,
                            base_branch, head_branch, head_sha, author_id, created_ms
                     FROM review_requests
                     WHERE author_id = ?1
                     ORDER BY created_ms DESC
                     LIMIT ?2",
                )
                .map_err(map_sql)?;

            let requests = stmt
                .query_map(params![author_id, limit as i64], map_request_row)
                .map_err(map_sql)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(map_sql)?;
            drop(stmt);

            let mut out = Vec::with_capacity(requests.len());
            for req in requests {
                let assignments = fetch_assignments_for_request_conn(conn, &req.request_id)?;
                out.push(ReviewRequestWithAssignments {
                    request: req,
                    assignments,
                });
            }
            Ok(out)
        })
        .await
    }

    pub async fn list_reviewer_inbox(
        &self,
        reviewer_id: String,
    ) -> Result<Vec<ReviewerInboxItem>, DbError> {
        self.run(move |conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT
                        r.request_id, r.repo_url, r.pr_number, r.pr_url, r.pr_title,
                        r.base_branch, r.head_branch, r.head_sha, r.author_id, r.created_ms,
                        a.reviewer_id, a.status, a.reject_reason, a.detail, a.worker_agent,
                        a.claimed_by_device_id, a.known_peer, a.created_ms, a.updated_ms, a.expires_ms
                     FROM review_assignments a
                     JOIN review_requests r ON r.request_id = a.request_id
                     WHERE a.reviewer_id = ?1
                       AND a.status IN ('pending_offline', 'dispatched', 'delivered', 'queued', 'reviewing')
                     ORDER BY a.created_ms ASC",
                )
                .map_err(map_sql)?;
            let items = stmt
                .query_map(params![reviewer_id], map_inbox_row)
                .map_err(map_sql)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(map_sql)?;
            Ok(items)
        })
        .await
    }
}
