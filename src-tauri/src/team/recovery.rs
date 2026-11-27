#[cfg(not(test))]
use std::collections::HashSet;
#[cfg(not(test))]
use std::path::Path;
#[cfg(not(test))]
use std::sync::Arc;

#[cfg(not(test))]
use chrono::Utc;
#[cfg(not(test))]
use relay_protocol::ReviewAssignmentStatus;
#[cfg(not(test))]
use tauri::{AppHandle, Emitter};
#[cfg(not(test))]
use tracing::info;

#[cfg(not(test))]
use crate::git::worktree::{
    is_auto_review_worktree_dir, list_worktrees_with_status, normalize_path, remove_worktree,
};
#[cfg(not(test))]
use crate::team::jobs::{
    decide_startup_reconcile_action, AutoReviewJobPhase, StartupReconcileAction,
};
#[cfg(not(test))]
use crate::team::orchestrator::AutoReviewOrchestrator;

#[cfg(not(test))]
impl AutoReviewOrchestrator {
    /// Crash/reboot 3-way reconciliation: local journal + relay `sync-active` + herdr-core live sessions.
    pub(crate) async fn reconcile_on_startup(self: &Arc<Self>, app: &AppHandle) {
        let team = self.store.get_settings().await.team;
        let jobs_snapshot = self.list_jobs();
        let snap = self.hub.snapshot(&self.herdr).await;
        let reviewer_id = self
            .team_relay
            .snapshot()
            .await
            .github_id
            .unwrap_or_default();

        let sync_ids: Vec<String> = jobs_snapshot
            .iter()
            .filter(|j| j.phase.needs_relay_sync())
            .map(|j| j.request_id.clone())
            .collect();

        let relay_checks =
            if !sync_ids.is_empty() && team.is_connectable() && !reviewer_id.is_empty() {
                self.team_relay
                    .rest_sync_active(&team, &reviewer_id, sync_ids)
                    .await
                    .map(|r| r.results)
                    .unwrap_or_default()
            } else {
                Vec::new()
            };

        for job in &jobs_snapshot {
            let check = relay_checks.iter().find(|c| c.request_id == job.request_id);
            let has_live_term = job
                .terminal_address
                .as_deref()
                .map(|addr| {
                    snap.terminals
                        .iter()
                        .any(|t| t.address == addr && t.state == "live")
                })
                .unwrap_or(false);
            let wt_exists = job
                .worktree_path
                .as_deref()
                .map(|p| Path::new(p).exists())
                .unwrap_or(false);
            let report_non_empty = job
                .report_path
                .as_deref()
                .and_then(|p| std::fs::metadata(p).ok())
                .map(|m| m.len() > 20)
                .unwrap_or(false);

            match decide_startup_reconcile_action(
                job,
                check,
                has_live_term,
                wt_exists,
                report_non_empty,
            ) {
                StartupReconcileAction::KeepAttached
                | StartupReconcileAction::PreserveReadyForAck
                | StartupReconcileAction::KeepQueued => {}
                StartupReconcileAction::PromoteToReadyForAck => {
                    let mut done_job = job.clone();
                    done_job.phase = AutoReviewJobPhase::ReadyForAck;
                    done_job.updated_ms = Utc::now().timestamp_millis();
                    if let Ok(mut g) = self.jobs.lock() {
                        g.upsert(done_job);
                    }
                    let _ = self
                        .report_status(
                            &job.request_id,
                            &reviewer_id,
                            ReviewAssignmentStatus::Completed,
                            None,
                            Some("Completed before reboot".to_string()),
                            Some(job.agent_id.clone()),
                        )
                        .await;
                }
                StartupReconcileAction::ResumeReview => {
                    let mut resumed = job.clone();
                    resumed.resume_attempts += 1;
                    resumed.terminal_address = None;
                    if let Ok(mut g) = self.jobs.lock() {
                        g.upsert(resumed);
                    }
                    self.launch_job(
                        app,
                        &job.request_id,
                        true,
                        Some("Resumed after PC reboot. Check if review comment was already posted to avoid duplicates, then finish and save the report."),
                    )
                    .await;
                }
                StartupReconcileAction::RecreateAndStart => {
                    if let Some(ref wt) = job.worktree_path {
                        let _ = remove_worktree(&job.repo_path, wt, None, true, false).await;
                    }
                    let mut reset = job.clone();
                    reset.resume_attempts += 1;
                    reset.worktree_path = None;
                    reset.terminal_address = None;
                    if let Ok(mut g) = self.jobs.lock() {
                        g.upsert(reset);
                    }
                    self.launch_job(
                        app,
                        &job.request_id,
                        false,
                        Some("Recreated ephemeral review worktree after reboot."),
                    )
                    .await;
                }
                StartupReconcileAction::AbortAndCleanup => {
                    self.abort_and_cleanup_job(app, &job.request_id, false)
                        .await;
                }
                StartupReconcileAction::MarkResumeLimitFailed => {
                    self.fail_job(
                        app,
                        job,
                        &reviewer_id,
                        None,
                        "Auto-resume limit reached after repeated reboots".to_string(),
                    )
                    .await;
                }
            }
        }

        self.cleanup_true_orphan_review_worktrees(app).await;
        self.emit_jobs(app);
    }

    /// Safe orphan cleaner: deletes ONLY `-rev-pr<N>-<id>` worktrees absent from both
    /// the local journal and live herdr-core sessions. Never touches dev or ROOT worktrees.
    async fn cleanup_true_orphan_review_worktrees(&self, app: &AppHandle) {
        let tracked_paths: HashSet<String> = self
            .list_jobs()
            .into_iter()
            .filter_map(|j| j.worktree_path.map(|p| normalize_path(&p)))
            .collect();
        let snap = self.hub.snapshot(&self.herdr).await;
        let live_cwds: HashSet<String> = snap
            .terminals
            .iter()
            .filter(|t| t.state == "live")
            .map(|t| normalize_path(&t.cwd))
            .collect();

        let projects = self.store.list_projects().await;
        let mut cleaned_any = false;
        for proj in projects {
            if let Ok(wts) =
                list_worktrees_with_status(&proj.repo_path, Some(&proj.default_branch)).await
            {
                for wt in wts {
                    if wt.is_main || !is_auto_review_worktree_dir(&wt.path) {
                        continue;
                    }
                    let norm = normalize_path(&wt.path);
                    if tracked_paths.contains(&norm) || live_cwds.contains(&norm) {
                        continue;
                    }
                    info!(
                        "Cleaning orphaned ephemeral auto-review worktree: {}",
                        wt.path
                    );
                    let _ = remove_worktree(&proj.repo_path, &wt.path, None, true, false).await;
                    self.save_worktree_meta(norm, None).await;
                    cleaned_any = true;
                }
            }
        }
        if cleaned_any {
            let _ = app.emit_to("main", "jjdr:team-worktrees-dirty", true);
        }
    }
}
