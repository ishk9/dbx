//! Builds a deadpool pool from a saved connection config.
//!
//! `RecyclingMethod::Verified` is deliberate: it pings a pooled connection
//! before handing it out, so a silently-dropped backend is detected and
//! recreated instead of returning a dead client. This is the mechanism behind
//! our "never a blank grid, auto-reconnect" thesis — we lean on deadpool's
//! recycling rather than hand-rolling reconnect logic.

use deadpool_postgres::{Manager, ManagerConfig, Pool, RecyclingMethod};
use tokio_postgres::NoTls;

use super::config::ConnConfig;
use crate::error::Result;

/// Idle connections we keep per server. Small on purpose: a desktop client with
/// a handful of tabs doesn't need many, and a low cap makes the leak class
/// impossible to hit.
/// ponytail: fixed cap; expose in Preferences if power users need more tabs.
const MAX_POOL_SIZE: usize = 8;

pub fn build_pool(config: &ConnConfig, password: &str) -> Result<Pool> {
    let mut pg = tokio_postgres::Config::new();
    pg.host(&config.host)
        .port(config.port)
        .user(&config.user)
        .dbname(&config.dbname)
        .password(password)
        .application_name("dbx");

    let mgr_config = ManagerConfig {
        recycling_method: RecyclingMethod::Verified,
    };

    // ponytail: NoTls covers localhost (the Phase-2/3 target). TLS for managed
    // Postgres (Supabase/Neon/RDS) lands as tls.rs and swaps the connector here;
    // deadpool erases the TLS type so `Pool`'s signature does not change.
    let mgr = Manager::from_config(pg, NoTls, mgr_config);
    let pool = Pool::builder(mgr).max_size(MAX_POOL_SIZE).build()?;
    Ok(pool)
}
