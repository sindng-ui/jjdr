use std::path::{Path, PathBuf};

use serde::Deserialize;

#[derive(Debug, Clone)]
pub struct RelayConfig {
    pub bind_addr: String,
    pub db_path: PathBuf,
    pub team_key: String,
    pub ttl_hours: u64,
    pub ttl_sweep_interval_secs: u64,
    pub rate_limit_per_min: u32,
    pub max_reviewers_per_request: usize,
    pub ws_ping_interval_secs: u64,
    pub ws_pong_timeout_secs: u64,
}

#[derive(Debug, Default, Deserialize)]
struct FileConfig {
    bind_addr: Option<String>,
    db_path: Option<String>,
    team_key: Option<String>,
    ttl_hours: Option<u64>,
    ttl_sweep_interval_secs: Option<u64>,
    rate_limit_per_min: Option<u32>,
    max_reviewers_per_request: Option<usize>,
    ws_ping_interval_secs: Option<u64>,
    ws_pong_timeout_secs: Option<u64>,
}

impl Default for RelayConfig {
    fn default() -> Self {
        Self {
            bind_addr: "0.0.0.0:8787".to_string(),
            db_path: PathBuf::from("jjdr-relay.db"),
            team_key: String::new(),
            ttl_hours: 48,
            ttl_sweep_interval_secs: 300,
            rate_limit_per_min: 30,
            max_reviewers_per_request: 5,
            ws_ping_interval_secs: 30,
            ws_pong_timeout_secs: 60,
        }
    }
}

impl RelayConfig {
    /// Load configuration from optional TOML file (or `./jjdr-relay.toml` if present)
    /// overlaid by `JJDR_RELAY_*` environment variables.
    pub fn load(explicit_path: Option<&Path>) -> Result<Self, String> {
        let mut cfg = Self::default();

        let candidate_path = explicit_path
            .map(PathBuf::from)
            .or_else(|| {
                let p = PathBuf::from("jjdr-relay.toml");
                if p.exists() {
                    Some(p)
                } else {
                    None
                }
            });

        if let Some(path) = candidate_path {
            let raw = std::fs::read_to_string(&path)
                .map_err(|e| format!("failed to read {}: {}", path.display(), e))?;
            let parsed: FileConfig = toml::from_str(&raw)
                .map_err(|e| format!("invalid TOML in {}: {}", path.display(), e))?;
            if let Some(v) = parsed.bind_addr {
                cfg.bind_addr = v;
            }
            if let Some(v) = parsed.db_path {
                cfg.db_path = PathBuf::from(v);
            }
            if let Some(v) = parsed.team_key {
                cfg.team_key = v;
            }
            if let Some(v) = parsed.ttl_hours {
                cfg.ttl_hours = v;
            }
            if let Some(v) = parsed.ttl_sweep_interval_secs {
                cfg.ttl_sweep_interval_secs = v;
            }
            if let Some(v) = parsed.rate_limit_per_min {
                cfg.rate_limit_per_min = v;
            }
            if let Some(v) = parsed.max_reviewers_per_request {
                cfg.max_reviewers_per_request = v;
            }
            if let Some(v) = parsed.ws_ping_interval_secs {
                cfg.ws_ping_interval_secs = v;
            }
            if let Some(v) = parsed.ws_pong_timeout_secs {
                cfg.ws_pong_timeout_secs = v;
            }
        }

        if let Ok(v) = std::env::var("JJDR_RELAY_BIND") {
            if !v.trim().is_empty() {
                cfg.bind_addr = v.trim().to_string();
            }
        }
        if let Ok(v) = std::env::var("JJDR_RELAY_DB") {
            if !v.trim().is_empty() {
                cfg.db_path = PathBuf::from(v.trim());
            }
        }
        if let Ok(v) = std::env::var("JJDR_RELAY_TEAM_KEY") {
            if !v.trim().is_empty() {
                cfg.team_key = v.trim().to_string();
            }
        }
        if let Ok(v) = std::env::var("JJDR_RELAY_TTL_HOURS") {
            if let Ok(parsed) = v.trim().parse::<u64>() {
                cfg.ttl_hours = parsed;
            }
        }
        if let Ok(v) = std::env::var("JJDR_RELAY_RATE_LIMIT") {
            if let Ok(parsed) = v.trim().parse::<u32>() {
                cfg.rate_limit_per_min = parsed;
            }
        }

        if cfg.team_key.trim().is_empty() {
            return Err(
                "team_key is required. Set JJDR_RELAY_TEAM_KEY or team_key in jjdr-relay.toml."
                    .to_string(),
            );
        }
        if cfg.ttl_hours == 0 {
            return Err("ttl_hours must be >= 1".to_string());
        }
        if cfg.max_reviewers_per_request == 0 || cfg.max_reviewers_per_request > 20 {
            return Err("max_reviewers_per_request must be between 1 and 20".to_string());
        }

        Ok(cfg)
    }

    pub fn ttl_ms(&self) -> i64 {
        (self.ttl_hours as i64).saturating_mul(3_600_000)
    }
}
