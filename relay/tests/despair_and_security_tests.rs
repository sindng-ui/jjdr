mod common;

use common::{
    connect_ws, hello_peer, recv_until, recv_ws_timeout, sample_review_body, send_ws, TestServer,
};
use futures_util::SinkExt;
use relay_protocol::{
    CancelReviewRequestBody, CancelReviewRequestResponse, ClientMessage,
    CreateReviewRequestResponse, HealthResponse, PeerInfo, PresenceStatus, RejectReason,
    ReviewAssignmentStatus, ServerMessage, UpdateAssignmentStatusBody, PROTOCOL_VERSION,
};
use reqwest::StatusCode;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message as WsMessage;

#[tokio::test]
async fn tc01_health_and_auth_failures() {
    let srv = TestServer::start().await;
    let client = reqwest::Client::new();

    let health_resp = client.get(srv.http_url("/health")).send().await.unwrap();
    assert_eq!(health_resp.status(), StatusCode::OK);
    let health: HealthResponse = health_resp.json().await.unwrap();
    assert_eq!(health.status, "ok");
    assert_eq!(health.protocol_version, PROTOCOL_VERSION);

    for bad_key in [None, Some(""), Some("wrong"), Some("TEST-SECRET-KEY")] {
        let mut req = client.get(srv.http_url("/api/v1/peers"));
        if let Some(k) = bad_key {
            req = req.header("x-team-key", k);
        }
        let resp = req.send().await.unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    let ws_err = connect_async(srv.ws_url("wrong-key")).await;
    assert!(ws_err.is_err());

    let ok_resp = client
        .get(srv.http_url("/api/v1/peers"))
        .header("authorization", format!("Bearer {}", srv.team_key))
        .send()
        .await
        .unwrap();
    assert_eq!(ok_resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn tc04_layer1_duplicate_sha_blocks_active_and_allows_after_cancel_or_new_sha() {
    let srv = TestServer::start().await;
    let repo = "https://github.corp.company.com/team/jjdr.git";
    let _ws_rev = hello_peer(&srv, "rev1", PresenceStatus::Online, &[repo]).await;

    let client = reqwest::Client::new();
    let r1: CreateReviewRequestResponse = client
        .post(srv.http_url("/api/v1/reviews"))
        .header("x-team-key", &srv.team_key)
        .json(&sample_review_body("author", &["rev1"], 500, "sha_aaa111", repo))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(r1.assignments[0].status, ReviewAssignmentStatus::Dispatched);

    let r_dup: CreateReviewRequestResponse = client
        .post(srv.http_url("/api/v1/reviews"))
        .header("x-team-key", &srv.team_key)
        .json(&sample_review_body("author", &["rev1"], 500, "sha_aaa111", repo))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(r_dup.assignments[0].status, ReviewAssignmentStatus::Rejected);
    assert_eq!(
        r_dup.assignments[0].reject_reason,
        Some(RejectReason::DuplicateSha)
    );

    let r_new_sha: CreateReviewRequestResponse = client
        .post(srv.http_url("/api/v1/reviews"))
        .header("x-team-key", &srv.team_key)
        .json(&sample_review_body("author", &["rev1"], 500, "sha_bbb222", repo))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        r_new_sha.assignments[0].status,
        ReviewAssignmentStatus::Dispatched
    );

    let cancel_resp: CancelReviewRequestResponse = client
        .post(srv.http_url(&format!("/api/v1/reviews/{}/cancel", r1.request.request_id)))
        .header("x-team-key", &srv.team_key)
        .json(&CancelReviewRequestBody {
            author_id: "author".to_string(),
            reviewer_ids: vec![],
            reason: Some("re-triggering".to_string()),
        })
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(cancel_resp.cancelled_reviewers, vec!["rev1".to_string()]);

    let r_retry: CreateReviewRequestResponse = client
        .post(srv.http_url("/api/v1/reviews"))
        .header("x-team-key", &srv.team_key)
        .json(&sample_review_body("author", &["rev1"], 500, "sha_aaa111", repo))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        r_retry.assignments[0].status,
        ReviewAssignmentStatus::Dispatched
    );
}

#[tokio::test]
async fn tc05_layer1_reviewer_paused_rejects_and_recovers_on_resume() {
    let srv = TestServer::start().await;
    let repo = "https://github.corp.company.com/team/jjdr.git";
    let mut ws_rev = hello_peer(&srv, "paused_dev", PresenceStatus::Paused, &[repo]).await;

    let client = reqwest::Client::new();
    let rejected: CreateReviewRequestResponse = client
        .post(srv.http_url("/api/v1/reviews"))
        .header("x-team-key", &srv.team_key)
        .json(&sample_review_body("author", &["paused_dev"], 601, "sha_601aaa", repo))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        rejected.assignments[0].status,
        ReviewAssignmentStatus::Rejected
    );
    assert_eq!(
        rejected.assignments[0].reject_reason,
        Some(RejectReason::ReviewerPaused)
    );

    send_ws(
        &mut ws_rev,
        &ClientMessage::UpdatePresence {
            status: PresenceStatus::Online,
            repo_urls: None,
            display_name: None,
        },
    )
    .await;
    let _ = recv_until(&mut ws_rev, 2000, |m| {
        matches!(m, ServerMessage::PeersUpdated { .. })
    })
    .await;

    let ok_res: CreateReviewRequestResponse = client
        .post(srv.http_url("/api/v1/reviews"))
        .header("x-team-key", &srv.team_key)
        .json(&sample_review_body("author", &["paused_dev"], 601, "sha_601aaa", repo))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        ok_res.assignments[0].status,
        ReviewAssignmentStatus::Dispatched
    );
}

