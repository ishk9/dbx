//! Builds a deadpool pool from a saved connection config.
//!
//! `RecyclingMethod::Verified` is deliberate: it pings a pooled connection
//! before handing it out, so a silently-dropped backend is detected and
//! recreated instead of returning a dead client. This is the mechanism behind
//! our "never a blank grid, auto-reconnect" thesis — we lean on deadpool's
//! recycling rather than hand-rolling reconnect logic.

use std::time::Duration;

use deadpool_postgres::{Manager, ManagerConfig, Pool, RecyclingMethod, Runtime, Timeouts};
use tokio_postgres::NoTls;

use super::config::{ConnConfig, SslMode};
use crate::error::{AppError, Result};

/// Idle connections we keep per server. Small on purpose: a desktop client with
/// a handful of tabs doesn't need many, and a low cap makes the leak class
/// impossible to hit.
/// ponytail: fixed cap; expose in Preferences if power users need more tabs.
const MAX_POOL_SIZE: usize = 8;

/// Cap every connection phase so a black-holing host can't hang a command
/// forever. `connect_timeout` bounds the TCP+auth handshake; the deadpool
/// timeouts bound pool acquisition, creation, and the Verified recycle-ping.
/// ponytail: fixed timeouts; surface in Preferences if users hit slow links.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const WAIT_TIMEOUT: Duration = Duration::from_secs(30);
const CREATE_TIMEOUT: Duration = Duration::from_secs(10);
const RECYCLE_TIMEOUT: Duration = Duration::from_secs(5);

pub fn build_pool(config: &ConnConfig, password: &str) -> Result<Pool> {
    // Honor an explicit `Require`: TLS isn't wired yet (NoTls below), so rather
    // than connect in cleartext while the user believes the link is encrypted —
    // a downgrade they never consented to — refuse loudly. `Prefer`/`Disable`
    // both permit plaintext by definition, so NoTls is correct for them.
    // ponytail: remove this guard once tls.rs provides a MakeTlsConnect connector.
    if matches!(config.ssl_mode, SslMode::Require) {
        return Err(AppError::Other(
            "SSL 'Require' isn't supported yet — the connection would be unencrypted, so it was \
             refused. Use SSL 'Prefer' or 'Disable', or connect over localhost. TLS is coming."
                .into(),
        ));
    }

    let mut pg = tokio_postgres::Config::new();
    pg.host(&config.host)
        .port(config.port)
        .user(&config.user)
        .dbname(&config.dbname)
        .password(password)
        .connect_timeout(CONNECT_TIMEOUT)
        // Tag each backend so it's identifiable in pg_stat_activity — helps DBAs
        // and lets the leak self-check target one connection's backends exactly.
        .application_name(&format!("dbx {}", display_name(config)));

    let mgr_config = ManagerConfig {
        recycling_method: RecyclingMethod::Verified,
    };

    // ponytail: NoTls covers localhost + Prefer/Disable. Real TLS for managed
    // Postgres (Supabase/Neon/RDS) lands as tls.rs and swaps the connector here;
    // deadpool erases the TLS type so `Pool`'s signature does not change.
    let mgr = Manager::from_config(pg, NoTls, mgr_config);
    let pool = Pool::builder(mgr)
        .max_size(MAX_POOL_SIZE)
        // A runtime is required for create/recycle timeouts to fire.
        .runtime(Runtime::Tokio1)
        .timeouts(Timeouts {
            wait: Some(WAIT_TIMEOUT),
            create: Some(CREATE_TIMEOUT),
            recycle: Some(RECYCLE_TIMEOUT),
        })
        .build()?;
    Ok(pool)
}

fn display_name(config: &ConnConfig) -> &str {
    if config.name.is_empty() {
        &config.dbname
    } else {
        &config.name
    }
}
