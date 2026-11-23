use std::path::Path;

use serde::{Deserialize, Serialize};
use tokio::process::Command;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BootstrapConfig {
    /// Relative paths to copy from main repo into new worktree (e.g. ".env", ".env.local")
    #[serde(default)]
    pub copy_files: Vec<String>,
    /// Optional shell command to run inside the newly created worktree (e.g. "npm ci")
    #[serde(default)]
    pub setup_command: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BootstrapResult {
    pub copied: Vec<String>,
    pub command_output: Option<String>,
    pub warnings: Vec<String>,
}

pub async fn run_bootstrap(
    repo_root: &str,
    worktree_path: &str,
    config: &BootstrapConfig,
) -> BootstrapResult {
    let mut copied = Vec::new();
    let mut warnings = Vec::new();
    let src_root = Path::new(repo_root);
    let dst_root = Path::new(worktree_path);

    for rel in &config.copy_files {
        let trimmed = rel.trim();
        if trimmed.is_empty() {
            continue;
        }
        let src = src_root.join(trimmed);
        let dst = dst_root.join(trimmed);
        if !src.exists() {
            warnings.push(format!("Skipped missing file: {}", trimmed));
            continue;
        }
        if let Some(parent) = dst.parent() {
            let _ = tokio::fs::create_dir_all(parent).await;
        }
        match tokio::fs::copy(&src, &dst).await {
            Ok(_) => copied.push(trimmed.to_string()),
            Err(e) => warnings.push(format!("Failed to copy {}: {}", trimmed, e)),
        }
    }

    let mut command_output = None;
    if let Some(cmd_str) = config.setup_command.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        #[cfg(windows)]
        let mut cmd = {
            let mut c = Command::new("cmd");
            c.args(["/C", cmd_str]).creation_flags(CREATE_NO_WINDOW);
            c
        };
        #[cfg(not(windows))]
        let mut cmd = {
            let mut c = Command::new("sh");
            c.args(["-c", cmd_str]);
            c
        };

        cmd.current_dir(dst_root);
        match cmd.output().await {
            Ok(out) => {
                let text = format!(
                    "{}{}",
                    String::from_utf8_lossy(&out.stdout),
                    String::from_utf8_lossy(&out.stderr)
                );
                if !out.status.success() {
                    warnings.push(format!("Setup command exited with {}: {}", out.status, text.trim()));
                }
                command_output = Some(text);
            }
            Err(e) => warnings.push(format!("Setup command failed to start: {}", e)),
        }
    }

    BootstrapResult {
        copied,
        command_output,
        warnings,
    }
}
