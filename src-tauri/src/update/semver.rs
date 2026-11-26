use std::cmp::Ordering;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PrereleaseId {
    Numeric(u64),
    AlphaNumeric(String),
}

impl Ord for PrereleaseId {
    fn cmp(&self, other: &Self) -> Ordering {
        match (self, other) {
            (PrereleaseId::Numeric(a), PrereleaseId::Numeric(b)) => a.cmp(b),
            (PrereleaseId::Numeric(_), PrereleaseId::AlphaNumeric(_)) => Ordering::Less,
            (PrereleaseId::AlphaNumeric(_), PrereleaseId::Numeric(_)) => Ordering::Greater,
            (PrereleaseId::AlphaNumeric(a), PrereleaseId::AlphaNumeric(b)) => a.cmp(b),
        }
    }
}

impl PartialOrd for PrereleaseId {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedVersion {
    pub major: u64,
    pub minor: u64,
    pub patch: u64,
    pub prerelease: Vec<PrereleaseId>,
}

impl Ord for ParsedVersion {
    fn cmp(&self, other: &Self) -> Ordering {
        let core = (self.major, self.minor, self.patch).cmp(&(other.major, other.minor, other.patch));
        if core != Ordering::Equal {
            return core;
        }
        match (self.prerelease.is_empty(), other.prerelease.is_empty()) {
            (true, true) => Ordering::Equal,
            (true, false) => Ordering::Greater,
            (false, true) => Ordering::Less,
            (false, false) => self.prerelease.cmp(&other.prerelease),
        }
    }
}

impl PartialOrd for ParsedVersion {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// Strip leading `v`/`V` and surrounding whitespace from a release tag or version string.
pub fn normalize_version(raw: &str) -> String {
    let trimmed = raw.trim();
    let stripped = trimmed
        .strip_prefix('v')
        .or_else(|| trimmed.strip_prefix('V'))
        .unwrap_or(trimmed);
    stripped.trim().to_string()
}

/// Parse a SemVer string such as `0.3.0`, `v0.10.2`, `1.2.3-rc.1+build.4`.
pub fn parse_version(raw: &str) -> Option<ParsedVersion> {
    let normalized = normalize_version(raw);
    if normalized.is_empty() {
        return None;
    }

    // Discard +build metadata per SemVer 2.0.0
    let without_build = normalized.split('+').next()?;
    let (core_part, pre_part) = match without_build.split_once('-') {
        Some((core, pre)) => (core, Some(pre)),
        None => (without_build, None),
    };

    let mut nums = core_part.split('.');
    let major = nums.next()?.parse::<u64>().ok()?;
    let minor = nums.next()?.parse::<u64>().ok()?;
    let patch = match nums.next() {
        Some(p) => p.parse::<u64>().ok()?,
        None => 0,
    };
    if nums.next().is_some() {
        return None;
    }

    let mut prerelease = Vec::new();
    if let Some(pre) = pre_part {
        if pre.is_empty() {
            return None;
        }
        for part in pre.split('.') {
            if part.is_empty() {
                return None;
            }
            if let Ok(num) = part.parse::<u64>() {
                prerelease.push(PrereleaseId::Numeric(num));
            } else {
                prerelease.push(PrereleaseId::AlphaNumeric(part.to_string()));
            }
        }
    }

    Some(ParsedVersion {
        major,
        minor,
        patch,
        prerelease,
    })
}

/// Returns true iff `candidate` is strictly greater than `current`.
pub fn is_newer_version(current: &str, candidate: &str) -> bool {
    match (parse_version(current), parse_version(candidate)) {
        (Some(cur), Some(cand)) => cand > cur,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_v_prefix_and_whitespace() {
        assert_eq!(normalize_version("  v0.4.1  "), "0.4.1");
        assert_eq!(normalize_version("V1.2.3"), "1.2.3");
        assert_eq!(normalize_version("0.3.0"), "0.3.0");
    }

    #[test]
    fn compares_major_minor_patch_numerically() {
        assert!(is_newer_version("0.3.0", "0.3.1"));
        assert!(is_newer_version("0.3.0", "v0.10.0"));
        assert!(is_newer_version("0.9.9", "1.0.0"));
        assert!(!is_newer_version("0.3.0", "0.3.0"));
        assert!(!is_newer_version("0.3.1", "0.3.0"));
        assert!(!is_newer_version("0.10.0", "0.3.0"));
    }

    #[test]
    fn handles_prerelease_and_build_metadata() {
        assert!(is_newer_version("0.4.0-beta.1", "0.4.0"));
        assert!(is_newer_version("0.4.0-beta.2", "0.4.0-beta.10"));
        assert!(is_newer_version("0.4.0-alpha.1", "0.4.0-beta.1"));
        assert!(!is_newer_version("0.4.0", "0.4.0-rc.1"));
        assert!(!is_newer_version("0.4.0+20261126", "0.4.0+20261127"));
    }

    #[test]
    fn rejects_invalid_version_strings() {
        assert!(parse_version("").is_none());
        assert!(parse_version("latest").is_none());
        assert!(parse_version("1.2.3.4").is_none());
        assert!(parse_version("1.2.3-").is_none());
        assert!(!is_newer_version("0.3.0", "invalid"));
    }
}
