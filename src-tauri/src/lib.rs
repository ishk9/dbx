mod commands;
mod connection;
mod error;
mod store;

use connection::ConnectionManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // The one owner of every connection's lifecycle, shared across commands.
        .manage(ConnectionManager::new())
        .invoke_handler(tauri::generate_handler![
            commands::test_connection,
            commands::connect,
            commands::connect_saved,
            commands::disconnect,
            commands::list_connections,
            commands::delete_connection,
            commands::connection_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
