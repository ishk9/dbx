//! The connection lifecycle — the single owner of connect / idle / reconnect /
//! teardown for every server, for every tab.
//!
//! pgAdmin's connection bugs (dropped connections, leaks, blank grids on silent
//! disconnect, modal spam) are three symptoms of one missing thing: a component
//! that owns the connection state machine. This is that component. Auto-reconnect,
//! leak-free teardown, and silent recovery are all one concern here instead of
//! scattered per-feature bugs.
//!
//! Deliberately Tauri-free so it unit-tests without a running app. The command
//! layer wraps these methods and emits `conn://status` events; the core only
//! returns the new `ConnState`.

mod config;
mod pool;

pub use config::{ConnConfig, SslMode};

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use deadpool_postgres::{Client, Pool};
use serde::Serialize;

use crate::error::{AppError, Result};

/// Prove a config works without registering it — backs the wizard's
/// "Test connection" button. Builds a throwaway pool, round-trips, drops it.
pub async fn test_connection(config: &ConnConfig, password: &str) -> Result<()> {
    let p = pool::build_pool(config, password)?;
    let client = p.get().await?;
    client.query_one("SELECT 1", &[]).await?;
    Ok(())
}

/// The states a server connection moves through. Serialized to the frontend so
/// the inline status banner renders the same state the backend holds — no
/// guessing, no modal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", content = "detail", rename_all = "camelCase")]
pub enum ConnState {
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
    Failed(String),
}

/// One live server connection: its config + pool + current state.
struct Connection {
    config: ConnConfig,
    pool: Pool,
    state: ConnState,
}

/// Owns every live connection. Registered as Tauri managed state.
#[derive(Default)]
pub struct ConnectionManager {
    conns: Mutex<HashMap<String, Connection>>,
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Open (or replace) a connection: build the pool, prove it works with a
    /// round-trip, and record it as `Connected`. Returns the new state.
    pub async fn connect(&self, config: ConnConfig, password: &str) -> Result<ConnState> {
        let pool = pool::build_pool(&config, password)?;

        // Prove the credentials/host actually work before we call it Connected,
        // so the wizard's "Test connection" gives a truthful result.
        let client = pool.get().await?;
        client.query_one("SELECT 1", &[]).await?;
        drop(client); // back to the pool immediately

        let id = config.id.clone();
        let mut conns = self.conns.lock().unwrap();
        conns.insert(
            id,
            Connection {
                config,
                pool,
                state: ConnState::Connected,
            },
        );
        Ok(ConnState::Connected)
    }

    /// Acquire a pooled client. If the backend dropped silently, deadpool's
    /// `Verified` recycling recreates it; we retry once and reflect the state
    /// transition so the UI can show "reconnecting" instead of a blank result.
    ///
    /// The returned `Client` releases itself to the pool on drop (RAII) — this
    /// is why closing a query tool can't leak a backend connection.
    pub async fn client(&self, id: &str) -> Result<Client> {
        let pool = self.pool_for(id)?;

        match pool.get().await {
            Ok(client) => {
                self.set_state(id, ConnState::Connected);
                Ok(client)
            }
            Err(first) => {
                // One silent-reconnect attempt before surfacing the loss.
                self.set_state(id, ConnState::Reconnecting);
                tokio::time::sleep(Duration::from_millis(250)).await;
                match pool.get().await {
                    Ok(client) => {
                        self.set_state(id, ConnState::Connected);
                        Ok(client)
                    }
                    Err(_) => {
                        let msg = first.to_string();
                        self.set_state(id, ConnState::Failed(msg.clone()));
                        Err(AppError::ConnectionLost(msg))
                    }
                }
            }
        }
    }

    /// Tear down a connection: drop it from the map and close the pool, which
    /// closes every idle backend connection. Explicit teardown = no leak.
    pub fn disconnect(&self, id: &str) -> Result<()> {
        let mut conns = self.conns.lock().unwrap();
        let conn = conns
            .remove(id)
            .ok_or_else(|| AppError::UnknownConnection(id.to_string()))?;
        conn.pool.close();
        Ok(())
    }

