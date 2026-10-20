//! Start the separately installed OpenCode CLI only when the selected local
//! loopback endpoint is absent. Remote SSH endpoints are never passed here.

use fs2::FileExt;
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex, OnceLock},
    thread,
    time::{Duration, Instant},
};

#[cfg(unix)]
use std::os::{unix::fs::OpenOptionsExt, unix::process::CommandExt};

#[derive(Debug)]
struct LocalEndpoint {
    origin: String,
    hostname: String,
    port: u16,
}

fn parse_endpoint(raw: &str) -> Result<LocalEndpoint, String> {
    let url = url::Url::parse(raw.trim()).map_err(|_| "Некорректный адрес сервера")?;
    let hostname = url.host_str().ok_or("В адресе нет имени хоста")?;
    if url.scheme() != "http"
        || !matches!(hostname, "127.0.0.1" | "localhost" | "[::1]")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Автозапуск разрешён только для обычного HTTP-адреса localhost без пути и учётных данных".into());
    }
    let port = url.port_or_known_default().ok_or("В адресе нет порта")?;
    if port == 0 {
        return Err("Для автозапуска нужен фиксированный порт от 1 до 65535".into());
    }
    Ok(LocalEndpoint {
        origin: url.origin().ascii_serialization(),
        hostname: hostname.trim_matches(&['[', ']'][..]).to_owned(),
        port,
    })
}

fn app_lock(dir: &Path) -> Result<File, String> {
    fs::create_dir_all(dir).map_err(|e| format!("Не удалось открыть каталог приложения: {e}"))?;
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(unix)]
    options.mode(0o600);
    let file = options
        .open(dir.join("opencode-start.lock"))
        .map_err(|e| format!("Не удалось открыть блокировку запуска OpenCode: {e}"))?;
    file.lock_exclusive()
        .map_err(|e| format!("Не удалось заблокировать запуск OpenCode: {e}"))?;
    Ok(file)
}

fn binary_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(
            std::env::split_paths(&path)
                .filter(|p| p.is_absolute())
                .flat_map(|p| {
                    #[cfg(target_os = "windows")]
                    let names = ["opencode.exe", "opencode"];
                    #[cfg(not(target_os = "windows"))]
                    let names = ["opencode", "opencode"];
                    names.map(|name| p.join(name))
                }),
        );
    }
    if let Ok(home) = crate::paths::user_home() {
        #[cfg(target_os = "windows")]
        {
            candidates.push(home.join(r".opencode\bin\opencode.exe"));
            candidates.push(home.join(r"AppData\Roaming\npm\opencode.exe"));
        }
        #[cfg(not(target_os = "windows"))]
        {
            candidates.push(home.join(".opencode/bin/opencode"));
            candidates.push(home.join(".bun/bin/opencode"));
        }
    }
    #[cfg(target_os = "windows")]
    if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        let packages = local.join(r"Microsoft\WinGet\Packages");
        if let Ok(entries) = fs::read_dir(packages) {
            for entry in entries.flatten() {
                if entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("SST.opencode_")
                {
                    candidates.push(entry.path().join("opencode.exe"));
                }
            }
        }
    }
    #[cfg(target_os = "macos")]
    candidates.extend(["/opt/homebrew/bin/opencode", "/usr/local/bin/opencode"].map(PathBuf::from));
    #[cfg(target_os = "linux")]
    candidates.extend(["/usr/local/bin/opencode", "/usr/bin/opencode"].map(PathBuf::from));
    candidates
}

fn find_binary(configured: Option<&Path>) -> Result<PathBuf, String> {
    if let Some(path) = configured {
        if !path.is_absolute() {
            return Err("Укажите абсолютный путь к OpenCode CLI.".into());
        }
        let canonical =
            fs::canonicalize(path).map_err(|_| "OpenCode CLI по указанному пути не найден.")?;
        let metadata =
            fs::metadata(&canonical).map_err(|_| "OpenCode CLI по указанному пути не найден.")?;
        #[cfg(unix)]
        if !metadata.is_file() || metadata.permissions().mode() & 0o111 == 0 {
            return Err("Указанный путь к OpenCode CLI не является исполняемым файлом.".into());
        }
        #[cfg(not(unix))]
        if !metadata.is_file() {
            return Err("Указанный путь к OpenCode CLI не является файлом.".into());
        }
        return Ok(canonical);
    }
    for candidate in binary_candidates() {
        let Ok(path) = fs::canonicalize(candidate) else {
            continue;
        };
        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        #[cfg(unix)]
        if metadata.permissions().mode() & 0o111 == 0 {
            continue;
        }
        return Ok(path);
    }
    Err("OpenCode CLI не найден. Установите `opencode` отдельно и повторите подключение.".into())
}

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

