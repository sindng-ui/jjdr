use std::sync::atomic::Ordering;
use std::time::Duration;

use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, State, WebviewUrl,
    WebviewWindowBuilder,
};

use crate::store::overlay::{
    compute_overlay_position, BgOverlayPayload, OverlayOpenCardEvent, OVERLAY_HEIGHT_LOGICAL,
    OVERLAY_MARGIN_LOGICAL, OVERLAY_WIDTH_LOGICAL, OVERLAY_WINDOW_LABEL,
};
use crate::AppState;

const OVERLAY_AUTO_HIDE_MS: u64 = 7_000;

fn is_main_in_foreground(app: &AppHandle) -> bool {
    let Some(main) = app.get_webview_window("main") else {
        return false;
    };
    let visible = main.is_visible().unwrap_or(false);
    let minimized = main.is_minimized().unwrap_or(false);
    let focused = main.is_focused().unwrap_or(false);
    visible && !minimized && focused
}

fn position_overlay_window(app: &AppHandle, overlay: &tauri::WebviewWindow, position: &str) {
    let monitor = app
        .get_webview_window("main")
        .and_then(|w| w.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());

    let _ = overlay.set_size(LogicalSize::new(
        OVERLAY_WIDTH_LOGICAL,
        OVERLAY_HEIGHT_LOGICAL,
    ));

    if let Some(mon) = monitor {
        let area = mon.work_area();
        let scale = mon.scale_factor();
        let win_w = (OVERLAY_WIDTH_LOGICAL * scale).round() as i32;
        let win_h = (OVERLAY_HEIGHT_LOGICAL * scale).round() as i32;
        let margin = (OVERLAY_MARGIN_LOGICAL * scale).round() as i32;

        let (x, y) = compute_overlay_position(
            area.position.x,
            area.position.y,
            area.size.width as i32,
            area.size.height as i32,
            win_w,
            win_h,
            margin,
            position,
        );
        let _ = overlay.set_position(PhysicalPosition::new(x, y));
    }
}

pub fn hide_overlay_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
        // Clear payload in overlay webview so CSS animations stop running while hidden
        let _ = app.emit_to(OVERLAY_WINDOW_LABEL, "jjdr:bg-overlay-clear", ());
        // Ensure a hidden transparent overlay can never swallow clicks on Windows DWM
        let _ = win.set_ignore_cursor_events(true);
        let _ = win.hide();
    }
}

pub fn destroy_overlay_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
        let _ = win.destroy();
    }
}

/// Async command is REQUIRED on Windows Tauri v2 when calling `WebviewWindowBuilder::build()`
/// to prevent WebView2 COM main-thread deadlock / input routing corruption.
#[tauri::command]
pub async fn show_bg_overlay(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: BgOverlayPayload,
    force_preview: Option<bool>,
) -> Result<bool, String> {
    let _op_guard = state.bg_overlay_op_lock.lock().await;
    let preview = force_preview.unwrap_or(false) || payload.is_preview;

    // Never show notifications while main app is active in foreground (unless explicit settings preview)
    if !preview && is_main_in_foreground(&app) {
        hide_overlay_window(&app);
        return Ok(false);
    }

    if let Ok(mut guard) = state.bg_overlay_payload.lock() {
        *guard = Some(payload.clone());
    }

    let overlay = match app.get_webview_window(OVERLAY_WINDOW_LABEL) {
        Some(win) => win,
        None => WebviewWindowBuilder::new(
            &app,
            OVERLAY_WINDOW_LABEL,
            WebviewUrl::App("index.html?overlay=1".into()),
        )
        .title("jjdr — Priority Alert")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .focused(false)
        .shadow(false)
        .visible(false)
        .inner_size(OVERLAY_WIDTH_LOGICAL, OVERLAY_HEIGHT_LOGICAL)
        .build()
        .map_err(|e| format!("Failed to create bg overlay window: {}", e))?,
    };

    // Re-check foreground state after async WebView2 creation so returning to main never flashes overlay
    if !preview && is_main_in_foreground(&app) {
        hide_overlay_window(&app);
        return Ok(false);
    }

    position_overlay_window(&app, &overlay, &payload.position);
    let _ = overlay.set_ignore_cursor_events(false);
    let _ = overlay.set_always_on_top(true);
    let _ = app.emit_to(OVERLAY_WINDOW_LABEL, "jjdr:bg-overlay-update", &payload);
    // Show without focusing so user typing in another app is NEVER interrupted
    let _ = overlay.show();

    // Guaranteed 7s Rust-side auto-hide timer (immune to background WebView JS timer throttling)
    let my_gen = state.bg_overlay_gen.fetch_add(1, Ordering::SeqCst) + 1;
    let gen_ref = state.bg_overlay_gen.clone();
    let app_clone = app.clone();
    let stamp = payload.stamp.clone();
    // Ensure preview flag is cleared once the 7s timer expires so future focus events hide normally
    let payload_ref = app.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(OVERLAY_AUTO_HIDE_MS)).await;
        if gen_ref.load(Ordering::SeqCst) == my_gen {
            hide_overlay_window(&app_clone);
            if preview {
                if let Ok(mut g) = payload_ref.state::<AppState>().bg_overlay_payload.lock() {
                    if g.as_ref().map(|p| p.is_preview).unwrap_or(false) {
                        *g = None;
                    }
                }
            } else {
                let _ = app_clone.emit_to("main", "jjdr:overlay-dismissed", stamp);
            }
        }
    });

    Ok(true)
}

#[tauri::command]
pub async fn hide_bg_overlay(
    app: AppHandle,
    state: State<'_, AppState>,
    destroy: Option<bool>,
) -> Result<(), String> {
    state.bg_overlay_gen.fetch_add(1, Ordering::SeqCst);
    if let Ok(mut g) = state.bg_overlay_payload.lock() {
        if destroy.unwrap_or(false) || g.as_ref().map(|p| p.is_preview).unwrap_or(false) {
            *g = None;
        }
    }
    if destroy.unwrap_or(false) {
        destroy_overlay_window(&app);
    } else {
        hide_overlay_window(&app);
    }
    Ok(())
}

#[tauri::command]
pub async fn dismiss_bg_overlay(
    app: AppHandle,
    state: State<'_, AppState>,
    stamp: String,
) -> Result<(), String> {
    state.bg_overlay_gen.fetch_add(1, Ordering::SeqCst);
    hide_overlay_window(&app);
    let _ = app.emit_to("main", "jjdr:overlay-dismissed", stamp);
    Ok(())
}

#[tauri::command]
pub async fn get_bg_overlay_payload(
    state: State<'_, AppState>,
) -> Result<Option<BgOverlayPayload>, String> {
    let guard = state
        .bg_overlay_payload
        .lock()
        .map_err(|_| "overlay payload lock poisoned".to_string())?;
    Ok(guard.clone())
}

#[tauri::command]
pub async fn focus_main_from_overlay(
    app: AppHandle,
    state: State<'_, AppState>,
    card_key: String,
    address: String,
) -> Result<(), String> {
    state.bg_overlay_gen.fetch_add(1, Ordering::SeqCst);
    hide_overlay_window(&app);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
    let _ = app.emit_to(
        "main",
        "jjdr:overlay-open-card",
        OverlayOpenCardEvent { card_key, address },
    );
    Ok(())
}
