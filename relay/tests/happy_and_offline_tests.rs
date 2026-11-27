mod common;

use std::time::Duration;

use common::{hello_peer, recv_until, sample_review_body, send_ws, TestServer};
use jjdr_relay::config::RelayConfig;
use relay_protocol::{
    ClientMessage, CreateReviewRequestResponse, PeerInfo, PresenceStatus, RejectReason,
    ReviewAssignmentStatus, ReviewRequestWithAssignments, ReviewerInboxItem, ServerMessage,
};
use reqwest::StatusCode;

#[tokio::test]
async fn tc02_happy_path_two_reviewers_realtime_status_flow() {
    let srv = TestServer::start().await;
    let repo = "https://github.corp.company.com/team/jjdr.git";

    let mut ws_author = hello_peer(&srv, "@AuthorKim", PresenceStatus::Online, &[repo]).await;
    let mut ws_rev1 = hello_peer(&srv, "minsu", PresenceStatus::Online, &[repo]).await;
    let mut ws_rev2 = hello_peer(
        &srv,
        "younghee",
        PresenceStatus::Online,
        &["git@github.corp.company.com:Team/JJDR.git"],
    )
    .await;

    let client = reqwest::Client::new();
    let body = sample_review_body("authorkim", &["minsu", "younghee"], 412, "abcdef123456", repo);
    let resp = client
        .post(srv.http_url("/api/v1/reviews"))
        .header("x-team-key", &srv.team_key)
        .json(&body)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let created: CreateReviewRequestResponse = resp.json().await.unwrap();
    assert_eq!(created.assignments.len(), 2);
    assert!(created
        .assignments
        .iter()
        .all(|a| a.status == ReviewAssignmentStatus::Dispatched && a.known_peer));

    let msg1 = recv_until(&mut ws_rev1, 2000, |m| {
        matches!(m, ServerMessage::ReviewAssigned { .. })
    })
    .await;
    let msg2 = recv_until(&mut ws_rev2, 2000, |m| {
        matches!(m, ServerMessage::ReviewAssigned { .. })
    })
    .await;
    assert!(matches!(msg1, ServerMessage::ReviewAssigned { .. }));
    assert!(matches!(msg2, ServerMessage::ReviewAssigned { .. }));

    // Reviewer 1 sends explicit AckDelivery -> author receives Delivered
    send_ws(
        &mut ws_rev1,
        &ClientMessage::AckDelivery {
            request_id: created.request.request_id.clone(),
        },
    )
    .await;
    let ack_evt = recv_until(&mut ws_author, 2000, |m| {
        matches!(
            m,
            ServerMessage::AssignmentStatusChanged {
                reviewer_id,
                status: ReviewAssignmentStatus::Delivered,
                ..
            } if reviewer_id == "minsu"
        )
    })
    .await;
    assert!(matches!(
        ack_evt,
        ServerMessage::AssignmentStatusChanged { .. }
    ));

    for st in [
        ReviewAssignmentStatus::Queued,
        ReviewAssignmentStatus::Reviewing,
        ReviewAssignmentStatus::Completed,
    ] {
        send_ws(
            &mut ws_rev1,
            &ClientMessage::ReportStatus {
                request_id: created.request.request_id.clone(),
                status: st,
                reject_reason: None,
                detail: Some(format!("step {:?}", st)),
                worker_agent: Some("claude".to_string()),
            },
        )
        .await;
        let author_evt = recv_until(&mut ws_author, 2000, |m| {
            matches!(
                m,
                ServerMessage::AssignmentStatusChanged {
                    reviewer_id,
                    status,
                    ..
                } if reviewer_id == "minsu" && *status == st
            )
        })
        .await;
        assert!(matches!(
            author_evt,
            ServerMessage::AssignmentStatusChanged { .. }
        ));
    }

    let authored: Vec<ReviewRequestWithAssignments> = client
        .get(srv.http_url("/api/v1/reviews/authored/authorkim"))
        .header("x-team-key", &srv.team_key)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(authored.len(), 1);
    let minsu_state = authored[0]
        .assignments
        .iter()
        .find(|a| a.reviewer_id == "minsu")
        .unwrap();
    assert_eq!(minsu_state.status, ReviewAssignmentStatus::Completed);
    assert_eq!(minsu_state.worker_agent.as_deref(), Some("claude"));
}

