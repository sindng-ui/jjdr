use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};

use relay_protocol::ServerMessage;
use tokio::sync::{mpsc, RwLock};

static NEXT_CONN_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
struct ConnectionEntry {
    conn_id: u64,
    device_id: String,
    tx: mpsc::UnboundedSender<ServerMessage>,
}

/// In-memory WebSocket connection registry.
/// - Supports multiple concurrent sockets per user (seamless reconnect overlap or multi-PC).
/// - Routes `ReviewAssigned` exclusively to the latest primary socket (`send_to_primary_device`)
///   so two PCs running under the same GitHub ID never duplicate-execute an auto-review.
pub struct RelayHub {
    connections: RwLock<HashMap<String, Vec<ConnectionEntry>>>,
}

impl Default for RelayHub {
    fn default() -> Self {
        Self::new()
    }
}

impl RelayHub {
    pub fn new() -> Self {
        Self {
            connections: RwLock::new(HashMap::new()),
        }
    }

    /// Register a live WebSocket sender for `(github_id, device_id)` and return its connection ID.
    pub async fn register(
        &self,
        github_id: &str,
        device_id: &str,
        tx: mpsc::UnboundedSender<ServerMessage>,
    ) -> u64 {
        let conn_id = NEXT_CONN_ID.fetch_add(1, Ordering::Relaxed);
        let mut map = self.connections.write().await;
        map.entry(github_id.to_string())
            .or_default()
            .push(ConnectionEntry {
                conn_id,
                device_id: device_id.to_string(),
                tx,
            });
        conn_id
    }

    /// Unregister a specific socket. Returns `true` if the user now has zero active sockets.
    pub async fn unregister(&self, github_id: &str, conn_id: u64) -> bool {
        let mut map = self.connections.write().await;
        if let Some(entries) = map.get_mut(github_id) {
            entries.retain(|e| e.conn_id != conn_id);
            if entries.is_empty() {
                map.remove(github_id);
                return true;
            }
            return false;
        }
        true
    }

    pub async fn online_user_ids(&self) -> HashSet<String> {
        let map = self.connections.read().await;
        map.keys().cloned().collect()
    }

    pub async fn online_count(&self) -> usize {
        let map = self.connections.read().await;
        map.len()
    }

    /// Send a work assignment exclusively to the single most-recently-active primary socket.
    /// Returns `Some(device_id)` when delivered to a live channel, or `None` if user is offline.
    pub async fn send_to_primary_device(
        &self,
        github_id: &str,
        msg: ServerMessage,
    ) -> Option<String> {
        let candidates: Vec<(String, mpsc::UnboundedSender<ServerMessage>)> = {
            let map = self.connections.read().await;
            map.get(github_id)
                .map(|entries| {
                    entries
                        .iter()
                        .rev()
                        .map(|e| (e.device_id.clone(), e.tx.clone()))
                        .collect()
                })
                .unwrap_or_default()
        };

        for (device_id, tx) in candidates {
            if tx.send(msg.clone()).is_ok() {
                return Some(device_id);
            }
        }
        None
    }

    /// Send a notification (status/cancel) to all live sockets of a user.
    pub async fn send_to_user(&self, github_id: &str, msg: ServerMessage) -> bool {
        let senders: Vec<mpsc::UnboundedSender<ServerMessage>> = {
            let map = self.connections.read().await;
            map.get(github_id)
                .map(|entries| entries.iter().map(|e| e.tx.clone()).collect())
                .unwrap_or_default()
        };

        let mut delivered = false;
        for tx in senders {
            if tx.send(msg.clone()).is_ok() {
                delivered = true;
            }
        }
        delivered
    }

    /// Broadcast a message to every connected user across the hub.
    pub async fn broadcast(&self, msg: ServerMessage) {
        let senders: Vec<mpsc::UnboundedSender<ServerMessage>> = {
            let map = self.connections.read().await;
            map.values()
                .flat_map(|entries| entries.iter().map(|e| e.tx.clone()))
                .collect()
        };
        for tx in senders {
            let _ = tx.send(msg.clone());
        }
    }
}