fn log_file(dir: &Path) -> Result<(File, PathBuf), String> {
    let path = dir.join("opencode-autostart.log");
    let mut options = OpenOptions::new();
    options.create(true).append(true).read(true);
    #[cfg(unix)]
    options.mode(0o600);
    let file = options
        .open(&path)
        .map_err(|e| format!("Не удалось открыть журнал запуска: {e}"))?;
    if file.metadata().map(|m| m.len()).unwrap_or(0) > 4 * 1024 * 1024 {
        file.set_len(0)
            .map_err(|e| format!("Не удалось обновить журнал запуска: {e}"))?;
    }
    Ok((file, path))
}

#[derive(Debug, PartialEq, Eq)]
enum Probe {
    Healthy,
    Occupied,
    Absent,
}

fn probe(client: &reqwest::blocking::Client, endpoint: &LocalEndpoint) -> Probe {
    if let Ok(response) = client
        .get(format!("{}/global/health", endpoint.origin))
        .send()
    {
        if response.status().is_success()
            && response
                .json::<serde_json::Value>()
                .ok()
                .and_then(|v| v.get("healthy").and_then(serde_json::Value::as_bool))
                == Some(true)
        {
            return Probe::Healthy;
        }
        return Probe::Occupied;
    }
    let address = (endpoint.hostname.as_str(), endpoint.port);
    if let Ok(addresses) = address.to_socket_addrs() {
        for address in addresses {
            if TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok() {
                return Probe::Occupied;
            }
        }
    }
    Probe::Absent
}

type ManagedChild = Arc<Mutex<Child>>;
static MANAGED: OnceLock<Mutex<HashMap<String, ManagedChild>>> = OnceLock::new();
fn managed() -> &'static Mutex<HashMap<String, ManagedChild>> {
    MANAGED.get_or_init(|| Mutex::new(HashMap::new()))
}
fn retain_child(origin: &str, child: Child) {
    let child = Arc::new(Mutex::new(child));
    let origin = origin.to_string();
    managed()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(origin.clone(), child.clone());
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(1));
        let exited = child
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .try_wait()
            .ok()
            .flatten()
            .is_some();
        if exited {
            let mut registry = managed().lock().unwrap_or_else(|e| e.into_inner());
            if registry
                .get(&origin)
                .is_some_and(|current| Arc::ptr_eq(current, &child))
            {
                registry.remove(&origin);
            }
            break;
        }
    });
}

fn ensure_with(raw: &str, binary_override: Option<&Path>, data_dir: &Path) -> Result<(), String> {
    let endpoint = parse_endpoint(raw)?;
    // The file lock covers the second probe and readiness wait. Two Desktop
    // processes starting together therefore cannot launch two CLI processes.
    let _lock = app_lock(data_dir)?;
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| format!("Не удалось проверить OpenCode: {e}"))?;
    match probe(&client, &endpoint) {
        Probe::Healthy => return Ok(()),
        Probe::Occupied => {
            return Err(format!(
                "Порт {} уже занят, но OpenCode не отвечает на /global/health. Другой сервер не запускаю.",
                endpoint.port
            ));
        }
        Probe::Absent => {}
    }

    let binary = match binary_override {
        Some(path) => path.to_path_buf(),
        None => find_binary(None)?,
    };
    let (log, log_path) = log_file(data_dir)?;
    let stderr = log
        .try_clone()
        .map_err(|e| format!("Не удалось открыть журнал запуска: {e}"))?;
    let mut command = Command::new(binary);
    command
        .args([
            "serve",
            "--hostname",
            &endpoint.hostname,
            "--port",
            &endpoint.port.to_string(),
            "--cors",
            "tauri://localhost",
            "--cors",
            "http://tauri.localhost",
        ])
        // Never inherit a removed/protected project working directory from the UI.
        // Project access is checked separately through directory-scoped API calls.
        .current_dir(data_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(stderr));
    #[cfg(unix)]
    command.process_group(0);
    // The server is a background service with a private log, as on other
    // platforms; a console window would also stop it when closed.
    crate::process::hide_console(&mut command);
    let mut child = command
        .spawn()
        .map_err(|e| format!("Не удалось запустить OpenCode CLI: {e}"))?;
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if probe(&client, &endpoint) == Probe::Healthy {
            retain_child(&endpoint.origin, child);
            return Ok(());
        }
        if let Some(status) = child
            .try_wait()
            .map_err(|e| format!("Ошибка ожидания OpenCode: {e}"))?
        {
            return Err(format!(
                "OpenCode завершился при запуске ({status}). Журнал: {}",
                log_path.display()
            ));
        }
        if Instant::now() >= deadline {
            retain_child(&endpoint.origin, child);
            return Err(format!(
                "OpenCode запущен, но не ответил за 30 секунд. Журнал: {}",
                log_path.display()
            ));
        }
        thread::sleep(Duration::from_millis(300));
    }
}