#[tokio::test]
async fn tc03_offline_store_and_forward_survives_server_restart() {
    let srv = TestServer::start().await;
    let repo = "https://github.corp.company.com/team/jjdr.git";

    let ws_rev = hello_peer(&srv, "offline_dev", PresenceStatus::Online, &[repo]).await;
    drop(ws_rev);
    tokio::time::sleep(Duration::from_millis(60)).await;

    let client = reqwest::Client::new();
    for (pr, sha) in [(101, "1111111"), (102, "2222222")] {
        let resp = client
            .post(srv.http_url("/api/v1/reviews"))
            .header("x-team-key", &srv.team_key)
            .json(&sample_review_body("author", &["offline_dev"], pr, sha, repo))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);
        let created: CreateReviewRequestResponse = resp.json().await.unwrap();
        assert_eq!(
            created.assignments[0].status,
            ReviewAssignmentStatus::PendingOffline
        );
    }

    let (db_path, temp_dir) = srv.shutdown();
    let cfg = RelayConfig {
        bind_addr: "127.0.0.1:0".to_string(),
        db_path,
        team_key: "test-secret-key".to_string(),
        ttl_hours: 48,
        ttl_sweep_interval_secs: 3600,
        rate_limit_per_min: 100,
        max_reviewers_per_request: 5,
        ws_ping_interval_secs: 30,
        ws_pong_timeout_secs: 60,
    };
    let srv2 = TestServer::start_with_config(cfg, temp_dir).await;

    let mut ws_author = hello_peer(&srv2, "author", PresenceStatus::Online, &[repo]).await;
    let mut ws_rev2 = hello_peer(&srv2, "offline_dev", PresenceStatus::Online, &[repo]).await;

    let first = recv_until(&mut ws_rev2, 2000, |m| {
        matches!(m, ServerMessage::ReviewAssigned { .. })
    })
    .await;
    let second = recv_until(&mut ws_rev2, 2000, |m| {
        matches!(m, ServerMessage::ReviewAssigned { .. })
    })
    .await;

    let req1_id = match (first, second) {
        (
            ServerMessage::ReviewAssigned { request: r1, .. },
            ServerMessage::ReviewAssigned { request: r2, .. },
        ) => {
            assert_eq!(r1.pr_number, 101);
            assert_eq!(r2.pr_number, 102);
            r1.request_id
        }
        _ => panic!("expected two ReviewAssigned messages"),
    };

    // Reviewer ACKs delivery -> Author gets live Delivered notification
    send_ws(
        &mut ws_rev2,
        &ClientMessage::AckDelivery {
            request_id: req1_id,
        },
    )
    .await;

    let delivered_evt = recv_until(&mut ws_author, 2000, |m| {
        matches!(
            m,
            ServerMessage::AssignmentStatusChanged {
                pr_number: 101,
                status: ReviewAssignmentStatus::Delivered,
                ..
            }
        )
    })
    .await;
    assert!(matches!(
        delivered_evt,
        ServerMessage::AssignmentStatusChanged { .. }
    ));
}

