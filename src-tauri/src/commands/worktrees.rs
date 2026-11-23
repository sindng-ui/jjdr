use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;
use tokio::task::JoinSet;

use crate::commands::terminals::normalize_agent_argv;
use crate::git::bootstrap::{run_bootstrap, BootstrapResult};
use crate::git::worktree::{
    create_worktree, get_worktree_diff, list_worktrees_with_status, normalize_path,
    remove_worktree, DiffDetail, WorktreeInfo,
};
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct CreateWorktreeInput {
    pub project_id: String,
    pub branch_name: String,
    pub base_branch: Option<String>,
    pub custom_dir: Option<String>,
    /// Optional agent command/template (e.g. ["claude"], ["gemini"], ["codex", "--no-daemon"])
    pub launch_argv: Option<Vec<String>>,
    /// Optional initial task prompt passed directly to `terminal.run`
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

    // Base defaults to the repository's current checked-out branch unless explicitly overridden.
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
        let name = input
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

        let run_res = state
            .herdr
            .call(
                "terminal.run",
                json!({
                    "argv": argv,
                    "cwd": wt_path,
                    "name": name,
                    "labels": labels,
                    "outlive_parent": true,
                    "no_parent": true,
                    "keep": true,
                    "wait": false
                }),
            )
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

#[tauri::command]
pub async fn teardown_worktree(
    state: State<'_, AppState>,
    input: RemoveWorktreeInput,
) -> Result<(), String> {
    let projects = state.store.list_projects().await;
    let proj = projects
        .into_iter()
        .find(|p| p.id == input.project_id)
        .ok_or_else(|| "Project not found".to_string())?;

    // Terminate and remove associated herdr-core terminals cleanly first
    for addr in &input.terminal_addresses {
        let _ = state
            .herdr
            .call("terminal.kill", json!({ "terminal": addr }))
            .await;
        let _ = state
            .herdr
            .call("terminal.rm", json!({ "terminal": addr }))
            .await;
    }

    remove_worktree(
        &proj.repo_path,
        &input.worktree_path,
        input.branch_name.as_deref(),
        input.force,
        input.delete_branch,
    )
    .await
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
