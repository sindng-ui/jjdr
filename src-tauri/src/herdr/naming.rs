/// Sanitize a terminal session name so it strictly satisfies `herdr-core`'s
/// naming rules (must start with an ASCII letter and contain only `[A-Za-z0-9_-]`).
/// Returns `None` if no meaningful alphanumeric characters exist.
pub fn sanitize_herdr_name(raw: &str) -> Option<String> {
    let mut cleaned = String::with_capacity(raw.len().min(64));
    let mut prev_dash = false;

    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' {
            cleaned.push(ch);
            prev_dash = false;
        } else if !prev_dash {
            cleaned.push('-');
            prev_dash = true;
        }
    }

    let trimmed = cleaned.trim_matches(|c| c == '-' || c == '_');
    if trimmed.is_empty() {
        return None;
    }

    let mut result = if trimmed.as_bytes()[0].is_ascii_alphabetic() {
        trimmed.to_string()
    } else {
        format!("s-{}", trimmed)
    };

    if result.len() > 48 {
        result.truncate(48);
        while result.ends_with('-') || result.ends_with('_') {
            result.pop();
        }
    }

    if result.is_empty() {
        None
    } else {
        Some(result)
    }
}

/// Returns true when a `terminal.run` error indicates a name validation or duplicate conflict
/// that can be safely recovered by retrying without an explicit `name`.
pub fn is_recoverable_name_error(err_text: &str) -> bool {
    let lower = err_text.to_lowercase();
    lower.contains("-32602")
        || lower.contains("starting with a letter")
        || lower.contains("invalid name")
        || lower.contains("terminal name")
        || lower.contains("already exists")
        || lower.contains("already in use")
        || lower.contains("duplicate")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_leading_dash_and_non_ascii_names() {
        assert_eq!(sanitize_herdr_name("-sh"), Some("sh".to_string()));
        assert_eq!(
            sanitize_herdr_name("한글프로젝트-main-sh"),
            Some("main-sh".to_string())
        );
        assert_eq!(
            sanitize_herdr_name("123app-feat/login-sh"),
            Some("s-123app-feat-login-sh".to_string())
        );
        assert_eq!(
            sanitize_herdr_name("My App (v2) / feat#12 - sh"),
            Some("My-App-v2-feat-12-sh".to_string())
        );
        assert_eq!(sanitize_herdr_name("한글만---"), None);
        assert_eq!(sanitize_herdr_name("   ---   "), None);
    }

    #[test]
    fn truncates_long_names_cleanly() {
        let long = format!("proj-{}", "a".repeat(80));
        let out = sanitize_herdr_name(&long).unwrap();
        assert!(out.len() <= 48);
        assert!(out.as_bytes()[0].is_ascii_alphabetic());
    }
}
