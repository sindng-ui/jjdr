use relay_protocol::ReviewRequestPayload;

#[cfg(not(test))]
use std::path::Path;
#[cfg(not(test))]
use std::sync::{Arc, Mutex};
#[cfg(not(test))]
use std::time::Duration;
#[cfg(not(test))]
use chrono::Utc;
#[cfg(not(test))]
use relay_protocol::{
    normalize_repo_url, RejectReason, ReviewAssignmentStatus, UpdateAssignmentStatusBody,
};
#[cfg(not(test))]
use serde_json::json;
#[cfg(not(test))]
use tauri::{AppHandle, Emitter};
#[cfg(not(test))]
use tokio::sync::mpsc;
#[cfg(not(test))]
use tracing::{info, warn};
#[cfg(not(test))]
use crate::commands::terminals::{call_terminal_run_safe, normalize_agent_argv};
#[cfg(not(test))]
use crate::git::inspect::run_git;
#[cfg(not(test))]
use crate::git::worktree::{create_detached_pr_worktree, normalize_path, remove_worktree};
#[cfg(not(test))]
use crate::herdr::client::HerdrClient;
#[cfg(not(test))]
use crate::herdr::events::TerminalStateHub;
#[cfg(not(test))]
use crate::store::projects::{PersistenceStore, ProjectConfig, WorktreeCardMeta};
#[cfg(not(test))]
use crate::team::client::TeamRelayRuntime;
#[cfg(not(test))]
use crate::team::jobs::{
    can_start_job, count_queued_jobs, find_superseded_request_ids, pick_next_queued_job,
    AutoReviewJob, AutoReviewJobPhase, AutoReviewJobStore,
};
#[cfg(not(test))]
use crate::team::reject::{
    agent_supports_continue, build_review_agent_argv, detect_quota_exhausted,
    evaluate_layer2_reject, fetch_pr_live_meta, render_review_prompt,
};

#[derive(Debug, Clone)]
pub enum RelayOrchestratorEvent {
    ReviewAssigned(ReviewRequestPayload),
    ReviewCancelled { request_id: String },
}

#[cfg(not(test))]
pub struct AutoReviewOrchestrator {
    #[allow(dead_code)]
    pub(crate) store: Arc<PersistenceStore>,
    #[allow(dead_code)]
    pub(crate) herdr: Arc<HerdrClient>,
    #[allow(dead_code)]
    pub(crate) hub: Arc<TerminalStateHub>,
    #[allow(dead_code)]
    pub(crate) team_relay: Arc<TeamRelayRuntime>,
    pub(crate) jobs: Mutex<AutoReviewJobStore>,
    event_tx: mpsc::UnboundedSender<RelayOrchestratorEvent>,
    #[allow(dead_code)]
    event_rx: Mutex<Option<mpsc::UnboundedReceiver<RelayOrchestratorEvent>>>,
}

#[cfg(not(test))]
impl AutoReviewOrchestrator {
    pub fn new(
        config_dir: &Path,
        store: Arc<PersistenceStore>,
        herdr: Arc<HerdrClient>,
        hub: Arc<TerminalStateHub>,
        team_relay: Arc<TeamRelayRuntime>,
    ) -> Arc<Self> {
        let (event_tx, event_rx) = mpsc::unbounded_channel();
        let store_jobs = AutoReviewJobStore::load(config_dir);
        Arc::new(Self {
            store,
            herdr,
            hub,
            team_relay,
            jobs: Mutex::new(store_jobs),
            event_tx,
            event_rx: Mutex::new(Some(event_rx)),
        })
    }

    pub fn event_sender(&self) -> mpsc::UnboundedSender<RelayOrchestratorEvent> {
        self.event_tx.clone()
    }

    pub fn list_jobs(&self) -> Vec<AutoReviewJob> {
        self.jobs
            .lock()
            .map(|g| g.jobs().to_vec())
            .unwrap_or_default()
    }