#[cfg(unix)]
fn listener_pids(port: u16) -> Result<Vec<u32>, String> {
    let output = Command::new("lsof")
        .args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN", "-t"])
        .output()
        .map_err(|e| format!("Не удалось найти процесс сервера: {e}"))?;
    if !output.status.success() {
        return Ok(Vec::new());
    }
    let mut pids: Vec<u32> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.trim().parse().ok())
        .collect();
    pids.sort_unstable();
    pids.dedup();
    Ok(pids)
}

#[cfg(windows)]
fn listener_pids(port: u16) -> Result<Vec<u32>, String> {
    let output = Command::new("netstat")
        .args(["-ano", "-p", "tcp"])
        .output()
        .map_err(|e| format!("Не удалось найти процесс сервера: {e}"))?;
    let suffix = format!(":{port}");
    let mut pids: Vec<u32> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|line| {
            let fields: Vec<&str> = line.split_whitespace().collect();
            fields.len() == 5
                && fields[0] == "TCP"
                && fields[1].ends_with(&suffix)
                && fields[3] == "LISTENING"
        })
        .filter_map(|line| {
            line.split_whitespace()
                .last()
                .and_then(|value| value.parse().ok())
        })
        .collect();
    pids.sort_unstable();
    pids.dedup();
    Ok(pids)
}

#[cfg(unix)]
fn terminate_pid(pid: u32) -> Result<(), String> {
    let output = Command::new("kill")
        .arg(pid.to_string())
        .output()
        .map_err(|e| format!("Не удалось остановить OpenCode: {e}"))?;
    if !output.status.success() {
        return Err("OpenCode отказал в остановке".into());
    }
    Ok(())
}

#[cfg(windows)]
fn terminate_pid(pid: u32) -> Result<(), String> {
    let mut command = Command::new("taskkill");
    command.args(["/PID", &pid.to_string(), "/F"]);
    crate::process::hide_console(&mut command);
    let output = command
        .output()
        .map_err(|e| format!("Не удалось остановить OpenCode: {e}"))?;
    if !output.status.success() {
        return Err("OpenCode отказал в остановке".into());
    }
    Ok(())
}

/// Restart only a live child started by THIS Enki process. A healthy endpoint
/// is not proof of ownership: an external server (or SSH tunnel) stays untouched.
fn restart_with(raw: &str, binary_override: Option<&Path>, data_dir: &Path) -> Result<(), String> {
    let endpoint = parse_endpoint(raw)?;
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| format!("Не удалось проверить OpenCode: {e}"))?;
    {
        let _lock = app_lock(data_dir)?;
        if probe(&client, &endpoint) == Probe::Healthy {
            let owned = managed().lock().unwrap_or_else(|e| e.into_inner())
                .get(&endpoint.origin).cloned()
                .ok_or("Это внешний сервер OpenCode. Перезапустите его через средство, которым он запущен; Enki его не остановит.")?;
            let mut child = owned
                .lock()
                .map_err(|_| "Не удалось проверить процесс OpenCode")?;
            if child
                .try_wait()
                .map_err(|_| "Не удалось проверить процесс OpenCode")?
                .is_some()
                || listener_pids(endpoint.port)? != vec![child.id()]
            {
                return Err("Процесс сервера изменился; перезапуск отменён".into());
            }
            // Fail closed if activity cannot be read. The UI also gates across
            // all known directories/backends; never infer idle from stale UI.
            let statuses = client
                .get(format!("{}/session/status", endpoint.origin))
                .send()
                .and_then(reqwest::blocking::Response::error_for_status)
                .and_then(|r| r.json::<serde_json::Value>())
                .map_err(|_| "Не удалось проверить активные сессии OpenCode; перезапуск отменён")?;
            let sessions = statuses
                .as_object()
                .ok_or("Некорректное состояние сессий OpenCode")?;
            if sessions
                .values()
                .any(|s| s["type"].as_str() != Some("idle"))
            {
                return Err("Дождитесь завершения активных сессий OpenCode".into());
            }
            terminate_pid(child.id())?;
            let deadline = Instant::now() + Duration::from_secs(15);
            loop {
                if child
                    .try_wait()
                    .map_err(|_| "Ошибка ожидания OpenCode")?
                    .is_some()
                {
                    break;
                }
                if Instant::now() >= deadline {
                    return Err("Сервер OpenCode не остановился за 15 секунд".into());
                }
                thread::sleep(Duration::from_millis(100));
            }
            if probe(&client, &endpoint) != Probe::Absent {
                return Err("Порт OpenCode всё ещё занят; другой процесс не остановлен".into());
            }
        }
    }
    ensure_with(raw, binary_override, data_dir)
}

