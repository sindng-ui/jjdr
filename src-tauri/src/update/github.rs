use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::update::semver::{is_newer_version, normalize_version};
use crate::update::win_http::format_reqwest_error;

pub const DEFAULT_RELEASES_MANIFEST_URL: &str =
    "https://github.com/sindng-ui/jjdr/releases/latest/download/latest.json";
pub const DEFAULT_RELEASES_API_URL: &str =
    "https://api.github.com/repos/sindng-ui/jjdr/releases/latest";
pub const DEFAULT_RELEASES_PAGE_URL: &str =
    "https://github.com/sindng-ui/jjdr/releases/latest";

pub const ENV_UPDATE_FEED_URL: &str = "JJDR_UPDATE_FEED_URL";
pub const ENV_CURRENT_VERSION_OVERRIDE: &str = "JJDR_CURRENT_VERSION_OVERRIDE";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubReleaseAsset {
    pub name: String,
    pub browser_download_url: String,
    #[serde(default)]
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubReleasePayload {
    pub tag_name: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub html_url: Option<String>,
    #[serde(default)]
    pub published_at: Option<String>,
    #[serde(default)]
    pub draft: bool,
    #[serde(default)]
    pub prerelease: bool,
    #[serde(default)]
    pub assets: Vec<GitHubReleaseAsset>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub release_name: String,
    pub release_notes: String,
    pub release_url: String,
    pub published_at: Option<String>,
    pub asset_name: Option<String>,
    pub asset_download_url: Option<String>,
    pub asset_size_bytes: Option<u64>,
}

pub fn build_http_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| format!("Failed to initialize HTTP client: {}", e))
}

pub fn resolve_custom_feed_url() -> Option<String> {
    std::env::var(ENV_UPDATE_FEED_URL)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn resolve_feed_url() -> String {
    resolve_custom_feed_url().unwrap_or_else(|| DEFAULT_RELEASES_MANIFEST_URL.to_string())
}

pub fn resolve_current_version(app_version: &str) -> String {
    let raw = std::env::var(ENV_CURRENT_VERSION_OVERRIDE)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| app_version.to_string());
    normalize_version(&raw)
}

/// Prefer NSIS Windows `.exe` installer first, then `.msi` installer, ignoring signature files.
pub fn select_windows_installer_asset(
    assets: &[GitHubReleaseAsset],
) -> Option<&GitHubReleaseAsset> {
    let candidates: Vec<&GitHubReleaseAsset> = assets
        .iter()
        .filter(|a| {
            let lower = a.name.to_ascii_lowercase();
            !lower.ends_with(".sig") && !lower.ends_with(".sha256")
        })
        .collect();

    if let Some(setup_exe) = candidates.iter().find(|a| {
        let lower = a.name.to_ascii_lowercase();
        lower.ends_with(".exe") && (lower.contains("setup") || lower.contains("x64"))
    }) {
        return Some(*setup_exe);
    }
    if let Some(any_exe) = candidates
        .iter()
        .find(|a| a.name.to_ascii_lowercase().ends_with(".exe"))
    {
        return Some(*any_exe);
    }
    candidates
        .iter()
        .find(|a| a.name.to_ascii_lowercase().ends_with(".msi"))
        .copied()
}

pub fn build_check_result(
    current_version: &str,
    payload: GitHubReleasePayload,
) -> UpdateCheckResult {
    let current_norm = normalize_version(current_version);
    let latest_norm = normalize_version(&payload.tag_name);
    let eligible = !payload.draft && !payload.prerelease;
    let has_update = eligible && is_newer_version(&current_norm, &latest_norm);

    let asset = select_windows_installer_asset(&payload.assets);
    let release_name = payload
        .name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("jjdr v{}", latest_norm));
    let release_notes = payload.body.unwrap_or_default().trim().to_string();
    let release_url = payload
        .html_url
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_RELEASES_PAGE_URL.to_string());

    UpdateCheckResult {
        current_version: current_norm,
        latest_version: latest_norm,
        has_update,
        release_name,
        release_notes,
        release_url,
        published_at: payload.published_at,
        asset_name: asset.map(|a| a.name.clone()),
        asset_download_url: asset.map(|a| a.browser_download_url.clone()),
        asset_size_bytes: asset.and_then(|a| if a.size > 0 { Some(a.size) } else { None }),
    }
}