#[tokio::test]
async fn tc06_layer1_repo_not_registered_rejects_and_recovers_after_sync() {
    let srv = TestServer::start().await;
    let repo_a = "https://github.corp.company.com/team/repo-a.git";
    let repo_b = "https://github.corp.company.com/team/repo-b.git";

    let mut ws_rev = hello_peer(&srv, "dev_a", PresenceStatus::Online, &[repo_a]).await;
    let client = reqwest::Client::new();

    let rej: CreateReviewRequestResponse = client
        .post(srv.http_url("/api/v1/reviews"))
        .header("x-team-key", &srv.team_key)
        .json(&sample_review_body("author", &["dev_a"], 701, "sha_701aaa", repo_b))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(rej.assignments[0].status, ReviewAssignmentStatus::Rejected);
    assert_eq!(
        rej.assignments[0].reject_reason,
        Some(RejectReason::RepoNotRegistered)
    );

    send_ws(
        &mut ws_rev,
        &ClientMessage::UpdatePresence {
            status: PresenceStatus::Online,
            repo_urls: Some(vec![repo_a.to_string(), repo_b.to_string()]),
            display_name: None,
        },
    )
    .await;
    let _ = recv_until(&mut ws_rev, 2000, |m| {
        matches!(m, ServerMessage::PeersUpdated { .. })
    })
    .await;

    let ok_res: CreateReviewRequestResponse = client
        .post(srv.http_url("/api/v1/reviews"))
        .header("x-team-key", &srv.team_key)
        .json(&sample_review_body("author", &["dev_a"], 701, "sha_701aaa", repo_b))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        ok_res.assignments[0].status,
        ReviewAssignmentStatus::Dispatched
    );
}