#[tokio::test]
async fn tc11_dual_socket_reconnect_overlap_never_drops_presence() {
    let srv = TestServer::start().await;
    let repo = "https://github.corp.company.com/team/jjdr.git";

    let ws_old = hello_peer(&srv, "dual_dev", PresenceStatus::Online, &[repo]).await;
    let mut ws_new = hello_peer(&srv, "dual_dev", PresenceStatus::Online, &[repo]).await;

    drop(ws_old);
    tokio::time::sleep(Duration::from_millis(80)).await;

    let client = reqwest::Client::new();
    let peers: Vec<PeerInfo> = client
        .get(srv.http_url("/api/v1/peers"))
        .header("x-team-key", &srv.team_key)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let p = peers.iter().find(|p| p.github_id == "dual_dev").unwrap();
    assert_eq!(p.status, PresenceStatus::Online);

    let _: CreateReviewRequestResponse = client
        .post(srv.http_url("/api/v1/reviews"))
        .header("x-team-key", &srv.team_key)
        .json(&sample_review_body("author", &["dual_dev"], 301, "sha_301aaa", repo))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let got = recv_until(&mut ws_new, 2000, |m| {
        matches!(m, ServerMessage::ReviewAssigned { .. })
    })
    .await;
    assert!(matches!(got, ServerMessage::ReviewAssigned { .. }));
}

#[tokio::test]
async fn tc14_unknown_peer_offline_mailbox_and_first_join_delivery() {
    let srv = TestServer::start().await;
    let repo = "https://github.corp.company.com/team/jjdr.git";
    let client = reqwest::Client::new();

    let created: CreateReviewRequestResponse = client
        .post(srv.http_url("/api/v1/reviews"))
        .header("x-team-key", &srv.team_key)
        .json(&sample_review_body("alice", &["brand_new_dev"], 444, "sha_444aaa", repo))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        created.assignments[0].status,
        ReviewAssignmentStatus::PendingOffline
    );
    assert!(!created.assignments[0].known_peer);

    let inbox: Vec<ReviewerInboxItem> = client
        .get(srv.http_url("/api/v1/reviews/inbox/brand_new_dev"))
        .header("x-team-key", &srv.team_key)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(inbox.len(), 1);

    let mut ws_newbie = hello_peer(&srv, "brand_new_dev", PresenceStatus::Online, &[repo]).await;
    let msg = recv_until(&mut ws_newbie, 2000, |m| {
        matches!(m, ServerMessage::ReviewAssigned { .. })
    })
    .await;
    assert!(matches!(
        msg,
        ServerMessage::ReviewAssigned { request, .. } if request.pr_number == 444
    ));
}

#[tokio::test]
async fn tc15_layer2_reject_and_quota_failure_allow_retry() {
    let srv = TestServer::start().await;
    let repo = "https://github.corp.company.com/team/jjdr.git";
    let mut ws_author = hello_peer(&srv, "alice", PresenceStatus::Online, &[repo]).await;
    let mut ws_rev = hello_peer(&srv, "bob", PresenceStatus::Online, &[repo]).await;

    let client = reqwest::Client::new();
    let created: CreateReviewRequestResponse = client
        .post(srv.http_url("/api/v1/reviews"))
        .header("x-team-key", &srv.team_key)
        .json(&sample_review_body("alice", &["bob"], 555, "sha_555aaa", repo))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let _ = recv_until(&mut ws_rev, 2000, |m| {
        matches!(m, ServerMessage::ReviewAssigned { .. })
    })
    .await;

    send_ws(
        &mut ws_rev,
        &ClientMessage::ReportStatus {
            request_id: created.request.request_id.clone(),
            status: ReviewAssignmentStatus::Failed,
            reject_reason: Some(RejectReason::QuotaExhausted),
            detail: Some("claude & gemini quota exhausted".to_string()),
            worker_agent: Some("gemini".to_string()),
        },
    )
    .await;

    let fail_evt = recv_until(&mut ws_author, 2000, |m| {
        matches!(
            m,
            ServerMessage::AssignmentStatusChanged {
                status: ReviewAssignmentStatus::Failed,
                reject_reason: Some(RejectReason::QuotaExhausted),
                ..
            }
        )
    })
    .await;
    assert!(matches!(
        fail_evt,
        ServerMessage::AssignmentStatusChanged { .. }
    ));

    let retry: CreateReviewRequestResponse = client
        .post(srv.http_url("/api/v1/reviews"))
        .header("x-team-key", &srv.team_key)
        .json(&sample_review_body("alice", &["bob"], 555, "sha_555aaa", repo))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(retry.assignments[0].status, ReviewAssignmentStatus::Dispatched);
}
