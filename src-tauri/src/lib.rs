mod asr;
pub mod computer;
mod config;
mod hosts;
mod paths;
pub mod pi;
mod sound;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(hosts::Hosts::default())
        .manage(pi::PiSessions::default())
        .invoke_handler(tauri::generate_handler![
            asr::transcribe_audio,
            hosts::ssh_aliases,
            hosts::prepare_chat_workspace,
            hosts::connect_ssh,
            config::read_opencode_config,
            config::write_opencode_config,
            sound::completion_chime,
            computer::computer_status,
            computer::computer_set_enabled,
            computer::computer_action,
            pi::pi_detect,
            pi::pi_open,
            pi::pi_request,
            pi::pi_post,
            pi::pi_close,
            pi::pi_sessions,
            pi::pi_live_sessions,
            pi::pi_setup_lsp,
            pi::pi_probe_directory,
            pi::pi_prepare_chat_workspace
        ])
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                use tauri::Manager;
                if let Ok(mut tunnels) = app.state::<hosts::Hosts>().0.lock() {
                    tunnels.clear();
                }
                // No Pi agent may outlive the window that started it.
                pi::shutdown(app);
            }
        });
}
