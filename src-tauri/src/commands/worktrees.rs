use std::collections::{HashMap, HashSet};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use tokio::task::JoinSet;

use crate::commands::terminals::{call_terminal_run_safe, normalize_agent_argv};
use crate::git::bootstrap::{run_bootstrap, BootstrapResult};
use crate::git::worktree::{
    create_worktree, get_worktree_diff, list_worktrees_with_status, normalize_path,
    remove_worktree, rename_worktree_branch as rename_branch_impl, DiffDetail, WorktreeInfo,
};
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct CreateWorktreeInput {
    pub project_id: String,
    pub branch_name: String,
    pub base_branch: Option<String>,
    pub custom_dir: Option<String>,
    pub launch_argv: Option<Vec<String>>,
    pub initial_prompt: Option<String>,
    pub session_name: Option<String>,
    pub autonomous: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct CreateWorktreeOutput {
    pub worktree_path: String,
    pub branch_name: String,
    pub bootstrap: BootstrapResult,
    pub terminal_address: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RemoveWorktreeInput {
    pub project_id: String,
    pub worktree_path: String,
    pub branch_name: Option<String>,
    pub force: bool,
    pub delete_branch: bool,
    pub terminal_addresses: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct RenameBranchInput {
    pub project_id: String,
    pub old_branch: String,
    pub new_branch: String,
}

#[tauri::command]
pub async fn list_all_worktrees(
    state: State<'_, AppState>,
) -> Result<HashMap<String, Vec<WorktreeInfo>>, String> {
    let projects = state.store.list_projects().await;
    let mut join_set = JoinSet::new();

    for proj in projects {
        let id = proj.id.clone();
        let repo = proj.repo_path.clone();
        let def_branch = proj.default_branch.clone();
        join_set.spawn(async move {
            let list = list_worktrees_with_status(&repo, Some(&def_branch))
                .await
                .unwrap_or_default();
            (id, list)
        });
    }

    let mut result = HashMap::new();
    while let Some(res) = join_set.join_next().await {
        if let Ok((id, list)) = res {
            result.insert(id, list);
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn list_project_worktrees(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<WorktreeInfo>, String> {
    let projects = state.store.list_projects().await;
    let proj = projects
        .into_iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| "Project not found".to_string())?;
    list_worktrees_with_status(&proj.repo_path, Some(&proj.default_branch)).await
}

#[tauri::command]
pub async fn create_worktree_and_launch(
    state: State<'_, AppState>,
    input: CreateWorktreeInput,
) -> Result<CreateWorktreeOutput, String> {
    let projects = state.store.list_projects().await;
    let proj = projects
        .into_iter()
        .find(|p| p.id == input.project_id)
        .ok_or_else(|| "Project not found".to_string())?;

    let wt_path = create_worktree(
        &proj.repo_path,
        &input.branch_name,
        input.base_branch.as_deref(),
        input.custom_dir.as_deref(),
    )
    .await?;

    let bootstrap = run_bootstrap(&proj.repo_path, &wt_path, &proj.bootstrap).await;

    let mut terminal_address = None;
    if let Some(raw_argv) = input.launch_argv.filter(|a| !a.is_empty()) {
        let autonomous = input.autonomous.unwrap_or(true);
        let argv = normalize_agent_argv(raw_argv, input.initial_prompt, autonomous);

        let agent_name = argv[0].clone();
        let raw_name = input
            .session_name
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| {
                let slug = input.branch_name.replace(['/', '\\', ' '], "-");
                format!("{}-{}", proj.name, slug)
            });

        let labels = json!({
            "jjdr.project": proj.id,
            "jjdr.worktree": normalize_path(&wt_path),
            "jjdr.branch": input.branch_name,
            "jjdr.agent": agent_name
        });

        let params = json!({
            "argv": argv,
            "cwd": wt_path,
            "labels": labels,
            "outlive_parent": true,
            "no_parent": true,
            "keep": true,
            "wait": false
        });

        let run_res = call_terminal_run_safe(&state.herdr, params, Some(&raw_name))
            .await
            .map_err(|e| format!("Worktree created, but failed to start session: {}", e))?;

        terminal_address = run_res
            .get("terminal")
            .and_then(|t| t.get("address"))
            .or_else(|| run_res.get("address"))
            .and_then(|v| v.as_str())
            .map(String::from);

        state.hub.sync_terminals_now(&state.herdr).await;
    }

    Ok(CreateWorktreeOutput {
        worktree_path: wt_path,
        branch_name: input.branch_name,
        bootstrap,
        terminal_address,
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct WorktreeTeardownResultEvent {
    pub project_id: String,
    pub worktree_path: String,
    pub branch_name: String,
    pub ok: bool,
    pub error: Option<String>,
    pub worktrees: Option<Vec<WorktreeInfo>>,
}

#[tauri::command]
pub async fn teardown_worktree(
    app: AppHandle,
    state: State<'_, AppState>,
    input: RemoveWorktreeInput,
) -> Result<(), String> {
    let projects = state.store.list_projects().await;
    let proj = projects
        .into_iter()
        .find(|p| p.id == input.project_id)
        .ok_or_else(|| "Project not found".to_string())?;

    let herdr = state.herdr.clone();
    let hub = state.hub.clone();
    let project_id = input.project_id.clone();
    let repo_path = proj.repo_path.clone();
    let default_branch = proj.default_branch.clone();
    let worktree_path = input.worktree_path.clone();
    let branch_name = input.branch_name.clone();
    let branch_label = branch_name.clone().unwrap_or_else(|| worktree_path.clone());
    let force = input.force;
    let delete_branch = input.delete_branch;
    let initial_addrs = input.terminal_addresses;

    // Run full teardown completely in the background so UI modal closes immediately
    // and the user can continue working without waiting on OS file locks / large deletes.
    tokio::spawn(async move {
        let norm_wt = normalize_path(&worktree_path);
        let mut all_addrs: HashSet<String> = initial_addrs.into_iter().collect();
        {
            let term_map = hub.terminals.read().await;
            for t in term_map.values() {
                let term_cwd = normalize_path(&t.cwd);
                let label_wt = t
                    .labels
                    .get("jjdr.worktree")
                    .map(|s| normalize_path(s))
                    .unwrap_or_default();
                if term_cwd == norm_wt
                    || term_cwd.starts_with(&format!("{}/", norm_wt))
                    || label_wt == norm_wt
                {
                    all_addrs.insert(t.address.clone());
                }
            }
        }

        let had_sessions = !all_addrs.is_empty();
        if had_sessions {
            let mut kill_set = JoinSet::new();
            for addr in all_addrs {
                let client = herdr.clone();
                kill_set.spawn(async move {
                    let _ = client
                        .call("terminal.kill", json!({ "terminal": addr }))
                        .await;
                    let _ = client
                        .call("terminal.rm", json!({ "terminal": addr }))
                        .await;
                });
            }
            while kill_set.join_next().await.is_some() {}
            hub.sync_terminals_now(&herdr).await;
            // Give Windows processes (Node.js / Gemini CLI / ConPTY) a brief beat to release CWD handles
            tokio::time::sleep(Duration::from_millis(250)).await;
        }

        let res = remove_worktree(
            &repo_path,
            &worktree_path,
            branch_name.as_deref(),
            force,
            delete_branch,
        )
        .await;

        hub.sync_terminals_now(&herdr).await;

        let latest = list_worktrees_with_status(&repo_path, Some(&default_branch))
            .await
            .ok();

        // If a transient Windows error was returned but the worktree is already gone, treat as success
        let (ok, error) = match res {
            Ok(()) => (true, None),
            Err(err) => {
                let still_present = latest.as_ref().map_or(true, |list| {
                    list.iter().any(|w| normalize_path(&w.path) == norm_wt)
                });
                if !still_present {
                    (true, None)
                } else {
                    (false, Some(err))
                }
            }
        };

        let _ = app.emit_to(
            "main",
            "jjdr:worktree-teardown-result",
            WorktreeTeardownResultEvent {
                project_id,
                worktree_path,
                branch_name: branch_label,
                ok,
                error,
                worktrees: latest,
            },
        );
    });

    Ok(())
}

#[tauri::command]
pub async fn rename_worktree_branch(
    state: State<'_, AppState>,
    input: RenameBranchInput,
) -> Result<(), String> {
    let projects = state.store.list_projects().await;
    let proj = projects
        .into_iter()
        .find(|p| p.id == input.project_id)
        .ok_or_else(|| "Project not found".to_string())?;
    rename_branch_impl(&proj.repo_path, &input.old_branch, &input.new_branch).await
}

#[tauri::command]
pub async fn fetch_worktree_diff(
    state: State<'_, AppState>,
    project_id: String,
    worktree_path: String,
) -> Result<DiffDetail, String> {
    let projects = state.store.list_projects().await;
    let default_branch = projects
        .into_iter()
        .find(|p| p.id == project_id)
        .map(|p| p.default_branch)
        .unwrap_or_else(|| "main".into());
    get_worktree_diff(&worktree_path, &default_branch).await
}
