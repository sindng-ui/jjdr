use chrono::Utc;
use relay_protocol::{
    normalize_github_id, normalize_repo_url, CancelReviewRequestBody, CancelReviewRequestResponse,
    CreateReviewRequestBody, PeerInfo, ReviewRequestWithAssignments,
};
use tauri::{AppHandle, State};

use crate::team::author::{
    assign_pr_reviewers_via_gh, evaluate_track_b_candidate, fetch_pr_for_author_review,
    find_unavailable_reviewers, make_prompted_pr_key, normalize_selected_reviewers,
    resolve_project_repo_url, PrReviewCandidate, SubmitTeamReviewInput, SubmitTeamReviewResult,
    MAX_REVIEWERS_PER_REQUEST,
};
use crate::team::http::test_relay_connection;
use crate::team::jobs::AutoReviewJob;
use crate::team::{RelayTestResult, TeamConnectionSnapshot};
use crate::AppState;

#[tauri::command]
pub async fn get_team_status(state: State<'_, AppState>) -> Result<TeamConnectionSnapshot, String> {
    Ok(state.team_relay.snapshot().await)
}

#[tauri::command]
pub async fn test_team_relay_connection(
    relay_url: String,
    team_key: String,
    bypass_proxy: bool,
) -> Result<RelayTestResult, String> {
    Ok(test_relay_connection(&relay_url, &team_key, bypass_proxy).await)
}

#[tauri::command]
pub async fn detect_team_github_id(state: State<'_, AppState>) -> Result<String, String> {
    state.team_relay.detect_github_id(&state.store).await
}

#[tauri::command]
pub async fn reconnect_team_relay(
    state: State<'_, AppState>,
) -> Result<TeamConnectionSnapshot, String> {
    state.team_relay.notify_config_changed();
    Ok(state.team_relay.snapshot().await)
}

#[tauri::command]
pub async fn list_team_peers(state: State<'_, AppState>) -> Result<Vec<PeerInfo>, String> {
    Ok(state.team_relay.snapshot().await.peers)
}

#[tauri::command]
pub async fn flush_team_outbox(state: State<'_, AppState>) -> Result<usize, String> {
    let team = state.store.get_settings().await.team;
    Ok(state.team_relay.flush_outbox(&team).await)
}

#[tauri::command]
pub async fn list_auto_review_jobs(
    state: State<'_, AppState>,
) -> Result<Vec<AutoReviewJob>, String> {
    Ok(state.auto_review.list_jobs())
}

#[tauri::command]
pub async fn ack_auto_review_job(
    app: AppHandle,
    state: State<'_, AppState>,
    request_id: String,
) -> Result<(), String> {
    state.auto_review.ack_job(&app, &request_id).await;
    Ok(())
}

#[tauri::command]
pub async fn cancel_auto_review_job(
    app: AppHandle,
    state: State<'_, AppState>,
    request_id: String,
) -> Result<(), String> {
    state.auto_review.cancel_local_job(&app, &request_id).await;
    Ok(())
}

async fn resolve_my_github_id(state: &State<'_, AppState>) -> Option<String> {
    let snap = state.team_relay.snapshot().await;
    if let Some(id) = snap.github_id.and_then(|s| normalize_github_id(&s)) {
        return Some(id);
    }
    let team = state.store.get_settings().await.team;
    if let Some(id) = normalize_github_id(&team.github_id_override) {
        return Some(id);
    }
    state
        .team_relay
        .detect_github_id(&state.store)
        .await
        .ok()
        .and_then(|s| normalize_github_id(&s))
}

#[tauri::command]
pub async fn inspect_pr_for_review_request(
    state: State<'_, AppState>,
    project_id: String,
    worktree_path: String,
    pr_number: u64,
    pr_url_hint: Option<String>,
    manual: bool,
) -> Result<PrReviewCandidate, String> {
    let projects = state.store.list_projects().await;
    let project = projects
        .into_iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| format!("Project not found: {}", project_id))?;

    let repo_url = resolve_project_repo_url(&project.repo_path).await?;
    let my_github_id = resolve_my_github_id(&state).await;
    let details = fetch_pr_for_author_review(&project.repo_path, &repo_url, pr_number).await?;

    let key = make_prompted_pr_key(&repo_url, details.pr_number, &details.head_sha);
    let already_prompted = state
        .prompted_prs
        .lock()
        .map(|guard| guard.has(&key))
        .unwrap_or(false);

    let eval = evaluate_track_b_candidate(
        &details,
        my_github_id.as_deref(),
        Utc::now().timestamp_millis(),
        already_prompted,
        manual,
    );

    let pr_url = if !details.pr_url.trim().is_empty() {
        details.pr_url
    } else {
        pr_url_hint.unwrap_or_default()
    };

    Ok(PrReviewCandidate {
        repo_url,
        project_id: project.id,
        project_name: project.name,
        worktree_path,
        pr_number: details.pr_number,
        pr_url,
        pr_title: details.pr_title,
        base_branch: details.base_branch,
        head_branch: details.head_branch,
        head_sha: details.head_sha,
        author_id: details.author_id,
        is_draft: details.is_draft,
        created_at_ms: details.created_at_ms,
        already_requested_reviewers: details.already_requested_reviewers,
        eligible_for_auto_prompt: eval.eligible,
        skip_reason: eval.skip_reason,
    })
}