fn restart_sync(raw: &str, program: Option<&str>) -> Result<(), String> {
    let configured = program.map(str::trim).filter(|value| !value.is_empty());
    let binary = match configured {
        Some(path) => Some(find_binary(Some(Path::new(path)))?),
        None => None,
    };
    restart_with(raw, binary.as_deref(), &crate::paths::app_data_dir()?)
}

#[tauri::command]
pub async fn restart_local_opencode(
    window: tauri::WebviewWindow,
    endpoint: String,
    program: Option<String>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Недоступно в этом окне".into());
    }
    tauri::async_runtime::spawn_blocking(move || restart_sync(&endpoint, program.as_deref()))
        .await
        .map_err(|e| format!("Не удалось перезапустить OpenCode: {e}"))?
}

fn ensure_sync(raw: &str, program: Option<&str>) -> Result<(), String> {
    let configured = program.map(str::trim).filter(|value| !value.is_empty());
    // Existing healthy servers are never restarted. The settings probe also
    // validates this override before the next local autostart needs it.
    let binary = if let Some(path) = configured {
        Some(find_binary(Some(Path::new(path)))?)
    } else {
        None
    };
    ensure_with(raw, binary.as_deref(), &crate::paths::app_data_dir()?)
}

#[tauri::command]
pub async fn ensure_local_opencode(
    endpoint: String,
    program: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || ensure_sync(&endpoint, program.as_deref()))
        .await
        .map_err(|e| format!("Не удалось проверить запуск OpenCode: {e}"))?
}

