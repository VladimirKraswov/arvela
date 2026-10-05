//! Managed, persistent Chromium over Microsoft's official Playwright MCP.
//! The desktop owns lifecycle only; engines own tool permissions/agent loops.
use fs2::FileExt;
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::Manager;

const VERSION: &str = "0.0.83";
const RESOURCES: &[(&str, &str)] = &[
    (
        "package.json",
        include_str!("../resources/browser/package.json"),
    ),
    (
        "package-lock.json",
        include_str!("../resources/browser/package-lock.json"),
    ),
    (
        "daemon.mjs",
        include_str!("../resources/browser/daemon.mjs"),
    ),
    ("proxy.mjs", include_str!("../resources/browser/proxy.mjs")),
    ("setup.mjs", include_str!("../resources/browser/setup.mjs")),
    (
        "skills/desktop-browser/SKILL.md",
        include_str!("../resources/browser/SKILL.md"),
    ),
    (
        "pi-extension.ts",
        include_str!("../resources/browser/pi-extension.ts"),
    ),
];
#[derive(Default, Clone)]
pub struct BrowserRuntime(pub Arc<Mutex<Option<OwnedBrowser>>>, Arc<AtomicBool>);

pub struct OwnedBrowser {
    child: Child,
    #[cfg(target_os = "windows")]
    _job: windows_job::Job,
}
impl OwnedBrowser {
    #[allow(unused_mut)]
    fn new(mut child: Child) -> Result<Self, String> {
        #[cfg(target_os = "windows")]
        {
            let job = windows_job::Job::attach(&child).map_err(|error| {
                terminate(&mut child);
                error
            })?;
            return Ok(Self { child, _job: job });
        }
        #[cfg(not(target_os = "windows"))]
        {
            Ok(Self { child })
        }
    }
}
impl std::ops::Deref for OwnedBrowser {
    type Target = Child;
    fn deref(&self) -> &Child {
        &self.child
    }
}
impl std::ops::DerefMut for OwnedBrowser {
    fn deref_mut(&mut self) -> &mut Child {
        &mut self.child
    }
}

