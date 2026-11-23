use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CoreInfo {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HelloResult {
    pub generation: u32,
    pub version: String,
    pub core: CoreInfo,
    pub framed: bool,
    #[serde(default)]
    pub methods: Vec<String>,
    #[serde(default)]
    pub features: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Status {
    pub state: String,
    #[serde(default)]
    pub app: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub msg: Option<String>,
    #[serde(default)]
    pub progress: Option<u8>,
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Foreground {
    pub pid: i32,
    pub name: String,
    #[serde(default)]
    pub argv: Vec<String>,
    #[serde(default)]
    pub cwd: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Terminal {
    pub address: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub labels: HashMap<String, String>,
    #[serde(default)]
    pub argv: Vec<String>,
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub created_ms: u64,
    #[serde(default)]
    pub finished_ms: Option<u64>,
    #[serde(default)]
    pub exit_code: Option<i32>,
    #[serde(default)]
    pub signal: Option<i32>,
    #[serde(default)]
    pub screen: String,
    #[serde(default)]
    pub cols: u16,
    #[serde(default)]
    pub rows: u16,
    #[serde(default)]
    pub status: Option<Status>,
    #[serde(default)]
    pub status_ms: Option<u64>,
    #[serde(default)]
    pub turn: u64,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub template: Option<String>,
    #[serde(default)]
    pub keep: bool,
    #[serde(default)]
    pub pid: Option<i32>,
    #[serde(default)]
    pub parent: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub foreground: Option<Foreground>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubscribeResult {
    pub channel: Option<u32>,
    pub seq: u64,
    #[serde(default)]
    pub terminals: Vec<Terminal>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachResult {
    pub channel: u32,
    pub terminal: Terminal,
    #[serde(default)]
    pub resize_notifications: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ReadResult {
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub screen: Option<String>,
    #[serde(default)]
    pub incomplete: Option<bool>,
    #[serde(default)]
    pub why: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TemplateInfo {
    pub name: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TemplatesResult {
    #[serde(default)]
    pub templates: Vec<TemplateInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DocGetResult {
    pub value: serde_json::Value,
    pub version: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DocSetResult {
    pub version: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HerdrHealth {
    pub connected: bool,
    pub hc_found: bool,
    pub version: Option<String>,
    pub core_name: Option<String>,
    pub error: Option<String>,
    pub hint: Option<String>,
}

impl Default for HerdrHealth {
    fn default() -> Self {
        Self {
            connected: false,
            hc_found: true,
            version: None,
            core_name: None,
            error: None,
            hint: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TerminalPreview {
    pub address: String,
    pub lines: Vec<String>,
    pub updated_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateBatchPayload {
    pub full_sync: bool,
    pub terminals: Vec<Terminal>,
    pub removed_addresses: Vec<String>,
    pub previews: Vec<TerminalPreview>,
    pub health: HerdrHealth,
    pub seq: u64,
}