#[tokio::test]
async fn tc07_layer1_expired_ttl_sweeps_and_never_delivers_on_late_reconnect() {
    let srv = TestServer::start().await;
    let repo = "https://github.corp.company.com/team/jjdr.git";

    let mut ws_author = hello_peer(&srv, "author", PresenceStatus::Online, &[repo]).await;
    let ws_ghost_initial = hello_peer(&srv, "ghost_rev", PresenceStatus::Online, &[repo]).await;
    let client = reqwest::Client::new();

    let created: CreateReviewRequestResponse = client
        .post(srv.http_url("/api/v1/reviews"))
        .header("x-team-key", &srv.team_key)
        .json(&sample_review_body("author", &["ghost_rev"], 801, "sha_801aaa", repo))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        created.assignments[0].status,
        ReviewAssignmentStatus::Dispatched
    );

    // Ghost drops before ACKing delivery
    drop(ws_ghost_initial);
    tokio::time::sleep(std::time::Duration::from_millis(60)).await;

    let req_id = created.request.request_id.clone();
    srv.app
        .service
        .db
        .run(move |conn| {
            conn.execute(
                "UPDATE review_assignments SET expires_ms = 1 WHERE request_id = ?1",
                rusqlite::params![req_id],
            )
            .unwrap();
            Ok(())
        })
        .await
        .unwrap();

    let expired_count = srv.app.service.sweep_expired_assignments().await.unwrap();
    assert_eq!(expired_count, 1);

    let exp_evt = recv_until(&mut ws_author, 2000, |m| {
        matches!(
            m,
            ServerMessage::AssignmentStatusChanged {
                status: ReviewAssignmentStatus::Expired,
                reject_reason: Some(RejectReason::ExpiredTtl),
                ..
            }
        )
    })
    .await;
    assert!(matches!(
        exp_evt,
        ServerMessage::AssignmentStatusChanged { .. }
    ));

    let mut ws_ghost = hello_peer(&srv, "ghost_rev", PresenceStatus::Online, &[repo]).await;
    let maybe_stale = recv_ws_timeout(&mut ws_ghost, 250).await;
    assert!(
        !matches!(maybe_stale, Some(ServerMessage::ReviewAssigned { .. })),
        "expired request must never be delivered"
    );
}

#[tokio::test]
async fn tc08_concurrent_20_duplicate_requests_race_condition_only_one_wins() {
    let srv = TestServer::start().await;
    let repo = "https://github.corp.company.com/team/jjdr.git";
    let _ws_rev = hello_peer(&srv, "race_rev", PresenceStatus::Online, &[repo]).await;

    let client = reqwest::Client::new();
    let mut handles = Vec::new();
    for _ in 0..20 {
        let c = client.clone();
        let url = srv.http_url("/api/v1/reviews");
        let key = srv.team_key.clone();
        let body = sample_review_body("author", &["race_rev"], 901, "sha_race901", repo);
        handles.push(tokio::spawn(async move {
            let resp = c
                .post(url)
                .header("x-team-key", key)
                .json(&body)
                .send()
                .await
                .unwrap();
            assert_eq!(resp.status(), StatusCode::CREATED);
            resp.json::<CreateReviewRequestResponse>().await.unwrap()
        }));
    }

    let mut dispatched = 0usize;
    let mut dup_rejected = 0usize;
    for h in handles {
        let res = h.await.unwrap();
        match (res.assignments[0].status, res.assignments[0].reject_reason) {
            (ReviewAssignmentStatus::Dispatched, None) => dispatched += 1,
            (ReviewAssignmentStatus::Rejected, Some(RejectReason::DuplicateSha)) => {
                dup_rejected += 1
            }
            other => panic!("unexpected race outcome: {:?}", other),
        }
    }

    assert_eq!(dispatched, 1, "exactly one concurrent request must win");
    assert_eq!(dup_rejected, 19, "remaining 19 must be atomic DuplicateSha");
}

