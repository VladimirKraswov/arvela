// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--computer-mcp") {
        if let Err(error) = opencode_desktop_lib::computer::mcp_main() {
            eprintln!("{error}");
            std::process::exit(1);
        }
    } else if std::env::args().nth(1).as_deref() == Some("--agent-mcp") {
        if let Err(error) = opencode_desktop_lib::control::mcp_main() {
            eprintln!("{error}");
            std::process::exit(1);
        }
    } else if std::env::args().nth(1).as_deref() == Some("--browser-mcp") {
        if let Err(error) = opencode_desktop_lib::browser::mcp_main() {
            eprintln!("{error}");
            std::process::exit(1);
        }
    } else if std::env::args().nth(1).as_deref() == Some("--shared-mcp") {
        if let Err(error) = opencode_desktop_lib::capabilities::mcp_main() {
            eprintln!("{error}");
            std::process::exit(1);
        }
    } else {
        opencode_desktop_lib::run()
    }
}
