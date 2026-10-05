//! Pi coding agent as a second engine, driven over its documented JSONL RPC mode.
//!
//! Contract source: `packages/coding-agent/docs/rpc.md` in the installed
//! `@earendil-works/pi-coding-agent` distribution (verified against 0.85.1).
//!
//! Ownership rules, mirroring how OpenCode is treated:
//! - Pi is a separately installed CLI. This module launches it with an explicit
//!   absolute program path and argument vector; it never resolves `pi` through
//!   `PATH`, never passes credentials on the command line, and never opens a
//!   network listener — the transport is the child's stdin/stdout only.
//! - Exactly one process per (directory, session) pair. A second `open` for the
//!   same pair reuses the live child instead of forking a duplicate agent.
//! - Every child is killed when its entry is dropped, including on app exit.
//! - Extension dialogs (`extension_ui_request`) are surfaced to the UI. If the UI
//!   does not answer within the deadline, this module answers `cancelled: true`.
//!   Silence must never become approval.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[cfg(unix)]
use std::io::Read;
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        mpsc::{channel, Sender},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, State};

/// First-party LSP extension, materialized next to the app's own data. The
/// user's `~/.pi` configuration is never written to: the extension is passed
/// explicitly with `--extension`, so nothing about the user's own Pi setup
/// changes when this feature is turned on or off.
const LSP_EXTENSION: &str = include_str!("../resources/pi/lsp-extension.ts");

/// Approval gate for Pi's *built-in* tools. Written next to the app's own data
/// and loaded for every real Pi session — it is not optional, because without it
/// `write`/`edit`/`bash` would run unasked.
const TOOL_GATE: &str = include_str!("../resources/pi/tool-gate.ts");

/// Event name used for every Pi message pushed to the WebView.
pub const PI_EVENT: &str = "pi://event";

/// How long a dialog request may stay unanswered before it is auto-denied.
const DIALOG_DEADLINE: Duration = Duration::from_secs(120);
/// Bound on retained stderr so a chatty child cannot grow memory without limit.
const STDERR_TAIL: usize = 8 * 1024;

/// Dialog methods block the agent until answered; the rest are fire-and-forget.
const DIALOG_METHODS: &[&str] = &["select", "confirm", "input", "editor"];

// ---------------------------------------------------------------- installation

/// Absolute candidates, most specific first. `PATH` is deliberately not consulted:
/// a user-writable directory on `PATH` must not get to choose which agent runs.
fn candidate_programs() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(data) = crate::paths::app_data_dir() {
        #[cfg(target_os = "windows")]
        out.push(data.join(r"pi-runtime\node_modules\@earendil-works\pi-coding-agent\dist\cli.js"));
        #[cfg(not(target_os = "windows"))]
        out.push(data.join("pi-runtime/node_modules/.bin/pi"));
    }
    if let Ok(home) = crate::paths::user_home() {
        #[cfg(target_os = "windows")]
        out.push(
            home.join(
                r"AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent\dist\cli.js",
            ),
        );
        #[cfg(not(target_os = "windows"))]
        {
            out.push(home.join(".local/bin/pi"));
            out.push(home.join(".bun/bin/pi"));
        }
    }
    // Homebrew on Apple Silicon, Homebrew/manual on Intel and Linux.
    #[cfg(not(target_os = "windows"))]
    {
        out.push(PathBuf::from("/opt/homebrew/bin/pi"));
        out.push(PathBuf::from("/usr/local/bin/pi"));
    }
    out
}

/// A configured override must be an absolute path to an existing regular file.
fn validate_override(raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err("Укажите абсолютный путь к исполняемому файлу Pi.".into());
    }
    if !path.is_file() {
        return Err("Файл Pi по указанному пути не найден.".into());
    }
    Ok(path)
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PiInstall {
    pub installed: bool,
    pub path: String,
    pub version: String,
    /// "configured" | "managed" | "system" | "" — where the binary came from.
    pub source: String,
    pub error: String,
}

fn program_version(program: &Path, node_override: Option<&Path>) -> Result<String, String> {
    let output = command_for_program(program, node_override)?
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .and_then(|child| child.wait_with_output())
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr)
            .chars()
            .take(400)
            .collect());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn resolve_program(configured: Option<&str>) -> Result<(PathBuf, &'static str), String> {
    if let Some(raw) = configured.map(str::trim).filter(|s| !s.is_empty()) {
        return Ok((validate_override(raw)?, "configured"));
    }
    let managed_root = crate::paths::app_data_dir()
        .map(|d| d.join("pi-runtime"))
        .ok();
    for candidate in candidate_programs() {
        if candidate.is_file() {
            let source = if managed_root
                .as_ref()
                .is_some_and(|root| candidate.starts_with(root))
            {
                "managed"
            } else {
                "system"
            };
            return Ok((candidate, source));
        }
    }
    Err("Pi CLI не найден. Установите его или укажите путь в настройках.".into())
}

