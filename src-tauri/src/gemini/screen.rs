use crate::herdr::protocol::strip_ansi;
use crate::herdr::types::Status;

fn is_confirmation_option_line(low: &str) -> bool {
    low.contains("allow once")
        || low.contains("allow for this session")
        || low.contains("allow for all future")
        || low.contains("yes, allow")
        || low.contains("suggest changes")
        || low.contains("modify with external editor")
        || low.contains("no (esc)")
}

/// Strictly matches an active Gemini CLI input bar (NOT a confirmation radio cursor like `> Allow once`
/// or a code diff line like `> const x = 1;`).
fn is_strict_input_bar_line(low: &str) -> bool {
    if is_confirmation_option_line(low) {
        return false;
    }
    low.contains("type your message")
        || low.contains("press 'i' for insert")
        || low.contains("press 'esc' for normal mode")
        || low == ">"
        || low == "❯"
}

fn is_idle_prompt_line(low: &str) -> bool {
    if is_confirmation_option_line(low) {
        return false;
    }
    is_strict_input_bar_line(low) || low.contains("press ctrl+c")
}

/// Lightweight Layer-2 screen analyzer for Gemini CLI terminals.
/// Used purely as a zero-overhead fallback when hooks are uninstalled or
/// no hook event was received recently. Never spawns processes or sends RPCs.
pub fn analyze_gemini_screen(
    raw_text: &str,
    prev_state: Option<&str>,
) -> Option<(Status, bool)> {
    let cleaned = strip_ansi(raw_text);
    let non_empty: Vec<&str> = cleaned
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();

    if non_empty.is_empty() {
        return None;
    }

    // Inspect the bottom ~18 visible lines where Gemini CLI renders prompts, spinners, and confirmations
    let tail_start = non_empty.len().saturating_sub(18);
    let tail = &non_empty[tail_start..];
    let tail_lower: Vec<String> = tail.iter().map(|l| l.to_lowercase()).collect();

    // Active input bar at the very bottom (last 4 lines) means any confirmation box further up
    // in scrollback is historical and already resolved — prevents sticky false-positive `blocked`.
    // Uses `is_strict_input_bar_line` so radio selection cursors like `> Allow once` or `❯ Allow once`
    // are NEVER mistaken for an idle input prompt!
    let bottom_4_start = tail_lower.len().saturating_sub(4);
    let bottom_has_active_input = tail_lower[bottom_4_start..]
        .iter()
        .any(|l| is_strict_input_bar_line(l));

    // Active spinner / streaming indicator (e.g., "⠋ Thinking... (esc to cancel, 4s)")
    let has_spinner_or_cancel = tail.iter().zip(tail_lower.iter()).any(|(orig, low)| {
        let has_braille = orig
            .chars()
            .any(|c| ('\u{2800}'..='\u{28ff}').contains(&c));
        low.contains("esc to cancel")
            || low.contains("waiting for model")
            || low.contains("connecting to mcp servers")
            || (has_braille
                && (low.contains("thinking")
                    || low.contains("responding")
                    || low.contains("working")
                    || low.contains("generating")
                    || low.contains("executing")
                    || low.contains("reading")
                    || low.contains("searching")))
    });

    // 1. Permission / Approval confirmation prompt (highest priority ONLY when not already back at input prompt)
    // Inspect bottom 12 lines so old scrollback confirmations don't re-trigger.
    let perm_start = tail_lower.len().saturating_sub(12);
    let perm_window = &tail_lower[perm_start..];
    let has_allow_once = perm_window.iter().any(|l| l.contains("allow once"));
    let has_confirm_companion = perm_window.iter().any(|l| {
        l.contains("allow for this session")
            || l.contains("allow for all future")
            || l.contains("suggest changes")
            || l.contains("modify with external editor")
            || l.contains("(esc)")
            || l.contains("cancel")
    });
    let has_explicit_permission_prompt = perm_window.iter().any(|l| {
        l.contains("yes, allow once")
            || l.contains("yes, allow always")
            || l.contains("allow execution of")
            || l.contains("do you want to proceed")
            || l.contains("apply this change?")
            || l.contains("waiting for user confirmation")
            || l.contains("waiting for your confirmation")
    });
    let has_permission_prompt =
        !bottom_has_active_input && (has_explicit_permission_prompt || (has_allow_once && has_confirm_companion));

    if has_permission_prompt {
        let orig_window = &tail[perm_start..];
        let msg = orig_window
            .iter()
            .find(|l| {
                let low = l.to_lowercase();
                low.contains("allow execution")
                    || low.contains("do you want to proceed")
                    || low.contains("apply this change")
                    || low.contains("waiting for user confirmation")
                    || low.contains("waiting for your confirmation")
            })
            .copied()
            .unwrap_or("Approval required")
            .chars()
            .take(120)
            .collect::<String>();

        return Some((
            Status {
                state: "blocked".to_string(),
                app: Some("gemini".to_string()),
                kind: Some("permission".to_string()),
                msg: Some(msg),
                progress: None,
                title: None,
            },
            false,
        ));
    }

    // 2. Active working / streaming spinner
    if has_spinner_or_cancel {
        let msg = tail
            .iter()
            .rev()
            .find(|l| {
                let low = l.to_lowercase();
                low.contains("esc to cancel")
                    || low.contains("waiting for model")
                    || low.contains("connecting to mcp servers")
                    || low.contains("thinking")
                    || low.contains("responding")
                    || low.contains("working")
            })
            .map(|l| {
                l.trim_start_matches(|c: char| ('\u{2800}'..='\u{28ff}').contains(&c) || c == ' ')
                    .chars()
                    .take(100)
                    .collect::<String>()
            })
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Working...".to_string());

        return Some((
            Status {
                state: "working".to_string(),
                app: Some("gemini".to_string()),
                kind: None,
                msg: Some(msg),
                progress: None,
                title: None,
            },
            false,
        ));
    }

    // 3. Fatal API / auth error banner on bottom lines (strictly match error banners, not prose mentioning "api error")
    let recent_tail = &tail_lower[tail_lower.len().saturating_sub(6)..];
    if let Some(err_line) = recent_tail.iter().rev().find(|l| {
        let is_explicit_err_prefix = l.starts_with("error:")
            || l.starts_with("api error:")
            || l.starts_with("✕")
            || l.starts_with("✖")
            || l.starts_with("✗")
            || l.starts_with("[error]");
        let is_fatal_banner = l.contains("429 too many requests")
            || l.contains("quota exceeded")
            || l.contains("authentication failed")
            || l.contains("no longer supported");
        is_fatal_banner || (is_explicit_err_prefix && l.contains("api error"))
    }) {
        return Some((
            Status {
                state: "error".to_string(),
                app: Some("gemini".to_string()),
                kind: None,
                msg: Some(err_line.chars().take(120).collect()),
                progress: None,
                title: None,
            },
            false,
        ));
    }

    // 4. Transition from `working` back to idle prompt -> `done` (increment synthetic turn)
    let has_idle_prompt = tail_lower
        .iter()
        .rev()
        .take(6)
        .any(|l| is_idle_prompt_line(l));

    if prev_state == Some("working") && has_idle_prompt {
        return Some((
            Status {
                state: "done".to_string(),
                app: Some("gemini".to_string()),
                kind: None,
                msg: Some("Turn complete".to_string()),
                progress: None,
                title: None,
            },
            true,
        ));
    }

    None
}

