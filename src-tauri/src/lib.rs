#[cfg(not(test))]
pub mod commands;
pub mod gemini;
pub mod git;
pub mod herdr;
pub mod store;
pub mod team;
pub mod update;

#[cfg(not(test))]
use std::sync::atomic::AtomicU64;
#[cfg(not(test))]
use std::sync::{Arc, Mutex};

#[cfg(not(test))]
use tauri::menu::{Menu, MenuItem};
#[cfg(not(test))]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
#[cfg(not(test))]
use tauri::{Emitter, Manager, RunEvent, WindowEvent};

#[cfg(not(test))]
use commands::terminals::AttachManager;
#[cfg(not(test))]
use gemini::bridge::GeminiBridgeRuntime;
#[cfg(not(test))]
use herdr::client::HerdrClient;
#[cfg(not(test))]
use herdr::events::{spawn_herdr_supervisor, TerminalStateHub};
#[cfg(not(test))]
use store::file_index::FileIndexStore;
#[cfg(not(test))]
use store::overlay::BgOverlayPayload;
#[cfg(not(test))]
use store::projects::PersistenceStore;
#[cfg(not(test))]
use team::client::TeamRelayRuntime;
#[cfg(not(test))]
use team::orchestrator::AutoReviewOrchestrator;

#[cfg(not(test))]
pub struct AppState {
    pub herdr: Arc<HerdrClient>,
    pub hub: Arc<TerminalStateHub>,
    pub gemini_bridge: Arc<GeminiBridgeRuntime>,
    pub team_relay: Arc<TeamRelayRuntime>,
    pub auto_review: Arc<AutoReviewOrchestrator>,
    pub store: Arc<PersistenceStore>,
    pub attach: Arc<AttachManager>,
    pub file_index: Arc<FileIndexStore>,
    pub bg_overlay_payload: Mutex<Option<BgOverlayPayload>>,
    pub bg_overlay_op_lock: tokio::sync::Mutex<()>,
    pub bg_overlay_gen: Arc<AtomicU64>,
}