#[cfg(target_os = "windows")]
mod windows_job {
    use std::{ffi::c_void, os::windows::io::AsRawHandle, process::Child};
    #[repr(C)]
    #[derive(Default)]
    struct Basic {
        process_time: i64,
        job_time: i64,
        flags: u32,
        min_working_set: usize,
        max_working_set: usize,
        active_limit: u32,
        affinity: usize,
        priority: u32,
        scheduling: u32,
    }
    #[repr(C)]
    #[derive(Default)]
    struct Io {
        read_operations: u64,
        write_operations: u64,
        other_operations: u64,
        read_bytes: u64,
        write_bytes: u64,
        other_bytes: u64,
    }
    #[repr(C)]
    #[derive(Default)]
    struct Extended {
        basic: Basic,
        io: Io,
        process_memory: usize,
        job_memory: usize,
        peak_process_memory: usize,
        peak_job_memory: usize,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateJobObjectW(attributes: *const c_void, name: *const u16) -> *mut c_void;
        fn SetInformationJobObject(
            job: *mut c_void,
            class: u32,
            info: *const c_void,
            length: u32,
        ) -> i32;
        fn AssignProcessToJobObject(job: *mut c_void, process: *mut c_void) -> i32;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }
    pub struct Job(*mut c_void);
    // Job handles can be closed from any thread; ownership remains unique.
    unsafe impl Send for Job {}
    impl Job {
        pub fn attach(child: &Child) -> Result<Self, String> {
            unsafe {
                let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if job.is_null() {
                    return Err("Windows не создал Job Object для браузера.".into());
                }
                let mut info = Extended::default();
                info.basic.flags = 0x2000; // KILL_ON_JOB_CLOSE
                if SetInformationJobObject(
                    job,
                    9,
                    &info as *const _ as *const c_void,
                    std::mem::size_of::<Extended>() as u32,
                ) == 0
                    || AssignProcessToJobObject(job, child.as_raw_handle()) == 0
                {
                    CloseHandle(job);
                    return Err("Windows не смог привязать браузер к Desktop Job Object.".into());
                }
                Ok(Job(job))
            }
        }
    }
    impl Drop for Job {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserStatus {
    pub supported: bool,
    pub installed: bool,
    pub running: bool,
    pub browser_open: bool,
    pub command: String,
    pub node_program: Option<String>,
    pub skill_path: String,
    pub runtime_path: String,
    pub profile_path: String,
    pub version: Option<String>,
    pub error: Option<String>,
}
pub fn root_dir() -> Result<PathBuf, String> {
    Ok(crate::paths::app_data_dir()?.join("browser-runtime"))
}
pub fn support_dir() -> Result<PathBuf, String> {
    Ok(root_dir()?.join("current"))
}
fn private_dir(path: &Path) -> Result<(), String> {
    if fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("Каталог браузера не должен быть символической ссылкой.".into());
    }
    fs::create_dir_all(path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn executable(path: &Path) -> bool {
    if !path.is_absolute() || !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::metadata(path).is_ok_and(|m| m.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))]
    {
        true
    }
}
pub fn node_program(configured: Option<&str>) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Some(value) = configured.filter(|v| !v.trim().is_empty()) {
        let path = PathBuf::from(value.trim());
        if !executable(&path) {
            return Err("Укажите абсолютный путь к исполняемому Node.js.".into());
        }
        candidates.push(path);
    } else {
        if let Ok(home) = crate::paths::user_home() {
            candidates.extend([home.join(".local/bin/node"), home.join(".volta/bin/node")]);
            #[cfg(target_os = "windows")]
            candidates.push(home.join("AppData/Local/Programs/nodejs/node.exe"));
        }
        candidates.extend([
            PathBuf::from("/opt/homebrew/bin/node"),
            PathBuf::from("/usr/local/bin/node"),
            PathBuf::from("/usr/bin/node"),
        ]);
        #[cfg(target_os = "windows")]
        candidates.push(PathBuf::from(r"C:\Program Files\nodejs\node.exe"));
    }
    let node = candidates.into_iter().find(|p| executable(p)).ok_or(
        "Для браузера нужен Node.js 20+; установите Node.js или задайте его абсолютный путь.",
    )?;
    let mut child = Command::new(&node)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Не удалось запустить Node.js.")?;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if child
            .try_wait()
            .map_err(|_| "Не удалось проверить Node.js")?
            .is_some()
        {
            break;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Проверка Node.js превысила 5 секунд. Проверьте указанный путь.".into());
        }
        thread::sleep(Duration::from_millis(25));
    }
    let output = child
        .wait_with_output()
        .map_err(|_| "Не удалось проверить Node.js.")?;
    let version = String::from_utf8_lossy(&output.stdout);
    let major: u32 = version
        .trim()
        .trim_start_matches('v')
        .split('.')
        .next()
        .unwrap_or("")
        .parse()
        .unwrap_or(0);
    if !output.status.success() || major < 20 {
        return Err("Браузеру нужен Node.js версии 20 или новее.".into());
    }
    Ok(node)
}
fn npm_cli(node: &Path) -> Result<PathBuf, String> {
    let parent = node.parent().ok_or("Не найден каталог Node.js")?;
    let canonical = fs::canonicalize(node).unwrap_or_else(|_| node.to_path_buf());
    let actual = canonical.parent().unwrap_or(parent);
    let candidates = [
        parent.join("node_modules/npm/bin/npm-cli.js"),
        parent.join("../lib/node_modules/npm/bin/npm-cli.js"),
        actual.join("../lib/node_modules/npm/bin/npm-cli.js"),
        PathBuf::from("/opt/homebrew/lib/node_modules/npm/bin/npm-cli.js"),
        PathBuf::from("/usr/share/nodejs/npm/bin/npm-cli.js"),
    ];
    candidates
        .into_iter()
        .find(|p| p.is_file())
        .ok_or("Node.js найден, но npm не найден. Установите Node.js вместе с npm.".into())
}
fn installed_at(current: &Path) -> bool {
    if fs::symlink_metadata(current).is_ok_and(|m| m.file_type().is_symlink()) {
        return false;
    }
    let manifest = fs::read(current.join("installed.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok());
    manifest.as_ref().is_some_and(|m| {
        m["version"] == VERSION
            && m["browserExecutable"].as_str().is_some_and(|exe| {
                let exe = PathBuf::from(exe);
                exe.is_absolute()
                    && exe.is_file()
                    && current
                        .parent()
                        .is_some_and(|root| exe.starts_with(root.join("browsers")))
            })
    }) && fs::read(current.join("node_modules/@playwright/mcp/package.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .is_some_and(|package| package["version"] == VERSION)
        && fs::read(current.join("node_modules/@modelcontextprotocol/sdk/package.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .is_some_and(|package| package["version"] == "1.32.0")
        && RESOURCES.iter().all(|(name, content)| {
            fs::read_to_string(current.join(name)).ok().as_deref() == Some(*content)
        })
}
pub fn installed_pi_extension() -> Option<PathBuf> {
    let current = support_dir().ok()?;
    installed_at(&current)
        .then(|| current.join("pi-extension.ts"))
        .filter(|p| p.is_file())
}
fn ready(root: &Path) -> Option<Value> {
    let value: Value = serde_json::from_slice(&fs::read(root.join("ready.json")).ok()?).ok()?;
    let port = value["port"].as_u64()?;
    let token = value["token"].as_str()?;
    if port == 0
        || port > 65535
        || token.len() != 64
        || !token.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return None;
    }
    Some(value)
}
fn request(root: &Path, endpoint: &str, body: Option<&Value>) -> Result<Value, String> {
    let value = ready(root).ok_or("Браузер остановлен. Запустите его в настройках Desktop.")?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(if endpoint == "rpc" { 90 } else { 3 }))
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!(
        "http://127.0.0.1:{}/{endpoint}",
        value["port"].as_u64().unwrap()
    );
    let builder = if let Some(body) = body {
        client.post(url).json(body)
    } else {
        client.get(url)
    };
    let response = builder
        .bearer_auth(value["token"].as_str().unwrap())
        .send()
        .map_err(|_| "Браузер не отвечает. Перезапустите его в настройках Desktop.")?;
    if !response.status().is_success() {
        return Err("Браузер отклонил запрос. Проверьте URL и состояние окна.".into());
    }
    let result: Value = response
        .json()
        .map_err(|_| "Некорректный ответ браузера.")?;
    if endpoint == "health" && result["instanceId"] != value["instanceId"] {
        return Err("Браузер перезапущен; повторите подключение.".into());
    }
    Ok(result)
}
fn status(configured: Option<&str>) -> Result<BrowserStatus, String> {
    let root = root_dir()?;
    let current = support_dir()?;
    let node = node_program(configured);
    let health = request(&root, "health", None).ok();
    let installed = installed_at(&current);
    Ok(BrowserStatus {
        supported: cfg!(any(
            target_os = "macos",
            target_os = "linux",
            target_os = "windows"
        )),
        installed,
        running: health.as_ref().is_some_and(|v| v["running"] == true),
        browser_open: health.as_ref().is_some_and(|v| v["browserOpen"] == true),
        command: std::env::current_exe()
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .into_owned(),
        node_program: node.as_ref().ok().map(|p| p.to_string_lossy().into_owned()),
        error: node.err(),
        skill_path: current.join("skills").to_string_lossy().into_owned(),
        runtime_path: current.to_string_lossy().into_owned(),
        profile_path: root.join("profile").to_string_lossy().into_owned(),
        version: installed.then(|| VERSION.to_owned()),
    })
}
fn managed_command(node: &Path, root: &Path, script: &Path) -> Command {
    let mut cmd = Command::new(node);
    cmd.arg(script)
        .env("PLAYWRIGHT_BROWSERS_PATH", root.join("browsers"));
    if let Some(parent) = node.parent() {
        let mut paths = vec![parent.to_path_buf()];
        if let Some(path) = std::env::var_os("PATH") {
            paths.extend(std::env::split_paths(&path));
        }
        if let Ok(path) = std::env::join_paths(paths) {
            cmd.env("PATH", path);
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd
}
fn terminate(child: &mut Child) {
    if child.try_wait().ok().flatten().is_some() {
        return;
    }
    #[cfg(unix)]
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGTERM);
    }
    #[cfg(not(unix))]
    {
        let _ = child.kill();
    }
    let deadline = Instant::now() + Duration::from_secs(4);
    while Instant::now() < deadline {
        if child.try_wait().ok().flatten().is_some() {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }
    #[cfg(unix)]
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    let _ = child.kill();
    let _ = child.wait();
}
fn start(
    owner: &mut Option<OwnedBrowser>,
    configured: Option<&str>,
    shutting_down: &AtomicBool,
) -> Result<(), String> {
    check_shutdown(shutting_down)?;
    let root = root_dir()?;
    private_dir(&root)?;
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(root.join("owner.lock"))
        .map_err(|e| e.to_string())?;
    lock.try_lock_exclusive()
        .map_err(|_| "Браузер уже запускается или настраивается.")?;
    let current = support_dir()?;
    if !installed_at(&current) {
        return Err(
            "Инструменты браузера ещё не установлены. Установите их в настройках Desktop.".into(),
        );
    }
    let node = node_program(configured)?;
    let mut manifest: Value = serde_json::from_slice(
        &fs::read(current.join("installed.json")).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let prior_node = manifest["nodeProgram"].as_str().map(PathBuf::from);
    if request(&root, "health", None).is_ok()
        && prior_node
            .as_ref()
            .is_some_and(|p| fs::canonicalize(p).ok() == fs::canonicalize(&node).ok())
    {
        return Ok(());
    }
    stop(owner);
    private_dir(&root.join("workspace"))?;
    private_dir(&root.join("profile"))?;
    manifest["nodeProgram"] = json!(node);
    let temporary = current.join("installed.tmp");
    fs::write(
        &temporary,
        serde_json::to_vec(&manifest).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    // Windows rename does not replace an existing destination. Manifest contains
    // no credentials; the daemon readiness record is independently atomic/private.
    #[cfg(target_os = "windows")]
    fs::remove_file(current.join("installed.json")).map_err(|e| e.to_string())?;
    fs::rename(temporary, current.join("installed.json")).map_err(|e| e.to_string())?;
    check_shutdown(shutting_down)?;
    let mut child = managed_command(&node, &root, &current.join("daemon.mjs"))
        .arg(&root)
        .current_dir(root.join("workspace"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Не удалось запустить браузерный сервис.")?;
    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline {
        if let Err(error) = check_shutdown(shutting_down) {
            terminate(&mut child);
            return Err(error);
        }
        if request(&root, "health", None).is_ok() {
            *owner = Some(OwnedBrowser::new(child)?);
            return Ok(());
        }
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            return Err("Браузерный сервис завершился. Проверьте установку Node/npm и системные библиотеки Chromium в Linux.".into());
        }
        thread::sleep(Duration::from_millis(100));
    }
    terminate(&mut child);
    Err("Браузерный сервис не запустился за 15 секунд. Повторите запуск.".into())
}
fn install(
    owner: &mut Option<OwnedBrowser>,
    configured: Option<&str>,
    shutting_down: &AtomicBool,
) -> Result<(), String> {
    check_shutdown(shutting_down)?;
    let root = root_dir()?;
    private_dir(&root)?;
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(root.join("owner.lock"))
        .map_err(|e| e.to_string())?;
    lock.try_lock_exclusive()
        .map_err(|_| "Установка браузера уже выполняется.")?;
    let current = support_dir()?;
    if installed_at(&current) {
        return Ok(());
    }
    stop(owner);
    let node = node_program(configured)?;
    let npm = npm_cli(&node)?;
    let staging = root.join(format!("staging-{}", std::process::id()));
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|e| e.to_string())?;
    }
    private_dir(&staging)?;
    private_dir(&root.join("workspace"))?;
    for (name, content) in RESOURCES {
        let destination = staging.join(name);
        if let Some(parent) = destination.parent() {
            private_dir(parent)?;
        }
        fs::write(destination, content).map_err(|e| e.to_string())?;
    }
    let mut child = managed_command(&node, &root, &staging.join("setup.mjs"))
        .arg(&root)
        .arg(npm)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Не удалось начать установку браузера.")?;
    #[cfg(target_os = "windows")]
    let _install_job = windows_job::Job::attach(&child).map_err(|error| {
        terminate(&mut child);
        error
    })?;
    let result = wait_for_installer(
        &mut child,
        &staging,
        shutting_down,
        Duration::from_secs(1250),
    );
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    let rollback = root.join("previous");
    if rollback.exists() {
        fs::remove_dir_all(&rollback).map_err(|e| e.to_string())?;
    }
    if current.exists() {
        fs::rename(&current, &rollback).map_err(|e| e.to_string())?;
    }
    if let Err(error) = fs::rename(&staging, &current) {
        if rollback.exists() {
            let _ = fs::rename(&rollback, &current);
        }
        return Err(error.to_string());
    }
    Ok(())
}
fn check_shutdown(shutting_down: &AtomicBool) -> Result<(), String> {
    if shutting_down.load(Ordering::Acquire) {
        return Err("Настройка браузера отменена при закрытии Desktop.".into());
    }
    Ok(())
}
fn wait_for_installer(
    child: &mut Child,
    staging: &Path,
    shutting_down: &AtomicBool,
    timeout: Duration,
) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Err(error) = check_shutdown(shutting_down) {
            terminate(child);
            return Err(error);
        }
        match child.try_wait() {
            Ok(Some(exit)) => {
                return if exit.success() && installed_at(staging) {
                    Ok(())
                } else {
                    Err("Установка браузера не завершена. Проверьте сеть, свободное место, npm и системные библиотеки Linux.".into())
                }
            }
            Err(_) => {
                terminate(child);
                return Err("Не удалось проверить процесс установки браузера.".into());
            }
            Ok(None) if Instant::now() >= deadline => {
                terminate(child);
                return Err("Время установки браузера истекло. Повторите настройку.".into());
            }
            Ok(None) => thread::sleep(Duration::from_millis(200)),
        }
    }
}
fn validated_url(value: Option<&str>) -> Result<String, String> {
    let value = value
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("about:blank")
        .trim();
    if value == "about:blank" {
        return Ok(value.to_owned());
    }
    let parsed = url::Url::parse(value).map_err(|_| "Введите полный HTTP(S)-адрес.")?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("Разрешены HTTP(S)-адреса без встроенных логинов и паролей.".into());
    }
    Ok(parsed.into())
}
fn main_window(window: &tauri::Window) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Настройки браузера доступны только в основном окне Desktop.".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn browser_status(
    window: tauri::Window,
    node_program: Option<String>,
) -> Result<BrowserStatus, String> {
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || status(node_program.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn browser_install(
    window: tauri::Window,
    state: tauri::State<'_, BrowserRuntime>,
    node_program: Option<String>,
) -> Result<BrowserStatus, String> {
    main_window(&window)?;
    let owner = state.0.clone();
    let shutting_down = state.1.clone();
    tauri::async_runtime::spawn_blocking(move || {
        install(
            &mut *owner.lock().map_err(|_| "Браузер занят")?,
            node_program.as_deref(),
            &shutting_down,
        )?;
        status(node_program.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn browser_start(
    window: tauri::Window,
    state: tauri::State<'_, BrowserRuntime>,
    node_program: Option<String>,
) -> Result<BrowserStatus, String> {
    main_window(&window)?;
    let owner = state.0.clone();
    let shutting_down = state.1.clone();
    tauri::async_runtime::spawn_blocking(move || {
        start(
            &mut *owner.lock().map_err(|_| "Браузер занят")?,
            node_program.as_deref(),
            &shutting_down,
        )?;
        status(node_program.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn browser_open(
    window: tauri::Window,
    state: tauri::State<'_, BrowserRuntime>,
    url: Option<String>,
    node_program: Option<String>,
) -> Result<BrowserStatus, String> {
    main_window(&window)?;
    let owner = state.0.clone();
    let shutting_down = state.1.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let address = url.as_deref().filter(|value| !value.trim().is_empty()).map(|value| validated_url(Some(value))).transpose()?;
        start(&mut *owner.lock().map_err(|_| "Браузер занят")?, node_program.as_deref(), &shutting_down)?;
        let root = root_dir()?;
        let payload = match address {
            Some(address) => json!({"method":"tools/call","workspace":root.join("workspace"),"reveal":true,"params":{"name":"browser_navigate","arguments":{"url":address}}}),
            None => json!({"method":"desktop/reveal"}),
        };
        let result = request(&root, "rpc", Some(&payload))?;
        if result["result"]["isError"] == true { return Err("Не удалось открыть страницу. Проверьте адрес, сеть и библиотеки Chromium в Linux.".into()); }
        status(node_program.as_deref())
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn browser_stop(
    window: tauri::Window,
    state: tauri::State<'_, BrowserRuntime>,
) -> Result<BrowserStatus, String> {
    main_window(&window)?;
    let owner = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        stop(&mut *owner.lock().map_err(|_| "Браузер занят")?);
        status(None)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn stop(owner: &mut Option<OwnedBrowser>) {
    if let Ok(root) = root_dir() {
        let _ = request(&root, "stop", Some(&json!({})));
    }
    if let Some(mut child) = owner.take() {
        terminate(&mut child);
    }
}
pub fn shutdown(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<BrowserRuntime>() {
        state.1.store(true, Ordering::Release);
        if let Ok(mut owner) = state.0.lock() {
            if owner.is_some() {
                stop(&mut owner);
            }
        }
    }
}
#[tauri::command]
pub async fn browser_pi_support(
    window: tauri::Window,
    node_program: Option<String>,
) -> Result<Value, String> {
    main_window(&window)?;
    let current = support_dir()?;
    let node = self::node_program(node_program.as_deref())?;
    if !installed_at(&current) {
        return Err("Инструменты браузера не установлены.".into());
    }
    Ok(
        json!({"extensionPath":current.join("pi-extension.ts"),"runtimePath":current,"nodeProgram":node,"command":std::env::current_exe().map_err(|e|e.to_string())?,"skillPath":current.join("skills")}),
    )
}
pub fn mcp_main() -> Result<(), String> {
    let root = root_dir()?;
    let current = support_dir()?;
    if !installed_at(&current) {
        return Err(
            "Desktop browser tools are not installed. Open Desktop → Settings → Browser.".into(),
        );
    }
    request(&root, "health", None)?;
    let manifest: Value = serde_json::from_slice(
        &fs::read(current.join("installed.json")).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let node = node_program(manifest["nodeProgram"].as_str())?;
    // Inherited stdio is MCP JSON-RPC only. Child shutdown leaves the browser
    // owner alive so another engine/UI can keep using the same profile.
    let exit = managed_command(&node, &root, &current.join("proxy.mjs"))
        .arg(&root)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .map_err(|_| "Could not launch browser MCP proxy")?;
    if !exit.success() {
        return Err("Browser MCP proxy stopped. Reconnect it from Desktop settings.".into());
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn navigation_rejects_privileged_and_credential_urls() {
        for bad in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,x",
            "http://user:password@example.com",
            "http:///",
            "relative/path",
            "about:settings",
        ] {
            assert!(validated_url(Some(bad)).is_err(), "{bad}");
        }
        assert_eq!(validated_url(None).unwrap(), "about:blank");
        assert_eq!(
            validated_url(Some("https://example.com/path")).unwrap(),
            "https://example.com/path"
        );
    }
    #[test]
    #[cfg(unix)]
    fn node_override_that_hangs_is_killed_within_deadline() {
        use std::os::unix::fs::PermissionsExt;
        let temp =
            std::env::temp_dir().join(format!("browser-node-timeout-{}", std::process::id()));
        private_dir(&temp).unwrap();
        let script = temp.join("node");
        fs::write(&script, "#!/bin/sh\nexec sleep 30\n").unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o700)).unwrap();
        let started = Instant::now();
        assert!(node_program(script.to_str())
            .unwrap_err()
            .contains("5 секунд"));
        assert!(started.elapsed() < Duration::from_secs(8));
        fs::remove_dir_all(temp).unwrap();
    }
    #[test]
    #[cfg(unix)]
    fn managed_private_directory_rejects_symlink() {
        let temp =
            std::env::temp_dir().join(format!("browser-private-link-{}", std::process::id()));
        private_dir(&temp).unwrap();
        let link = temp.join("link");
        std::os::unix::fs::symlink(std::env::temp_dir(), &link).unwrap();
        assert!(private_dir(&link).is_err());
        fs::remove_dir_all(temp).unwrap();
    }
    #[test]
    #[cfg(unix)]
    fn shutdown_cancels_installer_and_reaps_its_own_child() {
        use std::os::unix::process::CommandExt;
        let mut child = Command::new("/bin/sleep")
            .arg("30")
            .process_group(0)
            .spawn()
            .unwrap();
        let flag = Arc::new(AtomicBool::new(false));
        let signal = flag.clone();
        let setter = thread::spawn(move || {
            thread::sleep(Duration::from_millis(100));
            signal.store(true, Ordering::Release);
        });
        let began = Instant::now();
        let result = wait_for_installer(
            &mut child,
            Path::new("/nonexistent-test-owned-browser-stage"),
            &flag,
            Duration::from_secs(30),
        );
        assert!(result.unwrap_err().contains("закрытии Desktop"));
        assert!(began.elapsed() < Duration::from_secs(2));
        assert!(child.try_wait().unwrap().is_some());
        setter.join().unwrap();
    }
    #[test]
    fn relative_node_override_never_searches_cwd() {
        assert!(node_program(Some("node")).is_err());
    }
    #[test]
    fn status_requires_completed_setup_not_just_package_files() {
        let temp =
            std::env::temp_dir().join(format!("browser-install-incomplete-{}", std::process::id()));
        private_dir(&temp).unwrap();
        fs::write(temp.join("package.json"), "{}").unwrap();
        assert!(!installed_at(&temp));
        fs::remove_dir_all(temp).unwrap();
    }
    #[test]
    fn resources_pin_official_dependencies_and_no_unsafe_flags() {
        let manifest: Value = serde_json::from_str(RESOURCES[0].1).unwrap();
        assert_eq!(manifest["dependencies"]["@playwright/mcp"], VERSION);
        let daemon = include_str!("../resources/browser/daemon.mjs");
        assert!(daemon.contains("chromiumSandbox: true"));
        assert!(!daemon.contains("allowUnrestrictedFileAccess: true"));
        assert!(!daemon.contains("--no-sandbox"));
        assert!(daemon.contains("127.0.0.1"));
    }
}
