use super::*;
use crate::gemini::bridge::map_hook_packet_to_status;
use crate::gemini::GeminiHookPacket;

fn make_terminal(addr: &str, agent: &str, cwd: &str, tag: Option<&str>) -> Terminal {
    let mut labels = HashMap::new();
    labels.insert("jjdr.agent".into(), agent.into());
    labels.insert("jjdr.worktree".into(), normalize_path(cwd));
    if let Some(t) = tag {
        labels.insert("jjdr.gemini_tag".into(), t.into());
    }
    Terminal {
        address: addr.into(),
        name: Some(format!("sess-{}", addr)),
        labels,
        argv: vec![agent.into()],
        cwd: cwd.into(),
        state: "live".into(),
        created_ms: 1_000,
        finished_ms: None,
        exit_code: None,
        signal: None,
        screen: String::new(),
        cols: 120,
        rows: 40,
        status: None,
        status_ms: None,
        turn: 0,
        title: String::new(),
        template: None,
        keep: true,
        pid: Some(42),
        parent: None,
        reason: None,
        foreground: None,
    }
}

#[test]
fn full_single_turn_hook_lifecycle_with_permission_and_user_approval() {
    let mut engine = GeminiStateEngine::new();
    let mut map = HashMap::new();
    map.insert(
        "t-gem-1".into(),
        make_terminal("t-gem-1", "gemini", "K:\\proj\\wt-a", Some("tag-1")),
    );

    // 1. BeforeAgent -> working
    let (st, bump) = map_hook_packet_to_status(&GeminiHookPacket {
        hook_event_name: "BeforeAgent".into(),
        ..Default::default()
    })
    .unwrap();
    let res = engine.apply_event(
        &mut map,
        "t-gem-1",
        "tag-1",
        "K:\\proj\\wt-a",
        st,
        bump,
        10_000,
        GeminiStatusSource::Hook,
        "BeforeAgent",
    );
    assert_eq!(res, Some(("t-gem-1".into(), false)));
    assert_eq!(map["t-gem-1"].status.as_ref().unwrap().state, "working");
    assert_eq!(map["t-gem-1"].turn, 0);

    // 2. Notification(ToolPermission) -> blocked(permission) + requests preview
    let (st, bump) = map_hook_packet_to_status(&GeminiHookPacket {
        hook_event_name: "Notification".into(),
        notification_type: "ToolPermission".into(),
        message: "Allow execution of: npm test?".into(),
        ..Default::default()
    })
    .unwrap();
    let res = engine.apply_event(
        &mut map,
        "t-gem-1",
        "tag-1",
        "K:\\proj\\wt-a",
        st,
        bump,
        12_000,
        GeminiStatusSource::Hook,
        "Notification",
    );
    assert_eq!(res, Some(("t-gem-1".into(), true)));
    let st_now = map["t-gem-1"].status.as_ref().unwrap();
    assert_eq!(st_now.state, "blocked");
    assert_eq!(st_now.kind.as_deref(), Some("permission"));

    // 3. User clicks Approve (Enter) -> IMMEDIATELY releases blocked back to working!
    assert!(engine.apply_user_approval(&mut map, "t-gem-1", 13_000));
    let st_after = map["t-gem-1"].status.as_ref().unwrap();
    assert_eq!(st_after.state, "working");
    assert_eq!(st_after.kind, None);
    assert_eq!(map["t-gem-1"].turn, 0);

    // Second Enter while already working is a harmless no-op
    assert!(!engine.apply_user_approval(&mut map, "t-gem-1", 13_500));

    // 4. AfterAgent -> done + turn increments to 1
    let (st, bump) = map_hook_packet_to_status(&GeminiHookPacket {
        hook_event_name: "AfterAgent".into(),
        prompt_response: "All 38 tests pass.".into(),
        ..Default::default()
    })
    .unwrap();
    let res = engine.apply_event(
        &mut map,
        "t-gem-1",
        "tag-1",
        "K:\\proj\\wt-a",
        st,
        bump,
        20_000,
        GeminiStatusSource::Hook,
        "AfterAgent",
    );
    assert_eq!(res, Some(("t-gem-1".into(), true)));
    assert_eq!(map["t-gem-1"].status.as_ref().unwrap().state, "done");
    assert_eq!(map["t-gem-1"].turn, 1);
}

