mod connection;
mod error;

use connection::ConnectionManager;

// ponytail: `greet` stays until Phase 3 wires the real connect commands and the
// frontend stops calling it. Removing it now would just break App.tsx for a turn.
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // The one owner of every connection's lifecycle, shared across commands.
        .manage(ConnectionManager::new())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
