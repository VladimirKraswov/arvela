// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if matches!(
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
    } else if std::env::args().nth(1).as_deref() == Some("--shared-mcp") {
        if let Err(error) = arvela_lib::capabilities::mcp_main() {
            eprintln!("{error}");
            std::process::exit(1);
        }
    } else {
        arvela_lib::run()
    }
}