#[cfg(test)]
mod tests {
    use super::analyze_gemini_screen;

    #[test]
    fn detects_legacy_tool_permission_prompt_as_blocked_permission() {
        let screen = "\
╭──────────────────────────────────────────────╮
│ Allow execution of: run_shell_command?       │
│ ● 1. Yes, allow once                         │
│   2. Yes, allow always                       │
│   3. No (esc)                                │
╰──────────────────────────────────────────────╯";
        let (status, bump_turn) = analyze_gemini_screen(screen, Some("working")).unwrap();
        assert_eq!(status.state, "blocked");
        assert_eq!(status.kind.as_deref(), Some("permission"));
        assert_eq!(status.app.as_deref(), Some("gemini"));
        assert!(!bump_turn);
    }

    #[test]
    fn detects_modern_v03x_multiline_allow_once_confirmation() {
        let screen = "\
Apply this change?
  Allow once
  Allow for this session
  Allow for this file in all future sessions
  Modify with external editor
  No, suggest changes (esc)";
        let (status, bump_turn) = analyze_gemini_screen(screen, Some("working")).unwrap();
        assert_eq!(status.state, "blocked");
        assert_eq!(status.kind.as_deref(), Some("permission"));
        assert_eq!(status.msg.as_deref(), Some("Apply this change?"));
        assert!(!bump_turn);
    }

    #[test]
    fn detects_modern_confirmation_without_header_via_option_pair() {
        let screen = "  ● Allow once\n    Allow for this session\n    No, suggest changes (esc)\n";
        let (status, _) = analyze_gemini_screen(screen, Some("working")).unwrap();
        assert_eq!(status.state, "blocked");
        assert_eq!(status.kind.as_deref(), Some("permission"));
    }

