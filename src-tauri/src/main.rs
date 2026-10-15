// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--workshop-prepare") {
        if let Err(e) = arvela_lib::workshop::cli() {
            eprintln!("{e}");
            std::process::exit(1);
        }
    } else if std::env::args().nth(1).as_deref() == Some("--hub-update-status") {
        if let Err(e) = arvela_lib::hub_updates::cli_status() {
            eprintln!("{e}");
            std::process::exit(1);
        }
    } else if std::env::args().nth(1).as_deref() == Some("--apply-update") {
        if let Err(e) = arvela_lib::hub_updates::install::cli() {
            eprintln!("{e}");
            std::process::exit(1);
        }
    } else if matches!(
        std::env::args().nth(1).as_deref(),
        Some("--hub-setup" | "--hub-status")
    ) {
        if let Err(error) = arvela_lib::hub::cli() {
            eprintln!("{error}");
            std::process::exit(1);
        }
    } else if std::env::args().nth(1).as_deref() == Some("--computer-mcp") {
        if let Err(error) = arvela_lib::computer::mcp_main() {
            eprintln!("{error}");
            std::process::exit(1);
        }
    } else if std::env::args().nth(1).as_deref() == Some("--agent-mcp") {
        if let Err(error) = arvela_lib::control::mcp_main() {
            eprintln!("{error}");
            std::process::exit(1);
        }
    } else if std::env::args().nth(1).as_deref() == Some("--browser-mcp") {
        if let Err(error) = arvela_lib::browser::mcp_main() {
            eprintln!("{error}");
            std::process::exit(1);
        }
    } else if std::env::args().nth(1).as_deref() == Some("--memory-mcp") {
        if let Err(error) = arvela_lib::hub::retrieval::mcp_main() {
            eprintln!("{error}");
            std::process::exit(1);
        }
    } else if std::env::args().nth(1).as_deref() == Some("--project-map-mcp") {
        if let Err(error) = arvela_lib::capabilities::project_map::mcp_main() {
            eprintln!("{error}");
            std::process::exit(1);
        }
    } else if std::env::args().nth(1).as_deref() == Some("--shared-mcp") {
        if let Err(error) = arvela_lib::capabilities::mcp_main() {
            eprintln!("{error}");
            std::process::exit(1);
        }
    } else {
        arvela_lib::run()
    }
}