    pub fn state(&self, id: &str) -> Option<ConnState> {
        self.conns.lock().unwrap().get(id).map(|c| c.state.clone())
    }

    pub fn config(&self, id: &str) -> Option<ConnConfig> {
        self.conns.lock().unwrap().get(id).map(|c| c.config.clone())
    }

    pub fn ids(&self) -> Vec<String> {
        self.conns.lock().unwrap().keys().cloned().collect()
    }

    // --- internals ---

    /// Clone the pool handle out from under the lock so the `await` in `client`
    /// doesn't hold the mutex across suspension points. deadpool `Pool` is a
    /// cheap `Arc` clone.
    fn pool_for(&self, id: &str) -> Result<Pool> {
        self.conns
            .lock()
            .unwrap()
            .get(id)
            .map(|c| c.pool.clone())
            .ok_or_else(|| AppError::UnknownConnection(id.to_string()))
    }

    fn set_state(&self, id: &str, state: ConnState) {
        if let Some(conn) = self.conns.lock().unwrap().get_mut(id) {
            conn.state = state;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Live self-check for the whole lifecycle. Skips silently when
    /// `DBX_TEST_PG_URL` is unset so `cargo test` passes without a database;
    /// point it at a scratch Postgres to actually exercise reconnect + leak.
    ///
    /// Expected env format: host,port,user,password,dbname
    /// e.g. `DBX_TEST_PG_URL=localhost,5432,postgres,postgres,postgres`
    #[tokio::test]
    async fn lifecycle_connect_query_teardown_no_leak() {
        let Some(spec) = std::env::var("DBX_TEST_PG_URL").ok() else {
            eprintln!("DBX_TEST_PG_URL unset — skipping live connection self-check");
            return;
        };
        let parts: Vec<&str> = spec.split(',').collect();
        assert_eq!(parts.len(), 5, "DBX_TEST_PG_URL must be host,port,user,password,dbname");

        let config = ConnConfig {
            id: "test".into(),
            name: "test".into(),
            host: parts[0].into(),
            port: parts[1].parse().unwrap(),
            user: parts[2].into(),
            dbname: parts[4].into(),
            ssl_mode: SslMode::Disable,
        };
        let password = parts[3];

        let mgr = ConnectionManager::new();

        // connect → Connected
        let state = mgr.connect(config.clone(), password).await.unwrap();
        assert_eq!(state, ConnState::Connected);

        // Count our own backends before and after teardown to prove no leak.
        let backends_query =
            "SELECT count(*)::int FROM pg_stat_activity WHERE application_name = 'dbx'";

        // Acquire a couple of clients (like opening tabs) then drop them.
        {
            let c1 = mgr.client("test").await.unwrap();
            let c2 = mgr.client("test").await.unwrap();
            let n: i32 = c1.query_one(backends_query, &[]).await.unwrap().get(0);
            assert!(n >= 1, "expected at least one dbx backend while connected");
            drop(c1);
            drop(c2);
        }

        // Teardown closes the pool → backends go away.
        mgr.disconnect("test").unwrap();
        assert!(mgr.state("test").is_none(), "connection should be gone after disconnect");

        // Fresh short-lived connection just to read the post-teardown count.
        let mgr2 = ConnectionManager::new();
        mgr2.connect(config, password).await.unwrap();
        let probe = mgr2.client("test").await.unwrap();
        // Give the closed pool's backends a moment to actually terminate.
        tokio::time::sleep(Duration::from_millis(300)).await;
        let after: i32 = probe.query_one(backends_query, &[]).await.unwrap().get(0);
        // Only mgr2's own backend(s) should remain; the torn-down pool leaked none.
        assert!(after <= 2, "torn-down pool leaked backends: {after} still open");
        mgr2.disconnect("test").unwrap();
    }
}