#[tokio::test]
async fn tc09_malformed_inputs_self_review_dedup_and_bounds() {
    let srv = TestServer::start().await;
    let repo = "https://github.corp.company.com/team/jjdr.git";
    let client = reqwest::Client::new();

    let self_only = client
        .post(srv.http_url("/api/v1/reviews"))
        .header("x-team-key", &srv.team_key)
        .json(&sample_review_body("alice", &["@ALICE", "alice"], 10, "abcdef1", repo))
        .send()
        .await
        .unwrap();
    assert_eq!(self_only.status(), StatusCode::BAD_REQUEST);

    let dedup_resp: CreateReviewRequestResponse = client
        .post(srv.http_url("/api/v1/reviews"))
        .header("x-team-key", &srv.team_key)
        .json(&sample_review_body(
            "alice",
            &["alice", "@Bob", "bob", "BOB"],
            11,
            "abcdef1",
            repo,
        ))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(dedup_resp.assignments.len(), 1);
    assert_eq!(dedup_resp.assignments[0].reviewer_id, "bob");

    let too_many = client
        .post(srv.http_url("/api/v1/reviews"))
        .header("x-team-key", &srv.team_key)
        .json(&sample_review_body(
            "alice",
            &["r1", "r2", "r3", "r4", "r5", "r6"],
            12,
            "abcdef1",
            repo,
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(too_many.status(), StatusCode::BAD_REQUEST);

    for bad_body in [
        sample_review_body("alice", &["bob"], 0, "abcdef1", repo),
        sample_review_body("alice", &["bob"], 13, "123", repo),
        sample_review_body("alice", &["bob"], 14, "abcdef1", "C:\\local\\repo"),
    ] {
        let resp = client
            .post(srv.http_url("/api/v1/reviews"))
            .header("x-team-key", &srv.team_key)
            .json(&bad_body)
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }
}

#[tokio::test]
async fn tc10_adversarial_forbidden_hijack_and_terminal_immutability() {
    let srv = TestServer::start().await;
    let repo = "https://github.corp.company.com/team/jjdr.git";
    let _ws_rev = hello_peer(&srv, "bob", PresenceStatus::Online, &[repo]).await;
    let mut ws_mallory = hello_peer(&srv, "mallory", PresenceStatus::Online, &[repo]).await;

    let client = reqwest::Client::new();
    let created: CreateReviewRequestResponse = client
        .post(srv.http_url("/api/v1/reviews"))
        .header("x-team-key", &srv.team_key)
        .json(&sample_review_body("alice", &["bob"], 201, "sha_201aaa", repo))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let req_id = created.request.request_id.clone();

    let hijack_http = client
        .post(srv.http_url(&format!("/api/v1/reviews/{}/status", req_id)))
        .header("x-team-key", &srv.team_key)
        .json(&UpdateAssignmentStatusBody {
            reviewer_id: "mallory".to_string(),
            status: ReviewAssignmentStatus::Completed,
            reject_reason: None,
            detail: None,
            worker_agent: None,
            device_id: None,
        })
        .send()
        .await
        .unwrap();
    assert_eq!(hijack_http.status(), StatusCode::FORBIDDEN);

    send_ws(
        &mut ws_mallory,
        &ClientMessage::ReportStatus {
            request_id: req_id.clone(),
            status: ReviewAssignmentStatus::Completed,
            reject_reason: None,
            detail: None,
            worker_agent: None,
        },
    )
    .await;
    let ws_err = recv_until(&mut ws_mallory, 2000, |m| {
        matches!(m, ServerMessage::Error { code, .. } if code == "forbidden")
    })
    .await;
    assert!(matches!(ws_err, ServerMessage::Error { .. }));

    let bad_cancel = client
        .post(srv.http_url(&format!("/api/v1/reviews/{}/cancel", req_id)))
        .header("x-team-key", &srv.team_key)
        .json(&CancelReviewRequestBody {
            author_id: "mallory".to_string(),
            reviewer_ids: vec![],
            reason: None,
        })
        .send()
        .await
        .unwrap();
    assert_eq!(bad_cancel.status(), StatusCode::FORBIDDEN);

    let ok_done = client
        .post(srv.http_url(&format!("/api/v1/reviews/{}/status", req_id)))
        .header("x-team-key", &srv.team_key)
        .json(&UpdateAssignmentStatusBody {
            reviewer_id: "bob".to_string(),
            status: ReviewAssignmentStatus::Completed,
            reject_reason: None,
            detail: None,
            worker_agent: Some("gemini".to_string()),
            device_id: None,
        })
        .send()
        .await
        .unwrap();
    assert_eq!(ok_done.status(), StatusCode::OK);

    let late_cancel: CancelReviewRequestResponse = client
        .post(srv.http_url(&format!("/api/v1/reviews/{}/cancel", req_id)))
        .header("x-team-key", &srv.team_key)
        .json(&CancelReviewRequestBody {
            author_id: "alice".to_string(),
            reviewer_ids: vec![],
            reason: Some("too late".to_string()),
        })
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(late_cancel.cancelled_reviewers.is_empty());
    assert_eq!(
        late_cancel.skipped_terminal_reviewers,
        vec!["bob".to_string()]
    );

    let late_status = client
        .post(srv.http_url(&format!("/api/v1/reviews/{}/status", req_id)))
        .header("x-team-key", &srv.team_key)
        .json(&UpdateAssignmentStatusBody {
            reviewer_id: "bob".to_string(),
            status: ReviewAssignmentStatus::Reviewing,
            reject_reason: None,
            detail: None,
            worker_agent: None,
            device_id: None,
        })
        .send()
        .await
        .unwrap();
    assert_eq!(late_status.status(), StatusCode::CONFLICT);

    let mut raw_ws = connect_ws(&srv).await;
    raw_ws
        .send(WsMessage::Text("{{{not-json".into()))
        .await
        .unwrap();
    let e1 = recv_ws_timeout(&mut raw_ws, 1000).await.unwrap();
    assert!(matches!(e1, ServerMessage::Error { code, .. } if code == "invalid_json"));

    send_ws(
        &mut raw_ws,
        &ClientMessage::ReportStatus {
            request_id: req_id,
            status: ReviewAssignmentStatus::Reviewing,
            reject_reason: None,
            detail: None,
            worker_agent: None,
        },
    )
    .await;
    let e2 = recv_ws_timeout(&mut raw_ws, 1000).await.unwrap();
    assert!(matches!(e2, ServerMessage::Error { code, .. } if code == "not_authenticated"));
}

#[tokio::test]
async fn tc12_rate_limit_blocks_spam_flood_with_429() {
    let srv = TestServer::start_custom(48, 3).await;
    let repo = "https://github.corp.company.com/team/jjdr.git";
    let client = reqwest::Client::new();

    for i in 1..=3 {
        let resp = client
            .post(srv.http_url("/api/v1/reviews"))
            .header("x-team-key", &srv.team_key)
            .json(&sample_review_body("spammer", &["bob"], i, "abcdef12", repo))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);
    }

    let blocked = client
        .post(srv.http_url("/api/v1/reviews"))
        .header("x-team-key", &srv.team_key)
        .json(&sample_review_body("spammer", &["bob"], 4, "abcdef12", repo))
        .send()
        .await
        .unwrap();
    assert_eq!(blocked.status(), StatusCode::TOO_MANY_REQUESTS);

    let innocent = client
        .post(srv.http_url("/api/v1/reviews"))
        .header("x-team-key", &srv.team_key)
        .json(&sample_review_body("innocent", &["bob"], 5, "abcdef12", repo))
        .send()
        .await
        .unwrap();
    assert_eq!(innocent.status(), StatusCode::CREATED);
}

#[tokio::test]
async fn tc13_unicode_emoji_and_sql_injection_payload_safety() {
    let srv = TestServer::start().await;
    let repo = "https://github.corp.company.com/team/jjdr.git";
    let _ws_rev = hello_peer(&srv, "bob", PresenceStatus::Online, &[repo]).await;

    let mut body = sample_review_body("alice", &["bob"], 777, "abcdef123", repo);
    body.pr_title = "🔥 결제 롤백 수정 '; DROP TABLE peers; DROP TABLE review_assignments; --".to_string();

    let client = reqwest::Client::new();
    let created: CreateReviewRequestResponse = client
        .post(srv.http_url("/api/v1/reviews"))
        .header("x-team-key", &srv.team_key)
        .json(&body)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(created.request.pr_title, body.pr_title);

    let peers: Vec<PeerInfo> = client
        .get(srv.http_url("/api/v1/peers"))
        .header("x-team-key", &srv.team_key)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(peers.len(), 1);
}
