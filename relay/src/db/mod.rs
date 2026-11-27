mod mappers;
mod reviews;

use std::path::Path;
use std::sync::{Arc, Mutex};

use relay_protocol::{
    PeerInfo, PresenceStatus, ReviewAssignmentView, ReviewRequestPayload,
};
use rusqlite::{params, Connection, TransactionBehavior};

pub(crate) use mappers::{fetch_peer_tx, map_sql};

#[derive(Debug, Clone)]
pub struct StoredPeer {
    pub github_id: String,
    pub display_name: String,
    pub desired_paused: bool,
    pub repo_urls: Vec<String>,
    pub last_seen_ms: i64,
}

impl StoredPeer {
    pub fn to_peer_info(&self, is_connected: bool) -> PeerInfo {
        let status = if self.desired_paused {
            PresenceStatus::Paused
        } else if is_connected {
            PresenceStatus::Online
        } else {
            PresenceStatus::Offline
        };
        PeerInfo {
            github_id: self.github_id.clone(),
            display_name: self.display_name.clone(),
            status,
            repo_urls: self.repo_urls.clone(),
            last_seen_ms: self.last_seen_ms,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ExpiredAssignmentRecord {
    pub request_id: String,
    pub repo_url: String,
    pub pr_number: u64,
    pub head_sha: String,
    pub author_id: String,
    pub reviewer_id: String,
    pub updated_ms: i64,
}

#[derive(Debug, Clone)]
pub struct StatusUpdateOutcome {
    pub request: ReviewRequestPayload,
    pub assignment: ReviewAssignmentView,
}

#[derive(Debug, Clone)]
pub struct CancelOutcome {
    pub request: ReviewRequestPayload,
    pub cancelled_reviewers: Vec<String>,
    pub skipped_terminal_reviewers: Vec<String>,
    pub updated_ms: i64,
}

#[derive(Debug, Clone)]
pub enum DbError {
    NotFound(String),
    Forbidden(String),
    Conflict(String),
    Internal(String),
}

impl std::fmt::Display for DbError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound(m) | Self::Forbidden(m) | Self::Conflict(m) | Self::Internal(m) => {
                write!(f, "{}", m)
            }
        }
    }
}

/// Thread-safe SQLite WAL store. All DB operations run inside `spawn_blocking`
/// so Tokio WebSocket event loops never block on disk I/O.
#[derive(Clone)]
pub struct RelayDb {
    conn: Arc<Mutex<Connection>>,
}

