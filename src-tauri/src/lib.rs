mod asr;
mod attachments;
pub mod browser;
pub mod capabilities;
pub mod computer;
mod config;
pub mod control;
mod hosts;
pub mod hub;
mod journal;
mod lifecycle;
mod local_server;
mod model_credentials;
mod paths;
pub mod pi;
mod process;
mod sound;
mod storage_info;
mod updates;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(hosts::Hosts::default())
        .manage(pi::PiSessions::default())
        .manage(lifecycle::Lifecycle::default())
        .manage(updates::Updates::default())
        .manage(capabilities::SharedRuntime::default())
        .manage(browser::BrowserRuntime::default())
        .manage(control::AgentControl::default())
        .setup(|app| {
            // Agent Control is optional. A socket that cannot be created (for
            // example a data path beyond the OS socket-name limit) must not stop
            // Desktop from starting; its status then reports it as unavailable.
            if let Err(error) = control::start(app.handle().clone()) {
                eprintln!("Agent Control is unavailable: {error}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            asr::transcribe_audio,
            journal::operation_journal,
            lifecycle::own_work,
            lifecycle::quit_report,
            updates::app_update,
            attachments::stage_archive,
            attachments::archive_access,
            hub::hub_config,
            hub::hub_request,
            hub::retrieval::memory_retrieval,
            hub::hub_package,
            hub::hub_spool,
            model_credentials::model_service_key,
            browser::browser_status,
            browser::browser_install,
            browser::browser_start,
            browser::browser_open,
            browser::browser_view,
            browser::browser_presence,
            browser::browser_session,
            browser::browser_input,
            browser::monitor::browser_monitor,
            browser::monitor::browser_monitor_frame,
            browser::browser_stop,
            browser::browser_pi_support,
            hosts::ssh_aliases,
            hosts::prepare_chat_workspace,
            hosts::connect_ssh,
            local_server::ensure_local_opencode,
            local_server::detect_local_opencode,
            config::read_opencode_config,
            config::write_opencode_config,
            capabilities::shared_catalog,
            capabilities::quality::skill_quality,
            capabilities::project_map::project_map_preview,
            capabilities::shared_save,
            capabilities::shared_install,
            capabilities::shared_probe,
            capabilities::shared_mcp_key,
            sound::completion_chime,
            computer::computer_status,
            computer::computer_set_enabled,
            computer::computer_action,
            control::agent_control_ready,
            control::agent_control_complete,
            control::agent_control_status,
            pi::pi_detect,
            pi::pi_open,
            pi::pi_request,
            pi::pi_post,
            pi::pi_close,
            pi::pi_sessions,
            storage_info::session_storage,
            pi::pi_live_sessions,
            pi::pi_resume_sessions,
            pi::pi_shared_inventory,
            pi::pi_setup_lsp,
            pi::pi_probe_directory,
            pi::pi_prepare_chat_workspace
        ])
        .plugin(
            tauri_plugin_updater::Builder::new()
                .pubkey(include_str!("../updater.pub").trim())
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } = &event
            {
                if label == "main" && lifecycle::request_exit(app) {
                    api.prevent_close();
                }
            }
            if let tauri::RunEvent::ExitRequested { api, code, .. } = &event {
                if *code != Some(tauri::RESTART_EXIT_CODE) && lifecycle::request_exit(app) {
                    api.prevent_exit();
                }
            }
            if let tauri::RunEvent::Exit = event {
                use tauri::Manager;
                if let Ok(mut tunnels) = app.state::<hosts::Hosts>().0.lock() {
                    tunnels.clear();
                }
                // No Pi agent may outlive the window that started it.
                capabilities::shutdown(app.state::<capabilities::SharedRuntime>().inner());
                pi::shutdown(app);
                browser::shutdown(app);
                control::shutdown(app);
            }
        });
}
