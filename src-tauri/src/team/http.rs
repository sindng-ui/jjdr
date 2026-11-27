use std::time::{Duration, Instant};

use chrono::Utc;
use relay_protocol::{
    CancelReviewRequestBody, CancelReviewRequestResponse, CreateReviewRequestBody,
    CreateReviewRequestResponse, HealthResponse, PeerInfo, ReviewRequestWithAssignments,
    ReviewerInboxItem, SyncActiveRequestsBody, SyncActiveRequestsResponse,
    UpdateAssignmentStatusBody,
};

use crate::store::team_settings::TeamOrchestrationSettings;
use crate::team::client::TeamRelayRuntime;
use crate::team::outbox::{classify_http_status, DeliveryAttemptResult, OutboxPayload};
use crate::team::RelayTestResult;

pub fn build_http_client(bypass_proxy: bool) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(10));
    if bypass_proxy {
        builder = builder.no_proxy();
    }
    builder
        .build()
        .map_err(|e| format!("failed to build http client: {}", e))
}

pub fn build_ws_url(base_http_url: &str, team_key: &str) -> Option<String> {
    let trimmed = base_http_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return None;
    }
    let ws_base = if let Some(rest) = trimmed.strip_prefix("https://") {
        format!("wss://{}", rest)
    } else if let Some(rest) = trimmed.strip_prefix("http://") {
        format!("ws://{}", rest)
    } else {
        format!("ws://{}", trimmed)
    };
    let encoded_key = percent_encode_query(team_key.trim());
    Some(format!("{}/ws?team_key={}", ws_base, encoded_key))
}

fn percent_encode_query(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for b in raw.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

/// Standalone 1-click connection test used from Settings modal (works with unsaved draft values).
pub async fn test_relay_connection(
    relay_url: &str,
    team_key: &str,
    bypass_proxy: bool,
) -> RelayTestResult {
    let start = Instant::now();
    let trimmed = relay_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return fail_test(0, false, None, None, 0, "Relay URL is empty".to_string());
    }
    let base = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("http://{}", trimmed)
    };

    let client = match build_http_client(bypass_proxy) {
        Ok(c) => c,
        Err(err) => return fail_test(start.elapsed().as_millis() as u64, false, None, None, 0, err),
    };

    let health_resp = match client.get(format!("{}/health", base)).send().await {
        Ok(r) => r,
        Err(err) => {
            return fail_test(
                start.elapsed().as_millis() as u64,
                false,
                None,
                None,
                0,
                format!("Cannot reach relay: {}", err),
            )
        }
    };
    if !health_resp.status().is_success() {
        return fail_test(
            start.elapsed().as_millis() as u64,
            false,
            None,
            None,
            0,
            format!("/health returned HTTP {}", health_resp.status()),
        );
    }
    let health: HealthResponse = match health_resp.json().await {
        Ok(h) => h,
        Err(err) => {
            return fail_test(
                start.elapsed().as_millis() as u64,
                false,
                None,
                None,
                0,
                format!("Invalid /health JSON: {}", err),
            )
        }
    };

    let peers_resp = match client
        .get(format!("{}/api/v1/peers", base))
        .header("x-team-key", team_key.trim())
        .send()
        .await
    {
        Ok(r) => r,
        Err(err) => {
            return fail_test(
                start.elapsed().as_millis() as u64,
                true,
                Some(health.version),
                Some(health.protocol_version),
                health.online_peers,
                format!("/api/v1/peers failed: {}", err),
            )
        }
    };

    if !peers_resp.status().is_success() {
        let code = peers_resp.status().as_u16();
        let msg = if code == 401 {
            "Relay reachable, but TEAM_KEY was rejected (401 Unauthorized)".to_string()
        } else {
            format!("Relay auth check failed (HTTP {})", code)
        };
        return fail_test(
            start.elapsed().as_millis() as u64,
            true,
            Some(health.version),
            Some(health.protocol_version),
            health.online_peers,
            msg,
        );
    }

    let peers: Vec<PeerInfo> = peers_resp.json().await.unwrap_or_default();
    RelayTestResult {
        ok: true,
        health_ok: true,
        auth_ok: true,
        latency_ms: start.elapsed().as_millis() as u64,
        server_version: Some(health.version),
        protocol_version: Some(health.protocol_version),
        online_peers: health.online_peers,
        total_peers: peers.len(),
        error: None,
    }
}

