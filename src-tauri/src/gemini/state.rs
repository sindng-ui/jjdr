use std::collections::HashMap;

use crate::gemini::bridge::build_override;
use crate::gemini::screen::analyze_gemini_screen;
use crate::gemini::{is_gemini_terminal, GeminiStatusOverride, GeminiStatusSource};
use crate::git::worktree::normalize_path;
use crate::herdr::types::{Status, Terminal};

pub const HOOK_AUTHORITY_WINDOW_MS: u64 = 15_000;

/// Pure, testable state engine for Gemini CLI status overrides, terminal matching,
/// user-approval recovery, and Layer-2 screen fallback arbitration.
#[derive(Debug, Default)]
pub struct GeminiStateEngine {
    overrides: HashMap<String, GeminiStatusOverride>,
}

impl GeminiStateEngine {
    pub fn new() -> Self {
        Self {
            overrides: HashMap::new(),
        }
    }

    pub fn remove_terminal(&mut self, addr: &str) {
        self.overrides.remove(addr);
    }

    pub fn has_recent_hook(&self, addr: &str, now_ms: u64, window_ms: u64) -> bool {
        self.overrides
            .get(addr)
            .map(|o| {
                o.source == GeminiStatusSource::Hook && now_ms.saturating_sub(o.status_ms) < window_ms
            })
            .unwrap_or(false)
    }

    /// Overlay synthesized Gemini status onto a `Terminal`, yielding whenever `herdr-core`
    /// itself provides a newer native status timestamp.
    pub fn overlay_terminal(&self, term: &mut Terminal) {
        let Some(ov) = self.overrides.get(&term.address) else {
            return;
        };
        if term.state != "live" {
            return;
        }
        if let Some(native_ms) = term.status_ms {
            if native_ms > ov.status_ms && term.status.is_some() {
                return;
            }
        }
        term.status = Some(ov.status.clone());
        term.status_ms = Some(ov.status_ms);
        if ov.synthetic_turn > term.turn {
            term.turn = ov.synthetic_turn;
        }
    }

    /// Resolve which live terminal owns an incoming Gemini event using strict priority:
    /// 1) `HC_TERMINAL_ID` (exact address or session name)
    /// 2) `JJDR_GEMINI_ADDR` (`jjdr.gemini_tag` injected by jjdr on launch)
    /// 3) Normalized CWD / worktree path (restricted to live Gemini terminals)
    pub fn resolve_target_address(
        terminals: &HashMap<String, Terminal>,
        terminal_id: &str,
        jjdr_addr: &str,
        cwd: &str,
    ) -> Option<String> {
        let tid = terminal_id.trim();
        if !tid.is_empty() {
            if let Some(t) = terminals.get(tid) {
                if t.state == "live" {
                    return Some(t.address.clone());
                }
            }
            if let Some(t) = terminals
                .values()
                .find(|t| t.state == "live" && (t.address == tid || t.name.as_deref() == Some(tid)))
            {
                return Some(t.address.clone());
            }
        }

        let tag = jjdr_addr.trim();
        if !tag.is_empty() {
            if let Some(t) = terminals.values().find(|t| {
                t.state == "live"
                    && (t.address == tag
                        || t.labels.get("jjdr.gemini_tag").map(|v| v.as_str()) == Some(tag))
            }) {
                return Some(t.address.clone());
            }
        }

        let norm_cwd = normalize_path(cwd);
        if !norm_cwd.is_empty() {
            let mut candidates: Vec<&Terminal> = terminals
                .values()
                .filter(|t| {
                    t.state == "live"
                        && is_gemini_terminal(t)
                        && (normalize_path(&t.cwd) == norm_cwd
                            || t.labels
                                .get("jjdr.worktree")
                                .map(|w| normalize_path(w) == norm_cwd)
                                .unwrap_or(false))
                })
                .collect();
            // Deterministic tie-break: most recently created session first
            candidates.sort_by(|a, b| b.created_ms.cmp(&a.created_ms));
            if let Some(best) = candidates.first() {
                return Some(best.address.clone());
            }
        }

        None
    }

