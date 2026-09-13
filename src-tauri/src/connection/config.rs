//! Serializable connection config shared with the frontend.
//!
//! The password is intentionally NOT a field here — it lives in the OS keychain
//! keyed by `id`, so configs can be persisted/logged without leaking secrets.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnConfig {
    /// Stable identifier (UUID from the frontend). Keys the keychain entry and
    /// the live-connection map.
    pub id: String,
    /// Human label shown in the sidebar.
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub dbname: String,
    #[serde(default)]
    pub ssl_mode: SslMode,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SslMode {
    Disable,
    #[default]
    Prefer,
    Require,
}