fn fail_test(
    latency_ms: u64,
    health_ok: bool,
    server_version: Option<String>,
    protocol_version: Option<u32>,
    online_peers: usize,
    error: String,
) -> RelayTestResult {
    RelayTestResult {
        ok: false,
        health_ok,
        auth_ok: false,
        latency_ms,
        server_version,
        protocol_version,
        online_peers,
        total_peers: 0,
        error: Some(error),
    }
}

impl TeamRelayRuntime {
    /// Flush queued outbox items over REST. Permanent errors (400/404/409) and TTL-expired
    /// entries are dropped; transient errors remain for the next reconnect.
    pub async fn flush_outbox(&self, team: &TeamOrchestrationSettings) -> usize {
        let Some(base_url) = team.normalized_relay_base_url() else {
            return 0;
        };
        let team_key = team.team_key.trim().to_string();
        if team_key.is_empty() {
            return 0;
        }
        let entries = {
            let Ok(mut guard) = self.outbox.lock() else {
                return 0;
            };
            guard.prune_expired(Utc::now().timestamp_millis());
            if guard.is_empty() {
                return 0;
            }
            guard.entries().to_vec()
        };

        let Ok(client) = build_http_client(team.bypass_proxy) else {
            return 0;
        };

        let mut outcomes = Vec::with_capacity(entries.len());
        let mut sent_count = 0usize;

        for entry in entries {
            let (url, body_res) = match entry.payload {
                OutboxPayload::ReportStatus { request_id, body } => (
                    format!("{}/api/v1/reviews/{}/status", base_url, request_id),
                    serde_json::to_value(body),
                ),
                OutboxPayload::SubmitReview { body } => (
                    format!("{}/api/v1/reviews", base_url),
                    serde_json::to_value(body),
                ),
            };
            let Ok(payload_val) = body_res else {
                outcomes.push((
                    entry.id,
                    DeliveryAttemptResult::PermanentDrop,
                    Some("serialization error".to_string()),
                ));
                continue;
            };

            let (res, err_msg) = match client
                .post(url)
                .header("x-team-key", &team_key)
                .json(&payload_val)
                .send()
                .await
            {
                Ok(resp) => {
                    let code = resp.status().as_u16();
                    let classified = classify_http_status(code);
                    let msg = if classified == DeliveryAttemptResult::Sent {
                        None
                    } else {
                        Some(format!("HTTP {}", code))
                    };
                    (classified, msg)
                }
                Err(e) => (DeliveryAttemptResult::RetryLater, Some(e.to_string())),
            };

            if res == DeliveryAttemptResult::Sent {
                sent_count += 1;
            }
            outcomes.push((entry.id, res, err_msg));
        }

        if let Ok(mut guard) = self.outbox.lock() {
            guard.apply_flush_outcomes(&outcomes);
        }
        sent_count
    }

