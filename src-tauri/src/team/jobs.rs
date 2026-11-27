use std::path::{Path, PathBuf};

use relay_protocol::{ActiveAssignmentCheck, ReviewAssignmentStatus};
use serde::{Deserialize, Serialize};

pub const MAX_AUTO_RESUME_ATTEMPTS: u32 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutoReviewJobPhase {
    Queued,
    CreatingWt,
    Reviewing,
    ReadyForAck,
    CleaningUp,
    Failed,
}

impl AutoReviewJobPhase {
    /// Returns true if this job currently holds a concurrency worker slot.
    pub fn occupies_worker_slot(self) -> bool {
        matches!(self, Self::CreatingWt | Self::Reviewing)
    }

    /// Returns true if this job should be reconciled with relay `sync-active` on reboot.
    pub fn needs_relay_sync(self) -> bool {
        matches!(self, Self::Queued | Self::CreatingWt | Self::Reviewing)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AutoReviewJob {
    pub request_id: String,
    pub repo_url: String,
    pub project_id: String,
    pub project_name: String,
    pub repo_path: String,
    pub pr_number: u64,
    pub pr_url: String,
    pub pr_title: String,
    pub base_branch: String,
    pub head_branch: String,
    pub head_sha: String,
    pub author_id: String,
    pub worktree_path: Option<String>,
    pub report_path: Option<String>,
    pub terminal_address: Option<String>,
    pub agent_id: String,
    pub model: String,
    pub phase: AutoReviewJobPhase,
    pub fallback_used: bool,
    pub resume_attempts: u32,
    pub last_error: Option<String>,
    pub created_ms: i64,
    pub updated_ms: i64,
}

/// Persistent disk journal (`%APPDATA%/jjdr/auto_review_jobs.json`) for crash-safe reboot resume.
pub struct AutoReviewJobStore {
    path: PathBuf,
    jobs: Vec<AutoReviewJob>,
}

impl AutoReviewJobStore {
    pub fn load(config_dir: &Path) -> Self {
        let path = config_dir.join("auto_review_jobs.json");
        let jobs = std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<Vec<AutoReviewJob>>(&raw).ok())
            .unwrap_or_default();
        Self { path, jobs }
    }

    pub fn jobs(&self) -> &[AutoReviewJob] {
        &self.jobs
    }

    pub fn find(&self, request_id: &str) -> Option<&AutoReviewJob> {
        self.jobs.iter().find(|j| j.request_id == request_id)
    }

    pub fn find_mut(&mut self, request_id: &str) -> Option<&mut AutoReviewJob> {
        self.jobs.iter_mut().find(|j| j.request_id == request_id)
    }

    pub fn upsert(&mut self, job: AutoReviewJob) {
        if let Some(existing) = self.jobs.iter_mut().find(|j| j.request_id == job.request_id) {
            *existing = job;
        } else {
            self.jobs.push(job);
        }
        self.persist();
    }

    pub fn remove(&mut self, request_id: &str) -> Option<AutoReviewJob> {
        let idx = self.jobs.iter().position(|j| j.request_id == request_id)?;
        let removed = self.jobs.remove(idx);
        self.persist();
        Some(removed)
    }

    pub fn persist(&self) {
        if let Some(parent) = self.path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(text) = serde_json::to_string_pretty(&self.jobs) {
            let _ = std::fs::write(&self.path, text);
        }
    }
}

/// Count currently active (slot-occupying) jobs globally and for a given project.
pub fn count_active_slots(jobs: &[AutoReviewJob], project_id: &str) -> (usize, usize) {
    let mut global_active = 0usize;
    let mut project_active = 0usize;
    for j in jobs {
        if j.phase.occupies_worker_slot() {
            global_active += 1;
            if j.project_id == project_id {
                project_active += 1;
            }
        }
    }
    (global_active, project_active)
}

/// Dual hard-cap check: both global cap AND per-project cap must have free capacity.
pub fn can_start_job(
    jobs: &[AutoReviewJob],
    project_id: &str,
    global_cap: u32,
    per_project_cap: u32,
) -> bool {
    let g_cap = global_cap.max(1) as usize;
    let p_cap = per_project_cap.max(1) as usize;
    let (g_active, p_active) = count_active_slots(jobs, project_id);
    g_active < g_cap && p_active < p_cap
}

/// Pick the earliest FIFO `Queued` job whose project has capacity under both caps.
pub fn pick_next_queued_job<'a>(
    jobs: &'a [AutoReviewJob],
    global_cap: u32,
    per_project_cap: u32,
) -> Option<&'a AutoReviewJob> {
    let mut queued: Vec<&AutoReviewJob> = jobs
        .iter()
        .filter(|j| j.phase == AutoReviewJobPhase::Queued)
        .collect();
    queued.sort_by_key(|j| j.created_ms);
    queued
        .into_iter()
        .find(|j| can_start_job(jobs, &j.project_id, global_cap, per_project_cap))
}