fn parse_release_response(
    status: u16,
    body: &str,
    current_version: &str,
) -> Result<UpdateCheckResult, String> {
    if status == 404 {
        return Err("No published GitHub release found yet (404).".into());
    }
    if status == 403 {
        let lower = body.to_ascii_lowercase();
        if lower.contains("rate limit") {
            return Err("GitHub API rate limit exceeded. Please try again shortly.".into());
        }
        return Err(
            "Access denied by server or corporate proxy (HTTP 403).".into(),
        );
    }
    if !(200..300).contains(&status) {
        return Err(format!("Release server returned HTTP {}", status));
    }

    let payload = serde_json::from_str::<GitHubReleasePayload>(body)
        .map_err(|e| format!("Invalid release JSON payload: {}", e))?;

    Ok(build_check_result(current_version, payload))
}

/// Check latest release using a rate-limit-free cascade:
/// 1) Custom `JJDR_UPDATE_FEED_URL` if configured (local mock / enterprise mirror)
/// 2) GitHub Release Assets CDN `latest.json` (zero API rate limit, full What's New + exact asset sizes)
/// 3) `github.com/.../releases/latest` web redirect + `expanded_assets` HTML (zero API rate limit, works for older releases without `latest.json`)
/// 4) `api.github.com` as last-resort fallback
pub async fn check_latest_release(
    client: &reqwest::Client,
    current_version: &str,
) -> Result<UpdateCheckResult, String> {
    if let Some(custom_url) = resolve_custom_feed_url() {
        return check_release_from_url(client, &custom_url, current_version).await;
    }

    if let Ok(res) =
        check_release_from_url(client, DEFAULT_RELEASES_MANIFEST_URL, current_version).await
    {
        return Ok(res);
    }

    if let Ok(res) = crate::update::web_fallback::check_release_via_web_redirect(
        client,
        crate::update::web_fallback::DEFAULT_RELEASES_BASE_URL,
        current_version,
    )
    .await
    {
        return Ok(res);
    }

    check_release_from_url(client, DEFAULT_RELEASES_API_URL, current_version).await
}

