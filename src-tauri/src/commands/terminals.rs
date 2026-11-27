use serde::Deserialize;
use serde_json::json;
use tauri::State;

use crate::git::worktree::normalize_path;
use crate::herdr::client::HerdrClient;
use crate::herdr::naming::{is_recoverable_name_error, sanitize_herdr_name};
use crate::herdr::types::Terminal;
use crate::AppState;

pub use super::attach::AttachManager;

pub const MAX_SHELLS_PER_WORKTREE: usize = 2;

fn is_plain_shell_bin(raw_bin: &str) -> bool {
    let bin = raw_bin
        .replace('\\', "/")
        .rsplit('/')
        .next()
        .unwrap_or(raw_bin)
        .to_lowercase();
    let bin = bin
        .trim_end_matches(".exe")
        .trim_end_matches(".cmd")
        .trim_end_matches(".bat");
    matches!(
        bin,
        "" | "shell" | "pwsh" | "powershell" | "cmd" | "bash" | "zsh" | "sh" | "fish"
    )
}

fn is_plain_shell_argv(argv: &[String]) -> bool {
    argv.is_empty() || is_plain_shell_bin(&argv[0])
}

fn is_plain_shell_terminal(t: &Terminal) -> bool {
    if let Some(agent) = t.labels.get("jjdr.agent") {
        return is_plain_shell_bin(agent);
    }
    is_plain_shell_argv(&t.argv)
}

#[derive(Debug, Deserialize)]
pub struct LaunchSessionInput {
    pub project_id: Option<String>,
    pub cwd: String,
    pub branch: Option<String>,
    pub argv: Vec<String>,
    pub initial_prompt: Option<String>,
    pub name: Option<String>,
    pub autonomous: Option<bool>,
}

/// Normalize CLI flags for interactive herdr-core execution and default autonomous (YOLO) mode.
pub fn normalize_agent_argv(
    mut argv: Vec<String>,
    initial_prompt: Option<String>,
    autonomous: bool,
) -> Vec<String> {
    if argv.is_empty() {
        return argv;
    }

    let bin = argv[0]
        .replace('\\', "/")
        .rsplit('/')
        .next()
        .unwrap_or(&argv[0])
        .to_lowercase();
    let bin = bin
        .trim_end_matches(".exe")
        .trim_end_matches(".cmd")
        .trim_end_matches(".bat")
        .to_string();

    if bin == "codex" && !argv.iter().any(|a| a == "--no-daemon") {
        argv.push("--no-daemon".into());
    }

    if autonomous {
        match bin.as_str() {
            "agy" => {
                if !argv.iter().any(|a| a == "--dangerously-skip-permissions") {
                    argv.push("--dangerously-skip-permissions".into());
                }
            }
            "claude" => {
                if !argv.iter().any(|a| a == "--dangerously-skip-permissions") {
                    argv.push("--dangerously-skip-permissions".into());
                }
                if !argv
                    .iter()
                    .any(|a| a == "--permission-mode" || a.starts_with("--permission-mode="))
                {
                    argv.push("--permission-mode".into());
                    argv.push("bypassPermissions".into());
                }
            }
            "gemini" => {
                if !argv.iter().any(|a| a == "-y" || a == "--yolo") {
                    argv.push("-y".into());
                }
            }
            "codex" => {
                if !argv
                    .iter()
                    .any(|a| a == "--dangerously-bypass-approvals-and-sandbox" || a == "--yolo")
                {
                    argv.push("--dangerously-bypass-approvals-and-sandbox".into());
                }
            }
            _ => {}
        }
    }

    if let Some(prompt) = initial_prompt.filter(|p| !p.trim().is_empty()) {
        if bin == "agy" && !argv.iter().any(|a| a == "-i" || a == "--prompt-interactive") {
            argv.push("-i".into());
        }
        argv.push(prompt);
    }

    argv
}

/// Invoke `terminal.run` with sanitized `name`, falling back cleanly without `name`
/// if herdr-core rejects the name (invalid syntax or duplicate session name).
pub async fn call_terminal_run_safe(
    client: &HerdrClient,
    mut params: serde_json::Value,
    raw_name: Option<&str>,
) -> Result<serde_json::Value, String> {
    let sanitized = raw_name.and_then(sanitize_herdr_name);
    if let Some(ref name) = sanitized {
        params["name"] = json!(name);
    }

    match client.call("terminal.run", params.clone()).await {
        Ok(res) => Ok(res),
        Err(err) => {
            let err_str = err.to_string();
            if sanitized.is_some() && is_recoverable_name_error(&err_str) {
                if let Some(obj) = params.as_object_mut() {
                    obj.remove("name");
                }
                client
                    .call("terminal.run", params)
                    .await
                    .map_err(|e| e.to_string())
            } else {
                Err(err_str)
            }
        }
    }
}

