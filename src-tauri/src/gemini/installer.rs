use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

pub const JJDR_GEMINI_HOOK_NAME: &str = "jjdr-gemini-bridge";

/// High-signal lifecycle events ONLY (zero hooks during tool-calling loops like BeforeTool/AfterTool,
/// preventing corporate AV/EDR process-spawn slowdowns).
pub const GEMINI_BRIDGE_EVENTS: [&str; 3] = ["BeforeAgent", "Notification", "AfterAgent"];

pub fn gemini_settings_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot resolve home directory".to_string())?;
    Ok(home.join(".gemini").join("settings.json"))
}

pub fn gemini_bridge_dir() -> Result<PathBuf, String> {
    let base = dirs::config_dir()
        .or_else(dirs::home_dir)
        .ok_or_else(|| "Cannot resolve app data directory".to_string())?;
    Ok(base.join("jjdr").join("gemini-bridge"))
}

pub fn gemini_endpoint_path() -> Result<PathBuf, String> {
    Ok(gemini_bridge_dir()?.join("endpoint.json"))
}

/// Build an ultra-lightweight inline hook command.
///
/// On Windows, Gemini CLI already spawns `pwsh`/`powershell -NoProfile -NonInteractive -Command`,
/// so running pure inline .NET UDP directly inside that shell spawns ZERO secondary `node.exe`
/// processes, bypasses `.ps1` ExecutionPolicy, and finishes fire-and-forget in <5ms even when
/// `jjdr` is closed.
pub fn build_hook_command(endpoint_path: &Path) -> String {
    #[cfg(windows)]
    {
        let escaped = endpoint_path
            .to_string_lossy()
            .replace('\'', "''");
        format!(
            "try {{ $utf8 = [Text.Encoding]::UTF8; \
$ep = [IO.File]::ReadAllText('{escaped}', $utf8) | ConvertFrom-Json; \
$sr = New-Object IO.StreamReader([Console]::OpenStandardInput(), $utf8); \
$raw = $sr.ReadToEnd(); \
$ev = if ($raw) {{ $raw | ConvertFrom-Json }} else {{ $null }}; \
$resp = if ($ev -and $ev.prompt_response) {{ [string]$ev.prompt_response }} else {{ '' }}; \
if ($resp.Length -gt 240) {{ $resp = $resp.Substring(0, 240); if ([char]::IsHighSurrogate($resp[$resp.Length - 1])) {{ $resp = $resp.Substring(0, $resp.Length - 1) }} }}; \
$p = @{{ token=[string]$ep.token; terminal_id=[string]$env:HC_TERMINAL_ID; jjdr_addr=[string]$env:JJDR_GEMINI_ADDR; \
hook_event_name=$(if($ev){{[string]$ev.hook_event_name}}else{{''}}); \
cwd=$(if($ev){{[string]$ev.cwd}}else{{''}}); \
notification_type=$(if($ev){{[string]$ev.notification_type}}else{{''}}); \
message=$(if($ev){{[string]$ev.message}}else{{''}}); \
tool_name=$(if($ev){{[string]$ev.tool_name}}else{{''}}); \
prompt_response=$resp }} | ConvertTo-Json -Compress; \
$b = $utf8.GetBytes($p); \
$u = New-Object Net.Sockets.UdpClient; \
[void]$u.Send($b, $b.Length, '127.0.0.1', [int]$ep.port); \
$u.Close() }} catch {{}}; Write-Output '{{}}'"
        )
    }
    #[cfg(not(windows))]
    {
        let escaped = endpoint_path
            .to_string_lossy()
            .replace('\'', "'\\''");
        format!(
            "node -e \"const fs=require('fs'),d=require('dgram');let r='';process.stdin.on('data',c=>r+=c);process.stdin.on('end',()=>{{try{{const ep=JSON.parse(fs.readFileSync('{escaped}','utf8'));const ev=r?JSON.parse(r):{{}};const resp=typeof ev.prompt_response==='string'?ev.prompt_response.slice(0,240):'';const buf=Buffer.from(JSON.stringify({{token:ep.token||'',terminal_id:process.env.HC_TERMINAL_ID||'',jjdr_addr:process.env.JJDR_GEMINI_ADDR||'',hook_event_name:ev.hook_event_name||'',cwd:ev.cwd||'',notification_type:ev.notification_type||'',message:ev.message||'',tool_name:ev.tool_name||'',prompt_response:resp}}));const s=d.createSocket('udp4');s.send(buf,ep.port,'127.0.0.1',()=>s.close());}}catch{{}}process.stdout.write('{{}}');}});\""
        )
    }
}

