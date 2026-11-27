use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;

use crate::update::win_http::format_reqwest_error;

pub const ENV_UPDATE_DRY_RUN: &str = "JJDR_UPDATE_DRY_RUN";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateProgressEvent {
    pub stage: String,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub percent: Option<u8>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadOutcome {
    pub file_path: String,
    pub bytes_written: u64,
    pub dry_run: bool,
}

pub fn is_dry_run_enabled() -> bool {
    std::env::var(ENV_UPDATE_DRY_RUN)
        .ok()
        .map(|v| {
            let low = v.trim().to_ascii_lowercase();
            low == "1" || low == "true" || low == "yes"
        })
        .unwrap_or(false)
}

pub fn is_allowed_download_url(url: &str) -> bool {
    let trimmed = url.trim();
    trimmed.starts_with("https://")
        || trimmed.starts_with("http://127.0.0.1")
        || trimmed.starts_with("http://localhost")
}

pub fn sanitize_asset_filename(raw_name: &str) -> String {
    let base = Path::new(raw_name)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("jjdr-update-installer.exe");
    let cleaned: String = base
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.is_empty() {
        "jjdr-update-installer.exe".into()
    } else {
        cleaned
    }
}

pub async fn download_asset_to_dir<F>(
    client: &reqwest::Client,
    download_url: &str,
    asset_name: &str,
    dest_dir: &Path,
    mut on_progress: F,
) -> Result<(PathBuf, u64), String>
where
    F: FnMut(u64, Option<u64>, Option<u8>),
{
    if !is_allowed_download_url(download_url) {
        return Err("Blocked disallowed download URL scheme.".into());
    }

    tokio::fs::create_dir_all(dest_dir)
        .await
        .map_err(|e| format!("Failed to create update directory: {}", e))?;

    let safe_name = sanitize_asset_filename(asset_name);
    let final_path = dest_dir.join(&safe_name);
    let part_path = dest_dir.join(format!("{}.part", safe_name));

    let downloaded: u64 = match client
        .get(download_url)
        .header(reqwest::header::USER_AGENT, "jjdr-updater")
        .send()
        .await
    {
        Ok(mut resp) => {
            if !resp.status().is_success() {
                return Err(format!(
                    "Installer download returned HTTP {}",
                    resp.status().as_u16()
                ));
            }

            let total_bytes = resp.content_length();
            let mut file = tokio::fs::File::create(&part_path)
                .await
                .map_err(|e| format!("Failed to create temp installer file: {}", e))?;

            let mut dl: u64 = 0;
            let mut last_percent: Option<u8> = None;
            let mut last_emit = Instant::now();
            on_progress(0, total_bytes, Some(0));

            while let Some(chunk) = resp
                .chunk()
                .await
                .map_err(|e| format!("Download stream interrupted: {}", format_reqwest_error(&e)))?
            {
                file.write_all(&chunk)
                    .await
                    .map_err(|e| format!("Failed to write installer chunk: {}", e))?;
                dl += chunk.len() as u64;

                let pct = total_bytes.and_then(|total| {
                    if total > 0 {
                        Some(((dl.saturating_mul(100)) / total).min(100) as u8)
                    } else {
                        None
                    }
                });

                let pct_changed = pct != last_percent;
                let elapsed_ok = last_emit.elapsed() >= Duration::from_millis(90);
                if pct_changed || elapsed_ok {
                    last_percent = pct;
                    last_emit = Instant::now();
                    on_progress(dl, total_bytes, pct);
                }
            }

            file.flush()
                .await
                .map_err(|e| format!("Failed to flush installer file: {}", e))?;
            drop(file);
            on_progress(dl, total_bytes.or(Some(dl)), Some(100));
            dl
        }
        Err(primary_err) => {
            let primary_msg = format_reqwest_error(&primary_err);

            #[cfg(windows)]
            if download_url.trim().starts_with("https://") {
                crate::update::win_http::download_file_via_windows_proxy(
                    download_url,
                    "jjdr-updater",
                    &part_path,
                    180,
                    &mut on_progress,
                )
                .await
                .map_err(|fallback_err| {
                    format!(
                        "Download request failed: {} (Windows proxy fallback also failed: {})",
                        primary_msg, fallback_err
                    )
                })?
            } else {
                return Err(format!("Download request failed: {}", primary_msg));
            }

            #[cfg(not(windows))]
            {
                return Err(format!("Download request failed: {}", primary_msg));
            }
        }
    };

    if downloaded == 0 {
        let _ = tokio::fs::remove_file(&part_path).await;
        return Err("Downloaded installer file is empty.".into());
    }

    if final_path.exists() {
        let _ = tokio::fs::remove_file(&final_path).await;
    }
    tokio::fs::rename(&part_path, &final_path)
        .await
        .map_err(|e| format!("Failed to finalize installer file: {}", e))?;

    Ok((final_path, downloaded))
}

pub fn launch_installer(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("Installer not found at {}", path.display()));
    }
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    #[cfg(windows)]
    {
        if ext == "msi" {
            std::process::Command::new("msiexec")
                .arg("/i")
                .arg(path)
                .spawn()
                .map_err(|e| format!("Failed to launch MSI installer: {}", e))?;
        } else {
            std::process::Command::new(path)
                .spawn()
                .map_err(|e| format!("Failed to launch EXE installer: {}", e))?;
        }
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let _ = ext;
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to launch installer: {}", e))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = ext;
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to launch installer: {}", e))?;
        return Ok(());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::update::github::build_http_client;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    async fn spawn_binary_server(body: Vec<u8>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            if let Ok((mut stream, _)) = listener.accept().await {
                let mut req_buf = [0u8; 2048];
                let _ = stream.read(&mut req_buf).await;
                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(header.as_bytes()).await;
                let _ = stream.write_all(&body).await;
                let _ = stream.shutdown().await;
            }
        });
        format!("http://{}/asset.exe", addr)
    }

    #[test]
    fn sanitizes_asset_filename_against_traversal() {
        assert_eq!(
            sanitize_asset_filename("../../evil/jjdr_0.4.0-setup.exe"),
            "jjdr_0.4.0-setup.exe"
        );
    }

    #[test]
    fn validates_allowed_download_url_schemes() {
        assert!(is_allowed_download_url("https://github.com/a/b.exe"));
        assert!(is_allowed_download_url("http://127.0.0.1:18420/a.exe"));
        assert!(is_allowed_download_url("http://localhost:18420/a.exe"));
        assert!(!is_allowed_download_url("http://evil.example/a.exe"));
        assert!(!is_allowed_download_url("file:///C:/Windows/cmd.exe"));
    }

    #[tokio::test]
    async fn mock_http_downloads_installer_and_tracks_progress() {
        let payload = vec![b'J'; 64 * 1024];
        let url = spawn_binary_server(payload.clone()).await;
        let client = build_http_client(5).unwrap();

        let temp_dir =
            std::env::temp_dir().join(format!("jjdr-update-test-{}", uuid::Uuid::new_v4()));
        let mut progress_points: Vec<u8> = Vec::new();
        let (path, written) = download_asset_to_dir(
            &client,
            &url,
            "jjdr_9.9.9_x64-setup.exe",
            &temp_dir,
            |_dl, _tot, pct| {
                if let Some(p) = pct {
                    progress_points.push(p);
                }
            },
        )
        .await
        .unwrap();

        assert_eq!(written, payload.len() as u64);
        assert!(path.exists());
        assert_eq!(progress_points.first(), Some(&0));
        assert_eq!(progress_points.last(), Some(&100));

        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    }
}