/// npm installs Pi as `#!/usr/bin/env node`. Finder does not put Homebrew in
/// PATH, so launching that absolute Pi path alone still fails inside `env`.
/// Resolve only the interpreter from explicit locations and pass the script to
/// it directly; the Pi executable itself is never selected through PATH.
#[cfg(unix)]
fn command_for_program(program: &Path, node_override: Option<&Path>) -> Result<Command, String> {
    use std::os::unix::fs::PermissionsExt;

    let mut prefix = [0_u8; 64];
    let length = std::fs::File::open(program)
        .and_then(|mut file| file.read(&mut prefix))
        .map_err(|e| {
            format!(
                "Не удалось прочитать исполняемый файл {}: {e}",
                program.display()
            )
        })?;
    let first_line = prefix[..length]
        .split(|byte| *byte == b'\n')
        .next()
        .unwrap_or(&[]);
    if first_line != b"#!/usr/bin/env node" && first_line != b"#!/usr/bin/env node\r" {
        return Ok(Command::new(program));
    }

    if let Some(node) = node_override {
        if !node.is_absolute() {
            return Err("Укажите абсолютный путь к Node.js.".into());
        }
        let metadata =
            std::fs::metadata(node).map_err(|_| "Node.js по указанному пути не найден.")?;
        if !metadata.is_file() || metadata.permissions().mode() & 0o111 == 0 {
            return Err("Указанный путь к Node.js не является исполняемым файлом.".into());
        }
    }
    let mut candidates = Vec::new();
    if let Some(node) = node_override {
        candidates.push(node.to_path_buf());
    }
    if let Some(parent) = program.parent() {
        candidates.push(parent.join("node"));
    }
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        candidates.push(home.join(".local/bin/node"));
        candidates.push(home.join(".volta/bin/node"));
    }
    candidates.extend([
        PathBuf::from("/opt/homebrew/bin/node"),
        PathBuf::from("/usr/local/bin/node"),
        PathBuf::from("/usr/bin/node"),
    ]);
    let node = candidates
        .into_iter()
        .find(|path| {
            std::fs::metadata(path)
                .map(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
                .unwrap_or(false)
        })
        .ok_or_else(|| {
            "Pi установлен, но Node.js не найден рядом с ним или в известных местах установки."
                .to_string()
        })?;

    let mut command = Command::new(&node);
    command.arg(program);
    // Pi may start Node-based extensions and language servers. Preserve the
    // inherited PATH, but put the verified interpreter directory first.
    if let Some(parent) = node.parent() {
        let mut paths = vec![parent.to_path_buf()];
        if let Some(inherited) = std::env::var_os("PATH") {
            paths.extend(std::env::split_paths(&inherited).filter(|entry| entry.is_absolute()));
        }
        command.env(
            "PATH",
            std::env::join_paths(paths).map_err(|e| e.to_string())?,
        );
    }
    Ok(command)
}

#[cfg(not(unix))]
fn command_for_program(program: &Path, node_override: Option<&Path>) -> Result<Command, String> {
    let extension = program
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if extension.eq_ignore_ascii_case("exe") {
        return Ok(Command::new(program));
    }
    if extension.eq_ignore_ascii_case("cmd") || extension.eq_ignore_ascii_case("bat") {
        return Err("Для Pi укажите JavaScript entrypoint пакета, а не npm .cmd shim.".into());
    }
    if !matches!(
        extension.to_ascii_lowercase().as_str(),
        "js" | "mjs" | "cjs"
    ) {
        return Ok(Command::new(program));
    }
    let mut nodes = Vec::new();
    if let Some(node) = node_override {
        if !node.is_absolute() || !node.is_file() {
            return Err("Укажите абсолютный путь к существующему node.exe.".into());
        }
        nodes.push(node.to_path_buf());
    }
    nodes.push(PathBuf::from(r"C:\Program Files\nodejs\node.exe"));
    if let Ok(home) = crate::paths::user_home() {
        nodes.push(home.join(r"AppData\Local\Programs\nodejs\node.exe"));
    }
    let node = nodes
        .into_iter()
        .find(|path| path.is_absolute() && path.is_file())
        .ok_or("Pi найден, но абсолютный node.exe не найден.")?;
    let mut command = Command::new(&node);
    command.arg(program);
    if let Some(parent) = node.parent() {
        let mut paths = vec![parent.to_path_buf()];
        if let Some(inherited) = std::env::var_os("PATH") {
            paths.extend(std::env::split_paths(&inherited).filter(|entry| entry.is_absolute()));
        }
        command.env(
            "PATH",
            std::env::join_paths(paths).map_err(|e| e.to_string())?,
        );
    }
    Ok(command)
}

#[tauri::command]
pub async fn pi_detect(configured_path: Option<String>, node_program: Option<String>) -> PiInstall {
    tauri::async_runtime::spawn_blocking(move || {
        match resolve_program(configured_path.as_deref()) {
            Ok((path, source)) => {
                match program_version(&path, node_program.as_deref().map(Path::new)) {
                    Ok(version) => PiInstall {
                        installed: true,
                        path: path.display().to_string(),
                        version,
                        source: source.into(),
                        error: String::new(),
                    },
                    Err(error) => PiInstall {
                        installed: false,
                        path: path.display().to_string(),
                        source: source.into(),
                        error,
                        ..PiInstall::default()
                    },
                }
            }
            Err(error) => PiInstall {
                error,
                ..PiInstall::default()
            },
        }
    })
    .await
    .unwrap_or_else(|e| PiInstall {
        error: e.to_string(),
        ..PiInstall::default()
    })
}

