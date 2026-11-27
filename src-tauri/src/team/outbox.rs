use std::path::{Path, PathBuf};

use chrono::Utc;
use relay_protocol::{CreateReviewRequestBody, UpdateAssignmentStatusBody};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const OUTBOX_TTL_MS: i64 = 12 * 3_600 * 1000; // 12 hours

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OutboxPayload {
    ReportStatus {
        request_id: String,
        body: UpdateAssignmentStatusBody,
    },
    SubmitReview {
        body: CreateReviewRequestBody,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutboxEntry {
    pub id: String,
    pub created_ms: i64,
    pub attempts: u32,
    pub last_error: Option<String>,
    pub payload: OutboxPayload,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryAttemptResult {
    Sent,
    PermanentDrop,
    RetryLater,
}

/// Persistent disk-backed FIFO outbox (`%APPDATA%/jjdr/relay_outbox.json`).
/// Guarantees reviewer status reports (`Completed/Rejected/Failed`) and author requests
/// survive temporary relay downtime or PC restarts without leaking infinite retries.
pub struct RelayOutbox {
    path: PathBuf,
    entries: Vec<OutboxEntry>,
}

impl RelayOutbox {
    pub fn load(config_dir: &Path) -> Self {
        let path = config_dir.join("relay_outbox.json");
        let entries = std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<Vec<OutboxEntry>>(&raw).ok())
            .unwrap_or_default();
        Self { path, entries }
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn entries(&self) -> &[OutboxEntry] {
        &self.entries
    }

    pub fn enqueue(&mut self, payload: OutboxPayload) -> String {
        let id = Uuid::new_v4().to_string();
        let entry = OutboxEntry {
            id: id.clone(),
            created_ms: Utc::now().timestamp_millis(),
            attempts: 0,
            last_error: None,
            payload,
        };
        self.entries.push(entry);
        // Hard cap queue length to prevent unbounded disk growth during prolonged outages
        if self.entries.len() > 200 {
            let excess = self.entries.len() - 200;
            self.entries.drain(0..excess);
        }
        self.persist();
        id
    }

    /// Prune entries older than `OUTBOX_TTL_MS`. Returns number of expired entries removed.
    pub fn prune_expired(&mut self, now_ms: i64) -> usize {
        let before = self.entries.len();
        self.entries
            .retain(|e| now_ms.saturating_sub(e.created_ms) < OUTBOX_TTL_MS);
        let removed = before.saturating_sub(self.entries.len());
        if removed > 0 {
            self.persist();
        }
        removed
    }

    /// Apply delivery outcomes in order, dropping `Sent` and `PermanentDrop`, keeping `RetryLater`.
    pub fn apply_flush_outcomes(&mut self, outcomes: &[(String, DeliveryAttemptResult, Option<String>)]) {
        let mut next = Vec::with_capacity(self.entries.len());
        for mut entry in self.entries.drain(..) {
            if let Some((_, res, err)) = outcomes.iter().find(|(id, _, _)| id == &entry.id) {
                match res {
                    DeliveryAttemptResult::Sent | DeliveryAttemptResult::PermanentDrop => {
                        continue;
                    }
                    DeliveryAttemptResult::RetryLater => {
                        entry.attempts = entry.attempts.saturating_add(1);
                        entry.last_error = err.clone();
                        next.push(entry);
                    }
                }
            } else {
                next.push(entry);
            }
        }
        self.entries = next;
        self.persist();
    }

    fn persist(&self) {
        if let Some(parent) = self.path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(&self.entries) {
            let _ = std::fs::write(&self.path, json);
        }
    }
}

/// Classify HTTP status code into permanent drop vs transient retry.
pub fn classify_http_status(status_code: u16) -> DeliveryAttemptResult {
    if (200..300).contains(&status_code) {
        DeliveryAttemptResult::Sent
    } else if matches!(status_code, 400 | 401 | 403 | 404 | 409) {
        DeliveryAttemptResult::PermanentDrop
    } else {
        DeliveryAttemptResult::RetryLater
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use relay_protocol::ReviewAssignmentStatus;

    fn sample_status_payload(req_id: &str) -> OutboxPayload {
        OutboxPayload::ReportStatus {
            request_id: req_id.to_string(),
            body: UpdateAssignmentStatusBody {
                reviewer_id: "bob".to_string(),
                status: ReviewAssignmentStatus::Completed,
                reject_reason: None,
                detail: None,
                worker_agent: Some("claude".to_string()),
                device_id: Some("pc-1".to_string()),
            },
        }
    }

    #[test]
    fn persists_across_reload_and_applies_outcomes() {
        let dir = std::env::temp_dir().join(format!("jjdr_outbox_test_{}", Uuid::new_v4()));
        let mut ob = RelayOutbox::load(&dir);
        let id1 = ob.enqueue(sample_status_payload("req-1"));
        let id2 = ob.enqueue(sample_status_payload("req-2"));
        let id3 = ob.enqueue(sample_status_payload("req-3"));

        // Reload from disk simulating PC reboot
        let mut reloaded = RelayOutbox::load(&dir);
        assert_eq!(reloaded.len(), 3);

        reloaded.apply_flush_outcomes(&[
            (id1, DeliveryAttemptResult::Sent, None),
            (id2, DeliveryAttemptResult::PermanentDrop, Some("409 conflict".into())),
            (id3.clone(), DeliveryAttemptResult::RetryLater, Some("503 down".into())),
        ]);

        let final_load = RelayOutbox::load(&dir);
        assert_eq!(final_load.len(), 1);
        assert_eq!(final_load.entries()[0].id, id3);
        assert_eq!(final_load.entries()[0].attempts, 1);
        assert_eq!(final_load.entries()[0].last_error.as_deref(), Some("503 down"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn prunes_entries_past_ttl_and_classifies_http_codes() {
        let dir = std::env::temp_dir().join(format!("jjdr_outbox_ttl_{}", Uuid::new_v4()));
        let mut ob = RelayOutbox::load(&dir);
        ob.enqueue(sample_status_payload("req-old"));
        ob.entries[0].created_ms = 1_000;
        let removed = ob.prune_expired(1_000 + OUTBOX_TTL_MS + 1);
        assert_eq!(removed, 1);
        assert!(ob.is_empty());

        assert_eq!(classify_http_status(200), DeliveryAttemptResult::Sent);
        assert_eq!(classify_http_status(201), DeliveryAttemptResult::Sent);
        assert_eq!(classify_http_status(404), DeliveryAttemptResult::PermanentDrop);
        assert_eq!(classify_http_status(409), DeliveryAttemptResult::PermanentDrop);
        assert_eq!(classify_http_status(503), DeliveryAttemptResult::RetryLater);
        assert_eq!(classify_http_status(429), DeliveryAttemptResult::RetryLater);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
