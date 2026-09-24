//! Only app-owned directories and SSH tunnels. The OpenCode engine remains externally managed.
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    io::Read,
    net::TcpListener,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::State;

#[derive(Default, Clone)]
pub struct Hosts(pub Arc<Mutex<HashMap<String, Tunnel>>>);
pub struct Tunnel {
    child: Child,
    endpoint: String,
}
impl Drop for Tunnel {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    directory: String,
    root: String,
}

fn valid_target(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 253
        && !s.starts_with('-')
        && s.bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_.@:%[]".contains(&c))
}
/// Absolute paths only: resolving `ssh` through PATH would let a user-writable
/// directory decide which binary opens the tunnel. macOS ships the first entry,
/// Debian/Ubuntu the first or second, Nix/Homebrew installs the last.
const SSH_PROGRAMS: &[&str] = &["/usr/bin/ssh", "/bin/ssh", "/usr/local/bin/ssh"];

fn ssh_program() -> &'static str {
    SSH_PROGRAMS
        .iter()
        .copied()
        .find(|p| PathBuf::from(p).is_file())
        .unwrap_or(SSH_PROGRAMS[0])
}

fn ssh(target: &str) -> Result<Command, String> {
    if !valid_target(target) {
        return Err("Укажите SSH-алиас или user@host, без параметров команды.".into());
    }
    let mut c = Command::new(ssh_program());
    c.args([
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        "ConnectTimeout=8",
        "-o",
        "ServerAliveInterval=15",
        "-o",
        "ServerAliveCountMax=3",
    ]);
    Ok(c)
}
fn output_timeout(mut c: Command) -> Result<String, String> {
    let mut child = c
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let until = Instant::now() + Duration::from_secs(12);
    loop {
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            let out = child.wait_with_output().map_err(|e| e.to_string())?;
            if !out.status.success() {
                return Err(String::from_utf8_lossy(&out.stderr)
                    .chars()
                    .take(1200)
                    .collect());
            }
            return Ok(String::from_utf8_lossy(&out.stdout).trim().to_string());
        }
        if Instant::now() >= until {
            let _ = child.kill();
            let _ = child.wait();
            return Err("SSH: время ожидания истекло.".into());
        }
        thread::sleep(Duration::from_millis(50));
    }
}

#[tauri::command]
pub fn ssh_aliases() -> Vec<String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let text = fs::read_to_string(PathBuf::from(home).join(".ssh/config")).unwrap_or_default();
    let mut out = Vec::new();
    for line in text.lines() {
        let mut words = line
            .split('#')
            .next()
            .unwrap_or_default()
            .split_whitespace();
        if words.next().is_some_and(|x| x.eq_ignore_ascii_case("host")) {
            for name in words {
                if valid_target(name) && !out.iter().any(|x| x == name) {
                    out.push(name.to_string());
                }
            }
        }
    }
    out
}