// ------------------------------------------------------------------- sessions

/// Session storage is per project directory, so one project's Pi history can
/// never appear inside another's listing.
pub fn session_dir_for(directory: &str) -> Result<PathBuf, String> {
    let digest = stable_digest(directory);
    let dir = crate::paths::app_data_dir()?
        .join("pi-sessions")
        .join(digest);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Short, stable, filesystem-safe identifier for a directory path. FNV-1a keeps
/// this dependency-free; it is an index key, never a security boundary.
fn stable_digest(input: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in input.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionFile {
    pub id: String,
    pub file: String,
    pub cwd: String,
    pub created: String,
    pub updated: f64,
}

/// Reads only the session header line of each `.jsonl`, so listing stays cheap
/// and never needs a running agent.
#[tauri::command]
pub async fn pi_sessions(directory: String) -> Result<Vec<PiSessionFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = session_dir_for(&directory)?;
        let mut out = Vec::new();
        for entry in std::fs::read_dir(&dir)
            .map_err(|e| e.to_string())?
            .flatten()
        {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let Ok(file) = std::fs::File::open(&path) else {
                continue;
            };
            let mut first = String::new();
            if BufReader::new(file).read_line(&mut first).is_err() {
                continue;
            }
            let Ok(header) = serde_json::from_str::<Value>(&first) else {
                continue;
            };
            if header["type"] != "session" {
                continue;
            }
            let updated = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as f64)
                .unwrap_or(0.0);
            let id = header["id"].as_str().unwrap_or_default().to_string();
            // Capability probes are not conversations. Older builds could leave
            // one behind; never show it as a chat.
            if id.starts_with("probe-") {
                continue;
            }
            out.push(PiSessionFile {
                id,
                file: path.display().to_string(),
                cwd: header["cwd"].as_str().unwrap_or_default().to_string(),
                created: header["timestamp"].as_str().unwrap_or_default().to_string(),
                updated,
            });
        }
        out.retain(|s| !s.id.is_empty());
        out.sort_by(|a, b| b.updated.total_cmp(&a.updated));
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ------------------------------------------------------------------------ lsp

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LspServer {
    pub id: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub extensions: Vec<String>,
    pub language_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspSetup {
    pub extension_path: String,
    pub config_path: String,
    pub servers: Vec<LspServer>,
    pub missing: Vec<String>,
}

/// Known language servers for this project's languages, by absolute path only.
fn lsp_candidates() -> Vec<(LspServer, Vec<PathBuf>)> {
    let managed = crate::paths::app_data_dir()
        .map(|d| d.join("pi-runtime/node_modules/.bin/typescript-language-server"))
        .ok();
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let mut typescript_paths: Vec<PathBuf> = managed.into_iter().collect();
    typescript_paths.push(PathBuf::from("/usr/local/bin/typescript-language-server"));
    typescript_paths.push(PathBuf::from(
        "/opt/homebrew/bin/typescript-language-server",
    ));
    let mut rust_paths = vec![
        PathBuf::from("/usr/bin/rust-analyzer"),
        PathBuf::from("/usr/local/bin/rust-analyzer"),
        PathBuf::from("/opt/homebrew/bin/rust-analyzer"),
    ];
    if let Some(home) = home {
        rust_paths.insert(0, home.join(".cargo/bin/rust-analyzer"));
    }
    vec![
        (
            LspServer {
                id: "typescript".into(),
                command: String::new(),
                args: vec!["--stdio".into()],
                extensions: vec![
                    ".ts".into(),
                    ".tsx".into(),
                    ".js".into(),
                    ".jsx".into(),
                    ".mts".into(),
                    ".cts".into(),
                ],
                language_id: "typescript".into(),
            },
            typescript_paths,
        ),
        (
            LspServer {
                id: "rust".into(),
                command: String::new(),
                args: vec![],
                extensions: vec![".rs".into()],
                language_id: "rust".into(),
            },
            rust_paths,
        ),
    ]
}

/// A language server is only offered when `--version` actually succeeds.
fn runnable(program: &Path) -> bool {
    let Ok(mut command) = command_for_program(program, None) else {
        return false;
    };
    command
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// Materialized on every session start so a stale copy can never be loaded.
fn write_tool_gate() -> Result<PathBuf, String> {
    let path = pi_support_dir()?.join("tool-gate.ts");
    std::fs::write(&path, TOOL_GATE).map_err(|e| e.to_string())?;
    Ok(path)
}

fn pi_support_dir() -> Result<PathBuf, String> {
    let dir = crate::paths::app_data_dir()?.join("pi");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// A managed, empty working directory for probes that have no project open, so
/// the settings screen can list models without borrowing a user folder.
#[tauri::command]
pub async fn pi_probe_directory() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let dir = pi_support_dir()?.join("probe");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(dir.display().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Create a local projectless workspace for Pi without consulting the OpenCode
/// server. The shared helper validates the app-generated id and confines the
/// directory to the app's own chats root.
#[tauri::command]
pub async fn pi_prepare_chat_workspace(id: String) -> Result<crate::hosts::Workspace, String> {
    let home = crate::paths::user_home()?.to_string_lossy().to_string();
    crate::hosts::prepare_chat_workspace(id, None, home).await
}

/// Writes the extension and its server list into the app's own directory and
/// reports which servers were not found, so the UI can say so plainly.
/// `extra_paths` are absolute language-server paths configured by the user.
/// They are tried first, which is what makes this work on a macOS app launched
/// from Finder: such a process does not inherit `/opt/homebrew/bin` or
/// `~/.cargo/bin` in `PATH`, and this module never consults `PATH` anyway.
#[tauri::command]
pub async fn pi_setup_lsp(extra_paths: Option<Vec<String>>) -> Result<LspSetup, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = pi_support_dir()?;
        let extension_path = dir.join("lsp-extension.ts");
        std::fs::write(&extension_path, LSP_EXTENSION).map_err(|e| e.to_string())?;

        let mut servers = Vec::new();
        let mut missing = Vec::new();
        let extra: Vec<PathBuf> = extra_paths
            .unwrap_or_default()
            .iter()
            .filter_map(|raw| validate_override(raw).ok())
            .collect();
        for (mut server, paths) in lsp_candidates() {
            // A configured path wins, but only if it really runs.
            let paths: Vec<PathBuf> = extra.iter().cloned().chain(paths).collect();
            // Existence is not enough: `rustup` installs a shim at
            // /usr/bin/rust-analyzer for components that are *not* installed,
            // and it exits non-zero at run time. Probe before advertising it.
            match paths.into_iter().find(|p| p.is_file() && runnable(p)) {
                Some(found) => {
                    server.command = found.display().to_string();
                    servers.push(server);
                }
                None => missing.push(server.id),
            }
        }
        let config_path = dir.join("lsp-config.json");
        std::fs::write(
            &config_path,
            serde_json::to_string_pretty(&json!({ "servers": servers }))
                .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
        }
        Ok(LspSetup {
            extension_path: extension_path.display().to_string(),
            config_path: config_path.display().to_string(),
            servers,
            missing,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

// -------------------------------------------------------------------- process

#[derive(Default)]
pub struct PiSessions(pub Arc<Mutex<HashMap<String, PiProcess>>>);

pub struct PiProcess {
    child: Child,
    /// Taken on shutdown: closing it is the EOF that asks Pi to exit cleanly.
    stdin: Option<ChildStdin>,
    pending: Arc<Mutex<HashMap<String, Sender<Value>>>>,
    dialogs: Arc<Mutex<HashMap<String, Instant>>>,
    stderr: Arc<Mutex<String>>,
    pub directory: String,
    pub session_id: String,
    counter: u64,
}

/// Ordered shutdown of the whole agent process *tree*.
///
/// Pi is a Node process that itself spawns language servers, so signalling only
/// the direct child would leave those grandchildren running. The sequence is:
///
///   1. close stdin — Pi's RPC loop sees EOF, exits its own way and runs its
///      JavaScript exit handlers, which is what stops the language servers and
///      flushes the session transcript;
///   2. wait, bounded, for that to happen;
///   3. if it did not, SIGTERM the process **group**, wait again;
///   4. last resort, SIGKILL the group.
///
/// An immediate `kill()` (SIGKILL to the child only) skips every JS handler and
/// is exactly how language servers were being orphaned.
const GRACEFUL_EOF: Duration = Duration::from_millis(3000);
const GRACEFUL_TERM: Duration = Duration::from_millis(1500);

fn wait_bounded(child: &mut Child, limit: Duration) -> bool {
    let until = Instant::now() + limit;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) => {}
            Err(_) => return false,
        }
        if Instant::now() >= until {
            return false;
        }
        thread::sleep(Duration::from_millis(25));
    }
}

/// Signal the child's process group. The child is its own group leader (see
/// `process_group(0)` at spawn), so this reaches the language servers too.
#[cfg(unix)]
fn signal_group(pid: u32, signal: i32) {
    // Safety: `killpg` on our own child's group; failure is reported, not UB.
    unsafe {
        libc::killpg(pid as libc::pid_t, signal);
    }
}
#[cfg(not(unix))]
fn signal_group(_pid: u32, _signal: i32) {}

/// The shutdown sequence, free-standing so it can be tested against a process
/// tree that deliberately ignores EOF and SIGTERM.
fn shutdown_tree(child: &mut Child, stdin: Option<ChildStdin>) {
    drop(stdin);
    if wait_bounded(child, GRACEFUL_EOF) {
        return;
    }
    #[cfg(unix)]
    signal_group(child.id(), libc::SIGTERM);
    #[cfg(not(unix))]
    let _ = child.kill();
    if wait_bounded(child, GRACEFUL_TERM) {
        return;
    }
    #[cfg(unix)]
    signal_group(child.id(), libc::SIGKILL);
    let _ = child.kill();
    let _ = child.wait();
}

impl PiProcess {
    fn shutdown(&mut self) {
        let stdin = self.stdin.take();
        shutdown_tree(&mut self.child, stdin);
    }
}

impl Drop for PiProcess {
    fn drop(&mut self) {
        self.shutdown();
    }
}

pub fn session_key(directory: &str, session_id: &str) -> String {
    format!("{directory}\u{0}{session_id}")
}

/// Session ids become file names, so keep them to the shape Pi itself generates.
fn valid_session_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiOpenRequest {
    pub directory: String,
    pub session_id: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub thinking: Option<String>,
    pub program: Option<String>,
    pub node_program: Option<String>,
    /// Absolute paths of extensions to load. Validated as existing files.
    #[serde(default)]
    pub extensions: Vec<String>,
    /// Capability probe: run with `--no-session` so it writes no transcript and
    /// can never appear in the user's chat list.
    #[serde(default)]
    pub ephemeral: bool,
    /// Desktop-managed browser is optional and never loaded for metadata probes.
    #[serde(default)]
    pub browser_enabled: bool,
    /// "ask" (default) or "full". Anything else is treated as "ask".
    pub tool_policy: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiOpened {
    pub key: String,
    pub session_id: String,
    pub session_dir: String,
    pub program: String,
    pub reused: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PiEnvelope {
    key: String,
    directory: String,
    session_id: String,
    payload: Value,
}

fn emit(app: &tauri::AppHandle, envelope: PiEnvelope) {
    let _ = app.emit(PI_EVENT, envelope);
}

#[tauri::command]
pub async fn pi_open(
    app: tauri::AppHandle,
    state: State<'_, PiSessions>,
    request: PiOpenRequest,
) -> Result<PiOpened, String> {
    if !valid_session_id(&request.session_id) {
        return Err("Некорректный идентификатор сессии Pi.".into());
    }
    let directory = PathBuf::from(&request.directory);
    if !directory.is_absolute() || !directory.is_dir() {
        return Err("Рабочий каталог Pi недоступен.".into());
    }
    let key = session_key(&request.directory, &request.session_id);
    let handles = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut map = handles.lock().map_err(|e| e.to_string())?;
        // One live agent per session: a duplicate would double-write the session
        // file and answer the same prompt twice.
        if let Some(existing) = map.get_mut(&key) {
            if existing
                .child
                .try_wait()
                .map_err(|e| e.to_string())?
                .is_none()
            {
                let session_dir = session_dir_for(&request.directory)?;
                return Ok(PiOpened {
                    key: key.clone(),
                    session_id: existing.session_id.clone(),
                    session_dir: session_dir.display().to_string(),
                    program: String::new(),
                    reused: true,
                });
            }
            map.remove(&key);
        }
        let (program, _) = resolve_program(request.program.as_deref())?;
        let session_dir = session_dir_for(&request.directory)?;

        let mut args: Vec<String> = vec!["--mode".into(), "rpc".into()];
        if request.ephemeral {
            args.push("--no-session".into());
        } else {
            args.push("--session-dir".into());
            args.push(session_dir.display().to_string());
            args.push("--session-id".into());
            args.push(request.session_id.clone());
        }
        if let Some(provider) = request.provider.as_deref().filter(|s| !s.is_empty()) {
            args.push("--provider".into());
            args.push(provider.into());
        }
        if let Some(model) = request.model.as_deref().filter(|s| !s.is_empty()) {
            args.push("--model".into());
            args.push(model.into());
        }
        if let Some(level) = request.thinking.as_deref().filter(|s| !s.is_empty()) {
            args.push("--thinking".into());
            args.push(level.into());
        }
        // The approval gate is loaded first and unconditionally for real
        // sessions. A probe runs with tools it never invokes, so it is exempt.
        if !request.ephemeral {
            let gate = write_tool_gate()?;
            args.push("--extension".into());
            args.push(gate.display().to_string());
        }
        let browser_extension = if request.browser_enabled && !request.ephemeral {
            crate::browser::installed_pi_extension()
        } else {
            None
        };
        if let Some(extension) = &browser_extension {
            args.push("--extension".into());
            args.push(extension.display().to_string());
        }
        for extension in &request.extensions {
            let path = validate_override(extension)?;
            args.push("--extension".into());
            args.push(path.display().to_string());
        }

        let mut command =
            command_for_program(&program, request.node_program.as_deref().map(Path::new))?;
        command.args(&args).current_dir(&directory);
        if browser_extension.is_some() {
            command.env(
                "OCDESKTOP_BROWSER_COMMAND",
                std::env::current_exe().map_err(|e| e.to_string())?,
            );
        }
        #[cfg(unix)]
        {
            // Own process group: language servers Pi spawns inherit it, so the
            // shutdown sequence above can reach the whole tree.
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        if !request.extensions.is_empty() {
            // The extension only ever executes programs named in this file.
            command.env(
                "OCDESKTOP_LSP_CONFIG",
                pi_support_dir()?.join("lsp-config.json"),
            );
        }
        // Default-deny unless the user explicitly chose full access in settings.
        command.env(
            "OCDESKTOP_PI_TOOL_POLICY",
            match request.tool_policy.as_deref() {
                Some("full") => "full",
                _ => "ask",
            },
        );
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Не удалось запустить Pi: {e}"))?;

        let stdin = Some(child.stdin.take().ok_or("Pi не принял ввод")?);
        let stdout = child.stdout.take().ok_or("Pi не выдал поток вывода")?;
        let stderr_pipe = child.stderr.take().ok_or("Pi не выдал поток ошибок")?;
        let pending: Arc<Mutex<HashMap<String, Sender<Value>>>> = Arc::default();
        let dialogs: Arc<Mutex<HashMap<String, Instant>>> = Arc::default();
        let stderr = Arc::new(Mutex::new(String::new()));

        spawn_reader(
            app.clone(),
            stdout,
            key.clone(),
            request.directory.clone(),
            request.session_id.clone(),
            pending.clone(),
            dialogs.clone(),
            handles.clone(),
        );
        spawn_stderr(stderr_pipe, stderr.clone());

        map.insert(
            key.clone(),
            PiProcess {
                child,
                stdin,
                pending,
                dialogs,
                stderr,
                directory: request.directory.clone(),
                session_id: request.session_id.clone(),
                counter: 0,
            },
        );
        Ok(PiOpened {
            key,
            session_id: request.session_id,
            session_dir: session_dir.display().to_string(),
            program: program.display().to_string(),
            reused: false,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Strict JSONL per the Pi docs: split on `\n` only, tolerate a trailing `\r`.
/// A generic line reader would also split on U+2028/U+2029, which are legal
/// inside JSON strings and would corrupt assistant text.
fn read_jsonl_lines(stream: impl std::io::Read, mut on_line: impl FnMut(&str)) {
    let mut reader = BufReader::new(stream);
    let mut buffer: Vec<u8> = Vec::new();
    loop {
        buffer.clear();
        match reader.read_until(b'\n', &mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        while buffer.last() == Some(&b'\n') || buffer.last() == Some(&b'\r') {
            buffer.pop();
        }
        if buffer.is_empty() {
            continue;
        }
        on_line(&String::from_utf8_lossy(&buffer));
    }
}

#[allow(clippy::too_many_arguments)]
fn spawn_reader(
    app: tauri::AppHandle,
    stdout: std::process::ChildStdout,
    key: String,
    directory: String,
    session_id: String,
    pending: Arc<Mutex<HashMap<String, Sender<Value>>>>,
    dialogs: Arc<Mutex<HashMap<String, Instant>>>,
    handles: Arc<Mutex<HashMap<String, PiProcess>>>,
) {
    thread::spawn(move || {
        read_jsonl_lines(stdout, |line| {
            let Ok(value) = serde_json::from_str::<Value>(line) else {
                return;
            };
            // Correlated command responses go to their waiting caller only.
            if value["type"] == "response" {
                if let Some(id) = value["id"].as_str() {
                    let sender = pending.lock().ok().and_then(|mut p| p.remove(id));
                    if let Some(sender) = sender {
                        let _ = sender.send(value.clone());
                        return;
                    }
                }
            }
            if value["type"] == "extension_ui_request" {
                if let (Some(id), Some(method)) = (value["id"].as_str(), value["method"].as_str()) {
                    if DIALOG_METHODS.contains(&method) {
                        if let Ok(mut open) = dialogs.lock() {
                            open.insert(id.to_string(), Instant::now());
                        }
                        arm_dialog_watchdog(
                            handles.clone(),
                            dialogs.clone(),
                            key.clone(),
                            id.to_string(),
                        );
                    }
                }
            }
            emit(
                &app,
                PiEnvelope {
                    key: key.clone(),
                    directory: directory.clone(),
                    session_id: session_id.clone(),
                    payload: value,
                },
            );
        });
        // The child ended: tell the UI so it can show a real error instead of a
        // conversation that silently stopped responding.
        emit(
            &app,
            PiEnvelope {
                key: key.clone(),
                directory,
                session_id,
                payload: json!({"type": "pi_exited"}),
            },
        );
    });
}

fn spawn_stderr(stderr: std::process::ChildStderr, sink: Arc<Mutex<String>>) {
    thread::spawn(move || {
        read_jsonl_lines(stderr, |line| {
            if let Ok(mut buffer) = sink.lock() {
                buffer.push_str(line);
                buffer.push('\n');
                if buffer.len() > STDERR_TAIL {
                    let cut = buffer.len() - STDERR_TAIL;
                    *buffer = buffer[cut..].to_string();
                }
            }
        });
    });
}

/// Default-deny: an unanswered dialog is cancelled once the deadline passes, so
/// a closed window or a stalled WebView can never read as approval.
fn arm_dialog_watchdog(
    handles: Arc<Mutex<HashMap<String, PiProcess>>>,
    dialogs: Arc<Mutex<HashMap<String, Instant>>>,
    key: String,
    id: String,
) {
    thread::spawn(move || {
        thread::sleep(DIALOG_DEADLINE);
        let still_open = dialogs
            .lock()
            .map(|open| open.contains_key(&id))
            .unwrap_or(false);
        if !still_open {
            return;
        }
        if let Ok(mut map) = handles.lock() {
            if let Some(process) = map.get_mut(&key) {
                let _ = process.write_line(
                    &json!({"type":"extension_ui_response","id":id,"cancelled":true}).to_string(),
                );
            }
        }
        if let Ok(mut open) = dialogs.lock() {
            open.remove(&id);
        }
    });
}

impl PiProcess {
    fn write_line(&mut self, line: &str) -> Result<(), String> {
        let stdin = self
            .stdin
            .as_mut()
            .ok_or_else(|| "Pi не принимает команды: сессия закрывается.".to_string())?;
        stdin
            .write_all(line.as_bytes())
            .and_then(|_| stdin.write_all(b"\n"))
            .and_then(|_| stdin.flush())
            .map_err(|_| "Pi не принимает команды: процесс завершился.".to_string())
    }
    fn stderr_tail(&self) -> String {
        self.stderr
            .lock()
            .map(|s| s.trim().chars().rev().take(600).collect::<String>())
            .map(|s| s.chars().rev().collect())
            .unwrap_or_default()
    }
}

/// Send a command and wait for its correlated response.
#[tauri::command]
pub async fn pi_request(
    state: State<'_, PiSessions>,
    key: String,
    command: Value,
    timeout_ms: Option<u64>,
) -> Result<Value, String> {
    let handles = state.0.clone();
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(30_000).clamp(1_000, 600_000));
    tauri::async_runtime::spawn_blocking(move || {
        let (sender, receiver) = channel::<Value>();
        let id = {
            let mut map = handles.lock().map_err(|e| e.to_string())?;
            let process = map.get_mut(&key).ok_or("Сессия Pi не запущена.")?;
            process.counter += 1;
            let id = format!("r{}", process.counter);
            let mut payload = command;
            payload["id"] = json!(id);
            process
                .pending
                .lock()
                .map_err(|e| e.to_string())?
                .insert(id.clone(), sender);
            if let Err(error) = process.write_line(&payload.to_string()) {
                process.pending.lock().ok().map(|mut p| p.remove(&id));
                return Err(format!("{error} {}", process.stderr_tail()));
            }
            id
        };
        match receiver.recv_timeout(timeout) {
            Ok(value) => Ok(value),
            Err(_) => {
                let mut map = handles.lock().map_err(|e| e.to_string())?;
                if let Some(process) = map.get_mut(&key) {
                    process.pending.lock().ok().map(|mut p| p.remove(&id));
                    let tail = process.stderr_tail();
                    if !tail.is_empty() {
                        return Err(format!("Pi не ответил вовремя. {tail}"));
                    }
                }
                Err("Pi не ответил вовремя.".into())
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Fire-and-forget line, used for `extension_ui_response` and other
/// notifications that carry no correlated reply.
#[tauri::command]
pub async fn pi_post(
    state: State<'_, PiSessions>,
    key: String,
    message: Value,
) -> Result<(), String> {
    let handles = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut map = handles.lock().map_err(|e| e.to_string())?;
        let process = map.get_mut(&key).ok_or("Сессия Pi не запущена.")?;
        if message["type"] == "extension_ui_response" {
            if let Some(id) = message["id"].as_str() {
                process.dialogs.lock().ok().map(|mut d| d.remove(id));
            }
        }
        process.write_line(&message.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn pi_close(state: State<'_, PiSessions>, key: String) -> Result<(), String> {
    let handles = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        handles.lock().map_err(|e| e.to_string())?.remove(&key);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Keys of the currently live Pi children — used by settings and by tests that
/// must prove no duplicate process was created.
#[tauri::command]
pub async fn pi_live_sessions(state: State<'_, PiSessions>) -> Result<Vec<String>, String> {
    let handles = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut map = handles.lock().map_err(|e| e.to_string())?;
        map.retain(|_, process| matches!(process.child.try_wait(), Ok(None)));
        Ok(map.keys().cloned().collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stop every Pi child. Called on app exit so no agent outlives the window.
pub fn shutdown(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<PiSessions>() {
        if let Ok(mut map) = state.0.lock() {
            map.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn older_pi_requests_do_not_implicitly_enable_browser() {
        let request: PiOpenRequest =
            serde_json::from_value(json!({"directory":"/tmp", "sessionId":"test-legacy"})).unwrap();
        assert!(!request.browser_enabled);
        assert!(!request.ephemeral);
        let request: PiOpenRequest = serde_json::from_value(json!({"directory":"/tmp", "sessionId":"test-enabled", "browserEnabled":true, "ephemeral":true})).unwrap();
        assert!(request.browser_enabled && request.ephemeral);
    }

    #[test]
    fn session_ids_cannot_escape_the_session_directory() {
        for ok in ["chat-0001", "abc_DEF-123"] {
            assert!(valid_session_id(ok));
        }
        for bad in [
            "",
            "../../etc/passwd",
            "a/b",
            "a b",
            "a.jsonl",
            &"x".repeat(65),
        ] {
            assert!(!valid_session_id(bad), "{bad}");
        }
    }

    #[test]
    fn each_directory_gets_its_own_session_store() {
        let a = stable_digest("/home/user/project-a");
        let b = stable_digest("/home/user/project-b");
        assert_ne!(a, b);
        assert_eq!(a.len(), 16);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(a, stable_digest("/home/user/project-a"));
    }

    #[test]
    fn session_keys_cannot_collide_across_directories() {
        // A separator that cannot appear in a path keeps "/a" + "b-c" distinct
        // from "/a\0b" + "c".
        assert_ne!(session_key("/a", "b-c"), session_key("/a\u{0}b", "c"));
    }

    #[test]
    fn the_program_path_is_never_taken_from_path() {
        for candidate in candidate_programs() {
            assert!(candidate.is_absolute(), "{}", candidate.display());
        }
        assert!(validate_override("pi").is_err());
        assert!(validate_override("./pi").is_err());
        assert!(validate_override("/definitely/not/here/pi").is_err());
    }

    #[test]
    #[cfg(unix)]
    fn env_node_pi_runs_with_a_finder_like_path() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!(
            "opencode-pi-node-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let pi = root.join("pi");
        let node = root.join("node");
        std::fs::write(&pi, "#!/usr/bin/env node\nconsole.log('ok')\n").unwrap();
        std::fs::write(&node, "#!/bin/sh\nprintf '%s\\n' \"$1\"\n").unwrap();
        std::fs::set_permissions(&pi, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::set_permissions(&node, std::fs::Permissions::from_mode(0o700)).unwrap();

        let prepared = command_for_program(&pi, None).unwrap();
        let prepared_path = prepared
            .get_envs()
            .find(|(key, _)| *key == "PATH")
            .and_then(|(_, value)| value)
            .unwrap();
        assert_eq!(
            std::env::split_paths(prepared_path).next(),
            Some(root.clone())
        );
        let output = command_for_program(&pi, None)
            .unwrap()
            .env("PATH", "/usr/bin:/bin")
            .output()
            .unwrap();
        assert!(output.status.success());
        assert_eq!(
            String::from_utf8_lossy(&output.stdout).trim(),
            pi.display().to_string()
        );
        assert!(command_for_program(&pi, Some(Path::new("node"))).is_err());
        assert!(command_for_program(&pi, Some(&root.join("missing-node"))).is_err());
        assert!(command_for_program(&pi, Some(&node)).is_ok());
        std::fs::remove_dir_all(root).unwrap();
    }

    /// Assistant text may legally contain U+2028/U+2029; a generic line reader
    /// would split there and corrupt the JSON record.
    #[test]
    fn jsonl_framing_splits_on_lf_only() {
        let payload =
            "{\"type\":\"a\",\"text\":\"line\u{2028}sep\"}\r\n{\"type\":\"b\"}\n\n{\"type\":\"c\"}";
        let mut lines = Vec::new();
        read_jsonl_lines(payload.as_bytes(), |line| lines.push(line.to_string()));
        assert_eq!(lines.len(), 3);
        let first: Value = serde_json::from_str(&lines[0]).unwrap();
        assert_eq!(first["text"], "line\u{2028}sep");
        assert_eq!(
            serde_json::from_str::<Value>(&lines[2]).unwrap()["type"],
            "c"
        );
    }

    /// A language server that exits when its stdin closes (most of them do) is
    /// already handled by the graceful path. This covers the one that does not:
    /// the whole group must still be gone when the app quits, or the user is
    /// left with an orphaned server holding a workspace open.
    #[test]
    #[cfg(unix)]
    fn a_tree_that_ignores_eof_and_sigterm_is_still_fully_stopped() {
        use std::os::unix::process::CommandExt;
        // Parent ignores SIGTERM and never reads stdin; it spawns a grandchild
        // that does the same. Only a group SIGKILL can end this.
        let mut child = {
            let mut command = Command::new("/bin/sh");
            command
                .arg("-c")
                .arg("trap '' TERM; sh -c \"trap '' TERM; while :; do sleep 1; done\" & while :; do sleep 1; done")
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            command.process_group(0);
            command.spawn().expect("spawn test tree")
        };
        let pgid = child.id() as libc::pid_t;
        let stdin = child.stdin.take();
        // Give the grandchild time to exist.
        thread::sleep(Duration::from_millis(300));

        let started = Instant::now();
        shutdown_tree(&mut child, stdin);
        // Bounded: it must not hang waiting for a process that never yields.
        assert!(started.elapsed() < GRACEFUL_EOF + GRACEFUL_TERM + Duration::from_secs(2));

        // Signal 0 only checks existence. ESRCH means the whole group is gone.
        thread::sleep(Duration::from_millis(200));
        let alive = unsafe { libc::killpg(pgid, 0) };
        assert_eq!(alive, -1, "process group survived shutdown");
    }

    #[test]
    fn only_blocking_dialog_methods_are_tracked_for_auto_deny() {
        for blocking in ["select", "confirm", "input", "editor"] {
            assert!(DIALOG_METHODS.contains(&blocking));
        }
        for passive in ["notify", "setStatus", "setWidget", "setTitle"] {
            assert!(!DIALOG_METHODS.contains(&passive));
        }
    }
}