fn is_jjdr_hook_entry(def: &Value) -> bool {
    def.get("hooks")
        .and_then(|h| h.as_array())
        .map(|arr| {
            arr.iter().any(|item| {
                item.get("name").and_then(|n| n.as_str()) == Some(JJDR_GEMINI_HOOK_NAME)
            })
        })
        .unwrap_or(false)
}

/// Non-destructively merge `jjdr-gemini-bridge` hooks into a Gemini `settings.json` JSON Value.
pub fn merge_hooks_into_settings(mut root: Value, command: &str) -> Value {
    if !root.is_object() {
        root = Value::Object(Map::new());
    }
    let root_obj = root.as_object_mut().unwrap();

    // Ensure `hooksConfig.enabled = true` (required by Gemini CLI HookRegistry)
    let hooks_cfg = root_obj
        .entry("hooksConfig".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !hooks_cfg.is_object() {
        *hooks_cfg = Value::Object(Map::new());
    }
    hooks_cfg
        .as_object_mut()
        .unwrap()
        .insert("enabled".to_string(), Value::Bool(true));

    let hooks_val = root_obj
        .entry("hooks".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !hooks_val.is_object() {
        *hooks_val = Value::Object(Map::new());
    }
    let hooks_obj = hooks_val.as_object_mut().unwrap();

    for event_name in GEMINI_BRIDGE_EVENTS {
        let mut entries: Vec<Value> = hooks_obj
            .get(event_name)
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        // Remove any previous jjdr-gemini-bridge entries for idempotent upgrades
        entries.retain(|def| !is_jjdr_hook_entry(def));

        entries.push(json!({
            "matcher": "*",
            "hooks": [
                {
                    "type": "command",
                    "name": JJDR_GEMINI_HOOK_NAME,
                    "command": command,
                    "timeout": 5000
                }
            ]
        }));

        hooks_obj.insert(event_name.to_string(), Value::Array(entries));
    }

    root
}

/// Remove only `jjdr-gemini-bridge` entries while preserving all user settings and other hooks.
pub fn remove_hooks_from_settings(mut root: Value) -> Value {
    let Some(root_obj) = root.as_object_mut() else {
        return root;
    };
    if let Some(hooks_obj) = root_obj.get_mut("hooks").and_then(|v| v.as_object_mut()) {
        for event_name in GEMINI_BRIDGE_EVENTS {
            if let Some(arr) = hooks_obj.get_mut(event_name).and_then(|v| v.as_array_mut()) {
                arr.retain(|def| !is_jjdr_hook_entry(def));
            }
            if hooks_obj
                .get(event_name)
                .and_then(|v| v.as_array())
                .map(|a| a.is_empty())
                .unwrap_or(false)
            {
                hooks_obj.remove(event_name);
            }
        }
    }
    root
}

/// Check whether all 3 bridge hooks and `hooksConfig.enabled` are currently present.
pub fn are_hooks_installed_in_value(root: &Value) -> bool {
    let enabled = root
        .get("hooksConfig")
        .and_then(|c| c.get("enabled"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !enabled {
        return false;
    }
    let Some(hooks_obj) = root.get("hooks").and_then(|h| h.as_object()) else {
        return false;
    };
    GEMINI_BRIDGE_EVENTS.iter().all(|event_name| {
        hooks_obj
            .get(*event_name)
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().any(is_jjdr_hook_entry))
            .unwrap_or(false)
    })
}

pub fn check_hooks_installed(settings_path: &Path) -> bool {
    let Ok(raw) = fs::read_to_string(settings_path) else {
        return false;
    };
    let trimmed = raw.trim_start_matches('\u{feff}').trim();
    let Ok(val) = serde_json::from_str::<Value>(trimmed) else {
        return false;
    };
    are_hooks_installed_in_value(&val)
}

fn write_json_atomic(path: &Path, val: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create dir: {}", e))?;
    }
    let pretty = serde_json::to_string_pretty(val)
        .map_err(|e| format!("JSON serialize error: {}", e))?;
    let tmp = path.with_extension("json.jjdr.tmp");
    fs::write(&tmp, format!("{}\n", pretty))
        .map_err(|e| format!("Failed to write temp file: {}", e))?;
    if fs::rename(&tmp, path).is_err() {
        // Fallback overwrite on Windows when target exists
        fs::copy(&tmp, path).map_err(|e| format!("Failed to update settings file: {}", e))?;
        let _ = fs::remove_file(&tmp);
    }
    Ok(())
}

pub fn install_hooks_at(settings_path: &Path, endpoint_path: &Path) -> Result<(), String> {
    let existing = match fs::read_to_string(settings_path) {
        Ok(raw) => {
            let trimmed = raw.trim_start_matches('\u{feff}').trim();
            if trimmed.is_empty() {
                Value::Object(Map::new())
            } else {
                serde_json::from_str::<Value>(trimmed)
                    .map_err(|e| format!("Existing Gemini settings.json is not valid JSON: {}", e))?
            }
        }
        Err(_) => Value::Object(Map::new()),
    };
    let command = build_hook_command(endpoint_path);
    let updated = merge_hooks_into_settings(existing, &command);
    write_json_atomic(settings_path, &updated)
}

pub fn uninstall_hooks_at(settings_path: &Path) -> Result<(), String> {
    let Ok(raw) = fs::read_to_string(settings_path) else {
        return Ok(());
    };
    let trimmed = raw.trim_start_matches('\u{feff}').trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    let existing = serde_json::from_str::<Value>(trimmed)
        .map_err(|e| format!("Existing Gemini settings.json is not valid JSON: {}", e))?;
    let updated = remove_hooks_from_settings(existing);
    write_json_atomic(settings_path, &updated)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn non_destructively_merges_and_removes_only_jjdr_hooks() {
        let initial = json!({
            "theme": "Default",
            "mcpServers": { "my-mcp": { "command": "npx" } },
            "hooks": {
                "BeforeAgent": [
                    {
                        "matcher": "*",
                        "hooks": [{ "type": "command", "name": "user-custom-hook", "command": "echo hi" }]
                    }
                ]
            }
        });

        let installed = merge_hooks_into_settings(initial, "cmd-v1");
        assert!(are_hooks_installed_in_value(&installed));
        assert_eq!(installed["theme"], "Default");
        assert_eq!(installed["mcpServers"]["my-mcp"]["command"], "npx");
        assert_eq!(installed["hooks"]["BeforeAgent"].as_array().unwrap().len(), 2);

        // Idempotent reinstall updates command without duplicating
        let reinstalled = merge_hooks_into_settings(installed, "cmd-v2");
        assert_eq!(
            reinstalled["hooks"]["BeforeAgent"].as_array().unwrap().len(),
            2
        );

        // Uninstall removes only jjdr hooks and preserves user hook + theme
        let removed = remove_hooks_from_settings(reinstalled);
        assert!(!are_hooks_installed_in_value(&removed));
        assert_eq!(removed["theme"], "Default");
        assert_eq!(removed["hooks"]["BeforeAgent"].as_array().unwrap().len(), 1);
        assert_eq!(
            removed["hooks"]["BeforeAgent"][0]["hooks"][0]["name"],
            "user-custom-hook"
        );
        assert!(removed["hooks"].get("AfterAgent").is_none());
    }

    #[test]
    fn strictly_registers_only_3_turn_boundary_events_with_5s_timeout() {
        assert_eq!(
            GEMINI_BRIDGE_EVENTS,
            ["BeforeAgent", "Notification", "AfterAgent"]
        );
        let installed = merge_hooks_into_settings(json!({}), "dummy-cmd");
        assert_eq!(installed["hooksConfig"]["enabled"], json!(true));

        let hooks_obj = installed["hooks"].as_object().unwrap();
        assert_eq!(hooks_obj.len(), 3);
        assert!(hooks_obj.get("BeforeTool").is_none());
        assert!(hooks_obj.get("AfterTool").is_none());
        assert!(hooks_obj.get("BeforeModel").is_none());
        assert!(hooks_obj.get("AfterModel").is_none());

        for ev in GEMINI_BRIDGE_EVENTS {
            let entry = &hooks_obj[ev][0];
            assert_eq!(entry["matcher"], "*");
            let hook = &entry["hooks"][0];
            assert_eq!(hook["type"], "command");
            assert_eq!(hook["name"], JJDR_GEMINI_HOOK_NAME);
            assert_eq!(hook["timeout"], 5000);
        }
    }

    #[test]
    fn escapes_spaces_and_single_quotes_in_endpoint_path() {
        let tricky = PathBuf::from(r"C:\Users\O'Brien Dev\AppData\Roaming\jjdr\endpoint.json");
        let cmd = build_hook_command(&tricky);
        #[cfg(windows)]
        {
            assert!(cmd.contains("O''Brien Dev"));
            assert!(cmd.contains("Write-Output '{}'"));
            assert!(!cmd.contains("node.exe"));
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_inline_powershell_hook_sends_valid_udp_and_clean_stdout() {
        use std::io::Write;
        use std::net::UdpSocket;
        use std::process::{Command, Stdio};
        use std::time::Duration;

        use crate::gemini::GeminiHookPacket;

        let socket = UdpSocket::bind("127.0.0.1:0").expect("bind loopback udp");
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .expect("set timeout");
        let port = socket.local_addr().unwrap().port();

        let ep_path = std::env::temp_dir().join(format!(
            "jjdr_gemini_hook_e2e_{}.json",
            std::process::id()
        ));
        let ep_body = json!({ "port": port, "token": "tok-e2e-xyz" }).to_string();
        fs::write(&ep_path, ep_body).expect("write endpoint");

        let cmd_str = build_hook_command(&ep_path);
        let shell = if Command::new("pwsh").arg("-Version").output().is_ok() {
            "pwsh"
        } else {
            "powershell"
        };

        let run_case = |payload: &str| -> GeminiHookPacket {
            let mut child = Command::new(shell)
                .args(["-NoProfile", "-NonInteractive", "-Command", &cmd_str])
                .env("HC_TERMINAL_ID", "term-e2e-1")
                .env("JJDR_GEMINI_ADDR", "tag-e2e-1")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .expect("spawn shell");

            {
                let stdin = child.stdin.as_mut().unwrap();
                stdin.write_all(payload.as_bytes()).unwrap();
            }

            let output = child.wait_with_output().expect("wait shell");
            assert!(
                output.status.success(),
                "hook exited non-zero: stderr={}",
                String::from_utf8_lossy(&output.stderr)
            );
            assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "{}");

            let mut buf = [0u8; 8192];
            let (len, _) = socket.recv_from(&mut buf).expect("receive udp packet");
            serde_json::from_slice(&buf[..len]).expect("parse GeminiHookPacket")
        };

        // 1. BeforeAgent
        let p1 = run_case(r#"{"hook_event_name":"BeforeAgent","cwd":"K:/repo/wt"}"#);
        assert_eq!(p1.token, "tok-e2e-xyz");
        assert_eq!(p1.terminal_id, "term-e2e-1");
        assert_eq!(p1.jjdr_addr, "tag-e2e-1");
        assert_eq!(p1.hook_event_name, "BeforeAgent");
        assert_eq!(p1.cwd, "K:/repo/wt");

        // 2. Notification (ToolPermission)
        let p2 = run_case(
            r#"{"hook_event_name":"Notification","cwd":"K:/repo/wt","notification_type":"ToolPermission","message":"Allow run_shell_command?"}"#,
        );
        assert_eq!(p2.hook_event_name, "Notification");
        assert_eq!(p2.notification_type, "ToolPermission");
        assert_eq!(p2.message, "Allow run_shell_command?");

        // 3. AfterAgent with >240 char response (must truncate cleanly to 240 chars)
        let long_text = "A".repeat(600);
        let p3_json = json!({
            "hook_event_name": "AfterAgent",
            "cwd": "K:/repo/wt",
            "prompt_response": long_text
        })
        .to_string();
        let p3 = run_case(&p3_json);
        assert_eq!(p3.hook_event_name, "AfterAgent");
        assert_eq!(p3.prompt_response.len(), 240);

        // 4. Adversarial: Korean UTF-8 path + Korean/emoji/quotes/$var/backslash + surrogate-boundary emoji truncation
        let kr_resp = "형님! 로그인 버그 수정 완료했습니다 🎉 (특수문자: \"quotes\" $var \\path)";
        let kr_json = json!({
            "hook_event_name": "AfterAgent",
            "cwd": "K:/프로젝트/한글폴더",
            "prompt_response": kr_resp
        })
        .to_string();
        let p_kr = run_case(&kr_json);
        assert_eq!(p_kr.cwd, "K:/프로젝트/한글폴더");
        assert_eq!(p_kr.prompt_response, kr_resp);

        // Surrogate boundary stress: 150x 4-byte emoji (300 UTF-16 units) with odd prefix 'x' so index 240 splits a surrogate!
        let emoji_stress = format!("x{}", "🎉".repeat(150));
        let emoji_json = json!({
            "hook_event_name": "AfterAgent",
            "cwd": "K:/repo/wt",
            "prompt_response": emoji_stress
        })
        .to_string();
        let p_emoji = run_case(&emoji_json);
        assert!(p_emoji.prompt_response.starts_with("x🎉"));
        assert!(!p_emoji.prompt_response.contains('\u{FFFD}'));

        // Also test legacy Windows PowerShell 5.1 (`powershell.exe`) directly with Korean UTF-8 payload!
        if Command::new("powershell").arg("-Command").arg("exit 0").output().is_ok() {
            let mut ps5 = Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", &cmd_str])
                .env("HC_TERMINAL_ID", "term-ps5")
                .env("JJDR_GEMINI_ADDR", "tag-ps5")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .expect("spawn powershell 5.1");
            {
                let stdin = ps5.stdin.as_mut().unwrap();
                stdin.write_all(kr_json.as_bytes()).unwrap();
            }
            let ps5_out = ps5.wait_with_output().expect("wait ps5");
            assert!(ps5_out.status.success());
            assert_eq!(String::from_utf8_lossy(&ps5_out.stdout).trim(), "{}");
            let mut buf = [0u8; 8192];
            let (len, _) = socket.recv_from(&mut buf).expect("receive ps5 udp");
            let p_ps5: GeminiHookPacket = serde_json::from_slice(&buf[..len]).expect("parse ps5 packet");
            assert_eq!(p_ps5.cwd, "K:/프로젝트/한글폴더");
            assert_eq!(p_ps5.prompt_response, kr_resp);
        }

        let _ = fs::remove_file(&ep_path);

        // 5. Silent {} exit when endpoint.json is missing (jjdr closed)
        let missing_cmd = build_hook_command(&ep_path);
        let fallback_out = Command::new(shell)
            .args(["-NoProfile", "-NonInteractive", "-Command", &missing_cmd])
            .stdin(Stdio::null())
            .output()
            .expect("run fallback");
        assert!(fallback_out.status.success());
        assert_eq!(String::from_utf8_lossy(&fallback_out.stdout).trim(), "{}");
    }

    #[test]
    fn despair_handles_utf8_bom_and_malformed_hook_shapes_without_data_loss() {
        let dir = std::env::temp_dir().join(format!("jjdr_despair_bom_{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let settings_path = dir.join("settings.json");
        let ep_path = dir.join("endpoint.json");

        // UTF-8 BOM + malformed hooksConfig (bool) + malformed hooks (null) + valid user settings
        let bom_raw = "\u{feff}{\"theme\":\"Solarized\",\"hooksConfig\":false,\"hooks\":null}";
        fs::write(&settings_path, bom_raw).unwrap();

        install_hooks_at(&settings_path, &ep_path).expect("BOM settings must install cleanly");
        assert!(check_hooks_installed(&settings_path));

        let saved: Value =
            serde_json::from_str(&fs::read_to_string(&settings_path).unwrap()).unwrap();
        assert_eq!(saved["theme"], "Solarized");
        assert_eq!(saved["hooksConfig"]["enabled"], true);

        uninstall_hooks_at(&settings_path).expect("uninstall must succeed");
        assert!(!check_hooks_installed(&settings_path));
        let after: Value =
            serde_json::from_str(&fs::read_to_string(&settings_path).unwrap()).unwrap();
        assert_eq!(after["theme"], "Solarized");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn despair_refuses_to_overwrite_corrupted_json_settings_file() {
        let dir = std::env::temp_dir().join(format!("jjdr_despair_badjson_{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let settings_path = dir.join("settings.json");
        let ep_path = dir.join("endpoint.json");

        let broken = "{ \"theme\": \"Dark\", BROKEN_JSON ";
        fs::write(&settings_path, broken).unwrap();

        assert!(install_hooks_at(&settings_path, &ep_path).is_err());
        assert!(uninstall_hooks_at(&settings_path).is_err());
        assert!(!check_hooks_installed(&settings_path));
        // Original user file MUST remain 100% untouched!
        assert_eq!(fs::read_to_string(&settings_path).unwrap(), broken);

        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(windows)]
    #[test]
    fn despair_windows_hook_survives_corrupt_stdin_100kb_payload_broken_endpoint_and_closed_port() {
        use std::io::Write;
        use std::net::UdpSocket;
        use std::process::{Command, Stdio};
        use std::time::Duration;

        use crate::gemini::GeminiHookPacket;

        let shell = if Command::new("pwsh").arg("-Version").output().is_ok() {
            "pwsh"
        } else {
            "powershell"
        };

        let dir = std::env::temp_dir().join(format!("jjdr_despair_hook_{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let ep_path = dir.join("endpoint.json");

        // Helper: run hook with arbitrary stdin and assert silent exit=0, stdout="{}", stderr=""
        let run_silent = |stdin_bytes: &[u8]| {
            let cmd = build_hook_command(&ep_path);
            let mut child = Command::new(shell)
                .args(["-NoProfile", "-NonInteractive", "-Command", &cmd])
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .expect("spawn shell");
            {
                let stdin = child.stdin.as_mut().unwrap();
                let _ = stdin.write_all(stdin_bytes);
            }
            let out = child.wait_with_output().expect("wait shell");
            assert!(
                out.status.success(),
                "must never exit non-zero: stderr={}",
                String::from_utf8_lossy(&out.stderr)
            );
            assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "{}");
            assert!(
                String::from_utf8_lossy(&out.stderr).trim().is_empty(),
                "must never leak stderr: {}",
                String::from_utf8_lossy(&out.stderr)
            );
        };

        // Case A: Corrupted endpoint.json / invalid port / zero port
        for bad_ep in ["", "{broken", r#"{"port":"abc","token":"x"}"#, r#"{"port":0,"token":"x"}"#] {
            fs::write(&ep_path, bad_ep).unwrap();
            run_silent(br#"{"hook_event_name":"BeforeAgent"}"#);
        }

        // Case B: Valid socket -> corrupt stdin, empty stdin, binary garbage, AND 100KB huge prompt_response!
        let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
        socket.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let port = socket.local_addr().unwrap().port();
        fs::write(&ep_path, json!({ "port": port, "token": "tok-chaos" }).to_string()).unwrap();

        run_silent(b"");
        run_silent(b"{this is not json");
        run_silent(&[0x00, 0xFF, 0xFE, 0x01, 0x02]);

        // Drain any empty-stdin packet if sent, then send 100KB prompt_response
        let _ = socket.set_nonblocking(true);
        let mut drain = [0u8; 8192];
        while socket.recv_from(&mut drain).is_ok() {}
        let _ = socket.set_nonblocking(false);

        let huge_100kb = json!({
            "hook_event_name": "AfterAgent",
            "cwd": "K:/chaos",
            "prompt_response": "Z".repeat(100_000)
        })
        .to_string();
        run_silent(huge_100kb.as_bytes());

        let mut buf = [0u8; 8192];
        let (len, _) = socket.recv_from(&mut buf).expect("100KB payload must truncate and arrive over UDP");
        let pkt: GeminiHookPacket = serde_json::from_slice(&buf[..len]).unwrap();
        assert_eq!(pkt.token, "tok-chaos");
        assert_eq!(pkt.prompt_response.len(), 240);

        // Case C: Closed UDP port (jjdr exited right before hook ran) -> must still finish cleanly
        drop(socket);
        run_silent(br#"{"hook_event_name":"AfterAgent","prompt_response":"bye"}"#);

        let _ = fs::remove_dir_all(&dir);
    }
}