#[tauri::command]
pub async fn launch_session(
    state: State<'_, AppState>,
    input: LaunchSessionInput,
) -> Result<String, String> {
    let cwd = if input.cwd.trim().is_empty() {
        dirs::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string())
    } else {
        input.cwd
    };

    let is_plain_shell = is_plain_shell_argv(&input.argv);
    let norm_cwd = normalize_path(&cwd);

    // Enforce max 2 live shells per worktree when launching inside a project worktree
    let mut existing_live_shells = 0usize;
    if is_plain_shell && input.project_id.is_some() {
        let map = state.hub.terminals.read().await;
        for t in map.values() {
            if t.state != "live" || !is_plain_shell_terminal(t) {
                continue;
            }
            let same_wt = t
                .labels
                .get("jjdr.worktree")
                .map(|w| normalize_path(w) == norm_cwd)
                .unwrap_or_else(|| normalize_path(&t.cwd) == norm_cwd);
            if same_wt {
                existing_live_shells += 1;
            }
        }
        if existing_live_shells >= MAX_SHELLS_PER_WORKTREE {
            return Err(format!(
                "한 Worktree당 PowerShell(터미널)은 최대 {}개까지 열 수 있습니다.",
                MAX_SHELLS_PER_WORKTREE
            ));
        }
    }

    let autonomous = input.autonomous.unwrap_or(true);
    let argv = if input.argv.is_empty() {
        Vec::new()
    } else if is_plain_shell {
        input.argv
    } else {
        normalize_agent_argv(input.argv, input.initial_prompt, autonomous)
    };

    let mut labels = serde_json::Map::new();
    labels.insert("jjdr.worktree".into(), json!(norm_cwd));
    labels.insert(
        "jjdr.agent".into(),
        json!(if is_plain_shell { "shell" } else { argv[0].as_str() }),
    );
    if let Some(pid) = input.project_id {
        labels.insert("jjdr.project".into(), json!(pid));
    }
    if let Some(br) = input.branch {
        labels.insert("jjdr.branch".into(), json!(br));
    }

    let is_gemini = !is_plain_shell
        && argv
            .first()
            .map(|a| {
                a.replace('\\', "/")
                    .rsplit('/')
                    .next()
                    .unwrap_or(a)
                    .trim_end_matches(".exe")
                    .eq_ignore_ascii_case("gemini")
            })
            .unwrap_or(false);
    let gemini_tag = if is_gemini {
        Some(uuid::Uuid::new_v4().to_string())
    } else {
        None
    };
    if let Some(ref tag) = gemini_tag {
        labels.insert("jjdr.gemini_tag".into(), json!(tag));
    }

    let mut params = json!({
        "cwd": cwd,
        "labels": labels,
        "outlive_parent": true,
        "no_parent": true,
        "keep": true,
        "wait": false
    });
    if let Some(tag) = gemini_tag {
        params["env"] = json!({ "JJDR_GEMINI_ADDR": tag });
    }
    if !argv.is_empty() {
        params["argv"] = json!(argv);
    }

    let effective_name = input.name.map(|n| {
        if is_plain_shell && existing_live_shells > 0 {
            format!("{}-{}", n, existing_live_shells + 1)
        } else {
            n
        }
    });

    let res = call_terminal_run_safe(&state.herdr, params, effective_name.as_deref()).await?;

    let address = res
        .get("terminal")
        .and_then(|t| t.get("address"))
        .or_else(|| res.get("address"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let hub = state.hub.clone();
    let herdr = state.herdr.clone();
    tokio::spawn(async move {
        hub.sync_terminals_now(&herdr).await;
    });

    Ok(address)
}

#[tauri::command]
pub async fn send_terminal_text(
    state: State<'_, AppState>,
    address: String,
    text: String,
    force: Option<bool>,
) -> Result<(), String> {
    state
        .herdr
        .call(
            "terminal.send",
            json!({
                "terminal": address,
                "text": text,
                "force": force.unwrap_or(false)
            }),
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn send_terminal_keys(
    state: State<'_, AppState>,
    address: String,
    keys: Vec<String>,
) -> Result<(), String> {
    let sent_enter = keys.iter().any(|k| {
        let low = k.trim().to_lowercase();
        low == "enter" || low == "return" || k.contains('\r') || k.contains('\n')
    });
    state
        .herdr
        .call(
            "terminal.keys",
            json!({
                "terminal": address,
                "keys": keys
            }),
        )
        .await
        .map_err(|e| e.to_string())?;
    if sent_enter {
        state.hub.notify_gemini_user_approved(&address).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn interrupt_terminal(
    state: State<'_, AppState>,
    address: String,
) -> Result<(), String> {
    state
        .herdr
        .call("terminal.interrupt", json!({ "terminal": address }))
        .await
        .map_err(|e| e.to_string())?;
    state.hub.notify_gemini_user_interrupted(&address, false).await;
    Ok(())
}

#[tauri::command]
pub async fn kill_terminal(
    state: State<'_, AppState>,
    address: String,
    remove: Option<bool>,
) -> Result<(), String> {
    let _ = state
        .herdr
        .call("terminal.kill", json!({ "terminal": address }))
        .await;
    if remove.unwrap_or(true) {
        let _ = state
            .herdr
            .call("terminal.rm", json!({ "terminal": address }))
            .await;
    }
    Ok(())
}

#[tauri::command]
pub async fn popout_external_terminal(address: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let wt = std::process::Command::new("wt.exe")
            .args(["hc", "attach", &address])
            .spawn();
        if wt.is_err() {
            std::process::Command::new("cmd")
                .args(["/C", "start", "hc", "attach", &address])
                .spawn()
                .map_err(|e| format!("Failed to open external terminal: {}", e))?;
        }
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        let _ = address;
        Err("External terminal popout is currently configured for Windows.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_agent_argv;

    #[test]
    fn claude_adds_bypass_permission_mode_and_skip_permissions() {
        let out = normalize_agent_argv(vec!["claude".into()], None, true);
        assert_eq!(
            out,
            vec![
                "claude",
                "--dangerously-skip-permissions",
                "--permission-mode",
                "bypassPermissions"
            ]
        );
    }

    #[test]
    fn claude_does_not_duplicate_existing_permission_mode() {
        let out = normalize_agent_argv(
            vec![
                "claude".into(),
                "--continue".into(),
                "--permission-mode=acceptEdits".into(),
            ],
            None,
            true,
        );
        assert_eq!(
            out,
            vec![
                "claude",
                "--continue",
                "--permission-mode=acceptEdits",
                "--dangerously-skip-permissions"
            ]
        );
    }
}
