mod common;

use std::time::Duration;

use common::{
    hello_peer, hello_peer_device, recv_until, recv_ws_timeout, sample_review_body, send_ws,
    TestServer,
};
use relay_protocol::{
    CancelReviewRequestBody, ClientMessage, CreateReviewRequestResponse, PeerInfo, PresenceStatus,
    RejectReason, ReviewAssignmentStatus, ServerMessage, SyncActiveRequestsBody,
    SyncActiveRequestsResponse, UpdateAssignmentStatusBody,
};
use reqwest::StatusCode;

#[tokio::test]
async fn tc16_explicit_delivery_ack_and_half_open_drop_redelivery() {
    let srv = TestServer::start().await;
    let repo = "https://github.corp.company.com/team/jjdr.git";

    let mut ws_author = hello_peer(&srv, "alice", PresenceStatus::Online, &[repo]).await;
    let ws_rev_dropped =
        hello_peer_device(&srv, "bob", PresenceStatus::Online, &[repo], Some("pc-1")).await;

    let client = reqwest::Client::new();
    let created: CreateReviewRequestResponse = client
        .post(srv.http_url("/api/v1/reviews"))
        .header("x-team-key", &srv.team_key)
        .json(&sample_review_body("alice", &["bob"], 1601, "sha_1601aa", repo))
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

    // Simulate bob's PC sleeping/disconnecting BEFORE sending AckDelivery!
    drop(ws_rev_dropped);
    tokio::time::sleep(Duration::from_millis(80)).await;

    // Author must NOT have received Delivered yet
    let unexpected = recv_ws_timeout(&mut ws_author, 150).await;
    assert!(
        !matches!(
            unexpected,
            Some(ServerMessage::AssignmentStatusChanged {
                status: ReviewAssignmentStatus::Delivered,
                ..
            })
        ),
        "must not mark Delivered before explicit AckDelivery"
    );

    // Bob wakes up and reconnects -> un-ACKed Dispatched request is re-pushed automatically!
    let mut ws_rev_back =
        hello_peer_device(&srv, "bob", PresenceStatus::Online, &[repo], Some("pc-1")).await;
    let redelivered = recv_until(&mut ws_rev_back, 2000, |m| {
        matches!(m, ServerMessage::ReviewAssigned { .. })
    })
    .await;
    let req_id = match redelivered {
        ServerMessage::ReviewAssigned { request, .. } => {
            assert_eq!(request.pr_number, 1601);
            request.request_id
        }
        _ => panic!("expected redelivered ReviewAssigned"),
    };

    // Bob sends AckDelivery -> transitions to Delivered and notifies author!
    send_ws(&mut ws_rev_back, &ClientMessage::AckDelivery { request_id: req_id }).await;
    let delivered_evt = recv_until(&mut ws_author, 2000, |m| {
        matches!(
            m,
            ServerMessage::AssignmentStatusChanged {
                pr_number: 1601,
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

    // If bob reconnects a third time after ACK, the request is NOT re-pushed as un-ACKed!
    drop(ws_rev_back);
    tokio::time::sleep(Duration::from_millis(60)).await;
    let mut ws_rev_third =
        hello_peer_device(&srv, "bob", PresenceStatus::Online, &[repo], Some("pc-1")).await;
    let dup_push = recv_ws_timeout(&mut ws_rev_third, 200).await;
    assert!(
        !matches!(dup_push, Some(ServerMessage::ReviewAssigned { .. })),
        "already ACKed assignment must not be re-pushed on reconnect"
    );
}

#[tokio::test]
async fn tc17_ws_heartbeat_reaps_zombie_silent_socket() {
    // Aggressive test intervals: ping every 1s, reap after 2s of silence
    let srv = TestServer::start_with_heartbeat(48, 100, 1, 2).await;
    let repo = "https://github.corp.company.com/team/jjdr.git";

    // Connect and complete Hello, then DO NOT poll the socket (simulates Windows Sleep half-open)
    let _silent_zombie_ws =
        hello_peer_device(&srv, "sleeper", PresenceStatus::Online, &[repo], Some("lap-1")).await;

    let client = reqwest::Client::new();
    let peers_before: Vec<PeerInfo> = client
        .get(srv.http_url("/api/v1/peers"))
        .header("x-team-key", &srv.team_key)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        peers_before
            .iter()
            .find(|p| p.github_id == "sleeper")
            .unwrap()
            .status,
        PresenceStatus::Online
    );

    // Wait past pong_timeout (2s) + 1 ping cycle
    tokio::time::sleep(Duration::from_millis(3300)).await;

    let peers_after: Vec<PeerInfo> = client
        .get(srv.http_url("/api/v1/peers"))
        .header("x-team-key", &srv.team_key)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        peers_after
            .iter()
            .find(|p| p.github_id == "sleeper")
            .unwrap()
            .status,
        PresenceStatus::Offline,
        "unresponsive half-open socket must be reaped to Offline"
    );
}

#[tokio::test]
async fn tc18_dual_device_single_primary_delivery_and_atomic_claim_conflict() {
    let srv = TestServer::start().await;
    let repo = "https://github.corp.company.com/team/jjdr.git";

    // Same user "bob" connected from TWO PCs simultaneously
    let mut ws_desktop = hello_peer_device(
        &srv,
        "bob",
        PresenceStatus::Online,
        &[repo],
        Some("device-desktop"),
    )
    .await;
    let mut ws_laptop = hello_peer_device(
        &srv,
        "bob",
        PresenceStatus::Online,
        &[repo],
        Some("device-laptop"),
    )
    .await;

    let client = reqwest::Client::new();
    let created: CreateReviewRequestResponse = client
        .post(srv.http_url("/api/v1/reviews"))
        .header("x-team-key", &srv.team_key)
        .json(&sample_review_body("alice", &["bob"], 1801, "sha_1801aa", repo))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let req_id = created.request.request_id.clone();

    // Primary (most recent: laptop) receives ReviewAssigned
    let laptop_msg = recv_until(&mut ws_laptop, 2000, |m| {
        matches!(m, ServerMessage::ReviewAssigned { .. })
    })
    .await;
    assert!(matches!(laptop_msg, ServerMessage::ReviewAssigned { .. }));

    // Secondary (desktop) must NOT receive ReviewAssigned (no double execution!)
    let desktop_msg = recv_ws_timeout(&mut ws_desktop, 250).await;
    assert!(
        !matches!(desktop_msg, Some(ServerMessage::ReviewAssigned { .. })),
        "secondary PC must not receive duplicate ReviewAssigned"
    );

    // Laptop ACKs and claims the assignment
    send_ws(
        &mut ws_laptop,
        &ClientMessage::AckDelivery {
            request_id: req_id.clone(),
        },
    )
    .await;
    tokio::time::sleep(Duration::from_millis(60)).await;

    // Even if desktop manually tries to report Reviewing via REST or WS -> 409 Conflict!
    let desktop_conflict = client
        .post(srv.http_url(&format!("/api/v1/reviews/{}/status", req_id)))
        .header("x-team-key", &srv.team_key)
        .json(&UpdateAssignmentStatusBody {
            reviewer_id: "bob".to_string(),
            status: ReviewAssignmentStatus::Reviewing,
            reject_reason: None,
            detail: None,
            worker_agent: Some("claude".to_string()),
            device_id: Some("device-desktop".to_string()),
        })
        .send()
        .await
        .unwrap();
    assert_eq!(desktop_conflict.status(), StatusCode::CONFLICT);

    send_ws(
        &mut ws_desktop,
        &ClientMessage::AckDelivery {
            request_id: req_id.clone(),
        },
    )
    .await;
    let ws_conflict = recv_until(&mut ws_desktop, 2000, |m| {
        matches!(m, ServerMessage::Error { code, .. } if code == "conflict")
    })
    .await;
    assert!(matches!(ws_conflict, ServerMessage::Error { .. }));

    // Claiming device (laptop) succeeds cleanly
    let laptop_ok = client
        .post(srv.http_url(&format!("/api/v1/reviews/{}/status", req_id)))
        .header("x-team-key", &srv.team_key)
        .json(&UpdateAssignmentStatusBody {
            reviewer_id: "bob".to_string(),
            status: ReviewAssignmentStatus::Reviewing,
            reject_reason: None,
            detail: None,
            worker_agent: Some("claude".to_string()),
            device_id: Some("device-laptop".to_string()),
        })
        .send()
        .await
        .unwrap();
    assert_eq!(laptop_ok.status(), StatusCode::OK);
}

#[tokio::test]
async fn tc19_offline_cancel_caught_by_sync_active_on_reconnect() {
    let srv = TestServer::start().await;
    let repo = "https://github.corp.company.com/team/jjdr.git";

    let mut ws_rev =
        hello_peer_device(&srv, "bob", PresenceStatus::Online, &[repo], Some("pc-bob")).await;
    let client = reqwest::Client::new();

    // Two PRs: #1901 will be cancelled while bob is offline; #1902 stays active
    let r1: CreateReviewRequestResponse = client
        .post(srv.http_url("/api/v1/reviews"))
        .header("x-team-key", &srv.team_key)
        .json(&sample_review_body("alice", &["bob"], 1901, "sha_1901aa", repo))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let r2: CreateReviewRequestResponse = client
        .post(srv.http_url("/api/v1/reviews"))
        .header("x-team-key", &srv.team_key)
        .json(&sample_review_body("alice", &["bob"], 1902, "sha_1902aa", repo))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    // Bob starts Reviewing both, then disconnects (PC reboot / sleep)
    for req_id in [&r1.request.request_id, &r2.request.request_id] {
        send_ws(
            &mut ws_rev,
            &ClientMessage::ReportStatus {
                request_id: req_id.clone(),
                status: ReviewAssignmentStatus::Reviewing,
                reject_reason: None,
                detail: None,
                worker_agent: Some("claude".to_string()),
            },
        )
        .await;
    }
    tokio::time::sleep(Duration::from_millis(80)).await;
    drop(ws_rev);
    tokio::time::sleep(Duration::from_millis(60)).await;

    // While bob is offline, alice cancels #1901!
    let cancel_resp = client
        .post(srv.http_url(&format!("/api/v1/reviews/{}/cancel", r1.request.request_id)))
        .header("x-team-key", &srv.team_key)
        .json(&CancelReviewRequestBody {
            author_id: "alice".to_string(),
            reviewer_ids: vec![],
            reason: Some("author pushed new fix".to_string()),
        })
        .send()
        .await
        .unwrap();
    assert_eq!(cancel_resp.status(), StatusCode::OK);

    // Bob reboots and calls POST /api/v1/reviews/sync-active before resuming local jobs
    let sync: SyncActiveRequestsResponse = client
        .post(srv.http_url("/api/v1/reviews/sync-active"))
        .header("x-team-key", &srv.team_key)
        .json(&SyncActiveRequestsBody {
            reviewer_id: "bob".to_string(),
            device_id: Some("pc-bob".to_string()),
            request_ids: vec![
                r1.request.request_id.clone(),
                r2.request.request_id.clone(),
                "non-existent-id".to_string(),
            ],
        })
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    assert_eq!(sync.results.len(), 3);
    // #1901 cancelled -> MUST abort
    assert_eq!(sync.results[0].status, Some(ReviewAssignmentStatus::Cancelled));
    assert!(sync.results[0].should_abort);
    // #1902 still reviewing on same device -> safe to resume!
    assert_eq!(sync.results[1].status, Some(ReviewAssignmentStatus::Reviewing));
    assert!(!sync.results[1].should_abort);
    // Unknown ID (e.g. wiped relay DB) -> abort safely
    assert_eq!(sync.results[2].status, None);
    assert!(sync.results[2].should_abort);
}

#[tokio::test]
async fn tc20_dispatched_unacked_assignment_expires_on_ttl_sweep() {
    let srv = TestServer::start().await;
    let repo = "https://github.corp.company.com/team/jjdr.git";

    let mut ws_author = hello_peer(&srv, "alice", PresenceStatus::Online, &[repo]).await;
    let _ws_rev = hello_peer(&srv, "bob", PresenceStatus::Online, &[repo]).await;

    let client = reqwest::Client::new();
    let created: CreateReviewRequestResponse = client
        .post(srv.http_url("/api/v1/reviews"))
        .header("x-team-key", &srv.team_key)
        .json(&sample_review_body("alice", &["bob"], 2001, "sha_2001aa", repo))
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

    // Expire the un-ACKed Dispatched assignment
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

    let swept = srv.app.service.sweep_expired_assignments().await.unwrap();
    assert_eq!(swept, 1);

    let exp_evt = recv_until(&mut ws_author, 2000, |m| {
        matches!(
            m,
            ServerMessage::AssignmentStatusChanged {
                pr_number: 2001,
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
}
