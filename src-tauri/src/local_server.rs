//! Start the separately installed OpenCode CLI only when the selected local
//! loopback endpoint is absent. Remote SSH endpoints are never passed here.

use std::{
    fs::{self, File, OpenOptions},
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

#[cfg(unix)]
use std::os::{fd::AsRawFd, unix::fs::OpenOptionsExt, unix::process::CommandExt};

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
    fs::create_dir_all(&dir).map_err(|e| format!("Не удалось открыть каталог приложения: {e}"))?;
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(unix)]
    options.mode(0o600);
    let file = options
        .open(dir.join("opencode-start.lock"))
        .map_err(|e| format!("Не удалось открыть блокировку запуска OpenCode: {e}"))?;
    #[cfg(unix)]
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } != 0 {
        return Err(format!(
            "Не удалось заблокировать запуск OpenCode: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(file)
}

fn binary_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(
            std::env::split_paths(&path)
                .filter(|p| p.is_absolute())
                .map(|p| p.join("opencode")),
        );
    }
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        if home.is_absolute() {
            candidates.push(home.join(".opencode/bin/opencode"));
            candidates.push(home.join(".bun/bin/opencode"));
        }
    }
    #[cfg(target_os = "macos")]
    candidates.extend(["/opt/homebrew/bin/opencode", "/usr/local/bin/opencode"].map(PathBuf::from));
    #[cfg(target_os = "linux")]
    candidates.extend(["/usr/local/bin/opencode", "/usr/bin/opencode"].map(PathBuf::from));
    candidates
}

fn find_binary() -> Result<PathBuf, String> {
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
        None => find_binary()?,
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
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(stderr));
    #[cfg(unix)]
    command.process_group(0);
    let mut child = command
        .spawn()
        .map_err(|e| format!("Не удалось запустить OpenCode CLI: {e}"))?;
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if probe(&client, &endpoint) == Probe::Healthy {
            thread::spawn(move || {
                let _ = child.wait();
            });
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
            thread::spawn(move || {
                let _ = child.wait();
            });
            return Err(format!(
                "OpenCode запущен, но не ответил за 30 секунд. Журнал: {}",
                log_path.display()
            ));
        }
        thread::sleep(Duration::from_millis(300));
    }
}

fn ensure_sync(raw: &str) -> Result<(), String> {
    ensure_with(raw, None, &crate::paths::app_data_dir()?)
}

#[tauri::command]
pub async fn ensure_local_opencode(endpoint: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || ensure_sync(&endpoint))
        .await
        .map_err(|e| format!("Не удалось проверить запуск OpenCode: {e}"))?
}

#[tauri::command]
pub async fn detect_local_opencode() -> bool {
    tauri::async_runtime::spawn_blocking(|| find_binary().is_ok())
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
import sys, time
from http.server import BaseHTTPRequestHandler, HTTPServer
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
}
