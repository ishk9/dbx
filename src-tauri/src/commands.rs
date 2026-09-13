//! Tauri command layer — thin handlers that delegate to the connection manager
//! and the store, then emit `conn://status` so the UI's inline banner tracks the
//! real backend state. No business logic lives here (Command pattern).

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::connection::{self, ConnConfig, ConnState, ConnectionManager};
use crate::error::{AppError, Result};
use crate::store;

/// Payload for the `conn://status` event: connection id + flattened state.
#[derive(Serialize, Clone)]
struct StatusEvent<'a> {
    id: &'a str,
    #[serde(flatten)]
    state: &'a ConnState,
}

fn emit_status(app: &AppHandle, id: &str, state: &ConnState) {
    if let Err(e) = app.emit("conn://status", StatusEvent { id, state }) {
        // A dropped status event leaves the UI banner stale — which is exactly
        // the silent-failure mode we're trying to avoid. Surface it rather than
        // swallowing it.
        eprintln!("dbx: failed to emit conn://status for {id}: {e}");
    }
}

/// Dry-run a config (no persistence, no registration). Powers "Test connection".
#[tauri::command]
pub async fn test_connection(config: ConnConfig, password: String) -> Result<()> {
    connection::test_connection(&config, &password).await
}

/// Open a connection. When `save` is set, persist the config (config dir) and
/// password (keychain) so it survives restarts.
#[tauri::command]
pub async fn connect(
    app: AppHandle,
    mgr: State<'_, ConnectionManager>,
    config: ConnConfig,
    password: String,
    save: bool,
) -> Result<ConnState> {
    let state = mgr.connect(config.clone(), &password).await?;
    if save {
        // Password to the keychain first; only persist the config once the secret
        // is safely stored, so we never leave a saved config whose password
        // `connect_saved` can't find.
        store::save_password(&config.id, &password)?;
        store::save_config(&app, &config)?;
    }
    emit_status(&app, &config.id, &state);
    Ok(state)
}

/// Reconnect a previously-saved connection using its keychain password —
/// one click on launch, no retyping.
#[tauri::command]
pub async fn connect_saved(
    app: AppHandle,
    mgr: State<'_, ConnectionManager>,
    id: String,
) -> Result<ConnState> {
    let config = store::load_configs(&app)?
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| AppError::UnknownConnection(id.clone()))?;
    let password = store::load_password(&id)?;
    let state = mgr.connect(config, &password).await?;
    emit_status(&app, &id, &state);
    Ok(state)
}

#[tauri::command]
pub fn disconnect(
    app: AppHandle,
    mgr: State<'_, ConnectionManager>,
    id: String,
) -> Result<()> {
    mgr.disconnect(&id)?;
    emit_status(&app, &id, &ConnState::Disconnected);
    Ok(())
}

/// Saved connections for the sidebar.
#[tauri::command]
pub fn list_connections(app: AppHandle) -> Result<Vec<ConnConfig>> {
    store::load_configs(&app)
}

/// Forget a saved connection (config + keychain password) and drop it if live.
#[tauri::command]
pub fn delete_connection(
    app: AppHandle,
    mgr: State<'_, ConnectionManager>,
    id: String,
) -> Result<()> {
    let _ = mgr.disconnect(&id); // ignore if not currently live
    store::delete_config(&app, &id)
}

#[tauri::command]
pub fn connection_state(mgr: State<'_, ConnectionManager>, id: String) -> Option<ConnState> {
    mgr.state(&id)
}