/// Count queued jobs currently waiting in local FIFO queue.
pub fn count_queued_jobs(jobs: &[AutoReviewJob]) -> usize {
    jobs.iter()
        .filter(|j| j.phase == AutoReviewJobPhase::Queued)
        .count()
}

/// Find older active/queued jobs for the same `(repo_url, pr_number)` with a different `head_sha`
/// so they can be superseded cleanly without wasting tokens on stale commits.
pub fn find_superseded_request_ids(
    jobs: &[AutoReviewJob],
    repo_url: &str,
    pr_number: u64,
    new_head_sha: &str,
) -> Vec<String> {
    jobs.iter()
        .filter(|j| {
            j.repo_url == repo_url
                && j.pr_number == pr_number
                && j.head_sha != new_head_sha
                && matches!(
                    j.phase,
                    AutoReviewJobPhase::Queued
                        | AutoReviewJobPhase::CreatingWt
                        | AutoReviewJobPhase::Reviewing
                )
        })
        .map(|j| j.request_id.clone())
        .collect()
}

/// Pure deterministic decision for crash/reboot reconciliation of a persisted job.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartupReconcileAction {
    /// Keep running as-is (simple jjdr restart, herdr-core session still alive).
    KeepAttached,
    /// Review report was already produced before reboot -> promote to ReadyForAck & report Completed.
    PromoteToReadyForAck,
    /// Worktree exists and session died -> resume AI session (`--continue` or fresh fallback).
    ResumeReview,
    /// Worktree was half-created or missing on disk -> clean & recreate from scratch.
    RecreateAndStart,
    /// Keep ReadyForAck intact in Zen Inbox (NEVER delete before user Ack!).
    PreserveReadyForAck,
    /// Relay cancelled/expired, or phase is CleaningUp -> teardown worktree and drop job.
    AbortAndCleanup,
    /// Exceeded MAX_AUTO_RESUME_ATTEMPTS -> stop auto-retrying and surface Failed card.
    MarkResumeLimitFailed,
    /// Job was still in FIFO queue -> keep queued for normal scheduler dispatch.
    KeepQueued,
}