#[test]
fn matches_dual_gemini_in_same_worktree_strictly_by_tag_and_id() {
    let mut engine = GeminiStateEngine::new();
    let mut map = HashMap::new();
    map.insert(
        "t-gem-1".into(),
        make_terminal("t-gem-1", "gemini", "K:\\repo\\feat", Some("tag-alpha")),
    );
    map.insert(
        "t-gem-2".into(),
        make_terminal("t-gem-2", "gemini", "K:\\repo\\feat", Some("tag-beta")),
    );

    let st = Status {
        state: "working".into(),
        app: Some("gemini".into()),
        kind: None,
        msg: Some("Beta working".into()),
        progress: None,
        title: None,
    };
    // No HC_TERMINAL_ID, only JJDR_GEMINI_ADDR tag -> must hit t-gem-2, NOT t-gem-1
    let matched = engine.apply_event(
        &mut map,
        "",
        "tag-beta",
        "K:/repo/feat/",
        st,
        false,
        5_000,
        GeminiStatusSource::Hook,
        "BeforeAgent",
    );
    assert_eq!(matched.map(|m| m.0), Some("t-gem-2".into()));
    assert!(map["t-gem-1"].status.is_none());
    assert_eq!(map["t-gem-2"].status.as_ref().unwrap().state, "working");
}

#[test]
fn matches_windows_cwd_case_and_slash_insensitively() {
    let mut map = HashMap::new();
    map.insert(
        "t-gem-1".into(),
        make_terminal("t-gem-1", "gemini", "K:\\Antigravity_Projects\\App", None),
    );
    let addr = GeminiStateEngine::resolve_target_address(
        &map,
        "",
        "",
        "k:/antigravity_projects/app/",
    );
    assert_eq!(addr.as_deref(), Some("t-gem-1"));
}

#[test]
fn multi_turn_increments_synthetic_turn_monotonically() {
    let mut engine = GeminiStateEngine::new();
    let mut map = HashMap::new();
    map.insert(
        "t-gem-1".into(),
        make_terminal("t-gem-1", "gemini", "K:\\proj\\wt", Some("tag-1")),
    );

    let done_status = || Status {
        state: "done".into(),
        app: Some("gemini".into()),
        kind: None,
        msg: Some("Done".into()),
        progress: None,
        title: None,
    };
    let work_status = || Status {
        state: "working".into(),
        app: Some("gemini".into()),
        kind: None,
        msg: Some("Thinking...".into()),
        progress: None,
        title: None,
    };

    engine.apply_event(&mut map, "t-gem-1", "", "", work_status(), false, 1000, GeminiStatusSource::Hook, "BeforeAgent");
    engine.apply_event(&mut map, "t-gem-1", "", "", done_status(), true, 2000, GeminiStatusSource::Hook, "AfterAgent");
    assert_eq!(map["t-gem-1"].turn, 1);

    engine.apply_event(&mut map, "t-gem-1", "", "", work_status(), false, 3000, GeminiStatusSource::Hook, "BeforeAgent");
    assert_eq!(map["t-gem-1"].turn, 1);
    assert_eq!(map["t-gem-1"].status.as_ref().unwrap().state, "working");

    engine.apply_event(&mut map, "t-gem-1", "", "", done_status(), true, 4000, GeminiStatusSource::Hook, "AfterAgent");
    assert_eq!(map["t-gem-1"].turn, 2);
    assert_eq!(map["t-gem-1"].status.as_ref().unwrap().state, "done");
}

#[test]
fn screen_fallback_respects_15s_hook_window_except_blocked_recovery() {
    let mut engine = GeminiStateEngine::new();
    let mut map = HashMap::new();
    map.insert(
        "t-gem-1".into(),
        make_terminal("t-gem-1", "gemini", "K:\\proj\\wt", None),
    );

    // Hook sets working at t=10_000
    engine.apply_event(
        &mut map,
        "t-gem-1",
        "",
        "",
        Status {
            state: "working".into(),
            app: Some("gemini".into()),
            kind: None,
            msg: Some("Thinking...".into()),
            progress: None,
            title: None,
        },
        false,
        10_000,
        GeminiStatusSource::Hook,
        "BeforeAgent",
    );

    // At t=12_000 (within 15s), stale prompt text on screen must NOT prematurely mark done!
    let ignored = engine.apply_screen_fallback(
        &mut map,
        "t-gem-1",
        "> Type your message or @path/to/file\n",
        12_000,
    );
    assert!(ignored.is_none());
    assert_eq!(map["t-gem-1"].status.as_ref().unwrap().state, "working");

    // Hook sets blocked(permission) at t=13_000
    engine.apply_event(
        &mut map,
        "t-gem-1",
        "",
        "",
        Status {
            state: "blocked".into(),
            app: Some("gemini".into()),
            kind: Some("permission".into()),
            msg: Some("Allow?".into()),
            progress: None,
            title: None,
        },
        false,
        13_000,
        GeminiStatusSource::Hook,
        "Notification",
    );
    assert_eq!(map["t-gem-1"].status.as_ref().unwrap().state, "blocked");

    // At t=15_000 (within 15s!), user approved in external terminal -> spinner is back on screen!
    // Screen fallback MUST bypass the 15s guard to release `blocked` -> `working`.
    let recovered = engine.apply_screen_fallback(
        &mut map,
        "t-gem-1",
        "Running tests...\n⠋ Thinking... (esc to cancel, 2s)\n",
        15_000,
    );
    assert!(recovered.is_some());
    assert_eq!(map["t-gem-1"].status.as_ref().unwrap().state, "working");
}

