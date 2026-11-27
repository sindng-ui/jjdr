use std::path::Path;
use std::time::Duration;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Response returned by the Windows OS HTTP fallback (WinINet / .NET HttpClient).
#[derive(Debug, Clone)]
pub struct WinHttpTextResponse {
    pub status: u16,
    pub final_url: Option<String>,
    pub body: String,
}

/// Format a `reqwest::Error` including its root cause chain so corporate proxy / TLS issues
/// surface actionable diagnostics instead of a generic "error sending request for url".
pub fn format_reqwest_error(err: &reqwest::Error) -> String {
    use std::error::Error;

    let mut parts: Vec<String> = vec![err.to_string()];
    let mut current = err.source();
    let mut depth = 0usize;
    while let Some(src) = current {
        let msg = src.to_string();
        if !msg.is_empty() && !parts.iter().any(|p| p.contains(&msg)) {
            parts.push(msg);
        }
        current = src.source();
        depth += 1;
        if depth >= 5 {
            break;
        }
    }
    parts.join(" -> ")
}

/// Fallback HTTPS GET using Windows .NET `HttpClient` via PowerShell.
/// Automatically inherits Windows IE/WinINet proxy settings, PAC scripts (`AutoConfigURL`),
/// corporate NTLM/Negotiate default proxy credentials, and the Windows Root CA store.
#[cfg(windows)]
pub async fn fetch_text_via_windows_proxy(
    url: &str,
    user_agent: &str,
    accept: &str,
    timeout_secs: u64,
) -> Result<WinHttpTextResponse, String> {
    use tokio::process::Command;

    const SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12 -bor 12288
} catch {}
Add-Type -AssemblyName System.Net.Http
$handler = New-Object System.Net.Http.HttpClientHandler
$handler.UseProxy = $true
$handler.UseDefaultCredentials = $true
try { $handler.DefaultProxyCredentials = [System.Net.CredentialCache]::DefaultCredentials } catch {}
$proxy = [System.Net.WebRequest]::GetSystemWebProxy()
if ($proxy) {
  $proxy.Credentials = [System.Net.CredentialCache]::DefaultCredentials
  $handler.Proxy = $proxy
}
$client = New-Object System.Net.Http.HttpClient($handler)
$client.Timeout = [TimeSpan]::FromSeconds([int]$env:JJDR_WINHTTP_TIMEOUT)
$req = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Get, $env:JJDR_WINHTTP_URL)
$req.Headers.TryAddWithoutValidation('User-Agent', $env:JJDR_WINHTTP_UA) | Out-Null
if ($env:JJDR_WINHTTP_ACCEPT) {
  $req.Headers.TryAddWithoutValidation('Accept', $env:JJDR_WINHTTP_ACCEPT) | Out-Null
}
try {
  $resp = $client.SendAsync($req).GetAwaiter().GetResult()
  $status = [int]$resp.StatusCode
  $finalUrl = ''
  try { $finalUrl = $resp.RequestMessage.RequestUri.AbsoluteUri } catch {}
  $body = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  Write-Output ("STATUS:" + $status)
  Write-Output ("URL:" + $finalUrl)
  Write-Output $body
} finally {
  $client.Dispose()
  $handler.Dispose()
}
"#;

    let mut cmd = Command::new("powershell.exe");
    cmd.creation_flags(CREATE_NO_WINDOW)
        .args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT])
        .env("JJDR_WINHTTP_URL", url)
        .env("JJDR_WINHTTP_UA", user_agent)
        .env("JJDR_WINHTTP_ACCEPT", accept)
        .env("JJDR_WINHTTP_TIMEOUT", timeout_secs.max(3).to_string());

    let output = tokio::time::timeout(
        Duration::from_secs(timeout_secs.saturating_add(5)),
        cmd.output(),
    )
    .await
    .map_err(|_| "Windows proxy fallback timed out.".to_string())?
    .map_err(|e| format!("Failed to spawn Windows proxy fallback: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("Windows proxy fallback exited with {}", output.status)
        } else {
            stderr
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut lines = stdout.splitn(3, '\n');
    let first = lines.next().unwrap_or("").trim();
    let second = lines.next().unwrap_or("").trim();
    let rest = lines.next().unwrap_or("");
    let status = first
        .strip_prefix("STATUS:")
        .and_then(|s| s.trim().parse::<u16>().ok())
        .ok_or_else(|| "Unexpected response format from Windows proxy fallback.".to_string())?;
    let final_url = second
        .strip_prefix("URL:")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    Ok(WinHttpTextResponse {
        status,
        final_url,
        body: rest.to_string(),
    })
}

/// Fallback streaming binary download using Windows .NET `HttpClient` via PowerShell.
/// Emits `PROGRESS <downloaded> <total>` lines on stdout and relays them to `on_progress`.
#[cfg(windows)]
pub async fn download_file_via_windows_proxy<F>(
    url: &str,
    user_agent: &str,
    part_path: &Path,
    timeout_secs: u64,
    mut on_progress: F,
) -> Result<u64, String>
where
    F: FnMut(u64, Option<u64>, Option<u8>),
{
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
    use tokio::process::Command;

    const SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12 -bor 12288
} catch {}
Add-Type -AssemblyName System.Net.Http
$handler = New-Object System.Net.Http.HttpClientHandler
$handler.UseProxy = $true
$handler.UseDefaultCredentials = $true
try { $handler.DefaultProxyCredentials = [System.Net.CredentialCache]::DefaultCredentials } catch {}
$proxy = [System.Net.WebRequest]::GetSystemWebProxy()
if ($proxy) {
  $proxy.Credentials = [System.Net.CredentialCache]::DefaultCredentials
  $handler.Proxy = $proxy
}
$client = New-Object System.Net.Http.HttpClient($handler)
$client.Timeout = [TimeSpan]::FromSeconds([int]$env:JJDR_WINHTTP_TIMEOUT)
$req = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Get, $env:JJDR_WINHTTP_URL)
$req.Headers.TryAddWithoutValidation('User-Agent', $env:JJDR_WINHTTP_UA) | Out-Null
try {
  $resp = $client.SendAsync($req, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
  $status = [int]$resp.StatusCode
  if ($status -lt 200 -or $status -ge 300) {
    [Console]::Error.WriteLine("Installer download returned HTTP $status")
    exit 2
  }
  $total = -1
  if ($null -ne $resp.Content.Headers.ContentLength) {
    $total = [int64]$resp.Content.Headers.ContentLength
  }
  $inStream = $resp.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
  $outStream = [System.IO.File]::Create($env:JJDR_WINHTTP_DEST)
  try {
    $buf = New-Object byte[] 65536
    [int64]$downloaded = 0
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $lastMs = -1000
    Write-Output "PROGRESS 0 $total"
    while (($read = $inStream.Read($buf, 0, $buf.Length)) -gt 0) {
      $outStream.Write($buf, 0, $read)
      $downloaded += $read
      if (($sw.ElapsedMilliseconds - $lastMs) -ge 90) {
        $lastMs = $sw.ElapsedMilliseconds
        Write-Output "PROGRESS $downloaded $total"
      }
    }
    $outStream.Flush()
    Write-Output "DONE $downloaded $total"
  } finally {
    $outStream.Dispose()
    $inStream.Dispose()
  }
} finally {
  $client.Dispose()
  $handler.Dispose()
}
"#;

    let mut cmd = Command::new("powershell.exe");
    cmd.creation_flags(CREATE_NO_WINDOW)
        .args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT])
        .env("JJDR_WINHTTP_URL", url)
        .env("JJDR_WINHTTP_UA", user_agent)
        .env("JJDR_WINHTTP_DEST", part_path.as_os_str())
        .env("JJDR_WINHTTP_TIMEOUT", timeout_secs.max(15).to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn Windows proxy downloader: {}", e))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Windows proxy downloader stdout unavailable.".to_string())?;
    let mut stderr = child.stderr.take();

    let mut reader = BufReader::new(stdout).lines();
    let mut final_downloaded: u64 = 0;

    while let Some(line) = reader
        .next_line()
        .await
        .map_err(|e| format!("Failed reading Windows proxy download progress: {}", e))?
    {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("PROGRESS ") {
            if let Some((dl, tot, pct)) = parse_progress_tokens(rest) {
                final_downloaded = dl;
                on_progress(dl, tot, pct);
            }
        } else if let Some(rest) = trimmed.strip_prefix("DONE ") {
            if let Some((dl, tot, _)) = parse_progress_tokens(rest) {
                final_downloaded = dl;
                on_progress(dl, tot.or(Some(dl)), Some(100));
            }
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Windows proxy downloader wait failed: {}", e))?;

    if !status.success() {
        let mut err_buf = String::new();
        if let Some(ref mut s) = stderr {
            let _ = s.read_to_string(&mut err_buf).await;
        }
        let msg = err_buf.trim();
        return Err(if msg.is_empty() {
            format!("Windows proxy download failed with {}", status)
        } else {
            msg.to_string()
        });
    }

    Ok(final_downloaded)
}

pub fn parse_progress_tokens(rest: &str) -> Option<(u64, Option<u64>, Option<u8>)> {
    let mut parts = rest.split_whitespace();
    let dl: u64 = parts.next()?.parse().ok()?;
    let raw_tot: i64 = parts.next()?.parse().ok()?;
    let tot = if raw_tot > 0 {
        Some(raw_tot as u64)
    } else {
        None
    };
    let pct = tot.map(|t| ((dl.saturating_mul(100)) / t).min(100) as u8);
    Some((dl, tot, pct))
}

#[cfg(test)]
mod tests {
    use super::parse_progress_tokens;

    #[test]
    fn parses_progress_tokens_with_known_and_unknown_total() {
        assert_eq!(parse_progress_tokens("500 1000"), Some((500, Some(1000), Some(50))));
        assert_eq!(parse_progress_tokens("1024 -1"), Some((1024, None, None)));
        assert_eq!(parse_progress_tokens("bad"), None);
    }
}
