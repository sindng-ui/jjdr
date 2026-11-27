use std::collections::BTreeSet;

/// Normalize a GitHub / GHE user identifier: strip leading '@', trim whitespace, lowercase.
pub fn normalize_github_id(raw: &str) -> Option<String> {
    let cleaned = raw.trim().trim_start_matches('@').trim().to_ascii_lowercase();
    if cleaned.is_empty() || cleaned.len() > 64 {
        return None;
    }
    if cleaned
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
    {
        Some(cleaned)
    } else {
        None
    }
}

/// Normalize any HTTPS, HTTP, SSH, or SCP-style Git remote URL into a canonical lowercase
/// `host/owner/repo` string so peers with different local folders or clone protocols match reliably.
pub fn normalize_repo_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    // Strip query string or fragment if a web PR URL was accidentally pasted.
    let without_query = trimmed.split(&['?', '#'][..]).next().unwrap_or(trimmed).trim();

    let mut body = if let Some(rest) = strip_scheme(without_query) {
        rest.to_string()
    } else if let Some((left, right)) = without_query.split_once(':') {
        // SCP-style git@github.corp.com:org/repo.git (exclude Windows drive paths like C:\foo)
        if left.len() <= 1 || right.starts_with('\\') {
            return None;
        }
        format!("{}/{}", left, right)
    } else {
        without_query.to_string()
    };

    // Drop embedded credentials (user@ or token@) before the first slash.
    if let Some(slash_idx) = body.find('/') {
        let authority = &body[..slash_idx];
        let path = &body[slash_idx..];
        let host_part = authority.rsplit('@').next().unwrap_or(authority);
        // Drop standard default ports (:80, :443, :22) but keep custom ports if present.
        let host_clean = strip_default_port(host_part);
        body = format!("{}{}", host_clean, path);
    } else {
        return None;
    }

    // Normalize slashes, trim trailing '/' and '.git', and lowercase.
    let normalized = body.replace('\\', "/");
    let parts: Vec<&str> = normalized.split('/').filter(|s| !s.is_empty()).collect();
    if parts.len() < 3 {
        return None;
    }

    let host = parts[0].to_ascii_lowercase();
    if host.is_empty() || !host.contains('.') && host != "localhost" && !host.contains(':') {
        return None;
    }

    let mut path_segments: Vec<String> = parts[1..]
        .iter()
        .map(|s| s.to_ascii_lowercase())
        .collect();

    if let Some(last) = path_segments.last_mut() {
        if let Some(stripped) = last.strip_suffix(".git") {
            *last = stripped.to_string();
        }
    }
    path_segments.retain(|s| !s.is_empty());
    if path_segments.len() < 2 {
        return None;
    }

    Some(format!("{}/{}", host, path_segments.join("/")))
}

/// Deduplicate and normalize a list of repository URLs into sorted canonical form.
pub fn normalize_repo_list<I, S>(repos: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let set: BTreeSet<String> = repos
        .into_iter()
        .filter_map(|r| normalize_repo_url(r.as_ref()))
        .collect();
    set.into_iter().collect()
}

fn strip_scheme(raw: &str) -> Option<&str> {
    let idx = raw.find("://")?;
    let scheme = &raw[..idx];
    if scheme
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'-' | b'.'))
    {
        Some(&raw[idx + 3..])
    } else {
        None
    }
}

fn strip_default_port(host: &str) -> &str {
    for suffix in [":443", ":80", ":22"] {
        if let Some(stripped) = host.strip_suffix(suffix) {
            return stripped;
        }
    }
    host
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_enterprise_https_and_ssh_variants_identically() {
        let expected = Some("github.corp.company.com/team-alpha/jjdr".to_string());
        assert_eq!(
            normalize_repo_url("https://github.corp.company.com/Team-Alpha/jjdr.git"),
            expected
        );
        assert_eq!(
            normalize_repo_url("https://GITHUB.CORP.COMPANY.COM/team-alpha/jjdr/"),
            expected
        );
        assert_eq!(
            normalize_repo_url("git@github.corp.company.com:Team-Alpha/jjdr.git"),
            expected
        );
        assert_eq!(
            normalize_repo_url("ssh://git@github.corp.company.com:22/team-alpha/jjdr.git"),
            expected
        );
        assert_eq!(
            normalize_repo_url("https://token@github.corp.company.com:443/team-alpha/jjdr.git?foo=1"),
            expected
        );
    }

    #[test]
    fn preserves_custom_port_and_subgroups() {
        assert_eq!(
            normalize_repo_url("https://git.internal.local:8443/group/sub/project.git"),
            Some("git.internal.local:8443/group/sub/project".to_string())
        );
    }

    #[test]
    fn rejects_invalid_or_local_paths() {
        assert_eq!(normalize_repo_url(""), None);
        assert_eq!(normalize_repo_url("C:\\work\\jjdr"), None);
        assert_eq!(normalize_repo_url("https://github.corp.com/only-owner"), None);
        assert_eq!(normalize_repo_url("not-a-repo"), None);
    }

    #[test]
    fn normalizes_github_ids_safely() {
        assert_eq!(normalize_github_id(" @MinSu-Dev "), Some("minsu-dev".to_string()));
        assert_eq!(normalize_github_id("alice.kim_1"), Some("alice.kim_1".to_string()));
        assert_eq!(normalize_github_id(""), None);
        assert_eq!(normalize_github_id("   @@@  "), None);
        assert_eq!(normalize_github_id("bad user;drop"), None);
    }

    #[test]
    fn deduplicates_repo_list() {
        let out = normalize_repo_list([
            "git@github.corp.com:Org/App.git",
            "https://github.corp.com/org/app",
            "invalid",
            "https://github.corp.com/org/beta.git",
        ]);
        assert_eq!(
            out,
            vec![
                "github.corp.com/org/app".to_string(),
                "github.corp.com/org/beta".to_string(),
            ]
        );
    }
}
