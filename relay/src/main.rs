use std::net::SocketAddr;
use std::path::PathBuf;

use jjdr_relay::config::RelayConfig;
use jjdr_relay::RelayApp;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let config_path = std::env::args()
        .skip_while(|a| a != "--config")
        .nth(1)
        .map(PathBuf::from);

    let config = match RelayConfig::load(config_path.as_deref()) {
        Ok(cfg) => cfg,
        Err(err) => {
            tracing::error!("Failed to load relay configuration: {}", err);
            std::process::exit(1);
        }
    };

    let bind_addr: SocketAddr = match config.bind_addr.parse() {
        Ok(addr) => addr,
        Err(err) => {
            tracing::error!("Invalid bind_addr '{}': {}", config.bind_addr, err);
            std::process::exit(1);
        }
    };

    let app = match RelayApp::new(config.clone()) {
        Ok(app) => app,
        Err(err) => {
            tracing::error!("Failed to initialize jjdr-relay: {}", err);
            std::process::exit(1);
        }
    };

    let ttl_handle = app.spawn_ttl_worker();
    let router = app.router();

    let listener = match tokio::net::TcpListener::bind(bind_addr).await {
        Ok(l) => l,
        Err(err) => {
            tracing::error!("Failed to bind {}: {}", bind_addr, err);
            std::process::exit(1);
        }
    };

    tracing::info!(
        "jjdr-relay v{} listening on {} (db={}, ttl={}h, rate_limit={}/min)",
        jjdr_relay::SERVER_VERSION,
        bind_addr,
        config.db_path.display(),
        config.ttl_hours,
        config.rate_limit_per_min
    );

    let server = axum::serve(listener, router).with_graceful_shutdown(async {
        let _ = tokio::signal::ctrl_c().await;
        tracing::info!("Shutdown signal received, stopping jjdr-relay...");
    });

    if let Err(err) = server.await {
        tracing::error!("Server exited with error: {}", err);
    }

    ttl_handle.abort();
}
