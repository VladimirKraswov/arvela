// The shell intentionally has no custom Rust commands: all OpenCode traffic
// goes through typed fetch calls to the loopback API (see src/api/client.ts),
// and native dialogs/streaming come from the dialog + opener plugins.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
