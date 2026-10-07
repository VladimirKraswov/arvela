//! A trusted pixel-only viewer. Its size is unrelated to Chromium's viewport.
//! No navigation/input, filesystem, credential or agent capability is added.
use serde::Deserialize;
use serde_json::Value;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "browser-monitor";
const EVENT: &str = "browser-monitor://presentation";

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Detach,
    Restore,
    Hide,
}

fn authorized(label: &str, action: Action) -> bool {
    label == "main" || (label == LABEL && !matches!(action, Action::Detach))
}

pub fn visible(app: &tauri::AppHandle) -> bool {
    app.get_webview_window(LABEL)
        .is_some_and(|window| window.is_visible().unwrap_or(false))
}

fn publish(app: &tauri::AppHandle, mode: &str) -> Result<(), String> {
    app.emit_to("main", EVENT, mode).map_err(|e| e.to_string())
}

/// Creating a webview is asynchronous to avoid the WebView2 synchronous-command
/// deadlock on Windows. Reuse one hidden viewer rather than making new browsers.
#[tauri::command]
pub async fn browser_monitor(
    app: tauri::AppHandle,
    window: tauri::Window,
    action: Action,
) -> Result<(), String> {
    if !authorized(window.label(), action) {
        return Err("Это окно не может управлять показом браузера.".into());
    }
    match action {
        Action::Detach => {
            let monitor = if let Some(existing) = app.get_webview_window(LABEL) {
                existing
            } else {
                let monitor = WebviewWindowBuilder::new(
                    &app,
                    LABEL,
                    WebviewUrl::App("index.html?view=browser-monitor".into()),
                )
                .title("Браузер · Arvela")
                .inner_size(420.0, 308.0)
                .resizable(false)
                .maximizable(false)
                .minimizable(false)
                .decorations(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .shadow(true)
                .visible(false)
                .focused(false)
                .center()
                .build()
                .map_err(|e| format!("Не удалось открыть окно наблюдения: {e}"))?;
                let handle = app.clone();
                monitor.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        if handle
                            .state::<super::BrowserRuntime>()
                            .shutting_down
                            .load(std::sync::atomic::Ordering::Acquire)
                        {
                            return;
                        }
                        // OS close/Alt+F4 means hide, never browser_stop.
                        api.prevent_close();
                        if let Some(viewer) = handle.get_webview_window(LABEL) {
                            if viewer.hide().is_ok() {
                                let _ = publish(&handle, "hidden");
                            }
                        }
                    }
                });
                monitor
            };
            monitor.show().map_err(|e| e.to_string())?;
            publish(&app, "monitor")
        }
        Action::Restore | Action::Hide => {
            let was_visible = visible(&app);
            if let Some(monitor) = app.get_webview_window(LABEL) {
                monitor.hide().map_err(|e| e.to_string())?;
            }
            if matches!(action, Action::Restore) {
                // A regular panel-open path also calls Restore. Only a visible
                // viewer emits/focuses, so this cannot loop its own UI event.
                if was_visible {
                    publish(&app, "panel")?;
                    if let Some(main) = app.get_webview_window("main") {
                        main.show().map_err(|e| e.to_string())?;
                        main.unminimize().map_err(|e| e.to_string())?;
                        main.set_focus().map_err(|e| e.to_string())?;
                    }
                }
            } else if was_visible {
                publish(&app, "hidden")?;
            }
            Ok(())
        }
    }
}

/// The viewer can read pixels, never the authenticated daemon address/key.
/// A hidden viewer stays mounted but cannot capture screenshots in the background.
#[tauri::command]
pub async fn browser_monitor_frame(window: tauri::Window) -> Result<Option<Value>, String> {
    if window.label() != LABEL {
        return Err("Наблюдение доступно только в окне браузера.".into());
    }
    if !window.is_visible().map_err(|e| e.to_string())? {
        return Ok(None);
    }
    super::blocking(move || {
        super::gateway::request(&super::root_dir()?, super::gateway::Endpoint::View, None).map(Some)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_main_can_create_the_viewer() {
        assert!(authorized("main", Action::Detach));
        assert!(!authorized(LABEL, Action::Detach));
        assert!(authorized(LABEL, Action::Restore));
        assert!(authorized(LABEL, Action::Hide));
        for action in [Action::Detach, Action::Restore, Action::Hide] {
            assert!(!authorized("untrusted", action));
        }
    }
    #[test]
    fn action_contract_rejects_browser_input_and_resize() {
        for action in ["resize", "click", "scroll", "stop", "navigate", "open"] {
            assert!(serde_json::from_value::<Action>(serde_json::json!(action)).is_err());
        }
        assert!(serde_json::from_value::<Action>(serde_json::json!("restore")).is_ok());
    }
}
