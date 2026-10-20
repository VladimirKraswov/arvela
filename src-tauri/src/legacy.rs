// Prevent an extra console window on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    enki_lib::entry::run_cli();
}
