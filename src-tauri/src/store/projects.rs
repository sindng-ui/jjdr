use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::RwLock;
use tracing::warn;

use crate::git::bootstrap::BootstrapConfig;
use crate::herdr::client::HerdrClient;
use crate::herdr::types::DocGetResult;

const DOC_PROJECTS_KEY: &str = "jjdr.projects.v1";
const DOC_UI_STATE_KEY: &str = "jjdr.ui_state.v1";
const DOC_SETTINGS_KEY: &str = "jjdr.settings.v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectConfig {
    pub id: String,
    pub name: String,
    pub repo_path: String,
    pub color: String,
    #[serde(default)]
    pub default_branch: String,
    #[serde(default)]
    pub default_agent: String,
    #[serde(default)]
    pub verify_command: Option<String>,
    #[serde(default)]
    pub bootstrap: BootstrapConfig,
    #[serde(default)]
    pub group: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorktreeCardMeta {
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PersistedUiState {
    #[serde(default)]
    pub view_mode: String,
    #[serde(default)]
    pub selected_terminal: Option<String>,
    #[serde(default)]
    pub attached_terminal: Option<String>,
    #[serde(default)]
    pub active_group: String,
    /// Map of terminal address -> last acknowledged turn number
    #[serde(default)]
    pub ack_turns: HashMap<String, u64>,
    /// Map of terminal address -> queued follow-up prompts waiting for `done`
    #[serde(default)]
    pub queued_prompts: HashMap<String, Vec<String>>,
    /// Map of worktree normalized path -> last agent command for quick resume after reboot
    #[serde(default)]
    pub last_agent_by_worktree: HashMap<String, Vec<String>>,
    /// User-adjusted right terminal drawer width in pixels
    #[serde(default)]
    pub terminal_width_px: Option<u32>,
    /// Custom display name / note per normalized worktree path
    #[serde(default)]
    pub worktree_meta: HashMap<String, WorktreeCardMeta>,
    /// Custom worktree card ordering per project id (normalized worktree paths)
    #[serde(default)]
    pub worktree_order_by_project: HashMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptPreset {
    pub id: String,
    pub label: String,
    pub prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_radar_density")]
    pub radar_density: String,
    #[serde(default = "default_root_card_mode")]
    pub root_card_mode: String,
    #[serde(default = "default_stuck_minutes")]
    pub stuck_minutes: u64,
    #[serde(default = "default_true")]
    pub notify_on_blocked: bool,
    #[serde(default)]
    pub notify_on_done: bool,
    #[serde(default = "default_true")]
    pub show_merge_overlap: bool,
    #[serde(default = "default_true")]
    pub bg_overlay_enabled: bool,
    #[serde(default = "default_bg_overlay_position")]
    pub bg_overlay_position: String,
    #[serde(default = "default_presets")]
    pub prompt_presets: Vec<PromptPreset>,
}

fn default_theme() -> String {
    "aurora".to_string()
}
fn default_radar_density() -> String {
    "balanced".to_string()
}
fn default_root_card_mode() -> String {
    "header_chip".to_string()
}
fn default_bg_overlay_position() -> String {
    "top_center".to_string()
}
fn default_stuck_minutes() -> u64 {
    5
}
fn default_true() -> bool {
    true
}
fn default_presets() -> Vec<PromptPreset> {
    vec![
        PromptPreset {
            id: "test".into(),
            label: "Run Tests".into(),
            prompt: "Run the test suite and fix any failures.".into(),
        },
        PromptPreset {
            id: "review".into(),
            label: "Self Review".into(),
            prompt: "Review your diff carefully for edge cases, bugs, and performance regressions.".into(),
        },
        PromptPreset {
            id: "lint".into(),
            label: "Fix Lint".into(),
            prompt: "Run lint and typecheck, and fix all warnings or errors.".into(),
        },
        PromptPreset {
            id: "commit".into(),
            label: "Prepare Commit".into(),
            prompt: "Summarize all changes concisely and propose a clean commit message.".into(),
        },
    ]
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            radar_density: default_radar_density(),
            root_card_mode: default_root_card_mode(),
            stuck_minutes: default_stuck_minutes(),
            notify_on_blocked: true,
            notify_on_done: false,
            show_merge_overlap: true,
            bg_overlay_enabled: true,
            bg_overlay_position: default_bg_overlay_position(),
            prompt_presets: default_presets(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PersistedBundle {
    pub projects: Vec<ProjectConfig>,
    pub ui_state: PersistedUiState,
    pub settings: AppSettings,
}

pub struct PersistenceStore {
    local_dir: PathBuf,
    projects: RwLock<Vec<ProjectConfig>>,
    ui_state: RwLock<PersistedUiState>,
    settings: RwLock<AppSettings>,
}

impl PersistenceStore {
    pub fn new() -> Self {
        let local_dir = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("jjdr");
        let _ = std::fs::create_dir_all(&local_dir);

        let projects = read_local_json(&local_dir.join("projects.json")).unwrap_or_default();
        let ui_state = read_local_json(&local_dir.join("ui_state.json")).unwrap_or_default();
        let settings = read_local_json(&local_dir.join("settings.json")).unwrap_or_default();

        Self {
            local_dir,
            projects: RwLock::new(projects),
            ui_state: RwLock::new(ui_state),
            settings: RwLock::new(settings),
        }
    }

    /// Hydrate from herdr-core `doc.get` when available, falling back to local cache.
    pub async fn load_bundle(&self, client: &Arc<HerdrClient>) -> PersistedBundle {
        if client.is_connected().await {
            if let Some(p) = doc_get_typed::<Vec<ProjectConfig>>(client, DOC_PROJECTS_KEY).await {
                *self.projects.write().await = p.clone();
                write_local_json(&self.local_dir.join("projects.json"), &p);
            }
            if let Some(u) = doc_get_typed::<PersistedUiState>(client, DOC_UI_STATE_KEY).await {
                *self.ui_state.write().await = u.clone();
                write_local_json(&self.local_dir.join("ui_state.json"), &u);
            }
            if let Some(s) = doc_get_typed::<AppSettings>(client, DOC_SETTINGS_KEY).await {
                *self.settings.write().await = s.clone();
                write_local_json(&self.local_dir.join("settings.json"), &s);
            }
        }

        PersistedBundle {
            projects: self.projects.read().await.clone(),
            ui_state: self.ui_state.read().await.clone(),
            settings: self.settings.read().await.clone(),
        }
    }

    pub async fn list_projects(&self) -> Vec<ProjectConfig> {
        self.projects.read().await.clone()
    }

    pub async fn upsert_project(
        &self,
        client: &Arc<HerdrClient>,
        project: ProjectConfig,
    ) -> Vec<ProjectConfig> {
        let list = {
            let mut guard = self.projects.write().await;
            if let Some(existing) = guard.iter_mut().find(|p| p.id == project.id) {
                *existing = project;
            } else {
                guard.push(project);
            }
            guard.clone()
        };
        write_local_json(&self.local_dir.join("projects.json"), &list);
        doc_set_best_effort(client, DOC_PROJECTS_KEY, json!(list)).await;
        list
    }

    pub async fn delete_project(
        &self,
        client: &Arc<HerdrClient>,
        project_id: &str,
    ) -> Vec<ProjectConfig> {
        let list = {
            let mut guard = self.projects.write().await;
            guard.retain(|p| p.id != project_id);
            guard.clone()
        };
        write_local_json(&self.local_dir.join("projects.json"), &list);
        doc_set_best_effort(client, DOC_PROJECTS_KEY, json!(list)).await;
        list
    }

    pub async fn reorder_projects(
        &self,
        client: &Arc<HerdrClient>,
        ordered_ids: &[String],
    ) -> Vec<ProjectConfig> {
        let list = {
            let mut guard = self.projects.write().await;
            *guard = apply_project_order(std::mem::take(&mut *guard), ordered_ids);
            guard.clone()
        };
        write_local_json(&self.local_dir.join("projects.json"), &list);
        doc_set_best_effort(client, DOC_PROJECTS_KEY, json!(list)).await;
        list
    }

    pub async fn save_ui_state(&self, client: &Arc<HerdrClient>, state: PersistedUiState) {
        *self.ui_state.write().await = state.clone();
        write_local_json(&self.local_dir.join("ui_state.json"), &state);
        doc_set_best_effort(client, DOC_UI_STATE_KEY, json!(state)).await;
    }

    pub async fn save_settings(&self, client: &Arc<HerdrClient>, settings: AppSettings) {
        *self.settings.write().await = settings.clone();
        write_local_json(&self.local_dir.join("settings.json"), &settings);
        doc_set_best_effort(client, DOC_SETTINGS_KEY, json!(settings)).await;
    }
}

async fn doc_get_typed<T: for<'de> Deserialize<'de>>(
    client: &Arc<HerdrClient>,
    name: &str,
) -> Option<T> {
    let val = client.call("doc.get", json!({ "name": name })).await.ok()?;
    let res: DocGetResult = serde_json::from_value(val).ok()?;
    if res.version == 0 || res.value.is_null() {
        return None;
    }
    serde_json::from_value::<T>(res.value).ok()
}

async fn doc_set_best_effort(client: &Arc<HerdrClient>, name: &str, value: Value) {
    if !client.is_connected().await {
        return;
    }
    // Optimistic concurrency: read current version then write
    let version = match client.call("doc.get", json!({ "name": name })).await {
        Ok(v) => serde_json::from_value::<DocGetResult>(v)
            .map(|r| r.version)
            .unwrap_or(0),
        Err(_) => 0,
    };
    if let Err(err) = client
        .call(
            "doc.set",
            json!({ "name": name, "value": value, "version": version }),
        )
        .await
    {
        warn!("doc.set {} skipped: {}", name, err);
    }
}

fn read_local_json<T: for<'de> Deserialize<'de>>(path: &PathBuf) -> Option<T> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_local_json<T: Serialize>(path: &PathBuf, value: &T) {
    if let Ok(text) = serde_json::to_string_pretty(value) {
        let _ = std::fs::write(path, text);
    }
}

pub fn apply_project_order(
    projects: Vec<ProjectConfig>,
    ordered_ids: &[String],
) -> Vec<ProjectConfig> {
    let mut by_id: HashMap<String, ProjectConfig> = projects
        .into_iter()
        .map(|p| (p.id.clone(), p))
        .collect();
    let mut reordered = Vec::with_capacity(by_id.len());
    for id in ordered_ids {
        if let Some(proj) = by_id.remove(id) {
            reordered.push(proj);
        }
    }
    let mut remaining: Vec<ProjectConfig> = by_id.into_values().collect();
    remaining.sort_by(|a, b| a.name.cmp(&b.name));
    reordered.extend(remaining);
    reordered
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_proj(id: &str, name: &str) -> ProjectConfig {
        ProjectConfig {
            id: id.into(),
            name: name.into(),
            repo_path: format!("/repo/{}", id),
            color: "#fff".into(),
            default_branch: "main".into(),
            default_agent: "agy".into(),
            verify_command: None,
            bootstrap: BootstrapConfig::default(),
            group: "Default".into(),
        }
    }

    #[test]
    fn reorders_projects_and_keeps_missing_ones() {
        let list = vec![mk_proj("a", "Alpha"), mk_proj("b", "Beta"), mk_proj("c", "Gamma")];
        let out = apply_project_order(list, &["c".into(), "a".into()]);
        let ids: Vec<&str> = out.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, vec!["c", "a", "b"]);
    }
}