    #[test]
    fn ignores_historical_permission_in_scrollback_once_input_prompt_returns() {
        let screen = "\
Allow execution of: npm test
  Allow once
  Allow for this session
✓ All 76 tests passed!
> Type your message or @path/to/file
";
        let (status, bump_turn) = analyze_gemini_screen(screen, Some("working")).unwrap();
        assert_eq!(status.state, "done");
        assert!(bump_turn);
    }

    #[test]
    fn parses_ansi_colored_pty_spinner_and_cancel_hint() {
        let screen = "\x1b[36mAnalyzing src/App.tsx\x1b[0m\n\x1b[1;33m⠋ Thinking...\x1b[0m (esc to cancel, 6s)\n";
        let (status, bump_turn) = analyze_gemini_screen(screen, None).unwrap();
        assert_eq!(status.state, "working");
        assert!(!bump_turn);
    }

    #[test]
    fn detects_waiting_for_model_and_mcp_connecting_as_working() {
        let s1 = "Waiting for model...\n";
        assert_eq!(analyze_gemini_screen(s1, None).unwrap().0.state, "working");

        let s2 = "Connecting to MCP servers... (1/2)\n";
        assert_eq!(analyze_gemini_screen(s2, None).unwrap().0.state, "working");
    }

    #[test]
    fn detects_working_to_done_transition_when_prompt_returns() {
        let screen = "Done! Updated the files cleanly.\n\n> Type your message or @path/to/file\n";
        let (status, bump_turn) = analyze_gemini_screen(screen, Some("working")).unwrap();
        assert_eq!(status.state, "done");
        assert!(bump_turn);
    }

    #[test]
    fn returns_none_on_steady_idle_prompt_to_avoid_status_churn() {
        let screen = "Welcome to Gemini CLI\n> Type your message or @path/to/file\n";
        assert!(analyze_gemini_screen(screen, None).is_none());
        assert!(analyze_gemini_screen(screen, Some("idle")).is_none());
        assert!(analyze_gemini_screen(screen, Some("done")).is_none());
    }

    #[test]
    fn detects_api_quota_auth_and_deprecated_errors() {
        for line in [
            "Error: 429 Too Many Requests - Quota exceeded\n",
            "API Error: internal server failure\n",
            "Authentication failed: token expired\n",
            "This login method is no longer supported\n",
        ] {
            let (status, bump) = analyze_gemini_screen(line, Some("working")).unwrap();
            assert_eq!(status.state, "error");
            assert!(!bump);
        }
    }

    #[test]
    fn adversarial_radio_cursor_gt_or_chevron_on_allow_once_still_detects_blocked() {
        for cursor in [">", "❯", "●"] {
            let screen = format!(
                "Apply this change?\n{} Allow once\n  Allow for this session\n  No, suggest changes (esc)\n",
                cursor
            );
            let (status, bump) = analyze_gemini_screen(&screen, Some("working")).unwrap();
            assert_eq!(status.state, "blocked", "failed for cursor '{}'", cursor);
            assert_eq!(status.kind.as_deref(), Some("permission"));
            assert!(!bump);
        }
    }

    #[test]
    fn adversarial_code_diff_gt_lines_do_not_falsely_trigger_done_while_working() {
        let screen = "\
Checking diff:
> const port = 8080;
> export function start() {}
";
        assert!(analyze_gemini_screen(screen, Some("working")).is_none());
    }

    #[test]
    fn despair_prose_mentioning_api_error_before_prompt_triggers_done_not_error() {
        let screen = "\
I fixed the API error handling in src/client.ts and added retries.
Let me know if you want unit tests too.

> Type your message or @path/to/file
";
        let (status, bump_turn) = analyze_gemini_screen(screen, Some("working")).unwrap();
        assert_eq!(status.state, "done");
        assert!(bump_turn);
    }

    #[test]
    fn despair_survives_empty_null_bytes_broken_ansi_and_50k_line_flood_fast() {
        assert!(analyze_gemini_screen("", Some("working")).is_none());
        assert!(analyze_gemini_screen("\0\0\x1b[999;broken\0", Some("working")).is_none());

        let mut flood = String::with_capacity(50_000 * 30);
        for i in 0..50_000 {
            flood.push_str(&format!("log line {} normal output\n", i));
        }
        flood.push_str("⠋ Thinking... (esc to cancel, 9s)\n");

        let start = std::time::Instant::now();
        let (status, bump) = analyze_gemini_screen(&flood, None).unwrap();
        let elapsed = start.elapsed();
        assert_eq!(status.state, "working");
        assert!(!bump);
        assert!(
            elapsed.as_millis() < 250,
            "50k-line flood took too long: {}ms",
            elapsed.as_millis()
        );
    }
}