#[tauri::command]
pub async fn detect_local_opencode(program: Option<String>) -> bool {
    tauri::async_runtime::spawn_blocking(move || {
        find_binary(program.as_deref().map(Path::new)).is_ok()
    })
    .await
    .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn autostart_accepts_only_plain_loopback_origins() {
        assert_eq!(parse_endpoint("http://127.0.0.1:4096").unwrap().port, 4096);
        assert_eq!(
            parse_endpoint("http://localhost:4196/").unwrap().hostname,
            "localhost"
        );
        assert_eq!(parse_endpoint("http://[::1]:4196").unwrap().hostname, "::1");
        for rejected in [
            "https://127.0.0.1:4096",
            "http://192.168.31.93:4096",
            "http://127.0.0.1:4096/other",
            "http://user:pass@127.0.0.1:4096",
            "http://127.0.0.1:4096?x=1",
            "http://127.0.0.1:0",
        ] {
            assert!(parse_endpoint(rejected).is_err(), "{rejected}");
        }
    }

    #[test]
    #[cfg(unix)]
    fn configured_cli_must_be_an_absolute_executable_file() {
        assert!(find_binary(Some(Path::new("./opencode"))).is_err());
        assert!(find_binary(Some(Path::new("/definitely/not/here/opencode"))).is_err());
        let root = std::env::temp_dir().join(format!("opencode-override-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let program = root.join("opencode");
        fs::write(&program, "#!/bin/sh\nexit 0\n").unwrap();
        assert!(find_binary(Some(&program)).is_err());
        fs::set_permissions(&program, fs::Permissions::from_mode(0o700)).unwrap();
        assert_eq!(
            find_binary(Some(&program)).unwrap(),
            fs::canonicalize(&program).unwrap()
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_healthy_existing_server_is_reused() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut request = [0; 1024];
            let _ = socket.read(&mut request);
            let body = r#"{"healthy":true,"version":"1.18.18"}"#;
            write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        });
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap();
        let endpoint = parse_endpoint(&format!("http://127.0.0.1:{port}")).unwrap();
        assert_eq!(probe(&client, &endpoint), Probe::Healthy);
        server.join().unwrap();
    }

    #[test]
    fn an_occupied_port_is_not_treated_as_an_absent_server() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .timeout(Duration::from_millis(200))
            .build()
            .unwrap();
        let endpoint = parse_endpoint(&format!("http://127.0.0.1:{port}")).unwrap();
        assert_eq!(probe(&client, &endpoint), Probe::Occupied);
    }

    #[test]
    #[cfg(unix)]
    fn failed_cli_start_reports_failure_without_claiming_connection() {
        let root = std::env::temp_dir().join(format!(
            "opencode-autostart-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let binary = root.join("opencode");
        fs::write(&binary, "#!/bin/sh\nprintf '%s\\n' \"$@\"\nexit 42\n").unwrap();
        fs::set_permissions(&binary, fs::Permissions::from_mode(0o700)).unwrap();
        let socket = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = socket.local_addr().unwrap().port();
        drop(socket);
        let error =
            ensure_with(&format!("http://127.0.0.1:{port}"), Some(&binary), &root).unwrap_err();
        assert!(error.contains("42"), "{error}");
        let log = fs::read_to_string(root.join("opencode-autostart.log")).unwrap();
        assert!(log.contains("serve\n--hostname\n127.0.0.1\n--port"));
        assert!(log.contains("--cors\ntauri://localhost"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn launches_a_test_owned_cli_and_waits_for_health() {
        let root = std::env::temp_dir().join(format!(
            "opencode-autostart-health-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let binary = root.join("opencode");
        fs::write(
            &binary,
            r#"#!/usr/bin/env python3
import sys, time, os
from http.server import BaseHTTPRequestHandler, HTTPServer
assert os.getcwd() == os.path.dirname(os.path.realpath(__file__))
port = int(sys.argv[sys.argv.index('--port') + 1])
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b'{"healthy":true,"version":"1.18.18"}'
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *_):
        pass
server = HTTPServer(('127.0.0.1', port), Handler)
server.handle_request()
time.sleep(1)
"#,
        )
        .unwrap();
        fs::set_permissions(&binary, fs::Permissions::from_mode(0o700)).unwrap();
        let socket = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = socket.local_addr().unwrap().port();
        drop(socket);
        ensure_with(&format!("http://127.0.0.1:{port}"), Some(&binary), &root).unwrap();
        thread::sleep(Duration::from_millis(1200));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn restart_replaces_the_healthy_server_with_a_new_process() {
        let root = std::env::temp_dir().join(format!(
            "opencode-autostart-restart-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let binary = root.join("opencode");
        fs::write(
            &binary,
            r#"#!/usr/bin/env python3
import sys, signal
from http.server import BaseHTTPRequestHandler, HTTPServer
port = int(sys.argv[sys.argv.index('--port') + 1])
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        from pathlib import Path
        body = (b'{"s":{"type":"busy"}}' if Path(__file__).with_name('busy').exists() else b'{}') if self.path == '/session/status' else b'{"healthy":true,"version":"1.18.18"}'
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *_):
        pass
signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
HTTPServer(('127.0.0.1', port), Handler).serve_forever()
"#,
        )
        .unwrap();
        fs::set_permissions(&binary, fs::Permissions::from_mode(0o700)).unwrap();
        let socket = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = socket.local_addr().unwrap().port();
        drop(socket);
        let url = format!("http://127.0.0.1:{port}");
        ensure_with(&url, Some(&binary), &root).unwrap();
        let before = listener_pids(port).unwrap();
        assert_eq!(before.len(), 1, "{before:?}");
        // A second Enki process has no ownership and cannot kill this listener.
        let owned = managed().lock().unwrap().remove(&url).unwrap();
        assert!(restart_with(&url, Some(&binary), &root)
            .unwrap_err()
            .contains("внешний"));
        assert_eq!(listener_pids(port).unwrap(), before);
        managed().lock().unwrap().insert(url.clone(), owned);
        fs::write(root.join("busy"), "1").unwrap();
        assert!(restart_with(&url, Some(&binary), &root)
            .unwrap_err()
            .contains("активных"));
        assert_eq!(listener_pids(port).unwrap(), before);
        fs::remove_file(root.join("busy")).unwrap();
        restart_with(&url, Some(&binary), &root).unwrap();
        let after = listener_pids(port).unwrap();
        assert_eq!(after.len(), 1, "{after:?}");
        assert_ne!(after, before);
        for pid in after {
            let _ = Command::new("kill").arg(pid.to_string()).output();
        }
        thread::sleep(Duration::from_millis(300));
        fs::remove_dir_all(root).unwrap();
    }
}