pub async fn check_release_from_url(
    client: &reqwest::Client,
    feed_url: &str,
    current_version: &str,
) -> Result<UpdateCheckResult, String> {
    let ua = format!("jjdr-updater/{}", normalize_version(current_version));
    let accept = "application/vnd.github+json";

    match client
        .get(feed_url)
        .header(reqwest::header::USER_AGENT, &ua)
        .header(reqwest::header::ACCEPT, accept)
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let body = resp
                .text()
                .await
                .map_err(|e| format!("Failed to read release response: {}", format_reqwest_error(&e)))?;
            parse_release_response(status, &body, current_version)
        }
        Err(primary_err) => {
            let primary_msg = format_reqwest_error(&primary_err);

            #[cfg(windows)]
            if feed_url.trim().starts_with("https://") {
                match crate::update::win_http::fetch_text_via_windows_proxy(
                    feed_url, &ua, accept, 12,
                )
                .await
                {
                    Ok(win_resp) => {
                        return parse_release_response(
                            win_resp.status,
                            &win_resp.body,
                            current_version,
                        );
                    }
                    Err(fallback_err) => {
                        return Err(format!(
                            "Failed to reach release server: {} (Windows proxy fallback also failed: {})",
                            primary_msg, fallback_err
                        ));
                    }
                }
            }

            Err(format!("Failed to reach release server: {}", primary_msg))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    async fn spawn_mock_http_server(
        status_line: &'static str,
        content_type: &'static str,
        body: Vec<u8>,
    ) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            if let Ok((mut stream, _)) = listener.accept().await {
                let mut req_buf = [0u8; 2048];
                let _ = stream.read(&mut req_buf).await;
                let header = format!(
                    "HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    status_line,
                    content_type,
                    body.len()
                );
                let _ = stream.write_all(header.as_bytes()).await;
                let _ = stream.write_all(&body).await;
                let _ = stream.shutdown().await;
            }
        });
        format!("http://{}/latest", addr)
    }

    #[test]
    fn selects_nsis_exe_before_msi_and_ignores_signatures() {
        let assets = vec![
            GitHubReleaseAsset {
                name: "jjdr_0.4.0_x64-setup.exe.sig".into(),
                browser_download_url: "https://example.com/sig".into(),
                size: 128,
            },
            GitHubReleaseAsset {
                name: "jjdr_0.4.0_x64_en-US.msi".into(),
                browser_download_url: "https://example.com/app.msi".into(),
                size: 1000,
            },
            GitHubReleaseAsset {
                name: "jjdr_0.4.0_x64-setup.exe".into(),
                browser_download_url: "https://example.com/setup.exe".into(),
                size: 2000,
            },
        ];
        let picked = select_windows_installer_asset(&assets).unwrap();
        assert_eq!(picked.name, "jjdr_0.4.0_x64-setup.exe");

        let msi_only = vec![assets[1].clone()];
        assert_eq!(
            select_windows_installer_asset(&msi_only).unwrap().name,
            "jjdr_0.4.0_x64_en-US.msi"
        );
    }

    #[test]
    fn ignores_draft_and_prerelease_payloads() {
        let draft = GitHubReleasePayload {
            tag_name: "v0.9.0".into(),
            name: Some("Draft".into()),
            body: Some("Notes".into()),
            html_url: None,
            published_at: None,
            draft: true,
            prerelease: false,
            assets: vec![],
        };
        assert!(!build_check_result("0.3.0", draft).has_update);

        let pre = GitHubReleasePayload {
            tag_name: "v0.9.0-rc.1".into(),
            name: None,
            body: None,
            html_url: None,
            published_at: None,
            draft: false,
            prerelease: true,
            assets: vec![],
        };
        assert!(!build_check_result("0.3.0", pre).has_update);
    }

    #[tokio::test]
    async fn mock_http_check_detects_newer_release_and_notes() {
        let json_body = serde_json::json!({
            "tag_name": "v0.4.0",
            "name": "jjdr v0.4.0",
            "body": "## What's New\n- Auto update popup\n- Faster radar",
            "html_url": "https://github.com/sindng-ui/jjdr/releases/tag/v0.4.0",
            "published_at": "2026-11-26T00:00:00Z",
            "draft": false,
            "prerelease": false,
            "assets": [
                {
                    "name": "jjdr_0.4.0_x64-setup.exe",
                    "browser_download_url": "http://127.0.0.1/jjdr_0.4.0_x64-setup.exe",
                    "size": 4096
                }
            ]
        })
        .to_string()
        .into_bytes();

        let url = spawn_mock_http_server("200 OK", "application/json", json_body).await;
        let client = build_http_client(5).unwrap();
        let res = check_release_from_url(&client, &url, "0.3.0").await.unwrap();

        assert!(res.has_update);
        assert_eq!(res.current_version, "0.3.0");
        assert_eq!(res.latest_version, "0.4.0");
        assert!(res.release_notes.contains("Auto update popup"));
        assert_eq!(res.asset_name.as_deref(), Some("jjdr_0.4.0_x64-setup.exe"));
        assert_eq!(res.asset_size_bytes, Some(4096));
    }

    #[tokio::test]
    async fn mock_http_check_reports_up_to_date_and_handles_http_errors() {
        let same_ver = serde_json::json!({
            "tag_name": "v0.3.0",
            "draft": false,
            "prerelease": false,
            "assets": []
        })
        .to_string()
        .into_bytes();

        let ok_url = spawn_mock_http_server("200 OK", "application/json", same_ver).await;
        let client = build_http_client(5).unwrap();
        let res = check_release_from_url(&client, &ok_url, "0.3.0")
            .await
            .unwrap();
        assert!(!res.has_update);

        let err_url = spawn_mock_http_server("404 Not Found", "text/plain", b"nope".to_vec()).await;
        let err = check_release_from_url(&client, &err_url, "0.3.0")
            .await
            .unwrap_err();
        assert!(err.contains("404"));
    }
}