pub fn decide_startup_reconcile_action(
    job: &AutoReviewJob,
    relay_check: Option<&ActiveAssignmentCheck>,
    has_live_terminal: bool,
    worktree_exists: bool,
    report_exists_non_empty: bool,
) -> StartupReconcileAction {
    if job.phase == AutoReviewJobPhase::CleaningUp {
        return StartupReconcileAction::AbortAndCleanup;
    }

    if job.phase == AutoReviewJobPhase::ReadyForAck {
        return StartupReconcileAction::PreserveReadyForAck;
    }

    if job.phase == AutoReviewJobPhase::Failed {
        return StartupReconcileAction::PreserveReadyForAck;
    }

    if let Some(check) = relay_check {
        if check.should_abort {
            return StartupReconcileAction::AbortAndCleanup;
        }
        if check.status == Some(ReviewAssignmentStatus::Completed) {
            return StartupReconcileAction::PreserveReadyForAck;
        }
    }

    if job.phase == AutoReviewJobPhase::Queued {
        return StartupReconcileAction::KeepQueued;
    }

    if has_live_terminal {
        return StartupReconcileAction::KeepAttached;
    }

    if report_exists_non_empty {
        return StartupReconcileAction::PromoteToReadyForAck;
    }

    if job.resume_attempts >= MAX_AUTO_RESUME_ATTEMPTS {
        return StartupReconcileAction::MarkResumeLimitFailed;
    }

    if job.phase == AutoReviewJobPhase::CreatingWt || !worktree_exists {
        return StartupReconcileAction::RecreateAndStart;
    }

    StartupReconcileAction::ResumeReview
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn mk_job(id: &str, proj: &str, pr: u64, sha: &str, phase: AutoReviewJobPhase, created_ms: i64) -> AutoReviewJob {
        AutoReviewJob {
            request_id: id.to_string(),
            repo_url: "github.corp.com/team/jjdr".to_string(),
            project_id: proj.to_string(),
            project_name: proj.to_string(),
            repo_path: format!("K:/repos/{}", proj),
            pr_number: pr,
            pr_url: format!("https://github.corp.com/team/jjdr/pull/{}", pr),
            pr_title: format!("PR #{}", pr),
            base_branch: "main".to_string(),
            head_branch: format!("feat/pr-{}", pr),
            head_sha: sha.to_string(),
            author_id: "alice".to_string(),
            worktree_path: Some(format!("K:/repos/{}-rev-pr{}-abc", proj, pr)),
            report_path: Some(format!("K:/repos/{}-rev-pr{}-abc/.jjdr-review/pr-{}.md", proj, pr, pr)),
            terminal_address: Some("t1".to_string()),
            agent_id: "claude".to_string(),
            model: String::new(),
            phase,
            fallback_used: false,
            resume_attempts: 0,
            last_error: None,
            created_ms,
            updated_ms: created_ms,
        }
    }

    #[test]
    fn enforces_dual_global_and_per_project_caps_with_fifo_order() {
        let jobs = vec![
            mk_job("j1", "proj-a", 1, "sha1", AutoReviewJobPhase::Reviewing, 100),
            mk_job("j2", "proj-a", 2, "sha2", AutoReviewJobPhase::Queued, 200),
            mk_job("j3", "proj-b", 3, "sha3", AutoReviewJobPhase::Queued, 300),
        ];

        // Global cap=2, per_project=1 -> proj-a is full, proj-b can start!
        assert!(!can_start_job(&jobs, "proj-a", 2, 1));
        assert!(can_start_job(&jobs, "proj-b", 2, 1));
        let picked = pick_next_queued_job(&jobs, 2, 1).expect("should pick proj-b");
        assert_eq!(picked.request_id, "j3");

        // Global cap=1 -> nobody can start
        assert!(pick_next_queued_job(&jobs, 1, 1).is_none());

        // ReadyForAck does NOT hold an active worker slot
        let ack_only = vec![
            mk_job("j4", "proj-a", 4, "sha4", AutoReviewJobPhase::ReadyForAck, 100),
            mk_job("j5", "proj-a", 5, "sha5", AutoReviewJobPhase::Queued, 200),
        ];
        assert_eq!(
            pick_next_queued_job(&ack_only, 1, 1).map(|j| j.request_id.as_str()),
            Some("j5")
        );
    }

    #[test]
    fn detects_superseded_stale_sha_jobs_without_touching_ready_for_ack() {
        let jobs = vec![
            mk_job("old-run", "p1", 412, "sha_v1", AutoReviewJobPhase::Reviewing, 100),
            mk_job("old-q", "p1", 412, "sha_v1", AutoReviewJobPhase::Queued, 150),
            mk_job("done-ack", "p1", 412, "sha_v0", AutoReviewJobPhase::ReadyForAck, 50),
            mk_job("other-pr", "p1", 999, "sha_v1", AutoReviewJobPhase::Reviewing, 120),
        ];
        let superseded =
            find_superseded_request_ids(&jobs, "github.corp.com/team/jjdr", 412, "sha_v2");
        assert_eq!(superseded, vec!["old-run".to_string(), "old-q".to_string()]);
    }

    #[test]
    fn startup_reconcile_covers_all_reboot_and_despair_cases() {
        let mut job = mk_job("r1", "p1", 10, "sha1", AutoReviewJobPhase::Reviewing, 100);
        let ok_check = ActiveAssignmentCheck {
            request_id: "r1".into(),
            status: Some(ReviewAssignmentStatus::Reviewing),
            should_abort: false,
            reason: None,
            claimed_by_device_id: Some("pc-1".into()),
            updated_ms: 200,
        };
        let abort_check = ActiveAssignmentCheck {
            request_id: "r1".into(),
            status: Some(ReviewAssignmentStatus::Cancelled),
            should_abort: true,
            reason: Some("cancelled while offline".into()),
            claimed_by_device_id: Some("pc-1".into()),
            updated_ms: 200,
        };

        // Case 1: jjdr restarted while herdr-core session still alive
        assert_eq!(
            decide_startup_reconcile_action(&job, Some(&ok_check), true, true, false),
            StartupReconcileAction::KeepAttached
        );

        // Case 2: Reboot killed session, but MD report was already written
        assert_eq!(
            decide_startup_reconcile_action(&job, Some(&ok_check), false, true, true),
            StartupReconcileAction::PromoteToReadyForAck
        );

        // Case 3: Reboot interrupted review mid-way -> ResumeReview
        assert_eq!(
            decide_startup_reconcile_action(&job, Some(&ok_check), false, true, false),
            StartupReconcileAction::ResumeReview
        );

        // Case 3b (Despair): Author cancelled while PC was rebooting -> AbortAndCleanup!
        assert_eq!(
            decide_startup_reconcile_action(&job, Some(&abort_check), false, true, false),
            StartupReconcileAction::AbortAndCleanup
        );

        // Case 3c (Despair): Repeated reboot loop hits MAX_AUTO_RESUME_ATTEMPTS -> stop looping!
        job.resume_attempts = MAX_AUTO_RESUME_ATTEMPTS;
        assert_eq!(
            decide_startup_reconcile_action(&job, Some(&ok_check), false, true, false),
            StartupReconcileAction::MarkResumeLimitFailed
        );

        // Case 4: Worktree missing/half-created -> RecreateAndStart
        job.resume_attempts = 0;
        assert_eq!(
            decide_startup_reconcile_action(&job, Some(&ok_check), false, false, false),
            StartupReconcileAction::RecreateAndStart
        );

        // Case 5: ReadyForAck must NEVER be deleted on reboot
        job.phase = AutoReviewJobPhase::ReadyForAck;
        assert_eq!(
            decide_startup_reconcile_action(&job, Some(&abort_check), false, true, true),
            StartupReconcileAction::PreserveReadyForAck
        );

        // Case 6: CleaningUp interrupted by reboot -> finish AbortAndCleanup
        job.phase = AutoReviewJobPhase::CleaningUp;
        assert_eq!(
            decide_startup_reconcile_action(&job, None, false, true, false),
            StartupReconcileAction::AbortAndCleanup
        );
    }

    #[test]
    fn persists_and_reloads_job_journal() {
        let dir = std::env::temp_dir().join(format!("jjdr_jobs_test_{}", Uuid::new_v4()));
        let mut store = AutoReviewJobStore::load(&dir);
        store.upsert(mk_job("r1", "p1", 10, "sha1", AutoReviewJobPhase::Reviewing, 100));
        assert_eq!(store.jobs().len(), 1);

        let reloaded = AutoReviewJobStore::load(&dir);
        assert_eq!(reloaded.jobs().len(), 1);
        assert_eq!(reloaded.find("r1").unwrap().pr_number, 10);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