impl RelayDb {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("failed to create db directory: {}", e))?;
            }
        }

        let conn = Connection::open(path)
            .map_err(|e| format!("failed to open sqlite db {}: {}", path.display(), e))?;

        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = FULL;
            PRAGMA foreign_keys = ON;
            PRAGMA busy_timeout = 5000;

            CREATE TABLE IF NOT EXISTS peers (
                github_id TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                desired_paused INTEGER NOT NULL DEFAULT 0,
                repo_urls_json TEXT NOT NULL DEFAULT '[]',
                last_seen_ms INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS review_requests (
                request_id TEXT PRIMARY KEY,
                repo_url TEXT NOT NULL,
                pr_number INTEGER NOT NULL,
                pr_url TEXT NOT NULL,
                pr_title TEXT NOT NULL,
                base_branch TEXT NOT NULL,
                head_branch TEXT NOT NULL,
                head_sha TEXT NOT NULL,
                author_id TEXT NOT NULL,
                created_ms INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS review_assignments (
                request_id TEXT NOT NULL,
                reviewer_id TEXT NOT NULL,
                repo_url TEXT NOT NULL,
                pr_number INTEGER NOT NULL,
                head_sha TEXT NOT NULL,
                status TEXT NOT NULL,
                reject_reason TEXT,
                detail TEXT,
                worker_agent TEXT,
                claimed_by_device_id TEXT,
                known_peer INTEGER NOT NULL DEFAULT 0,
                created_ms INTEGER NOT NULL,
                updated_ms INTEGER NOT NULL,
                expires_ms INTEGER NOT NULL,
                PRIMARY KEY (request_id, reviewer_id),
                FOREIGN KEY (request_id) REFERENCES review_requests(request_id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_assign_dedup
                ON review_assignments (repo_url, pr_number, head_sha, reviewer_id, status);
            CREATE INDEX IF NOT EXISTS idx_assign_inbox
                ON review_assignments (reviewer_id, status, created_ms);
            CREATE INDEX IF NOT EXISTS idx_assign_expiry
                ON review_assignments (status, expires_ms);
            CREATE INDEX IF NOT EXISTS idx_req_author
                ON review_requests (author_id, created_ms DESC);
            ",
        )
        .map_err(|e| format!("failed to initialize sqlite schema: {}", e))?;

        // Forward-compatible migration for DB files created before Phase 1.5.
        let has_device_col: bool = conn
            .prepare("PRAGMA table_info(review_assignments)")
            .and_then(|mut stmt| {
                let names: Vec<String> = stmt
                    .query_map([], |row| row.get::<_, String>(1))?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(names.iter().any(|n| n == "claimed_by_device_id"))
            })
            .map_err(|e| format!("failed to inspect review_assignments columns: {}", e))?;
        if !has_device_col {
            conn.execute(
                "ALTER TABLE review_assignments ADD COLUMN claimed_by_device_id TEXT",
                [],
            )
            .map_err(|e| format!("failed to migrate claimed_by_device_id column: {}", e))?;
        }

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub async fn run<T, F>(&self, op: F) -> Result<T, DbError>
    where
        T: Send + 'static,
        F: FnOnce(&mut Connection) -> Result<T, DbError> + Send + 'static,
    {
        let conn_arc = Arc::clone(&self.conn);
        tokio::task::spawn_blocking(move || {
            let mut guard = conn_arc
                .lock()
                .map_err(|_| DbError::Internal("sqlite mutex poisoned".to_string()))?;
            op(&mut guard)
        })
        .await
        .map_err(|e| DbError::Internal(format!("blocking db task failed: {}", e)))?
    }

    pub async fn upsert_peer(
        &self,
        github_id: String,
        display_name: Option<String>,
        desired_paused: Option<bool>,
        repo_urls: Option<Vec<String>>,
        now_ms: i64,
    ) -> Result<StoredPeer, DbError> {
        self.run(move |conn| {
            let tx = conn
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(map_sql)?;

            let existing = fetch_peer_tx(&tx, &github_id)?;
            let final_name = display_name
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .or_else(|| existing.as_ref().map(|p| p.display_name.clone()))
                .unwrap_or_else(|| github_id.clone());
            let final_paused = desired_paused
                .or_else(|| existing.as_ref().map(|p| p.desired_paused))
                .unwrap_or(false);
            let final_repos = repo_urls
                .or_else(|| existing.as_ref().map(|p| p.repo_urls.clone()))
                .unwrap_or_default();
            let repos_json = serde_json::to_string(&final_repos)
                .map_err(|e| DbError::Internal(e.to_string()))?;

            tx.execute(
                "INSERT INTO peers (github_id, display_name, desired_paused, repo_urls_json, last_seen_ms)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(github_id) DO UPDATE SET
                   display_name = excluded.display_name,
                   desired_paused = excluded.desired_paused,
                   repo_urls_json = excluded.repo_urls_json,
                   last_seen_ms = excluded.last_seen_ms",
                params![github_id, final_name, final_paused as i64, repos_json, now_ms],
            )
            .map_err(map_sql)?;

            tx.commit().map_err(map_sql)?;

            Ok(StoredPeer {
                github_id,
                display_name: final_name,
                desired_paused: final_paused,
                repo_urls: final_repos,
                last_seen_ms: now_ms,
            })
        })
        .await
    }

    pub async fn touch_peer_last_seen(&self, github_id: String, now_ms: i64) -> Result<(), DbError> {
        self.run(move |conn| {
            conn.execute(
                "UPDATE peers SET last_seen_ms = ?1 WHERE github_id = ?2",
                params![now_ms, github_id],
            )
            .map_err(map_sql)?;
            Ok(())
        })
        .await
    }

    pub async fn list_peers(&self) -> Result<Vec<StoredPeer>, DbError> {
        self.run(|conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT github_id, display_name, desired_paused, repo_urls_json, last_seen_ms
                     FROM peers ORDER BY github_id ASC",
                )
                .map_err(map_sql)?;
            let rows = stmt
                .query_map([], |row| {
                    let repos_raw: String = row.get(3)?;
                    let repo_urls: Vec<String> =
                        serde_json::from_str(&repos_raw).unwrap_or_default();
                    Ok(StoredPeer {
                        github_id: row.get(0)?,
                        display_name: row.get(1)?,
                        desired_paused: row.get::<_, i64>(2)? != 0,
                        repo_urls,
                        last_seen_ms: row.get(4)?,
                    })
                })
                .map_err(map_sql)?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row.map_err(map_sql)?);
            }
            Ok(out)
        })
        .await
    }
}
