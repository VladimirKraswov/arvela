mod asr;
mod config;
mod hosts;
mod sound;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(hosts::Hosts::default())
        .invoke_handler(tauri::generate_handler![
            asr::transcribe_audio,
            hosts::ssh_aliases,
            hosts::prepare_chat_workspace,
            hosts::connect_ssh,
            config::read_opencode_config,
            config::write_opencode_config,
            sound::completion_chime
        ])
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                use tauri::Manager;
                if let Ok(mut tunnels) = app.state::<hosts::Hosts>().0.lock() {
                    tunnels.clear();
                }
            }
        });
}
