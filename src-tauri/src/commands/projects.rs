use std::path::Path;

use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

use crate::git::bootstrap::BootstrapConfig;
use crate::git::worktree::{
    detect_default_branch, inspect_git_repo as inspect_repo_impl, validate_git_repo,
    RepoInspectInfo,
};
use crate::store::projects::ProjectConfig;
use crate::AppState;

#[tauri::command]
pub async fn inspect_git_repo(repo_path: String) -> Result<RepoInspectInfo, String> {
    inspect_repo_impl(&repo_path).await
}

#[derive(Debug, Deserialize)]
pub struct UpsertProjectInput {
    pub id: Option<String>,
    pub name: String,
    pub repo_path: String,
    pub color: String,
    pub default_branch: Option<String>,
    pub default_agent: Option<String>,
    pub verify_command: Option<String>,
    pub bootstrap: Option<BootstrapConfig>,
    pub group: Option<String>,
}

#[tauri::command]
pub async fn list_projects(state: State<'_, AppState>) -> Result<Vec<ProjectConfig>, String> {
    Ok(state.store.list_projects().await)
}

#[tauri::command]
pub async fn upsert_project(
    state: State<'_, AppState>,
    input: UpsertProjectInput,
) -> Result<Vec<ProjectConfig>, String> {
    let canonical_repo = validate_git_repo(&input.repo_path).await?;
    let default_branch = match input.default_branch.filter(|b| !b.trim().is_empty()) {
        Some(b) => b,
        None => detect_default_branch(Path::new(&canonical_repo)).await,
    };

    let project = ProjectConfig {
        id: input.id.unwrap_or_else(|| Uuid::new_v4().to_string()),
        name: input.name.trim().to_string(),
        repo_path: canonical_repo,
        color: input.color,
        default_branch,
        default_agent: input.default_agent.unwrap_or_else(|| "claude".into()),
        verify_command: input.verify_command.filter(|s| !s.trim().is_empty()),
        bootstrap: input.bootstrap.unwrap_or_default(),
        group: input.group.unwrap_or_else(|| "Default".into()),
    };

    let list = state.store.upsert_project(&state.herdr, project).await;
    state.team_relay.notify_config_changed();
    Ok(list)
}

#[tauri::command]
pub async fn delete_project(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<ProjectConfig>, String> {
    let list = state
        .store
        .delete_project(&state.herdr, &project_id)
        .await;
    state.team_relay.notify_config_changed();
    Ok(list)
}

#[tauri::command]
pub async fn reorder_projects(
    state: State<'_, AppState>,
    ordered_ids: Vec<String>,
) -> Result<Vec<ProjectConfig>, String> {
    Ok(state
        .store
        .reorder_projects(&state.herdr, &ordered_ids)
        .await)
}