#[test]
fn screen_only_mode_complete_lifecycle_without_any_hooks() {
    let mut engine = GeminiStateEngine::new();
    let mut map = HashMap::new();
    map.insert(
        "t-gem-1".into(),
        make_terminal("t-gem-1", "gemini", "K:\\proj\\wt", None),
    );

    // Step 1: Spinner detected -> working
    let r1 = engine.apply_screen_fallback(
        &mut map,
        "t-gem-1",
        "⠋ Thinking... (esc to cancel, 3s)\n",
        10_000,
    );
    assert!(r1.is_some());
    assert_eq!(map["t-gem-1"].status.as_ref().unwrap().state, "working");

    // Step 2: Modern v0.3x confirmation dialog -> blocked(permission)
    let r2 = engine.apply_screen_fallback(
        &mut map,
        "t-gem-1",
        "Allow execution of: git status\n  Allow once\n  Allow for this session\n  No, suggest changes (esc)\n",
        14_000,
    );
    assert!(r2.is_some());
    assert_eq!(map["t-gem-1"].status.as_ref().unwrap().state, "blocked");
    assert_eq!(
        map["t-gem-1"].status.as_ref().unwrap().kind.as_deref(),
        Some("permission")
    );

    // Step 3: User clicks Approve -> immediately working
    assert!(engine.apply_user_approval(&mut map, "t-gem-1", 15_000));
    assert_eq!(map["t-gem-1"].status.as_ref().unwrap().state, "working");

    // Step 4: Returns to input prompt (even with old "Allow execution" above in scrollback!) -> done + turn=1
    let r4 = engine.apply_screen_fallback(
        &mut map,
        "t-gem-1",
        "Allow execution of: git status\n  Allow once\nChecked repo: clean working tree.\n\n> Type your message or @path/to/file\n",
        20_000,
    );
    assert!(r4.is_some());
    assert_eq!(map["t-gem-1"].status.as_ref().unwrap().state, "done");
    assert_eq!(map["t-gem-1"].turn, 1);
}

#[test]
fn yields_to_newer_native_herdr_core_status() {
    let mut engine = GeminiStateEngine::new();
    let mut map = HashMap::new();
    map.insert(
        "t-gem-1".into(),
        make_terminal("t-gem-1", "gemini", "K:\\proj\\wt", None),
    );

    engine.apply_event(
        &mut map,
        "t-gem-1",
        "",
        "",
        Status {
            state: "working".into(),
            app: Some("gemini".into()),
            kind: None,
            msg: Some("Bridge working".into()),
            progress: None,
            title: None,
        },
        false,
        10_000,
        GeminiStatusSource::Hook,
        "BeforeAgent",
    );

    // Simulate future herdr-core sending native newer status at t=15_000
    let mut fresh_from_herdr = make_terminal("t-gem-1", "gemini", "K:\\proj\\wt", None);
    fresh_from_herdr.status = Some(Status {
        state: "done".into(),
        app: Some("gemini".into()),
        kind: None,
        msg: Some("Native herdr-core done".into()),
        progress: None,
        title: None,
    });
    fresh_from_herdr.status_ms = Some(15_000);
    engine.overlay_terminal(&mut fresh_from_herdr);

    assert_eq!(fresh_from_herdr.status.as_ref().unwrap().state, "done");
    assert_eq!(
        fresh_from_herdr.status.as_ref().unwrap().msg.as_deref(),
        Some("Native herdr-core done")
    );
}