    pub async fn rest_submit_review(
        &self,
        team: &TeamOrchestrationSettings,
        body: CreateReviewRequestBody,
    ) -> Result<CreateReviewRequestResponse, String> {
        let base = team
            .normalized_relay_base_url()
            .ok_or_else(|| "Relay URL is not configured".to_string())?;
        let client = build_http_client(team.bypass_proxy)?;
        let resp = client
            .post(format!("{}/api/v1/reviews", base))
            .header("x-team-key", team.team_key.trim())
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("relay request failed: {}", e))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("HTTP {}: {}", status, text));
        }
        resp.json::<CreateReviewRequestResponse>()
            .await
            .map_err(|e| format!("invalid relay response: {}", e))
    }

    pub async fn rest_report_status(
        &self,
        team: &TeamOrchestrationSettings,
        request_id: &str,
        mut body: UpdateAssignmentStatusBody,
    ) -> Result<(), String> {
        if body.device_id.is_none() {
            body.device_id = Some(self.device_id().to_string());
        }
        let base = team
            .normalized_relay_base_url()
            .ok_or_else(|| "Relay URL is not configured".to_string())?;
        let client = build_http_client(team.bypass_proxy)?;
        match client
            .post(format!("{}/api/v1/reviews/{}/status", base, request_id))
            .header("x-team-key", team.team_key.trim())
            .json(&body)
            .send()
            .await
        {
            Ok(resp) => {
                let code = resp.status().as_u16();
                match classify_http_status(code) {
                    DeliveryAttemptResult::Sent => Ok(()),
                    DeliveryAttemptResult::PermanentDrop => {
                        Err(format!("status rejected permanently (HTTP {})", code))
                    }
                    DeliveryAttemptResult::RetryLater => {
                        self.enqueue_outbox(OutboxPayload::ReportStatus {
                            request_id: request_id.to_string(),
                            body,
                        });
                        Err(format!("relay returned HTTP {}, queued in outbox", code))
                    }
                }
            }
            Err(err) => {
                self.enqueue_outbox(OutboxPayload::ReportStatus {
                    request_id: request_id.to_string(),
                    body,
                });
                Err(format!("relay unreachable ({}), queued in outbox", err))
            }
        }
    }

    pub async fn rest_cancel_review(
        &self,
        team: &TeamOrchestrationSettings,
        request_id: &str,
        body: CancelReviewRequestBody,
    ) -> Result<CancelReviewRequestResponse, String> {
        let base = team
            .normalized_relay_base_url()
            .ok_or_else(|| "Relay URL is not configured".to_string())?;
        let client = build_http_client(team.bypass_proxy)?;
        let resp = client
            .post(format!("{}/api/v1/reviews/{}/cancel", base, request_id))
            .header("x-team-key", team.team_key.trim())
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("cancel failed: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("HTTP {}", resp.status()));
        }
        resp.json().await.map_err(|e| e.to_string())
    }

    pub async fn rest_sync_active(
        &self,
        team: &TeamOrchestrationSettings,
        reviewer_id: &str,
        request_ids: Vec<String>,
    ) -> Result<SyncActiveRequestsResponse, String> {
        let base = team
            .normalized_relay_base_url()
            .ok_or_else(|| "Relay URL is not configured".to_string())?;
        let client = build_http_client(team.bypass_proxy)?;
        let body = SyncActiveRequestsBody {
            reviewer_id: reviewer_id.to_string(),
            device_id: Some(self.device_id().to_string()),
            request_ids,
        };
        let resp = client
            .post(format!("{}/api/v1/reviews/sync-active", base))
            .header("x-team-key", team.team_key.trim())
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("sync-active failed: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("HTTP {}", resp.status()));
        }
        resp.json().await.map_err(|e| e.to_string())
    }

    pub async fn rest_list_authored(
        &self,
        team: &TeamOrchestrationSettings,
        author_id: &str,
    ) -> Result<Vec<ReviewRequestWithAssignments>, String> {
        let base = team
            .normalized_relay_base_url()
            .ok_or_else(|| "Relay URL is not configured".to_string())?;
        let client = build_http_client(team.bypass_proxy)?;
        let resp = client
            .get(format!("{}/api/v1/reviews/authored/{}", base, author_id))
            .header("x-team-key", team.team_key.trim())
            .send()
            .await
            .map_err(|e| format!("list authored failed: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("HTTP {}", resp.status()));
        }
        resp.json().await.map_err(|e| e.to_string())
    }

    pub async fn rest_list_inbox(
        &self,
        team: &TeamOrchestrationSettings,
        reviewer_id: &str,
    ) -> Result<Vec<ReviewerInboxItem>, String> {
        let base = team
            .normalized_relay_base_url()
            .ok_or_else(|| "Relay URL is not configured".to_string())?;
        let client = build_http_client(team.bypass_proxy)?;
        let resp = client
            .get(format!("{}/api/v1/reviews/inbox/{}", base, reviewer_id))
            .header("x-team-key", team.team_key.trim())
            .send()
            .await
            .map_err(|e| format!("list inbox failed: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("HTTP {}", resp.status()));
        }
        resp.json().await.map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_ws_and_wss_urls_with_encoded_keys() {
        assert_eq!(
            build_ws_url("http://10.0.0.5:8787/", "my+secret/key").as_deref(),
            Some("ws://10.0.0.5:8787/ws?team_key=my%2Bsecret%2Fkey")
        );
        assert_eq!(
            build_ws_url("https://relay.corp.com", "abc-123").as_deref(),
            Some("wss://relay.corp.com/ws?team_key=abc-123")
        );
    }
}
