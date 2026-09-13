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

/// One reconnect attempt waits this long before retrying a dropped pool.
/// ponytail: single retry, no backoff; add exponential backoff + jitter if
/// users report flaky links.
const RECONNECT_DELAY: Duration = Duration::from_millis(250);

/// Prove a freshly-built pool works: acquire a client and round-trip. Shared by
/// `test_connection` and `connect` so the liveness check lives in one place.
async fn prove_pool(pool: &Pool) -> Result<()> {
    let client = pool.get().await?;
    client.query_one("SELECT 1", &[]).await?;
    Ok(())
}

/// Prove a config works without registering it — backs the wizard's
/// "Test connection" button. Builds a throwaway pool, round-trips, drops it.
pub async fn test_connection(config: &ConnConfig, password: &str) -> Result<()> {
    let pool = pool::build_pool(config, password)?;
    prove_pool(&pool).await
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
        // so the wizard gives a truthful result.
        prove_pool(&pool).await?;

        let id = config.id.clone();
        let mut conns = self.conns.lock().unwrap();
        // Replacing a live connection (reconnect, or concurrent connect for the
        // same id)? Close the pool we just evicted — a deadpool `Pool` is an Arc,
        // so dropping the map entry alone would leave its idle backends open.
        // This is exactly the leak class this module exists to prevent.
        if let Some(old) = conns.insert(
            id,
            Connection {
                config,
                pool,
                state: ConnState::Connected,
            },
        ) {
            old.pool.close();
        }
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
                tokio::time::sleep(RECONNECT_DELAY).await;
                match pool.get().await {
                    Ok(client) => {
                        self.set_state(id, ConnState::Connected);
                        Ok(client)
                    }
                    Err(_) if pool.is_closed() => {
                        // `disconnect` raced this call and tore the pool down on
                        // purpose — that's not a lost connection, so don't flip
                        // the UI to a scary "connection failed".
                        Err(AppError::UnknownConnection(id.to_string()))
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

        let host = parts[0];
        let port: u16 = parts[1].parse().unwrap();
        let user = parts[2];
        let password = parts[3];
        let dbname = parts[4];

        // The connection under test uses name "test" → application_name "dbx test".
        let config = ConnConfig {
            id: "test".into(),
            name: "test".into(),
            host: host.into(),
            port,
            user: user.into(),
            dbname: dbname.into(),
            ssl_mode: SslMode::Disable,
        };

        let mgr = ConnectionManager::new();

        // connect → Connected
        let state = mgr.connect(config.clone(), password).await.unwrap();
        assert_eq!(state, ConnState::Connected);

        // Count backends belonging *specifically* to this connection. Using its
        // unique application_name (not the shared "dbx" prefix) is what makes the
        // leak assertion rigorous — a separate probe connection can't inflate it.
        let under_test =
            "SELECT count(*)::int FROM pg_stat_activity WHERE application_name = 'dbx test'";

        // Acquire a couple of clients (like opening tabs) then drop them.
        {
            let c1 = mgr.client("test").await.unwrap();
            let c2 = mgr.client("test").await.unwrap();
            let n: i32 = c1.query_one(under_test, &[]).await.unwrap().get(0);
            assert!(n >= 1, "expected at least one 'dbx test' backend while connected");
            drop(c1);
            drop(c2);
        }

        // Teardown closes the pool → its backends must go away.
        mgr.disconnect("test").unwrap();
        assert!(mgr.state("test").is_none(), "connection should be gone after disconnect");

        // A *separate* connection (application_name "dbx probe") reads the count —
        // its own backends are excluded by the WHERE clause, so any non-zero result
        // is a genuine leak from the torn-down pool.
        let probe_config = ConnConfig {
            id: "probe".into(),
            name: "probe".into(),
            ..config
        };
        let mgr2 = ConnectionManager::new();
        mgr2.connect(probe_config, password).await.unwrap();
        let probe = mgr2.client("probe").await.unwrap();
        // Give the closed pool's backends a moment to actually terminate server-side.
        tokio::time::sleep(Duration::from_millis(500)).await;
        let leaked: i32 = probe.query_one(under_test, &[]).await.unwrap().get(0);
        assert_eq!(leaked, 0, "torn-down pool leaked {leaked} backend(s)");
        mgr2.disconnect("probe").unwrap();
    }
}