#[test]
fn never_interferes_with_claude_or_shell_or_finished_terminals() {
    let mut engine = GeminiStateEngine::new();
    let mut map = HashMap::new();
    map.insert(
        "t-claude".into(),
        make_terminal("t-claude", "claude", "K:\\proj\\wt", None),
    );
    map.insert(
        "t-shell".into(),
        make_terminal("t-shell", "pwsh", "K:\\proj\\wt", None),
    );
    let mut dead_gem = make_terminal("t-dead", "gemini", "K:\\proj\\wt", Some("tag-dead"));
    dead_gem.state = "finished".into();
    map.insert("t-dead".into(), dead_gem);

    let st = Status {
        state: "working".into(),
        app: Some("gemini".into()),
        kind: None,
        msg: Some("Thinking...".into()),
        progress: None,
        title: None,
    };

    // Even if someone sends t-claude's ID or shared CWD, engine refuses non-gemini & finished
    assert!(engine
        .apply_event(&mut map, "t-claude", "", "K:\\proj\\wt", st.clone(), false, 1000, GeminiStatusSource::Hook, "BeforeAgent")
        .is_none());
    assert!(engine
        .apply_event(&mut map, "", "", "K:\\proj\\wt", st.clone(), false, 1000, GeminiStatusSource::Hook, "BeforeAgent")
        .is_none());
    assert!(engine
        .apply_event(&mut map, "t-dead", "tag-dead", "K:\\proj\\wt", st, false, 1000, GeminiStatusSource::Hook, "BeforeAgent")
        .is_none());

    assert!(map["t-claude"].status.is_none());
    assert!(map["t-shell"].status.is_none());
    assert!(map["t-dead"].status.is_none());

    // Removal cleans up override table cleanly
    engine.remove_terminal("t-dead");
    assert!(!engine.has_recent_hook("t-dead", 1000, 15_000));
}

#[test]
fn adversarial_interrupt_and_esc_cancel_return_to_idle_without_false_ready() {
    let mut engine = GeminiStateEngine::new();
    let mut map = HashMap::new();
    map.insert(
        "t-gem-1".into(),
        make_terminal("t-gem-1", "gemini", "K:\\proj\\wt", None),
    );

    // Start working
    engine.apply_event(
        &mut map,
        "t-gem-1",
        "",
        "",
        Status {
            state: "working".into(),
            app: Some("gemini".into()),
            kind: None,
            msg: Some("Thinking...".into()),
            progress: None,
            title: None,
        },
        false,
        1_000,
        GeminiStatusSource::Hook,
        "BeforeAgent",
    );

    // Esc (only_if_blocked=true) while working should NOT falsely cancel if user hit Esc inside editor,
    // whereas Ctrl+C / Stop (only_if_blocked=false) immediately moves to idle with turn=0!
    assert!(!engine.apply_user_interrupt(&mut map, "t-gem-1", 1_500, true));
    assert_eq!(map["t-gem-1"].status.as_ref().unwrap().state, "working");

    assert!(engine.apply_user_interrupt(&mut map, "t-gem-1", 2_000, false));
    assert_eq!(map["t-gem-1"].status.as_ref().unwrap().state, "idle");
    assert_eq!(map["t-gem-1"].turn, 0);

    // Now test blocked(permission) -> Esc cancel -> idle (turn stays 0!)
    engine.apply_event(
        &mut map,
        "t-gem-1",
        "",
        "",
        Status {
            state: "blocked".into(),
            app: Some("gemini".into()),
            kind: Some("permission".into()),
            msg: Some("Allow?".into()),
            progress: None,
            title: None,
        },
        false,
        3_000,
        GeminiStatusSource::Hook,
        "Notification",
    );
    assert!(engine.apply_user_interrupt(&mut map, "t-gem-1", 3_500, true));
    assert_eq!(map["t-gem-1"].status.as_ref().unwrap().state, "idle");
    assert_eq!(map["t-gem-1"].turn, 0);
}

#[test]
fn adversarial_detects_unlabeled_external_node_gemini_cli_process() {
    use crate::herdr::types::Foreground;

    let mut ext = make_terminal("t-ext", "pwsh", "K:\\proj\\wt", None);
    ext.labels.clear();
    ext.argv = vec!["pwsh.exe".into()];
    ext.foreground = Some(Foreground {
        pid: 9999,
        name: "node.exe".into(),
        argv: vec![
            "node.exe".into(),
            "--no-warnings".into(),
            "C:\\Users\\dev\\AppData\\Roaming\\npm\\node_modules\\@google\\gemini-cli\\dist\\index.js".into(),
        ],
        cwd: "K:\\proj\\wt".into(),
    });

    assert!(is_gemini_terminal(&ext));
    let mut map = HashMap::new();
    map.insert("t-ext".into(), ext);
    let addr = GeminiStateEngine::resolve_target_address(&map, "", "", "k:/proj/wt");
    assert_eq!(addr.as_deref(), Some("t-ext"));
}

