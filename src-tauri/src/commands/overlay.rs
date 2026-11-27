use std::sync::atomic::Ordering;
use std::time::Duration;

use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, State, WebviewUrl,
    WebviewWindowBuilder,
};

use crate::store::overlay::{
    compute_overlay_position, is_window_obscured_by_occluders, BgOverlayPayload,
    OverlayOpenCardEvent, ScreenRect, OVERLAY_HEIGHT_LOGICAL, OVERLAY_MARGIN_LOGICAL,
    OVERLAY_WIDTH_LOGICAL, OVERLAY_WINDOW_LABEL,
};
use crate::AppState;

const OVERLAY_AUTO_HIDE_MS: u64 = 7_000;

#[cfg(windows)]
mod win_vis {
    use std::ffi::c_void;

    use crate::store::overlay::{is_window_obscured_by_occluders, ScreenRect};

    type Hwnd = *mut c_void;
    type Bool = i32;

    #[repr(C)]
    #[derive(Default)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    const GW_HWNDPREV: u32 = 3;
    const GWL_EXSTYLE: i32 = -20;
    const WS_EX_TRANSPARENT: i32 = 0x0000_0020;
    const WS_EX_TOOLWINDOW: i32 = 0x0000_0080;
    const DWMWA_CLOAKED: u32 = 14;

    #[link(name = "user32")]
    extern "system" {
        fn IsWindowVisible(hwnd: Hwnd) -> Bool;
        fn IsIconic(hwnd: Hwnd) -> Bool;
        fn GetForegroundWindow() -> Hwnd;
        fn GetWindowRect(hwnd: Hwnd, rect: *mut Rect) -> Bool;
        fn GetWindow(hwnd: Hwnd, cmd: u32) -> Hwnd;
        fn GetWindowLongW(hwnd: Hwnd, index: i32) -> i32;
    }

    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmGetWindowAttribute(
            hwnd: Hwnd,
            attr: u32,
            pv_attr: *mut c_void,
            cb_attr: u32,
        ) -> i32;
    }

    unsafe fn is_cloaked(hwnd: Hwnd) -> bool {
        let mut cloaked: u32 = 0;
        let hr = DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            (&mut cloaked as *mut u32).cast::<c_void>(),
            std::mem::size_of::<u32>() as u32,
        );
        hr == 0 && cloaked != 0
    }

    /// Returns `true` when `main_hwnd` is visible on screen to the user:
    /// not hidden, not minimized, not cloaked, and either focused or not covered by other windows
    /// stacked above it (e.g. visible on a secondary monitor or split-screen layout).
    pub fn is_hwnd_visible_to_user(main_hwnd: Hwnd, overlay_hwnd: Option<Hwnd>) -> bool {
        if main_hwnd.is_null() {
            return false;
        }
        unsafe {
            if IsWindowVisible(main_hwnd) == 0 || IsIconic(main_hwnd) != 0 || is_cloaked(main_hwnd)
            {
                return false;
            }
            if GetForegroundWindow() == main_hwnd {
                return true;
            }

            let mut target = Rect::default();
            if GetWindowRect(main_hwnd, &mut target) == 0 {
                return false;
            }
            let target_rect = ScreenRect {
                left: target.left,
                top: target.top,
                right: target.right,
                bottom: target.bottom,
            };

            let mut occluders: Vec<ScreenRect> = Vec::new();
            let mut cur = GetWindow(main_hwnd, GW_HWNDPREV);
            let mut steps = 0usize;
            while !cur.is_null() && steps < 128 {
                steps += 1;
                if Some(cur) != overlay_hwnd
                    && IsWindowVisible(cur) != 0
                    && IsIconic(cur) == 0
                    && !is_cloaked(cur)
                {
                    let ex = GetWindowLongW(cur, GWL_EXSTYLE);
                    let is_passthrough_overlay =
                        (ex & WS_EX_TRANSPARENT) != 0 || (ex & WS_EX_TOOLWINDOW) != 0;
                    if !is_passthrough_overlay {
                        let mut r = Rect::default();
                        if GetWindowRect(cur, &mut r) != 0 {
                            let sr = ScreenRect {
                                left: r.left,
                                top: r.top,
                                right: r.right,
                                bottom: r.bottom,
                            };
                            if sr.width() >= 40 && sr.height() >= 40 {
                                occluders.push(sr);
                            }
                        }
                    }
                }
                cur = GetWindow(cur, GW_HWNDPREV);
            }

            !is_window_obscured_by_occluders(target_rect, &occluders)
        }
    }
}

/// True when the main jjdr window is currently visible to the user (focused OR unobscured on screen,
/// such as on a secondary monitor or split-screen). Notifications are suppressed while `true`.
pub fn is_main_visible_to_user(app: &AppHandle) -> bool {
    let Some(main) = app.get_webview_window("main") else {
        return false;
    };
    let visible = main.is_visible().unwrap_or(false);
    let minimized = main.is_minimized().unwrap_or(false);
    if !visible || minimized {
        return false;
    }
    if main.is_focused().unwrap_or(false) {
        return true;
    }

    #[cfg(windows)]
    {
        if let Ok(hwnd) = main.hwnd() {
            let overlay_hwnd = app
                .get_webview_window(OVERLAY_WINDOW_LABEL)
                .and_then(|w| w.hwnd().ok())
                .map(|h| h.0);
            return win_vis::is_hwnd_visible_to_user(hwnd.0, overlay_hwnd);
        }
    }

    let _ = is_window_obscured_by_occluders;
    let _ = ScreenRect { left: 0, top: 0, right: 0, bottom: 0 };
    false
}

#[tauri::command]
pub fn is_main_visible_on_screen(app: AppHandle) -> bool {
    is_main_visible_to_user(&app)
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

    // Never show notifications while main app is visible on screen (unless explicit settings preview)
    if !preview && is_main_visible_to_user(&app) {
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

    // Re-check visibility after async WebView2 creation so returning to main never flashes overlay
    if !preview && is_main_visible_to_user(&app) {
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
