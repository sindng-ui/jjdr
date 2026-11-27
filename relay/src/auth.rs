use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Constant-time comparison for TEAM_KEY authentication to avoid timing side-channels.
pub fn verify_team_key(expected: &str, provided: Option<&str>) -> bool {
    let Some(candidate) = provided else {
        return false;
    };
    let a = expected.as_bytes();
    let b = candidate.as_bytes();
    if a.is_empty() || a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (&x, &y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Sliding-window per-key rate limiter for spam protection.
pub struct SlidingWindowLimiter {
    max_requests: u32,
    window: Duration,
    buckets: Mutex<HashMap<String, VecDeque<Instant>>>,
}

impl SlidingWindowLimiter {
    pub fn new(max_requests: u32, window: Duration) -> Self {
        Self {
            max_requests,
            window,
            buckets: Mutex::new(HashMap::new()),
        }
    }

    /// Returns Ok(()) if within limit, or Err(retry_after_secs) if exceeded.
    pub fn check_and_record(&self, key: &str) -> Result<(), u64> {
        if self.max_requests == 0 {
            return Ok(());
        }
        let now = Instant::now();
        let mut map = self
            .buckets
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        // Opportunistic prune when map grows large to keep memory bounded.
        if map.len() > 2048 {
            map.retain(|_, q| {
                while let Some(&front) = q.front() {
                    if now.duration_since(front) >= self.window {
                        q.pop_front();
                    } else {
                        break;
                    }
                }
                !q.is_empty()
            });
        }

        let queue = map.entry(key.to_string()).or_default();
        while let Some(&front) = queue.front() {
            if now.duration_since(front) >= self.window {
                queue.pop_front();
            } else {
                break;
            }
        }

        if queue.len() >= self.max_requests as usize {
            let retry_after = queue
                .front()
                .map(|&oldest| {
                    self.window
                        .saturating_sub(now.duration_since(oldest))
                        .as_secs()
                        .max(1)
                })
                .unwrap_or(1);
            return Err(retry_after);
        }

        queue.push_back(now);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verifies_team_key_strictly() {
        assert!(verify_team_key("secret-123", Some("secret-123")));
        assert!(!verify_team_key("secret-123", Some("secret-124")));
        assert!(!verify_team_key("secret-123", Some("secret-12")));
        assert!(!verify_team_key("secret-123", Some("SECRET-123")));
        assert!(!verify_team_key("secret-123", Some("")));
        assert!(!verify_team_key("secret-123", None));
        assert!(!verify_team_key("", Some("")));
    }

    #[test]
    fn rate_limiter_blocks_and_recovers() {
        let limiter = SlidingWindowLimiter::new(2, Duration::from_millis(80));
        assert!(limiter.check_and_record("alice").is_ok());
        assert!(limiter.check_and_record("alice").is_ok());
        assert!(limiter.check_and_record("alice").is_err());
        // Different key unaffected
        assert!(limiter.check_and_record("bob").is_ok());
        std::thread::sleep(Duration::from_millis(100));
        assert!(limiter.check_and_record("alice").is_ok());
    }
}