#[test]
fn despair_rejects_out_of_order_stale_packets_and_deduplicates_double_after_agent() {
    let mut engine = GeminiStateEngine::new();
    let mut map = HashMap::new();
    map.insert(
        "t-gem-1".into(),
        make_terminal("t-gem-1", "gemini", "K:\\proj\\wt", Some("tag-1")),
    );

    let done_st = || Status {
        state: "done".into(),
        app: Some("gemini".into()),
        kind: None,
        msg: Some("Finished".into()),
        progress: None,
        title: None,
    };
    let work_st = || Status {
        state: "working".into(),
        app: Some("gemini".into()),
        kind: None,
        msg: Some("Old working".into()),
        progress: None,
        title: None,
    };

    // Turn 1 completes at t=5000
    assert!(engine
        .apply_event(&mut map, "t-gem-1", "", "", done_st(), true, 5_000, GeminiStatusSource::Hook, "AfterAgent")
        .is_some());
    assert_eq!(map["t-gem-1"].turn, 1);
    assert_eq!(map["t-gem-1"].status.as_ref().unwrap().state, "done");

    // Stale BeforeAgent (t=3000 < 5000) arrives out-of-order -> MUST be rejected!
    assert!(engine
        .apply_event(&mut map, "t-gem-1", "", "", work_st(), false, 3_000, GeminiStatusSource::Hook, "BeforeAgent")
        .is_none());
    assert_eq!(map["t-gem-1"].status.as_ref().unwrap().state, "done");
    assert_eq!(map["t-gem-1"].turn, 1);

    // Duplicate AfterAgent at t=5200 (no working in between) -> MUST NOT double-bump turn!
    assert!(engine
        .apply_event(&mut map, "t-gem-1", "", "", done_st(), true, 5_200, GeminiStatusSource::Hook, "AfterAgent")
        .is_some());
    assert_eq!(map["t-gem-1"].turn, 1);
}

#[test]
fn despair_ambiguous_cwd_skips_dead_and_non_gemini_and_picks_latest_live() {
    let mut map = HashMap::new();
    let mut dead = make_terminal("t-dead", "gemini", "K:\\proj\\wt", None);
    dead.state = "finished".into();
    dead.created_ms = 9_999;
    map.insert("t-dead".into(), dead);

    let mut claude = make_terminal("t-claude", "claude", "K:\\proj\\wt", None);
    claude.created_ms = 9_998;
    map.insert("t-claude".into(), claude);

    let mut old_gem = make_terminal("t-gem-old", "gemini", "K:\\proj\\wt", None);
    old_gem.created_ms = 1_000;
    map.insert("t-gem-old".into(), old_gem);

    let mut new_gem = make_terminal("t-gem-new", "gemini", "K:\\proj\\wt", None);
    new_gem.created_ms = 5_000;
    map.insert("t-gem-new".into(), new_gem);

    // Both HC_TERMINAL_ID and JJDR_GEMINI_ADDR stripped -> must deterministically pick latest live Gemini
    let addr = GeminiStateEngine::resolve_target_address(&map, "", "", "k:/proj/wt");
    assert_eq!(addr.as_deref(), Some("t-gem-new"));
}

#[test]
fn despair_overlay_never_revives_crashed_or_finished_terminal() {
    let mut engine = GeminiStateEngine::new();
    let mut map = HashMap::new();
    map.insert(
        "t-gem-1".into(),
        make_terminal("t-gem-1", "gemini", "K:\\proj\\wt", None),
    );
    engine.apply_event(
        &mut map,
        "t-gem-1",
        "",
        "",
        Status {
            state: "working".into(),
            app: Some("gemini".into()),
            kind: None,
            msg: Some("Running".into()),
            progress: None,
            title: None,
        },
        false,
        10_000,
        GeminiStatusSource::Hook,
        "BeforeAgent",
    );

    // Terminal crashes (exit_code=137)
    let mut crashed = make_terminal("t-gem-1", "gemini", "K:\\proj\\wt", None);
    crashed.state = "finished".into();
    crashed.exit_code = Some(137);
    engine.overlay_terminal(&mut crashed);
    assert_eq!(crashed.state, "finished");
    assert!(crashed.status.is_none());
}
