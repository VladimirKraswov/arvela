//! The window is a view of the runtime. Closing it must not stop agent work.
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
static QUIT: AtomicU8 = AtomicU8::new(0);
static MONITOR_HIDDEN: AtomicBool = AtomicBool::new(false);
static AVAILABLE: AtomicBool = AtomicBool::new(false);
pub fn show(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        if MONITOR_HIDDEN.swap(false, Ordering::AcqRel) {
            if let Some(m) = app.get_webview_window(crate::browser::monitor::LABEL) {
                let _ = m.show();
            }
        }
    }
}
pub fn close(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if AVAILABLE.load(Ordering::Acquire) {
            let _ = w.hide();
            if let Some(m) = app.get_webview_window(crate::browser::monitor::LABEL) {
                if m.is_visible().unwrap_or(false) {
                    MONITOR_HIDDEN.store(true, Ordering::Release);
                    let _ = m.hide();
                }
            }
        } else {
            let _ = w.minimize();
        } // A desktop without a tray must remain reachable.
    }
}
pub fn setup(app: &tauri::AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Открыть Enki", true, None::<&str>)?;
    let updates = MenuItem::with_id(app, "updates", "Обновления…", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Завершить Enki", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &updates, &quit_item])?;
    let mut tray = TrayIconBuilder::with_id("arvela-runtime")
        .tooltip("Enki")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show(app),
            "updates" => {
                show(app);
                let _ = app.emit_to("main", "arvela-open-updates", ());
            }
            "quit" => quit(app),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    AVAILABLE.store(true, Ordering::Release);
    Ok(())
}

fn finish(app: &tauri::AppHandle) {
    if !crate::lifecycle::request_exit(app) {
        app.exit(0);
    }
}
fn quit(app: &tauri::AppHandle) {
    if QUIT
        .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return;
    }
    let _ = app.emit_to("main", "arvela-before-quit", ());
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(5));
        if QUIT
            .compare_exchange(1, 2, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
        {
            finish(&app);
        }
    });
}
#[tauri::command]
pub fn runtime_quit_ready(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    ready: bool,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Main window only".into());
    }
    if QUIT
        .compare_exchange(
            1,
            if ready { 2 } else { 0 },
            Ordering::AcqRel,
            Ordering::Acquire,
        )
        .is_ok()
        && ready
    {
        finish(&app);
    }
    Ok(())
}
