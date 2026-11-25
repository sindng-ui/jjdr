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
}