    /// Apply a Gemini lifecycle event onto the matching terminal.
    /// Returns `Some((matched_address, should_request_preview))`.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_event(
        &mut self,
        terminals: &mut HashMap<String, Terminal>,
        terminal_id: &str,
        jjdr_addr: &str,
        cwd: &str,
        status: Status,
        bump_turn: bool,
        ts: u64,
        source: GeminiStatusSource,
        event_name: &str,
    ) -> Option<(String, bool)> {
        let addr = Self::resolve_target_address(terminals, terminal_id, jjdr_addr, cwd)?;
        let term = terminals.get_mut(&addr)?;
        if term.state != "live" || !is_gemini_terminal(term) {
            return None;
        }

        let prev_ov = self.overrides.get(&addr);
        // Despair guard #1: Reject out-of-order stale events older than the latest recorded state
        if let Some(prev) = prev_ov {
            if ts < prev.status_ms {
                return None;
            }
        }

        let prev_turn = prev_ov
            .map(|o| o.synthetic_turn)
            .unwrap_or(0)
            .max(term.turn);
        // Despair guard #2: Deduplicate repeated `done` events within the same turn (no `working` in between)
        // so duplicate `AfterAgent` hooks never double-bump `turn` and resurrect an already-cleared card!
        let is_duplicate_done = bump_turn
            && status.state == "done"
            && prev_ov.map(|o| o.status.state.as_str()) == Some("done");
        let next_turn = if bump_turn && !is_duplicate_done {
            prev_turn + 1
        } else {
            prev_turn
        };
        let should_preview = matches!(status.state.as_str(), "blocked" | "done" | "error");

        let ov = build_override(status, ts, next_turn, source, event_name);
        self.overrides.insert(addr.clone(), ov);
        self.overlay_terminal(term);
        Some((addr, should_preview))
    }

    /// Immediately release a Gemini `blocked` (permission/question) state back into `working`
    /// when the user clicks Approve or presses Enter in the attached terminal.
    /// Critical because we intentionally omit per-tool hooks (`BeforeTool`/`AfterTool`) for
    /// corporate AV/EDR performance.
    pub fn apply_user_approval(
        &mut self,
        terminals: &mut HashMap<String, Terminal>,
        addr: &str,
        ts: u64,
    ) -> bool {
        let Some(term) = terminals.get_mut(addr) else {
            return false;
        };
        if term.state != "live" || !is_gemini_terminal(term) {
            return false;
        }
        let is_blocked = term
            .status
            .as_ref()
            .map(|s| s.state == "blocked")
            .unwrap_or(false);
        if !is_blocked {
            return false;
        }

        let prev_ov = self.overrides.get(addr);
        let prev_turn = prev_ov.map(|o| o.synthetic_turn).unwrap_or(0).max(term.turn);
        let source = prev_ov.map(|o| o.source).unwrap_or(GeminiStatusSource::Screen);

        let status = Status {
            state: "working".to_string(),
            app: Some("gemini".to_string()),
            kind: None,
            msg: Some("Resuming after approval...".to_string()),
            progress: None,
            title: None,
        };
        let ov = build_override(status, ts, prev_turn, source, "user_approved");
        self.overrides.insert(addr.to_string(), ov);
        self.overlay_terminal(term);
        true
    }

    /// Immediately transition a Gemini `working` or `blocked` session back to `idle`
    /// when the user explicitly interrupts (`Ctrl+C` / Stop button) or cancels a prompt (`Esc`).
    /// Does NOT increment `turn` so cancelled runs never falsely appear as "Ready" cards.
    pub fn apply_user_interrupt(
        &mut self,
        terminals: &mut HashMap<String, Terminal>,
        addr: &str,
        ts: u64,
        only_if_blocked: bool,
    ) -> bool {
        let Some(term) = terminals.get_mut(addr) else {
            return false;
        };
        if term.state != "live" || !is_gemini_terminal(term) {
            return false;
        }
        let cur = term.status.as_ref().map(|s| s.state.as_str());
        let eligible = if only_if_blocked {
            cur == Some("blocked")
        } else {
            matches!(cur, Some("working" | "blocked"))
        };
        if !eligible {
            return false;
        }

        let prev_ov = self.overrides.get(addr);
        let prev_turn = prev_ov.map(|o| o.synthetic_turn).unwrap_or(0).max(term.turn);
        let source = prev_ov.map(|o| o.source).unwrap_or(GeminiStatusSource::Screen);

        let status = Status {
            state: "idle".to_string(),
            app: Some("gemini".to_string()),
            kind: None,
            msg: Some(if only_if_blocked {
                "Cancelled".to_string()
            } else {
                "Interrupted".to_string()
            }),
            progress: None,
            title: None,
        };
        let ov = build_override(status, ts, prev_turn, source, "user_interrupted");
        self.overrides.insert(addr.to_string(), ov);
        self.overlay_terminal(term);
        true
    }

    /// Passive Layer-2 screen parser fallback invoked when `terminal.read` completes.
    /// Respects recent Layer-1 hooks EXCEPT when recovering out of `blocked` into `working`
    /// (e.g., user approved directly in an external terminal window).
    pub fn apply_screen_fallback(
        &mut self,
        terminals: &mut HashMap<String, Terminal>,
        addr: &str,
        raw_text: &str,
        ts: u64,
    ) -> Option<(String, bool)> {
        let prev_state = match terminals.get(addr) {
            Some(t) if t.state == "live" && is_gemini_terminal(t) => {
                t.status.as_ref().map(|s| s.state.clone())
            }
            _ => return None,
        };

        let (status, bump_turn) = analyze_gemini_screen(raw_text, prev_state.as_deref())?;

        // Respect Hook authority for 15s, EXCEPT allow immediate recovery from `blocked` -> `working`
        let recovering_from_blocked =
            prev_state.as_deref() == Some("blocked") && status.state == "working";
        if !recovering_from_blocked && self.has_recent_hook(addr, ts, HOOK_AUTHORITY_WINDOW_MS) {
            return None;
        }

        let same_state = prev_state.as_deref() == Some(status.state.as_str()) && !bump_turn;
        if same_state {
            return None;
        }

        self.apply_event(
            terminals,
            addr,
            "",
            "",
            status,
            bump_turn,
            ts,
            GeminiStatusSource::Screen,
            "screen_fallback",
        )
    }
}

#[cfg(test)]
#[path = "state_tests.rs"]
mod tests;
