pub mod auth;
pub mod config;
pub mod db;
pub mod hub;
pub mod routes;
pub mod service;

use std::sync::Arc;
use std::time::Instant;

use axum::Router;
use config::RelayConfig;
use db::RelayDb;
use hub::RelayHub;
use service::RelayService;

pub const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Shared server state injected into Axum routes and background workers.
pub struct RelayApp {
    pub config: RelayConfig,
    pub service: Arc<RelayService>,
    pub started_at: Instant,
}

impl RelayApp {
    pub fn new(config: RelayConfig) -> Result<Arc<Self>, String> {
        let db = RelayDb::open(&config.db_path)?;
        let hub = RelayHub::new();
        let service = Arc::new(RelayService::new(config.clone(), db, hub));
        Ok(Arc::new(Self {
            config,
            service,
            started_at: Instant::now(),
        }))
    }

    /// Spawn background TTL expiration loop (returns JoinHandle so tests/shutdown can abort cleanly).
    pub fn spawn_ttl_worker(self: &Arc<Self>) -> tokio::task::JoinHandle<()> {
        let service = Arc::clone(&self.service);
        let interval_secs = self.config.ttl_sweep_interval_secs.max(1);
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(std::time::Duration::from_secs(interval_secs));
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                ticker.tick().await;
                if let Err(err) = service.sweep_expired_assignments().await {
                    tracing::warn!("TTL sweep failed: {}", err);
                }
            }
        })
    }

    pub fn router(self: &Arc<Self>) -> Router {
        routes::build_router(Arc::clone(self))
    }
}
