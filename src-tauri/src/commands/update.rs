use std::time::Duration;

use tauri::{AppHandle, Emitter};

use crate::update::github::{
    build_http_client, check_latest_release, resolve_current_version, UpdateCheckResult,
};
use crate::update::installer::{
    download_asset_to_dir, is_dry_run_enabled, launch_installer, DownloadOutcome,
    UpdateProgressEvent,
};

#[tauri::command]
pub fn get_app_version(app: AppHandle) -> String {
    resolve_current_version(&app.package_info().version.to_string())
}

#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<UpdateCheckResult, String> {
    let current = resolve_current_version(&app.package_info().version.to_string());
    let client = build_http_client(10)?;
    check_latest_release(&client, &current).await
}

#[tauri::command]
pub async fn download_and_install_update(
    app: AppHandle,
    download_url: String,
    asset_name: String,
) -> Result<DownloadOutcome, String> {
    let client = build_http_client(180)?;
    let dest_dir = std::env::temp_dir().join("jjdr-updates");
    let app_for_progress = app.clone();

    let (file_path, bytes_written) = download_asset_to_dir(
        &client,
        &download_url,
        &asset_name,
        &dest_dir,
        move |downloaded_bytes, total_bytes, percent| {
            let _ = app_for_progress.emit(
                "jjdr:update-progress",
                UpdateProgressEvent {
                    stage: "downloading".into(),
                    downloaded_bytes,
                    total_bytes,
                    percent,
                    message: None,
                },
            );
        },
    )
    .await
    .map_err(|err| {
        let _ = app.emit(
            "jjdr:update-progress",
            UpdateProgressEvent {
                stage: "error".into(),
                downloaded_bytes: 0,
                total_bytes: None,
                percent: None,
                message: Some(err.clone()),
            },
        );
        err
    })?;

    let dry_run = is_dry_run_enabled();
    let file_path_str = file_path.to_string_lossy().to_string();

    if dry_run {
        let _ = app.emit(
            "jjdr:update-progress",
            UpdateProgressEvent {
                stage: "done".into(),
                downloaded_bytes: bytes_written,
                total_bytes: Some(bytes_written),
                percent: Some(100),
                message: Some(format!("Dry-run 완료: {}", file_path_str)),
            },
        );
        return Ok(DownloadOutcome {
            file_path: file_path_str,
            bytes_written,
            dry_run: true,
        });
    }

    let _ = app.emit(
        "jjdr:update-progress",
        UpdateProgressEvent {
            stage: "launching".into(),
            downloaded_bytes: bytes_written,
            total_bytes: Some(bytes_written),
            percent: Some(100),
            message: Some("인스톨러를 실행하고 앱을 종료합니다...".into()),
        },
    );

    launch_installer(&file_path)?;

    // Give frontend a brief moment to paint the launching state, then exit cleanly.
    // RunEvent::Exit detaches only `hc connect`, keeping herdr-core & AI sessions alive.
    let app_to_exit = app.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(450)).await;
        app_to_exit.exit(0);
    });

    Ok(DownloadOutcome {
        file_path: file_path_str,
        bytes_written,
        dry_run: false,
    })
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err("Only http/https URLs are allowed.".into());
    }
    if trimmed.chars().any(|c| c.is_control() || c.is_whitespace() || c == '"') {
        return Err("Invalid characters in URL.".into());
    }

    #[cfg(windows)]
    {
        std::process::Command::new("rundll32.exe")
            .arg("url.dll,FileProtocolHandler")
            .arg(trimmed)
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(trimmed)
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(trimmed)
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
        return Ok(());
    }
}
