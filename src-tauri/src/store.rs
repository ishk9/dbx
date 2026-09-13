//! Persistence for saved connections.
//!
//! Two stores, split by sensitivity:
//! - **Configs** (host/port/user/db, no secrets) → a JSON file in the app config
//!   dir. Safe to read, safe to back up.
//! - **Passwords** → the OS keychain via `keyring`, keyed by connection id.
//!   Never touch disk in plaintext.
//!
//! Saved connections are why dbx doesn't make you retype everything every launch
//! (pgAdmin #3298).

use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::connection::ConnConfig;
use crate::error::{AppError, Result};

const KEYCHAIN_SERVICE: &str = "com.ishk9.dbx";
const CONFIG_FILE: &str = "connections.json";

fn config_path(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::Other(format!("no app config dir: {e}")))?;
    fs::create_dir_all(&dir).map_err(|e| AppError::Other(e.to_string()))?;
    Ok(dir.join(CONFIG_FILE))
}

/// Read all saved connection configs (empty if none saved yet).
pub fn load_configs(app: &AppHandle) -> Result<Vec<ConnConfig>> {
    let path = config_path(app)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let text = fs::read_to_string(&path).map_err(|e| AppError::Other(e.to_string()))?;
    serde_json::from_str(&text).map_err(|e| AppError::Other(format!("corrupt {CONFIG_FILE}: {e}")))
}

/// Upsert a connection config by id (does not touch the password).
pub fn save_config(app: &AppHandle, config: &ConnConfig) -> Result<()> {
    let mut configs = load_configs(app)?;
    match configs.iter_mut().find(|c| c.id == config.id) {
        Some(existing) => *existing = config.clone(),
        None => configs.push(config.clone()),
    }
    write_configs(app, &configs)
}

/// Forget a connection: drop its config and its keychain password.
pub fn delete_config(app: &AppHandle, id: &str) -> Result<()> {
    let mut configs = load_configs(app)?;
    configs.retain(|c| c.id != id);
    write_configs(app, &configs)?;
    // Best-effort: a missing keychain entry is fine.
    let _ = delete_password(id);
    Ok(())
}

fn write_configs(app: &AppHandle, configs: &[ConnConfig]) -> Result<()> {
    let path = config_path(app)?;
    let text =
        serde_json::to_string_pretty(configs).map_err(|e| AppError::Other(e.to_string()))?;
    fs::write(&path, text).map_err(|e| AppError::Other(e.to_string()))
}

// --- keychain ---

fn entry(id: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(KEYCHAIN_SERVICE, id).map_err(|e| AppError::Keychain(e.to_string()))
}

pub fn save_password(id: &str, password: &str) -> Result<()> {
    entry(id)?
        .set_password(password)
        .map_err(|e| AppError::Keychain(e.to_string()))
}

pub fn load_password(id: &str) -> Result<String> {
    entry(id)?
        .get_password()
        .map_err(|e| AppError::Keychain(e.to_string()))
}

pub fn delete_password(id: &str) -> Result<()> {
    entry(id)?
        .delete_credential()
        .map_err(|e| AppError::Keychain(e.to_string()))
}
