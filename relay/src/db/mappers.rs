use relay_protocol::{
    RejectReason, ReviewAssignmentStatus, ReviewAssignmentView, ReviewRequestPayload,
    ReviewerInboxItem,
};
use rusqlite::{params, Connection, OptionalExtension};

use super::{DbError, StoredPeer};

pub(crate) fn map_sql(err: rusqlite::Error) -> DbError {
    DbError::Internal(format!("sqlite error: {}", err))
}

pub(crate) fn fetch_peer_tx(
    tx: &rusqlite::Transaction<'_>,
    github_id: &str,
) -> Result<Option<StoredPeer>, DbError> {
    tx.query_row(
        "SELECT github_id, display_name, desired_paused, repo_urls_json, last_seen_ms
         FROM peers WHERE github_id = ?1",
        params![github_id],
        |row| {
            let repos_raw: String = row.get(3)?;
            let repo_urls: Vec<String> = serde_json::from_str(&repos_raw).unwrap_or_default();
            Ok(StoredPeer {
                github_id: row.get(0)?,
                display_name: row.get(1)?,
                desired_paused: row.get::<_, i64>(2)? != 0,
                repo_urls,
                last_seen_ms: row.get(4)?,
            })
        },
    )
    .optional()
    .map_err(map_sql)
}

pub(crate) fn has_blocking_duplicate_tx(
    tx: &rusqlite::Transaction<'_>,
    repo_url: &str,
    pr_number: u64,
    head_sha: &str,
    reviewer_id: &str,
) -> Result<bool, DbError> {
    let mut stmt = tx
        .prepare(
            "SELECT status FROM review_assignments
             WHERE repo_url = ?1 AND pr_number = ?2 AND head_sha = ?3 AND reviewer_id = ?4",
        )
        .map_err(map_sql)?;
    let rows = stmt
        .query_map(
            params![repo_url, pr_number as i64, head_sha, reviewer_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(map_sql)?;

    for row in rows {
        let raw = row.map_err(map_sql)?;
        if let Some(st) = ReviewAssignmentStatus::parse(&raw) {
            if st.blocks_duplicate_sha() {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

pub(crate) fn fetch_request_tx(
    tx: &rusqlite::Transaction<'_>,
    request_id: &str,
) -> Result<Option<ReviewRequestPayload>, DbError> {
    tx.query_row(
        "SELECT request_id, repo_url, pr_number, pr_url, pr_title,
                base_branch, head_branch, head_sha, author_id, created_ms
         FROM review_requests WHERE request_id = ?1",
        params![request_id],
        map_request_row,
    )
    .optional()
    .map_err(map_sql)
}

pub(crate) fn fetch_assignment_tx(
    tx: &rusqlite::Transaction<'_>,
    request_id: &str,
    reviewer_id: &str,
) -> Result<Option<ReviewAssignmentView>, DbError> {
    tx.query_row(
        "SELECT request_id, reviewer_id, status, reject_reason, detail, worker_agent,
                claimed_by_device_id, known_peer, created_ms, updated_ms, expires_ms
         FROM review_assignments WHERE request_id = ?1 AND reviewer_id = ?2",
        params![request_id, reviewer_id],
        map_assignment_row,
    )
    .optional()
    .map_err(map_sql)
}

pub(crate) fn fetch_assignments_for_request_tx(
    tx: &rusqlite::Transaction<'_>,
    request_id: &str,
) -> Result<Vec<ReviewAssignmentView>, DbError> {
    let mut stmt = tx
        .prepare(
            "SELECT request_id, reviewer_id, status, reject_reason, detail, worker_agent,
                    claimed_by_device_id, known_peer, created_ms, updated_ms, expires_ms
             FROM review_assignments WHERE request_id = ?1 ORDER BY reviewer_id ASC",
        )
        .map_err(map_sql)?;
    let out = stmt
        .query_map(params![request_id], map_assignment_row)
        .map_err(map_sql)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_sql)?;
    Ok(out)
}

pub(crate) fn fetch_assignments_for_request_conn(
    conn: &Connection,
    request_id: &str,
) -> Result<Vec<ReviewAssignmentView>, DbError> {
    let mut stmt = conn
        .prepare(
            "SELECT request_id, reviewer_id, status, reject_reason, detail, worker_agent,
                    claimed_by_device_id, known_peer, created_ms, updated_ms, expires_ms
             FROM review_assignments WHERE request_id = ?1 ORDER BY reviewer_id ASC",
        )
        .map_err(map_sql)?;
    let out = stmt
        .query_map(params![request_id], map_assignment_row)
        .map_err(map_sql)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_sql)?;
    Ok(out)
}

pub(crate) fn map_request_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ReviewRequestPayload> {
    Ok(ReviewRequestPayload {
        request_id: row.get(0)?,
        repo_url: row.get(1)?,
        pr_number: row.get::<_, i64>(2)? as u64,
        pr_url: row.get(3)?,
        pr_title: row.get(4)?,
        base_branch: row.get(5)?,
        head_branch: row.get(6)?,
        head_sha: row.get(7)?,
        author_id: row.get(8)?,
        created_ms: row.get(9)?,
    })
}

pub(crate) fn map_assignment_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ReviewAssignmentView> {
    let status_raw: String = row.get(2)?;
    let reject_raw: Option<String> = row.get(3)?;
    Ok(ReviewAssignmentView {
        request_id: row.get(0)?,
        reviewer_id: row.get(1)?,
        status: ReviewAssignmentStatus::parse(&status_raw)
            .unwrap_or(ReviewAssignmentStatus::Failed),
        reject_reason: reject_raw.and_then(|s| RejectReason::parse(&s)),
        detail: row.get(4)?,
        worker_agent: row.get(5)?,
        claimed_by_device_id: row.get(6)?,
        known_peer: row.get::<_, i64>(7)? != 0,
        created_ms: row.get(8)?,
        updated_ms: row.get(9)?,
        expires_ms: row.get(10)?,
    })
}

pub(crate) fn map_inbox_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ReviewerInboxItem> {
    let req = ReviewRequestPayload {
        request_id: row.get(0)?,
        repo_url: row.get(1)?,
        pr_number: row.get::<_, i64>(2)? as u64,
        pr_url: row.get(3)?,
        pr_title: row.get(4)?,
        base_branch: row.get(5)?,
        head_branch: row.get(6)?,
        head_sha: row.get(7)?,
        author_id: row.get(8)?,
        created_ms: row.get(9)?,
    };
    let status_raw: String = row.get(11)?;
    let reject_raw: Option<String> = row.get(12)?;
    let assignment = ReviewAssignmentView {
        request_id: req.request_id.clone(),
        reviewer_id: row.get(10)?,
        status: ReviewAssignmentStatus::parse(&status_raw)
            .unwrap_or(ReviewAssignmentStatus::PendingOffline),
        reject_reason: reject_raw.and_then(|s| RejectReason::parse(&s)),
        detail: row.get(13)?,
        worker_agent: row.get(14)?,
        claimed_by_device_id: row.get(15)?,
        known_peer: row.get::<_, i64>(16)? != 0,
        created_ms: row.get(17)?,
        updated_ms: row.get(18)?,
        expires_ms: row.get(19)?,
    };
    Ok(ReviewerInboxItem {
        request: req,
        assignment,
    })
}
