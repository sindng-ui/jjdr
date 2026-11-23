#[cfg(not(test))]
pub mod commands;
pub mod git;
pub mod herdr;
pub mod store;

#[cfg(not(test))]
use std::sync::Arc;

#[cfg(not(test))]
use tauri::menu::{Menu, MenuItem};
#[cfg(not(test))]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
#[cfg(not(test))]
use tauri::{Manager, RunEvent};

#[cfg(not(test))]
use commands::terminals::AttachManager;
#[cfg(not(test))]
use herdr::client::HerdrClient;
#[cfg(not(test))]
use herdr::events::{spawn_herdr_supervisor, TerminalStateHub};
#[cfg(not(test))]
use store::projects::PersistenceStore;

#[cfg(not(test))]
pub struct AppState {
    pub herdr: Arc<HerdrClient>,
    pub hub: Arc<TerminalStateHub>,
    pub store: Arc<PersistenceStore>,
    pub attach: Arc<AttachManager>,
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
    let store = Arc::new(PersistenceStore::new());
    let attach = Arc::new(AttachManager::new());

    let state = AppState {
        herdr: herdr.clone(),
        hub: hub.clone(),
        store,
        attach: attach.clone(),
    };

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(state)
        .setup(move |app| {
            setup_tray(app)?;
            spawn_herdr_supervisor(app.handle().clone(), herdr.clone(), hub.clone());
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
            commands::projects::inspect_git_repo,
            commands::projects::list_projects,
            commands::projects::upsert_project,
            commands::projects::delete_project,
            commands::worktrees::list_all_worktrees,
            commands::worktrees::list_project_worktrees,
            commands::worktrees::create_worktree_and_launch,
            commands::worktrees::teardown_worktree,
            commands::worktrees::fetch_worktree_diff,
            commands::terminals::launch_session,
            commands::terminals::send_terminal_text,
            commands::terminals::send_terminal_keys,
            commands::terminals::interrupt_terminal,
            commands::terminals::kill_terminal,
            commands::terminals::attach_terminal,
            commands::terminals::detach_terminal,
            commands::terminals::write_terminal_input,
            commands::terminals::resize_terminal,
            commands::terminals::focus_terminal,
            commands::terminals::popout_external_terminal,
        ])
        .build(tauri::generate_context!())
        .expect("error while building jjdr tauri application");

    let herdr_exit = app.state::<AppState>().herdr.clone();
    let attach_exit = app.state::<AppState>().attach.clone();

    app.run(move |_app_handle, event| {
        if let RunEvent::Exit = event {
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