    #[cfg(not(test))]
    pub fn start_workers(self: &Arc<Self>, app: AppHandle) {
        // 1. Incoming relay event dispatcher (ReviewAssigned / ReviewCancelled)
        if let Some(mut rx) = self.event_rx.lock().ok().and_then(|mut g| g.take()) {
            let orch = Arc::clone(self);
            let app_evt = app.clone();
            tauri::async_runtime::spawn(async move {
                while let Some(evt) = rx.recv().await {
                    match evt {
                        RelayOrchestratorEvent::ReviewAssigned(req) => {
                            orch.handle_incoming_review(&app_evt, req).await;
                        }
                        RelayOrchestratorEvent::ReviewCancelled { request_id } => {
                            orch.handle_remote_cancel(&app_evt, &request_id).await;
                        }
                    }
                }
            });
        }

        // 2. One-shot startup reboot reconcile + orphan cleaner after 8s warmup delay
        {
            let orch = Arc::clone(self);
            let app_boot = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(8)).await;
                orch.reconcile_on_startup(&app_boot).await;
            });
        }

        // 3. Lightweight 2s monitor loop (0% CPU when no jobs exist)
        {
            let orch = Arc::clone(self);
            let app_mon = app;
            tauri::async_runtime::spawn(async move {
                let mut ticker = tokio::time::interval(Duration::from_secs(2));
                ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
                loop {
                    ticker.tick().await;
                    let has_jobs = orch
                        .jobs
                        .lock()
                        .map(|g| !g.jobs().is_empty())
                        .unwrap_or(false);
                    if !has_jobs {
                        continue;
                    }
                    orch.poll_active_jobs(&app_mon).await;
                }
            });
        }
    }

    #[cfg(not(test))]
    async fn handle_incoming_review(
        self: &Arc<Self>,
        app: &AppHandle,
        request: ReviewRequestPayload,
    ) {
        let team = self.store.get_settings().await.team;
        let reviewer_id = self
            .team_relay
            .snapshot()
            .await
            .github_id
            .unwrap_or_default();

        // Deduplicate if already tracked locally
        if self
            .jobs
            .lock()
            .ok()
            .and_then(|g| g.find(&request.request_id).cloned())
            .is_some()
        {
            return;
        }

        // 1. Match normalized repo_url to a configured local ProjectConfig
        let Some(project) = self.match_local_project(&request.repo_url).await else {
            let _ = self
                .report_status(
                    &request.request_id,
                    &reviewer_id,
                    ReviewAssignmentStatus::Rejected,
                    Some(RejectReason::RepoNotRegistered),
                    Some(format!("Repository {} not registered in jjdr", request.repo_url)),
                    None,
                )
                .await;
            return;
        };

        // 2. One-shot `gh pr view` for live PR state/labels/draft check
        let pr_meta = match fetch_pr_live_meta(&project.repo_path, &request.repo_url, request.pr_number).await {
            Ok(meta) => Some(meta),
            Err(err) => {
                let low = err.to_ascii_lowercase();
                if low.contains("auth") || low.contains("login") || low.contains("401") || low.contains("403") {
                    let _ = self
                        .report_status(
                            &request.request_id,
                            &reviewer_id,
                            ReviewAssignmentStatus::Rejected,
                            Some(RejectReason::GhAuthError),
                            Some(err),
                            None,
                        )
                        .await;
                    return;
                }
                warn!("gh pr view warning for PR #{}: {}", request.pr_number, err);
                None
            }
        };

        // 3. Evaluate Layer-2 local reject rules
        let queued_now = self
            .jobs
            .lock()
            .map(|g| count_queued_jobs(g.jobs()))
            .unwrap_or(0);
        if let Some((reason, detail)) =
            evaluate_layer2_reject(&team, &project.id, &request, pr_meta.as_ref(), queued_now)
        {
            info!(
                "Layer-2 rejected PR #{} ({:?}): {}",
                request.pr_number, reason, detail
            );
            let _ = self
                .report_status(
                    &request.request_id,
                    &reviewer_id,
                    ReviewAssignmentStatus::Rejected,
                    Some(reason),
                    Some(detail),
                    None,
                )
                .await;
            return;
        }

        // 4. Supersede any older active/queued job for the same (repo_url, pr_number) with stale SHA
        let superseded_ids = self
            .jobs
            .lock()
            .map(|g| {
                find_superseded_request_ids(
                    g.jobs(),
                    &request.repo_url,
                    request.pr_number,
                    &request.head_sha,
                )
            })
            .unwrap_or_default();
        for old_id in superseded_ids {
            info!("Superseding stale auto-review job {} with newer SHA", old_id);
            self.abort_and_cleanup_job(app, &old_id, false).await;
        }

        // 5. Enqueue job into persistent journal
        let agent_id = if team.primary_agent.trim().is_empty() {
            project.default_agent.clone()
        } else {
            team.primary_agent.trim().to_string()
        };
        let now = Utc::now().timestamp_millis();
        let job = AutoReviewJob {
            request_id: request.request_id.clone(),
            repo_url: request.repo_url.clone(),
            project_id: project.id.clone(),
            project_name: project.name.clone(),
            repo_path: project.repo_path.clone(),
            pr_number: request.pr_number,
            pr_url: request.pr_url.clone(),
            pr_title: request.pr_title.clone(),
            base_branch: request.base_branch.clone(),
            head_branch: request.head_branch.clone(),
            head_sha: request.head_sha.clone(),
            author_id: request.author_id.clone(),
            worktree_path: None,
            report_path: None,
            terminal_address: None,
            agent_id,
            model: team.primary_model.trim().to_string(),
            phase: AutoReviewJobPhase::Queued,
            fallback_used: false,
            resume_attempts: 0,
            last_error: None,
            created_ms: now,
            updated_ms: now,
        };

        let should_launch_now = {
            let Ok(mut guard) = self.jobs.lock() else {
                return;
            };
            guard.upsert(job);
            !team.auto_review_paused
                && can_start_job(
                    guard.jobs(),
                    &project.id,
                    team.global_max_auto_review_workers,
                    team.per_project_max_workers,
                )
        };
        self.emit_jobs(app);

        if should_launch_now {
            self.launch_job(app, &request.request_id, false, None).await;
        } else {
            let _ = self
                .report_status(
                    &request.request_id,
                    &reviewer_id,
                    ReviewAssignmentStatus::Queued,
                    None,
                    Some("Waiting in local FIFO queue".to_string()),
                    None,
                )
                .await;
        }
    }

    #[cfg(not(test))]
    pub(crate) async fn launch_job(
        self: &Arc<Self>,
        app: &AppHandle,
        request_id: &str,
        resume_existing_wt: bool,
        recovery_notice: Option<&str>,
    ) {
        let Some(mut job) = self
            .jobs
            .lock()
            .ok()
            .and_then(|g| g.find(request_id).cloned())
        else {
            return;
        };
        let team = self.store.get_settings().await.team;
        let reviewer_id = self
            .team_relay
            .snapshot()
            .await
            .github_id
            .unwrap_or_default();

        // Step A: Create or reuse detached PR worktree (skip_bootstrap)
        let wt_path = if resume_existing_wt {
            if let Some(ref existing) = job.worktree_path {
                if Path::new(existing).exists() {
                    existing.clone()
                } else {
                    match self.create_worktree_for_job(app, &mut job).await {
                        Ok(p) => p,
                        Err(err) => {
                            self.fail_job(app, &job, &reviewer_id, None, err).await;
                            return;
                        }
                    }
                }
            } else {
                match self.create_worktree_for_job(app, &mut job).await {
                    Ok(p) => p,
                    Err(err) => {
                        self.fail_job(app, &job, &reviewer_id, None, err).await;
                        return;
                    }
                }
            }
        } else {
            match self.create_worktree_for_job(app, &mut job).await {
                Ok(p) => p,
                Err(err) => {
                    self.fail_job(app, &job, &reviewer_id, None, err).await;
                    return;
                }
            }
        };

        // Prepare report path `.jjdr-review/pr-<N>.md`
        let report_dir = Path::new(&wt_path).join(".jjdr-review");
        let _ = std::fs::create_dir_all(&report_dir);
        let report_rel = format!(".jjdr-review/pr-{}.md", job.pr_number);
        let report_abs = report_dir
            .join(format!("pr-{}.md", job.pr_number))
            .to_string_lossy()
            .to_string();

        // Attach worktree card metadata so Zen Working immediately shows Review + PR# + author
        let norm_wt = normalize_path(&wt_path);
        let meta = WorktreeCardMeta {
            display_name: Some(format!("PR #{} · {}", job.pr_number, job.pr_title)),
            note: Some(format!("Auto-Review · by @{}", job.author_id)),
            mission_kind: Some("review".to_string()),
            pr_number: Some(job.pr_number as u32),
            pr_url: Some(job.pr_url.clone()),
        };
        self.save_worktree_meta(norm_wt.clone(), Some(meta)).await;

        // Build prompt & agent argv
        let req_payload = ReviewRequestPayload {
            request_id: job.request_id.clone(),
            repo_url: job.repo_url.clone(),
            pr_number: job.pr_number,
            pr_url: job.pr_url.clone(),
            pr_title: job.pr_title.clone(),
            base_branch: job.base_branch.clone(),
            head_branch: job.head_branch.clone(),
            head_sha: job.head_sha.clone(),
            author_id: job.author_id.clone(),
            created_ms: job.created_ms,
        };
        let prompt = render_review_prompt(
            &team.review_prompt_template,
            &req_payload,
            &job.project_name,
            &report_rel,
            recovery_notice,
        );
        let use_continue = resume_existing_wt && agent_supports_continue(&job.agent_id);
        let raw_argv = build_review_agent_argv(&job.agent_id, &job.model, use_continue);
        let argv = normalize_agent_argv(raw_argv, Some(prompt), true);

        let mut labels = serde_json::Map::new();
        labels.insert("jjdr.project".into(), json!(job.project_id));
        labels.insert("jjdr.worktree".into(), json!(norm_wt));
        labels.insert("jjdr.branch".into(), json!(format!("pr-{}", job.pr_number)));
        labels.insert("jjdr.agent".into(), json!(argv[0]));
        labels.insert("jjdr.role".into(), json!("auto_review"));
        labels.insert("jjdr.request_id".into(), json!(job.request_id));

        let raw_name = format!(
            "{}-rev-pr{}",
            job.project_name, job.pr_number
        );
        let params = json!({
            "argv": argv,
            "cwd": wt_path,
            "labels": serde_json::Value::Object(labels),
            "outlive_parent": true,
            "no_parent": true,
            "keep": true,
            "wait": false
        });

        let run_res = match call_terminal_run_safe(&self.herdr, params, Some(&raw_name)).await {
            Ok(v) => v,
            Err(err) => {
                self.fail_job(
                    app,
                    &job,
                    &reviewer_id,
                    None,
                    format!("Failed to launch review AI session: {}", err),
                )
                .await;
                return;
            }
        };

        let term_addr = run_res
            .get("terminal")
            .and_then(|t| t.get("address"))
            .or_else(|| run_res.get("address"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        job.worktree_path = Some(wt_path);
        job.report_path = Some(report_abs);
        job.terminal_address = term_addr;
        job.phase = AutoReviewJobPhase::Reviewing;
        job.updated_ms = Utc::now().timestamp_millis();
        job.last_error = None;
        if let Ok(mut guard) = self.jobs.lock() {
            guard.upsert(job.clone());
        }

        self.hub.sync_terminals_now(&self.herdr).await;
        self.emit_jobs(app);
        let _ = app.emit_to("main", "jjdr:team-worktrees-dirty", true);

        let detail = recovery_notice.map(|s| s.to_string());
        let _ = self
            .report_status(
                &job.request_id,
                &reviewer_id,
                ReviewAssignmentStatus::Reviewing,
                None,
                detail,
                Some(job.agent_id.clone()),
            )
            .await;
    }

    #[cfg(not(test))]
    async fn create_worktree_for_job(
        &self,
        app: &AppHandle,
        job: &mut AutoReviewJob,
    ) -> Result<String, String> {
        job.phase = AutoReviewJobPhase::CreatingWt;
        job.updated_ms = Utc::now().timestamp_millis();
        if let Ok(mut guard) = self.jobs.lock() {
            guard.upsert(job.clone());
        }
        self.emit_jobs(app);

        let short_id: String = job.request_id.chars().filter(|c| c.is_ascii_alphanumeric()).take(6).collect();
        let wt = create_detached_pr_worktree(&job.repo_path, job.pr_number, &job.head_sha, &short_id).await?;
        job.worktree_path = Some(wt.clone());
        if let Ok(mut guard) = self.jobs.lock() {
            guard.upsert(job.clone());
        }
        Ok(wt)
    }

    #[cfg(not(test))]
    async fn poll_active_jobs(self: &Arc<Self>, app: &AppHandle) {
        let team = self.store.get_settings().await.team;
        let reviewer_id = self
            .team_relay
            .snapshot()
            .await
            .github_id
            .unwrap_or_default();
        let snap = self.hub.snapshot(&self.herdr).await;

        let reviewing: Vec<AutoReviewJob> = self
            .jobs
            .lock()
            .map(|g| {
                g.jobs()
                    .iter()
                    .filter(|j| j.phase == AutoReviewJobPhase::Reviewing)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();

        for job in reviewing {
            let Some(ref addr) = job.terminal_address else {
                continue;
            };
            let term = snap.terminals.iter().find(|t| &t.address == addr);
            let preview_lines: Vec<String> = snap
                .previews
                .iter()
                .find(|p| &p.address == addr)
                .map(|p| p.lines.clone())
                .unwrap_or_default();

            let status_msg = term.and_then(|t| t.status.as_ref()).and_then(|s| s.msg.as_deref());
            let status_state = term
                .and_then(|t| t.status.as_ref())
                .map(|s| s.state.as_str())
                .unwrap_or("");
            let is_finished = term.map(|t| t.state != "live").unwrap_or(false);

            // 1. Check for rate-limit / quota exhaustion -> automatic 1-time Fallback AI switch!
            if let Some(quota_msg) = detect_quota_exhausted(status_msg, &preview_lines) {
                if !job.fallback_used && !team.fallback_agent.trim().is_empty() {
                    info!(
                        "Quota exhausted on {} for PR #{}; switching to fallback {}",
                        job.agent_id, job.pr_number, team.fallback_agent
                    );
                    self.trigger_fallback_ai(app, &job, &team.fallback_agent, &team.fallback_model)
                        .await;
                    continue;
                } else {
                    self.fail_job(
                        app,
                        &job,
                        &reviewer_id,
                        Some(RejectReason::QuotaExhausted),
                        format!("AI quota exhausted: {}", quota_msg),
                    )
                    .await;
                    continue;
                }
            }

            // 2. Check normal completion (`done` or process exited after producing work)
            let completed = status_state == "done" || is_finished;
            if completed {
                let mut updated = job.clone();
                updated.phase = AutoReviewJobPhase::ReadyForAck;
                updated.updated_ms = Utc::now().timestamp_millis();
                if let Ok(mut guard) = self.jobs.lock() {
                    guard.upsert(updated.clone());
                }
                self.emit_jobs(app);

                let _ = self
                    .report_status(
                        &updated.request_id,
                        &reviewer_id,
                        ReviewAssignmentStatus::Completed,
                        None,
                        None,
                        Some(updated.agent_id.clone()),
                    )
                    .await;

                if team.ack_teardown_mode == "immediate" {
                    self.ack_job(app, &updated.request_id).await;
                } else {
                    self.trigger_dispatch_next_queued(app);
                }
            }
        }

        // Dispatch queued items if slots are open and not paused
        if !team.auto_review_paused {
            self.trigger_dispatch_next_queued(app);
        }
    }

    #[cfg(not(test))]
    async fn trigger_fallback_ai(
        self: &Arc<Self>,
        app: &AppHandle,
        job: &AutoReviewJob,
        fallback_agent: &str,
        fallback_model: &str,
    ) {
        if let Some(ref addr) = job.terminal_address {
            let _ = self
                .herdr
                .call("terminal.kill", json!({ "address": addr }))
                .await;
        }
        if let Some(ref wt) = job.worktree_path {
            let _ = run_git(Path::new(wt), &["checkout", "--", "."]).await;
        }
        let mut next = job.clone();
        next.agent_id = fallback_agent.trim().to_string();
        next.model = fallback_model.trim().to_string();
        next.fallback_used = true;
        next.terminal_address = None;
        next.updated_ms = Utc::now().timestamp_millis();
        if let Ok(mut guard) = self.jobs.lock() {
            guard.upsert(next);
        }
        self.emit_jobs(app);

        self.launch_job(
            app,
            &job.request_id,
            true,
            Some("Previous AI hit rate limit/quota. Check existing comments on this PR first to avoid duplicates, then complete the review."),
        )
        .await;
    }

    #[cfg(not(test))]
    pub async fn ack_job(self: &Arc<Self>, app: &AppHandle, request_id: &str) {
        self.abort_and_cleanup_job(app, request_id, false).await;
        self.trigger_dispatch_next_queued(app);
    }

    #[cfg(not(test))]
    pub async fn cancel_local_job(self: &Arc<Self>, app: &AppHandle, request_id: &str) {
        let reviewer_id = self
            .team_relay
            .snapshot()
            .await
            .github_id
            .unwrap_or_default();
        let _ = self
            .report_status(
                request_id,
                &reviewer_id,
                ReviewAssignmentStatus::Rejected,
                Some(RejectReason::UserDeclined),
                Some("Cancelled by reviewer".to_string()),
                None,
            )
            .await;
        self.abort_and_cleanup_job(app, request_id, false).await;
        self.trigger_dispatch_next_queued(app);
    }

    #[cfg(not(test))]
    async fn handle_remote_cancel(self: &Arc<Self>, app: &AppHandle, request_id: &str) {
        info!("Author cancelled auto-review job {}, tearing down", request_id);
        self.abort_and_cleanup_job(app, request_id, false).await;
        self.trigger_dispatch_next_queued(app);
    }

    #[cfg(not(test))]
    pub(crate) async fn abort_and_cleanup_job(&self, app: &AppHandle, request_id: &str, keep_failed: bool) {
        let Some(mut job) = self
            .jobs
            .lock()
            .ok()
            .and_then(|g| g.find(request_id).cloned())
        else {
            return;
        };

        if !keep_failed {
            job.phase = AutoReviewJobPhase::CleaningUp;
            if let Ok(mut guard) = self.jobs.lock() {
                guard.upsert(job.clone());
            }
            self.emit_jobs(app);
        }

        if let Some(ref addr) = job.terminal_address {
            let _ = self
                .herdr
                .call("terminal.kill", json!({ "address": addr }))
                .await;
        }
        if let Some(ref wt) = job.worktree_path {
            let norm_wt = normalize_path(wt);
            let _ = remove_worktree(&job.repo_path, wt, None, true, false).await;
            self.save_worktree_meta(norm_wt, None).await;
        }

        if !keep_failed {
            if let Ok(mut guard) = self.jobs.lock() {
                guard.remove(request_id);
            }
        }
        self.emit_jobs(app);
        let _ = app.emit_to("main", "jjdr:team-worktrees-dirty", true);
    }

    #[cfg(not(test))]
    pub(crate) async fn fail_job(
        self: &Arc<Self>,
        app: &AppHandle,
        job: &AutoReviewJob,
        reviewer_id: &str,
        reason: Option<RejectReason>,
        err: String,
    ) {
        warn!("Auto-review job {} failed: {}", job.request_id, err);
        let mut failed = job.clone();
        failed.phase = AutoReviewJobPhase::Failed;
        failed.last_error = Some(err.clone());
        failed.updated_ms = Utc::now().timestamp_millis();
        if let Ok(mut guard) = self.jobs.lock() {
            guard.upsert(failed);
        }
        self.emit_jobs(app);
        let _ = self
            .report_status(
                &job.request_id,
                reviewer_id,
                ReviewAssignmentStatus::Failed,
                reason,
                Some(err),
                Some(job.agent_id.clone()),
            )
            .await;
        self.trigger_dispatch_next_queued(app);
    }

    #[cfg(not(test))]
    fn trigger_dispatch_next_queued(self: &Arc<Self>, app: &AppHandle) {
        let orch = Arc::clone(self);
        let app_next = app.clone();
        tauri::async_runtime::spawn(async move {
            let team = orch.store.get_settings().await.team;
            if team.auto_review_paused {
                return;
            }
            let next_id = orch.jobs.lock().ok().and_then(|g| {
                pick_next_queued_job(
                    g.jobs(),
                    team.global_max_auto_review_workers,
                    team.per_project_max_workers,
                )
                .map(|j| j.request_id.clone())
            });
            if let Some(id) = next_id {
                orch.launch_job(&app_next, &id, false, None).await;
            }
        });
    }

    #[cfg(not(test))]
    async fn match_local_project(&self, normalized_repo_url: &str) -> Option<ProjectConfig> {
        let projects = self.store.list_projects().await;
        for proj in projects {
            let p = Path::new(&proj.repo_path);
            if !p.exists() {
                continue;
            }
            if let Ok(raw) = run_git(p, &["remote", "get-url", "origin"]).await {
                if normalize_repo_url(&raw).as_deref() == Some(normalized_repo_url) {
                    return Some(proj);
                }
            }
        }
        None
    }

    #[cfg(not(test))]
    pub(crate) async fn save_worktree_meta(&self, norm_wt: String, meta: Option<WorktreeCardMeta>) {
        self.store
            .update_worktree_meta(&self.herdr, norm_wt, meta)
            .await;
    }

    #[cfg(not(test))]
    pub(crate) async fn report_status(
        &self,
        request_id: &str,
        reviewer_id: &str,
        status: ReviewAssignmentStatus,
        reject_reason: Option<RejectReason>,
        detail: Option<String>,
        worker_agent: Option<String>,
    ) -> Result<(), String> {
        if reviewer_id.is_empty() {
            return Ok(());
        }
        let team = self.store.get_settings().await.team;
        self.team_relay
            .rest_report_status(
                &team,
                request_id,
                UpdateAssignmentStatusBody {
                    reviewer_id: reviewer_id.to_string(),
                    status,
                    reject_reason,
                    detail,
                    worker_agent,
                    device_id: Some(self.team_relay.device_id().to_string()),
                },
            )
            .await
    }

    #[cfg(not(test))]
    pub(crate) fn emit_jobs(&self, app: &AppHandle) {
        let jobs = self.list_jobs();
        let _ = app.emit_to("main", "jjdr:auto-review-jobs-changed", jobs);
    }
}