#[cfg(not(test))]
pub fn run() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "jjdr_lib=info".into()),
        )
        .try_init();

    let herdr = Arc::new(HerdrClient::new());
    let hub = TerminalStateHub::new();
    let gemini_bridge = GeminiBridgeRuntime::new();
    let store = Arc::new(PersistenceStore::new());
    let team_relay = TeamRelayRuntime::new(store.local_dir());
    let auto_review = AutoReviewOrchestrator::new(
        store.local_dir(),
        store.clone(),
        herdr.clone(),
        hub.clone(),
        team_relay.clone(),
    );
    team_relay.attach_orchestrator_tx(auto_review.event_sender());
    let attach = Arc::new(AttachManager::new());
    let file_index = Arc::new(FileIndexStore::new());

    let state = AppState {
        herdr: herdr.clone(),
        hub: hub.clone(),
        gemini_bridge: gemini_bridge.clone(),
        team_relay: team_relay.clone(),
        auto_review: auto_review.clone(),
        store: store.clone(),
        attach: attach.clone(),
        file_index,
        bg_overlay_payload: Mutex::new(None),
        bg_overlay_op_lock: tokio::sync::Mutex::new(()),
        bg_overlay_gen: Arc::new(AtomicU64::new(0)),
    };

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(state)
        .setup(move |app| {
            setup_tray(app)?;
            if let Some(main_win) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                let overlay_gen = app.state::<AppState>().bg_overlay_gen.clone();
                main_win.on_window_event(move |event| match event {
                    WindowEvent::Focused(focused) => {
                        if *focused {
                            // Keep explicit settings preview visible for its full 7s timer even when main regains focus
                            let is_preview = handle
                                .state::<AppState>()
                                .bg_overlay_payload
                                .lock()
                                .ok()
                                .and_then(|g| g.as_ref().map(|p| p.is_preview))
                                .unwrap_or(false);
                            if !is_preview {
                                overlay_gen.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                                commands::overlay::hide_overlay_window(&handle);
                            }
                        }
                        let _ = handle.emit_to("main", "jjdr:main-bg-changed", !*focused);
                    }
                    WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => {
                        commands::overlay::destroy_overlay_window(&handle);
                    }
                    _ => {}
                });
            }
            spawn_herdr_supervisor(app.handle().clone(), herdr.clone(), hub.clone());
            gemini_bridge.start(hub.clone());
            team_relay.spawn_supervisor(app.handle().clone(), store.clone());
            auto_review.start_workers(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::system::get_initial_state,
            commands::system::get_herdr_health,
            commands::system::reconnect_herdr,
            commands::system::list_templates,
            commands::system::load_persisted_bundle,
            commands::system::save_ui_state,
            commands::system::save_settings,
            commands::system::update_tray_summary,
            commands::system::request_preview_refresh,
            commands::system::window_minimize,
            commands::system::window_toggle_maximize,
            commands::system::window_close,
            commands::system::window_start_dragging,
            commands::system::open_in_explorer,
            commands::files::warm_project_file_index,
            commands::files::search_project_files,
            commands::files::read_text_file,
            commands::files::open_with_default_app,
            commands::files::open_in_vscode,
            commands::projects::inspect_git_repo,
            commands::projects::list_projects,
            commands::projects::upsert_project,
            commands::projects::delete_project,
            commands::projects::reorder_projects,
            commands::worktrees::list_all_worktrees,
            commands::worktrees::list_project_worktrees,
            commands::worktrees::create_worktree_and_launch,
            commands::worktrees::teardown_worktree,
            commands::worktrees::rename_worktree_branch,
            commands::worktrees::fetch_worktree_diff,
            commands::terminals::launch_session,
            commands::terminals::send_terminal_text,
            commands::terminals::send_terminal_keys,
            commands::terminals::interrupt_terminal,
            commands::terminals::kill_terminal,
            commands::attach::attach_terminal,
            commands::attach::detach_terminal,
            commands::attach::write_terminal_input,
            commands::attach::resize_terminal,
            commands::attach::focus_terminal,
            commands::terminals::popout_external_terminal,
            commands::overlay::show_bg_overlay,
            commands::overlay::hide_bg_overlay,
            commands::overlay::dismiss_bg_overlay,
            commands::overlay::get_bg_overlay_payload,
            commands::overlay::focus_main_from_overlay,
            commands::overlay::is_main_visible_on_screen,
            commands::update::get_app_version,
            commands::update::check_for_update,
            commands::update::download_and_install_update,
            commands::update::open_external_url,
            commands::gemini_bridge::get_gemini_bridge_status,
            commands::gemini_bridge::install_gemini_bridge_hooks,
            commands::gemini_bridge::uninstall_gemini_bridge_hooks,
            commands::gemini_bridge::test_gemini_bridge_event,
            commands::team::get_team_status,
            commands::team::test_team_relay_connection,
            commands::team::detect_team_github_id,
            commands::team::reconnect_team_relay,
            commands::team::list_team_peers,
            commands::team::flush_team_outbox,
            commands::team::list_auto_review_jobs,
            commands::team::ack_auto_review_job,
            commands::team::cancel_auto_review_job,
        ])
        .build(tauri::generate_context!())
        .expect("error while building jjdr tauri application");

    let herdr_exit = app.state::<AppState>().herdr.clone();
    let attach_exit = app.state::<AppState>().attach.clone();

    app.run(move |app_handle, event| {
        if let RunEvent::Exit = event {
            commands::overlay::destroy_overlay_window(app_handle);
            // Gracefully close only our hc connect bridge; herdr-core & all AI sessions remain alive!
            tauri::async_runtime::block_on(async {
                attach_exit.detach_all(&herdr_exit).await;
                herdr_exit.disconnect().await;
            });
        }
    });
}

#[cfg(not(test))]
fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show", "Open jjdr Mission Control", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(
        app,
        "quit",
        "Quit jjdr (Keep AI Sessions Alive)",
        true,
        None::<&str>,
    )?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    let mut builder = TrayIconBuilder::with_id("jjdr-tray")
        .menu(&menu)
        .tooltip("jjdr — Mission Control")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.unminimize();
                    let _ = win.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(win) = tray.app_handle().get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.unminimize();
                    let _ = win.set_focus();
                }
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
