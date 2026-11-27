use regex::Regex;

use crate::update::github::{
    build_check_result, GitHubReleaseAsset, GitHubReleasePayload, UpdateCheckResult,
};
use crate::update::semver::normalize_version;
use crate::update::win_http::format_reqwest_error;

pub const DEFAULT_RELEASES_BASE_URL: &str = "https://github.com/sindng-ui/jjdr/releases";

/// Extract `vX.Y.Z` tag name from a redirected GitHub Release URL (`.../releases/tag/v0.4.8`)
/// or fallback to scanning canonical/tag links in the HTML body.
pub fn extract_tag_from_release_page(final_url: &str, html: &str) -> Option<String> {
    if let Some(idx) = final_url.find("/releases/tag/") {
        let rest = &final_url[idx + "/releases/tag/".len()..];
        let tag = rest
            .split(['?', '#', '/'])
            .next()
            .unwrap_or("")
            .trim();
        if !tag.is_empty() {
            return Some(tag.to_string());
        }
    }

    let re = Regex::new(r#"/releases/tag/(v?\d+\.\d+\.\d+[0-9A-Za-z.\-+]*)"#).ok()?;
    re.captures(html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
}

/// Extract `.exe` / `.msi` installer assets from GitHub's rate-limit-free
/// `/releases/expanded_assets/<tag>` HTML fragment.
pub fn extract_assets_from_expanded_html(
    html: &str,
    tag_name: &str,
) -> Vec<GitHubReleaseAsset> {
    let re = match Regex::new(
        r#"href="(/[^"]+/releases/download/[^"]+/([^"/]+\.(?:exe|msi)))""#,
    ) {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };

    let mut seen = std::collections::HashSet::new();
    let mut assets = Vec::new();

    for cap in re.captures_iter(html) {
        let rel_path = match cap.get(1) {
            Some(m) => m.as_str(),
            None => continue,
        };
        let filename = match cap.get(2) {
            Some(m) => m.as_str(),
            None => continue,
        };
        if !seen.insert(filename.to_string()) {
            continue;
        }
        assets.push(GitHubReleaseAsset {
            name: filename.to_string(),
            browser_download_url: format!("https://github.com{}", rel_path),
            size: 0,
        });
    }

    if assets.is_empty() {
        let ver = normalize_version(tag_name);
        if !ver.is_empty() {
            let guessed = format!("jjdr_{}_x64-setup.exe", ver);
            assets.push(GitHubReleaseAsset {
                browser_download_url: format!(
                    "{}/download/{}/{}",
                    DEFAULT_RELEASES_BASE_URL, tag_name, guessed
                ),
                name: guessed,
                size: 0,
            });
        }
    }

    assets
}

async fn fetch_web_page(
    client: &reqwest::Client,
    url: &str,
    ua: &str,
) -> Result<(u16, String, String), String> {
    match client
        .get(url)
        .header(reqwest::header::USER_AGENT, ua)
        .header(reqwest::header::ACCEPT, "text/html,application/xhtml+xml")
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let final_url = resp.url().to_string();
            let body = resp
                .text()
                .await
                .map_err(|e| format_reqwest_error(&e))?;
            Ok((status, final_url, body))
        }
        Err(primary_err) => {
            let primary_msg = format_reqwest_error(&primary_err);

            #[cfg(windows)]
            if url.trim().starts_with("https://") {
                match crate::update::win_http::fetch_text_via_windows_proxy(
                    url,
                    ua,
                    "text/html,application/xhtml+xml",
                    12,
                )
                .await
                {
                    Ok(win_resp) => {
                        return Ok((
                            win_resp.status,
                            win_resp.final_url.unwrap_or_else(|| url.to_string()),
                            win_resp.body,
                        ));
                    }
                    Err(fallback_err) => {
                        return Err(format!(
                            "{} (Windows proxy fallback: {})",
                            primary_msg, fallback_err
                        ));
                    }
                }
            }

            Err(primary_msg)
        }
    }
}

/// Rate-limit-free fallback that resolves the latest GitHub Release tag and Windows installer
/// directly via `github.com/sindng-ui/jjdr/releases/latest` (bypassing `api.github.com` 60req/hr cap).
pub async fn check_release_via_web_redirect(
    client: &reqwest::Client,
    releases_base_url: &str,
    current_version: &str,
) -> Result<UpdateCheckResult, String> {
    let base = releases_base_url.trim_end_matches('/');
    let latest_url = format!("{}/latest", base);
    let ua = format!("jjdr-updater/{}", normalize_version(current_version));

    let (status, final_url, html) = fetch_web_page(client, &latest_url, &ua).await?;
    if status == 404 {
        return Err("No published GitHub release found yet (404).".into());
    }
    if !(200..300).contains(&status) {
        return Err(format!("GitHub releases page returned HTTP {}", status));
    }

    let tag_name = extract_tag_from_release_page(&final_url, &html)
        .ok_or_else(|| "Could not determine latest release tag from GitHub page.".to_string())?;

    let expanded_url = format!("{}/expanded_assets/{}", base, tag_name);
    let expanded_html = fetch_web_page(client, &expanded_url, &ua)
        .await
        .ok()
        .filter(|(s, _, _)| (200..300).contains(s))
        .map(|(_, _, b)| b)
        .unwrap_or_default();

    let assets = extract_assets_from_expanded_html(&expanded_html, &tag_name);
    let ver = normalize_version(&tag_name);

    let payload = GitHubReleasePayload {
        tag_name: tag_name.clone(),
        name: Some(format!("jjdr v{}", ver)),
        body: None,
        html_url: Some(format!("{}/tag/{}", base, tag_name)),
        published_at: None,
        draft: false,
        prerelease: false,
        assets,
    };

    Ok(build_check_result(current_version, payload))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_tag_from_redirect_url_or_html() {
        assert_eq!(
            extract_tag_from_release_page(
                "https://github.com/sindng-ui/jjdr/releases/tag/v0.4.8",
                ""
            )
            .as_deref(),
            Some("v0.4.8")
        );
        assert_eq!(
            extract_tag_from_release_page(
                "https://github.com/sindng-ui/jjdr/releases/latest",
                r#"<link rel="canonical" href="https://github.com/sindng-ui/jjdr/releases/tag/v0.4.7">"#
            )
            .as_deref(),
            Some("v0.4.7")
        );
    }

    #[test]
    fn extracts_windows_installer_assets_from_expanded_html() {
        let html = r#"
          <a href="/sindng-ui/jjdr/releases/download/v0.4.8/jjdr_0.4.8_x64-setup.exe">exe</a>
          <a href="/sindng-ui/jjdr/releases/download/v0.4.8/jjdr_0.4.8_x64_en-US.msi">msi</a>
          <a href="/sindng-ui/jjdr/releases/download/v0.4.8/latest.json">json</a>
        "#;
        let assets = extract_assets_from_expanded_html(html, "v0.4.8");
        assert_eq!(assets.len(), 2);
        assert_eq!(assets[0].name, "jjdr_0.4.8_x64-setup.exe");
        assert_eq!(
            assets[0].browser_download_url,
            "https://github.com/sindng-ui/jjdr/releases/download/v0.4.8/jjdr_0.4.8_x64-setup.exe"
        );
    }

    #[test]
    fn falls_back_to_conventional_nsis_asset_when_expanded_html_empty() {
        let assets = extract_assets_from_expanded_html("", "v0.4.8");
        assert_eq!(assets.len(), 1);
        assert_eq!(assets[0].name, "jjdr_0.4.8_x64-setup.exe");
    }
}
