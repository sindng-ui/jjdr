use serde::{Deserialize, Serialize};

pub const OVERLAY_WINDOW_LABEL: &str = "bg-overlay";
pub const OVERLAY_WIDTH_LOGICAL: f64 = 488.0;
pub const OVERLAY_HEIGHT_LOGICAL: f64 = 138.0;
pub const OVERLAY_MARGIN_LOGICAL: f64 = 20.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BgOverlayPayload {
    pub card_key: String,
    pub address: String,
    pub bucket: String,
    pub badge: String,
    pub project_name: String,
    pub project_color: String,
    pub branch: String,
    pub agent_label: String,
    pub message: String,
    pub pending_count: usize,
    pub is_approval: bool,
    pub position: String,
    pub theme: String,
    pub stamp: String,
    #[serde(default)]
    pub is_preview: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverlayOpenCardEvent {
    pub card_key: String,
    pub address: String,
}

pub fn normalize_overlay_position(position: &str) -> &'static str {
    match position {
        "bottom_center" => "bottom_center",
        "bottom_right" => "bottom_right",
        _ => "top_center",
    }
}

/// Computes physical screen coordinates `(x, y)` inside a monitor's work area
/// (excluding OS taskbar) for the requested HUD position.
pub fn compute_overlay_position(
    work_x: i32,
    work_y: i32,
    work_w: i32,
    work_h: i32,
    win_w: i32,
    win_h: i32,
    margin: i32,
    position: &str,
) -> (i32, i32) {
    let max_x = work_x + (work_w - win_w).max(0);
    let max_y = work_y + (work_h - win_h).max(0);

    let (raw_x, raw_y) = match normalize_overlay_position(position) {
        "bottom_center" => (
            work_x + (work_w - win_w) / 2,
            work_y + work_h - win_h - margin,
        ),
        "bottom_right" => (
            work_x + work_w - win_w - margin,
            work_y + work_h - win_h - margin,
        ),
        _ => (work_x + (work_w - win_w) / 2, work_y + margin),
    };

    (raw_x.clamp(work_x, max_x), raw_y.clamp(work_y, max_y))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScreenRect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl ScreenRect {
    pub fn width(self) -> i32 {
        (self.right - self.left).max(0)
    }

    pub fn height(self) -> i32 {
        (self.bottom - self.top).max(0)
    }

    pub fn contains_point(self, x: i32, y: i32) -> bool {
        x >= self.left && x < self.right && y >= self.top && y < self.bottom
    }
}

/// Returns `true` when `target` is substantially covered (>= 7 of 9 interior sample points)
/// by windows stacked above it in Z-order.
/// - Dual monitor / side-by-side split / small popup overlapping -> `false` (still visible on screen)
/// - Fullscreen/maximized app covering `target` on the same monitor -> `true` (obscured)
pub fn is_window_obscured_by_occluders(target: ScreenRect, occluders: &[ScreenRect]) -> bool {
    let w = target.width();
    let h = target.height();
    if w <= 0 || h <= 0 {
        return true;
    }

    let xs = [
        target.left + (w * 20) / 100,
        target.left + w / 2,
        target.left + (w * 80) / 100,
    ];
    let ys = [
        target.top + (h * 20) / 100,
        target.top + h / 2,
        target.top + (h * 80) / 100,
    ];

    let mut covered = 0usize;
    for &x in &xs {
        for &y in &ys {
            if occluders.iter().any(|r| r.contains_point(x, y)) {
                covered += 1;
            }
        }
    }

    covered >= 7
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_unknown_position_to_top_center() {
        assert_eq!(normalize_overlay_position("top_center"), "top_center");
        assert_eq!(normalize_overlay_position("bottom_center"), "bottom_center");
        assert_eq!(normalize_overlay_position("bottom_right"), "bottom_right");
        assert_eq!(normalize_overlay_position("invalid"), "top_center");
        assert_eq!(normalize_overlay_position(""), "top_center");
    }

    #[test]
    fn computes_top_center_position_in_work_area() {
        let (x, y) = compute_overlay_position(0, 0, 1920, 1040, 488, 138, 20, "top_center");
        assert_eq!(x, (1920 - 488) / 2);
        assert_eq!(y, 20);
    }

    #[test]
    fn computes_bottom_center_and_bottom_right_on_secondary_monitor() {
        let (bx, by) =
            compute_overlay_position(1920, 40, 2560, 1400, 488, 138, 20, "bottom_center");
        assert_eq!(bx, 1920 + (2560 - 488) / 2);
        assert_eq!(by, 40 + 1400 - 138 - 20);

        let (rx, ry) =
            compute_overlay_position(1920, 40, 2560, 1400, 488, 138, 20, "bottom_right");
        assert_eq!(rx, 1920 + 2560 - 488 - 20);
        assert_eq!(ry, 40 + 1400 - 138 - 20);
    }

    #[test]
    fn clamps_to_work_area_when_screen_is_smaller_than_window() {
        let (x, y) = compute_overlay_position(100, 50, 300, 100, 488, 138, 20, "bottom_right");
        assert_eq!(x, 100);
        assert_eq!(y, 50);
    }

    #[test]
    fn treats_unoccluded_or_dual_monitor_window_as_visible() {
        let jjdr = ScreenRect { left: 0, top: 0, right: 1400, bottom: 900 };
        let other_monitor_app = ScreenRect { left: 1920, top: 0, right: 3840, bottom: 1080 };
        assert!(!is_window_obscured_by_occluders(jjdr, &[other_monitor_app]));

        let split_right = ScreenRect { left: 960, top: 0, right: 1920, bottom: 1080 };
        assert!(!is_window_obscured_by_occluders(jjdr, &[split_right]));
    }

    #[test]
    fn treats_covered_window_on_same_monitor_as_obscured() {
        let jjdr = ScreenRect { left: 100, top: 100, right: 1400, bottom: 900 };
        let maximized_browser = ScreenRect { left: 0, top: 0, right: 1920, bottom: 1040 };
        assert!(is_window_obscured_by_occluders(jjdr, &[maximized_browser]));
    }

    #[test]
    fn treats_small_overlapping_popup_as_still_visible() {
        let jjdr = ScreenRect { left: 0, top: 0, right: 1400, bottom: 900 };
        let small_popup = ScreenRect { left: 500, top: 300, right: 850, bottom: 550 };
        assert!(!is_window_obscured_by_occluders(jjdr, &[small_popup]));
    }
}