#[tauri::command]
pub async fn prepare_chat_workspace(
    id: String,
    ssh_target: Option<String>,
    server_home: String,
) -> Result<Workspace, String> {
    if id.len() < 12 || id.len() > 80 || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err("Некорректный идентификатор рабочего каталога.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(target) = ssh_target {
            let mut c = ssh(&target)?;
            // Only the restricted, app-generated ID is interpolated. No arbitrary shell input.
            let remote = crate::paths::REMOTE_CHATS_SUBPATH;
            let script = format!("umask 077; d=\"$HOME/{remote}/{id}\"; mkdir -p -- \"$d\" && cd -- \"$d\" && pwd -P");
            c.arg(&target).arg(script);
            let directory = output_timeout(c)?;
            if !directory.starts_with('/') || directory.contains('\n') { return Err("SSH вернул некорректный рабочий путь.".into()); }
            let root = directory.rsplit_once('/').ok_or("Некорректный путь")?.0.to_string();
            Ok(Workspace { directory, root })
        } else {
            let home = PathBuf::from(std::env::var("HOME").map_err(|e| e.to_string())?);
            if fs::canonicalize(&home).ok() != fs::canonicalize(&server_home).ok() || !home.is_absolute() {
                return Err("Сервер работает на другой машине. Выберите подключение SSH для создания чата.".into());
            }
            let root = crate::paths::app_data_dir()?.join("chats");
            fs::create_dir_all(&root).map_err(|e| e.to_string())?;
            let dir = root.join(&id);
            fs::create_dir(&dir).map_err(|e| e.to_string())?;
            #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?; }
            let directory = fs::canonicalize(dir).map_err(|e| e.to_string())?.to_string_lossy().to_string();
            let root = directory.rsplit_once('/').ok_or("Некорректный путь")?.0.to_string();
            Ok(Workspace { directory, root })
        }
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn connect_ssh(
    target: String,
    port: u16,
    state: State<'_, Hosts>,
) -> Result<String, String> {
    if port == 0 {
        return Err("Порт должен быть от 1 до 65535.".into());
    }
    let mut command = ssh(&target)?;
    let handles = state.0.clone();
    let key = format!("{target}:{port}");
    let ssh_target = target.clone();
    let endpoint = tauri::async_runtime::spawn_blocking(move || {
        let mut tunnels = handles.lock().map_err(|e| e.to_string())?;
        if let Some(t) = tunnels.get_mut(&key) {
            if t.child.try_wait().map_err(|e| e.to_string())?.is_none() {
                return Ok(t.endpoint.clone());
            }
        }
        tunnels.remove(&key);
        let socket = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        let local_port = socket.local_addr().map_err(|e| e.to_string())?.port();
        drop(socket);
        command.args([
            "-N",
            "-o",
            "ExitOnForwardFailure=yes",
            "-L",
            &format!("127.0.0.1:{local_port}:127.0.0.1:{port}"),
            &ssh_target,
        ]);
        let child = command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;
        let endpoint = format!("http://127.0.0.1:{local_port}");
        tunnels.insert(
            key,
            Tunnel {
                child,
                endpoint: endpoint.clone(),
            },
        );
        Ok::<_, String>(endpoint)
    })
    .await
    .map_err(|e| e.to_string())??;
    // Wait for the actual forwarded HTTP server, not just the SSH process to exist.
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;
    let until = Instant::now() + Duration::from_secs(13);
    while Instant::now() < until {
        {
            let mut tunnels = state.0.lock().map_err(|e| e.to_string())?;
            let key = format!("{target}:{port}");
            if let Some(t) = tunnels.get_mut(&key) {
                if t.child.try_wait().map_err(|e| e.to_string())?.is_some() {
                    let mut error = String::new();
                    if let Some(stderr) = t.child.stderr.take() {
                        let _ = stderr.take(1600).read_to_string(&mut error);
                    }
                    tunnels.remove(&key);
                    return Err(format!("SSH: {} Проверьте ключ и известный ключ сервера командой ssh {target} в терминале.", error.trim()));
                }
            }
        }
        if let Ok(response) = client.get(format!("{endpoint}/global/health")).send().await {
            if response.status().is_success() || response.status().as_u16() == 401 {
                return Ok(endpoint);
            }
        }
        tauri::async_runtime::spawn_blocking(|| thread::sleep(Duration::from_millis(150)))
            .await
            .map_err(|e| e.to_string())?;
    }
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&format!("{target}:{port}"));
    Err(format!("SSH подключён, но OpenCode не отвечает на 127.0.0.1:{port} удалённой машины. Запустите там opencode serve --hostname 127.0.0.1 --port {port}, затем повторите."))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ssh_targets_are_arguments_not_commands() {
        for ok in ["vm-v100", "user@192.168.31.2", "user@[::1]"] {
            assert!(valid_target(ok));
        }
        for bad in [
            "",
            "-oProxyCommand=touch",
            "host;rm",
            "a\nb",
            "a b",
            "$(id)",
            "`id`",
            "host/../../",
        ] {
            assert!(!valid_target(bad));
        }
    }
    #[test]
    fn ssh_is_only_ever_launched_from_an_absolute_path() {
        assert!(SSH_PROGRAMS.iter().all(|p| p.starts_with('/')));
        assert!(ssh_program().starts_with('/'));
    }
    #[test]
    fn ssh_never_disables_host_key_verification() {
        let cmd = ssh("vm-test").unwrap();
        let args: Vec<_> = cmd
            .get_args()
            .map(|x| x.to_string_lossy().to_string())
            .collect();
        assert!(args.contains(&"StrictHostKeyChecking=yes".to_string()));
        assert!(args.contains(&"BatchMode=yes".to_string()));
    }
}

#[cfg(test)]
mod workspace_tests {
    use super::*;
    #[tokio::test]
    async fn workspace_id_cannot_escape_the_managed_root_or_inject_remote_commands() {
        for id in [
            "../../escape-path",
            "some-id;touch-x",
            "$(touch x)",
            "bad\nworkspace",
        ] {
            assert!(
                prepare_chat_workspace(id.into(), Some("host".into()), "/home/test".into())
                    .await
                    .is_err()
            );
        }
    }
}