#[tauri::command]
pub async fn submit_team_review_request(
    state: State<'_, AppState>,
    input: SubmitTeamReviewInput,
) -> Result<SubmitTeamReviewResult, String> {
    let projects = state.store.list_projects().await;
    let project = projects
        .into_iter()
        .find(|p| p.id == input.project_id)
        .ok_or_else(|| format!("Project not found: {}", input.project_id))?;

    let author_id = resolve_my_github_id(&state)
        .await
        .ok_or_else(|| "GitHub ID is not configured (set or detect it in Team Settings)".to_string())?;

    let reviewers = normalize_selected_reviewers(
        &input.reviewer_ids,
        Some(&author_id),
        MAX_REVIEWERS_PER_REQUEST,
    );
    if reviewers.is_empty() {
        return Err("Select at least one valid online reviewer (excluding yourself)".to_string());
    }

    // Enforce online-only policy: never allow review requests while Relay is offline
    // or for teammates who are currently offline / paused.
    let snap = state.team_relay.snapshot().await;
    if !snap.connected {
        return Err("Relay is offline — review requests cannot be sent while disconnected.".to_string());
    }
    let unavailable = find_unavailable_reviewers(&reviewers, &snap.peers);
    if !unavailable.is_empty() {
        let handles = unavailable
            .iter()
            .map(|id| format!("@{}", id))
            .collect::<Vec<_>>()
            .join(", ");
        return Err(format!(
            "Offline or paused reviewers cannot be selected: {}",
            handles
        ));
    }

    let norm_repo = normalize_repo_url(&input.repo_url)
        .or_else(|| None)
        .unwrap_or(resolve_project_repo_url(&project.repo_path).await?);

    let (gh_assigned, gh_error) = if input.assign_on_github {
        match assign_pr_reviewers_via_gh(&project.repo_path, &norm_repo, input.pr_number, &reviewers)
            .await
        {
            Ok(()) => (true, None),
            Err(err) => (false, Some(err)),
        }
    } else {
        (false, None)
    };

    let team = state.store.get_settings().await.team;
    let body = CreateReviewRequestBody {
        repo_url: norm_repo.clone(),
        pr_number: input.pr_number,
        pr_url: input.pr_url.clone(),
        pr_title: input.pr_title.clone(),
        base_branch: input.base_branch.clone(),
        head_branch: input.head_branch.clone(),
        head_sha: input.head_sha.clone(),
        author_id: author_id.clone(),
        reviewers: reviewers.clone(),
    };

    let key = make_prompted_pr_key(&norm_repo, input.pr_number, &input.head_sha);

    match state.team_relay.rest_submit_review(&team, body).await {
        Ok(resp) => {
            if let Ok(mut guard) = state.prompted_prs.lock() {
                guard.mark(key);
            }
            Ok(SubmitTeamReviewResult {
                request: Some(ReviewRequestWithAssignments {
                    request: resp.request,
                    assignments: resp.assignments,
                }),
                reviewers_sent: reviewers,
                gh_assigned,
                gh_error,
                queued_offline: false,
                relay_error: None,
            })
        }
        Err(err) => Err(format!("Relay unreachable — review request aborted: {}", err)),
    }
}

#[tauri::command]
pub async fn dismiss_pr_review_prompt(
    state: State<'_, AppState>,
    repo_url: String,
    pr_number: u64,
    head_sha: String,
) -> Result<(), String> {
    let key = make_prompted_pr_key(&repo_url, pr_number, &head_sha);
    if let Ok(mut guard) = state.prompted_prs.lock() {
        guard.mark(key);
    }
    Ok(())
}

#[tauri::command]
pub async fn list_authored_team_reviews(
    state: State<'_, AppState>,
) -> Result<Vec<ReviewRequestWithAssignments>, String> {
    let team = state.store.get_settings().await.team;
    if !team.enabled || team.normalized_relay_base_url().is_none() {
        return Ok(Vec::new());
    }
    let Some(author_id) = resolve_my_github_id(&state).await else {
        return Ok(Vec::new());
    };
    state
        .team_relay
        .rest_list_authored(&team, &author_id)
        .await
}

#[tauri::command]
pub async fn cancel_authored_team_review(
    state: State<'_, AppState>,
    request_id: String,
    reviewer_id: Option<String>,
    reason: Option<String>,
) -> Result<CancelReviewRequestResponse, String> {
    let team = state.store.get_settings().await.team;
    let author_id = resolve_my_github_id(&state)
        .await
        .ok_or_else(|| "GitHub ID is not configured".to_string())?;
    let reviewer_ids = reviewer_id
        .and_then(|r| normalize_github_id(&r))
        .into_iter()
        .collect();
    let body = CancelReviewRequestBody {
        author_id,
        reviewer_ids,
        reason,
    };
    state
        .team_relay
        .rest_cancel_review(&team, &request_id, body)
        .await
}
