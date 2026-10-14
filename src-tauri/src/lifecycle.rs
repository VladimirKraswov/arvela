//! Own task cancellation on Quit, independent of WebView health. The external
//! OpenCode server is never terminated; only an exactly owned latest user turn
//! is eligible for the public abort endpoint.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::Manager;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OwnedWork {
    endpoint: String,
    directory: String,
    session_id: String,
    message_id: String,
    #[serde(default, skip_serializing)]
    authorization: Option<String>,
}
#[derive(Default)]
pub struct Lifecycle {
    work: Mutex<HashMap<String, OwnedWork>>,
    closing: AtomicBool,
    finished: AtomicBool,
}
impl Lifecycle {
    pub fn owned(&self) -> Result<Vec<OwnedWork>, String> {
        Ok(self
            .work
            .lock()
            .map_err(|e| e.to_string())?
            .values()
            .cloned()
            .collect())
    }
}
pub fn check_idle(work: &[OwnedWork]) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(3))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let mut checked = std::collections::HashMap::new();
    for w in work {
        let key = format!("{}\0{}", w.endpoint, w.directory);
        if !checked.contains_key(&key) {
            if checked.len() >= 32 {
                return Err("Проверьте незавершённые подключения перед установкой".into());
            }
            let status: Value = request(&client, w, "/session/status")
                .send()
                .and_then(|r| r.error_for_status())
                .and_then(|r| r.json())
                .map_err(|e| e.to_string())?;
            checked.insert(key.clone(), status);
        }
        if checked[&key][&w.session_id]["type"]
            .as_str()
            .is_some_and(|s| s != "idle")
        {
            return Err("OpenCode ещё работает. Установка отложена.".into());
        }
    }
    Ok(())
}
fn validate(work: &OwnedWork) -> Result<(), String> {
    let url = url::Url::parse(&work.endpoint).map_err(|_| "Invalid engine address")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || work.directory.len() > 8192
        || work.session_id.is_empty()
        || work.session_id.len() > 200
        || !work
            .session_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
        || !work.message_id.starts_with("msg_")
        || work.message_id.len() > 100
        || work
            .authorization
            .as_ref()
            .is_some_and(|s| s.len() > 8192 || s.contains(['\r', '\n']))
    {
        return Err("Invalid owned task".into());
    }
    Ok(())
}
#[tauri::command]
pub fn own_work(
    window: tauri::Window,
    state: tauri::State<'_, Lifecycle>,
    work: OwnedWork,
) -> Result<(), String> {
    if window.label() != "main" || state.closing.load(Ordering::Acquire) {
        return Err("Приложение закрывается. Запрос не отправлен.".into());
    }
    crate::updates::ensure_writable()?;
    validate(&work)?;
    let key = format!("{}\0{}", work.endpoint, work.session_id);
    let mut map = state.work.lock().map_err(|e| e.to_string())?;
    if map.len() >= 1024 && !map.contains_key(&key) {
        return Err(
            "Слишком много активных задач. Перезапустите приложение после завершения работы."
                .into(),
        );
    }
    map.insert(key, work);
    Ok(())
}
fn request(
    client: &reqwest::blocking::Client,
    work: &OwnedWork,
    path: &str,
) -> reqwest::blocking::RequestBuilder {
    let mut req = client
        .get(format!("{}{}", work.endpoint.trim_end_matches('/'), path))
        .query(&[("directory", &work.directory)]);
    if let Some(auth) = &work.authorization {
        req = req.header("Authorization", auth);
    }
    req
}
fn stop_owned(work: &OwnedWork) -> Result<bool, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let statuses: Value = request(&client, work, "/session/status")
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.json())
        .map_err(|e| e.to_string())?;
    if !matches!(
        statuses[&work.session_id]["type"].as_str(),
        Some("busy" | "retry" | "waiting")
    ) {
        return Ok(false);
    }
    let messages: Vec<Value> = request(
        &client,
        work,
        &format!("/session/{}/message", work.session_id),
    )
    .query(&[("limit", 200)])
    .send()
    .and_then(|r| r.error_for_status())
    .and_then(|r| r.json())
    .map_err(|e| e.to_string())?;
    let latest = messages
        .iter()
        .filter(|m| m["info"]["role"] == "user")
        .max_by_key(|m| m["info"]["id"].as_str().unwrap_or(""));
    if latest.and_then(|m| m["info"]["id"].as_str()) != Some(work.message_id.as_str()) {
        return Ok(false);
    }
    let mut req = client
        .post(format!(
            "{}/session/{}/abort",
            work.endpoint.trim_end_matches('/'),
            work.session_id
        ))
        .query(&[("directory", &work.directory)]);
    if let Some(auth) = &work.authorization {
        req = req.header("Authorization", auth);
    }
    req.send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?;
    Ok(true)
}
pub fn request_exit(app: &tauri::AppHandle) -> bool {
    let state = app.state::<Lifecycle>();
    if state.finished.load(Ordering::Acquire) {
        return false;
    }
    if state.closing.swap(true, Ordering::AcqRel) {
        return true;
    }
    let owned = state
        .work
        .lock()
        .map(|m| m.values().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    let app = app.clone();
    std::thread::spawn(move || {
        // Small fixed worker pool; no blocking HTTP on the native UI thread.
        let jobs = Arc::new(Mutex::new(owned));
        let failures = Arc::new(Mutex::new(Vec::<OwnedWork>::new()));
        let mut workers = Vec::new();
        for _ in 0..4 {
            let jobs = jobs.clone();
            let failures = failures.clone();
            workers.push(std::thread::spawn(move || {
                let start = std::time::Instant::now();
                while start.elapsed() < Duration::from_secs(8) {
                    let work = jobs.lock().ok().and_then(|mut v| v.pop());
                    let Some(work) = work else { break };
                    if stop_owned(&work).is_err() {
                        if let Ok(mut out) = failures.lock() {
                            out.push(work);
                        }
                    }
                }
            }));
        }
        crate::pi::shutdown(&app);
        for worker in workers {
            let _ = worker.join();
        }
        if let (Ok(mut failed), Ok(left)) = (failures.lock(), jobs.lock()) {
            failed.extend(left.iter().cloned());
            if let Ok(root) = crate::paths::app_data_dir() {
                let dir = root.join("recovery");
                let _ = std::fs::create_dir_all(&dir);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
                }
                if let Ok(body) = serde_json::to_vec(&*failed) {
                    let _ = std::fs::write(dir.join("last-quit.json"), body);
                }
            }
        }
        app.state::<Lifecycle>()
            .finished
            .store(true, Ordering::Release);
        app.exit(0);
    });
    true
}
#[tauri::command]
pub fn quit_report(window: tauri::Window) -> Result<Vec<OwnedWork>, String> {
    if window.label() != "main" {
        return Err("Main window only".into());
    }
    let path = crate::paths::app_data_dir()?.join("recovery/last-quit.json");
    if !path.exists() {
        return Ok(vec![]);
    }
    if path.is_symlink() || std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > 2_000_000 {
        return Err("Invalid quit report".into());
    }
    serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_credentials_urls_and_unscoped_ids() {
        let mut w = OwnedWork {
            endpoint: "http://127.0.0.1:4096".into(),
            directory: "/test".into(),
            session_id: "ses_a".into(),
            message_id: "msg_a".into(),
            authorization: None,
        };
        assert!(validate(&w).is_ok());
        w.session_id = "../foreign".into();
        assert!(validate(&w).is_err());
        w.session_id = "ses_a".into();
        w.endpoint = "http://user:secret@localhost".into();
        assert!(validate(&w).is_err());
    }
    #[test]
    fn quit_aborts_only_the_latest_owned_user_turn() {
        use std::io::{Read, Write};
        for own in [true, false] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let addr = listener.local_addr().unwrap();
            let server = std::thread::spawn(move || {
                let count = if own { 3 } else { 2 };
                let mut paths = Vec::new();
                for n in 0..count {
                    let (mut s, _) = listener.accept().unwrap();
                    s.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
                    let mut b = [0; 8192];
                    let len = s.read(&mut b).unwrap();
                    let line = String::from_utf8_lossy(&b[..len]);
                    paths.push(line.lines().next().unwrap().to_string());
                    let body = match n {
                        0 => r#"{"ses_a":{"type":"busy"}}"#.to_owned(),
                        1 => format!(
                            r#"[{{"info":{{"id":"{}","role":"user"}}}}]"#,
                            if own { "msg_a" } else { "msg_b" }
                        ),
                        _ => "true".into(),
                    };
                    write!(s,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
                }
                paths
            });
            let w = OwnedWork {
                endpoint: format!("http://{addr}"),
                directory: "/test".into(),
                session_id: "ses_a".into(),
                message_id: "msg_a".into(),
                authorization: None,
            };
            assert_eq!(stop_owned(&w).unwrap(), own);
            let paths = server.join().unwrap();
            assert_eq!(
                paths
                    .iter()
                    .any(|p| p.starts_with("POST /session/ses_a/abort")),
                own
            );
        }
    }
}
