//! Compilation runs only in a fresh signed snapshot, never in an owner project.
use super::{
    install::Plan,
    packet::{self, Verified},
    root,
};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
#[path = "../../native_fingerprint.rs"]
mod native_fingerprint;
pub struct Build {
    state: Mutex<Value>,
    cancel: AtomicBool,
    running: AtomicBool,
    prepared: Mutex<Option<(String, Plan)>>,
}
impl Default for Build {
    fn default() -> Self {
        Self {
            state: Mutex::new(json!({"stage":"idle"})),
            cancel: AtomicBool::new(false),
            running: AtomicBool::new(false),
            prepared: Mutex::new(None),
        }
    }
}
impl Build {
    pub fn status(&self) -> Value {
        self.state
            .lock()
            .map(|s| s.clone())
            .unwrap_or(json!({"stage":"error","error":"Build state unavailable"}))
    }
    pub fn running(&self) -> bool {
        self.running.load(Ordering::Acquire)
    }
    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::Release);
    }
    pub fn shutdown(&self) {
        self.cancel();
        let start = Instant::now();
        while self.running() && start.elapsed() < Duration::from_secs(12) {
            std::thread::sleep(Duration::from_millis(50));
        }
    }
    pub fn start(self: &Arc<Self>, v: Verified, digest: String) -> Result<(), String> {
        let lease = super::lease()?;
        if self.running.swap(true, Ordering::AcqRel) {
            return Err("Сборка уже выполняется".into());
        }
        self.cancel.store(false, Ordering::Release);
        *self.prepared.lock().map_err(|e| e.to_string())? = None;
        self.set(json!({"stage":"preparing","version":v.packet.version}));
        let this = self.clone();
        std::thread::spawn(move || {
            let _lease = lease;
            let result = this.compile(v, &digest);
            match result {
                Ok(plan) => {
                    *this.prepared.lock().unwrap_or_else(|e| e.into_inner()) = Some((digest, plan));
                    this.set(json!({"stage":"ready"}));
                }
                Err(e) => this.set(json!({"stage":"error","error":e})),
            }
            this.running.store(false, Ordering::Release);
        });
        Ok(())
    }
    fn set(&self, value: Value) {
        if let Ok(mut s) = self.state.lock() {
            *s = value;
        }
    }
    pub fn prepared(&self, digest: &str) -> Result<Plan, String> {
        self.prepared
            .lock()
            .map_err(|e| e.to_string())?
            .as_ref()
            .filter(|(d, _)| d == digest)
            .map(|(_, p)| p.clone())
            .ok_or("Сначала соберите выбранное обновление".into())
    }
    fn compile(&self, v: Verified, digest: &str) -> Result<Plan, String> {
        validate_identity(&v)?;
        let tools = Tools::find()?;
        let directory = root()?.join(format!("build-{digest}"));
        if directory.exists() {
            return Err("Каталог этой сборки уже существует. Удалите его через «Очистить сборку» перед повтором.".into());
        }
        packet::extract(&v.files, &directory)?;
        if native_fingerprint::fingerprint(&directory.join("src-tauri"))?
            != v.packet.native_fingerprint
        {
            return Err("Состав исходников не соответствует нативной версии".into());
        }
        let log = directory.join("build.log");
        for (stage, args, limit) in [
            (
                "dependencies",
                vec!["ci", "--no-audit", "--no-fund"],
                Duration::from_secs(15 * 60),
            ),
            ("compiling", build_args(), Duration::from_secs(40 * 60)),
        ] {
            self.set(json!({"stage":stage,"version":v.packet.version}));
            let mut cmd = Command::new(&tools.node);
            cmd.arg(&tools.npm)
                .args(args)
                .current_dir(&directory)
                .env("PATH", &tools.path)
                .env("CARGO_TARGET_DIR", directory.join("src-tauri/target"))
                .env_remove("TAURI_CONFIG")
                .env_remove("CARGO_BUILD_TARGET");
            // Publisher credentials are never forwarded to npm/build scripts.
            for key in [
                "ARVELA_HUB_ADMIN_TOKEN",
                "TAURI_SIGNING_PRIVATE_KEY",
                "TAURI_SIGNING_PRIVATE_KEY_PATH",
                "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
            ] {
                cmd.env_remove(key);
            }
            self.run(&mut cmd, &log, limit)?;
        }
        let artifact = artifact(&directory)?;
        let plan = Plan::create(&artifact, &v.packet.version)?;
        super::atomic(&directory.join("install-plan.json"), &plan)?;
        Ok(plan)
    }
    fn run(&self, cmd: &mut Command, log: &Path, limit: Duration) -> Result<(), String> {
        let out = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(log)
            .map_err(|e| e.to_string())?;
        cmd.stdin(Stdio::null())
            .stdout(out.try_clone().map_err(|e| e.to_string())?)
            .stderr(out);
        crate::process::hide_console(cmd);
        crate::process::own_process_group(cmd);
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Не удалось запустить сборку: {e}"))?;
        #[cfg(windows)]
        let _job = crate::process::KillOnCloseJob::attach(&child)?;
        let start = Instant::now();
        loop {
            if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                if status.success() {
                    return Ok(());
                }
                return Err(format!(
                    "Сборка завершилась с кодом {:?}. Лог: {}",
                    status.code(),
                    log.display()
                ));
            }
            let cancelled = self.cancel.load(Ordering::Acquire);
            if cancelled
                || start.elapsed() > limit
                || fs::metadata(log).is_ok_and(|m| m.len() > 8 * 1024 * 1024)
            {
                crate::process::terminate_group(&mut child, Duration::from_secs(2));
                return Err(if cancelled {
                    "Сборка отменена".into()
                } else {
                    format!("Превышено время или размер лога. Лог: {}", log.display())
                });
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    pub fn clear(&self) -> Result<(), String> {
        if self.running() {
            return Err("Сначала отмените сборку".into());
        }
        for entry in fs::read_dir(root()?).map_err(|e| e.to_string())? {
            let p = entry.map_err(|e| e.to_string())?.path();
            if p.file_name().is_some_and(|n| {
                n.to_string_lossy()
                    .strip_prefix("build-")
                    .is_some_and(packet::hash_ok)
            }) && !p.is_symlink()
            {
                fs::remove_dir_all(p).map_err(|e| e.to_string())?;
            }
        }
        *self.prepared.lock().map_err(|e| e.to_string())? = None;
        self.set(json!({"stage":"idle"}));
        Ok(())
    }
}
fn validate_identity(v: &Verified) -> Result<(), String> {
    for name in [
        "package.json",
        "package-lock.json",
        "src-tauri/tauri.conf.json",
    ] {
        let value: Value =
            serde_json::from_slice(v.files.get(name).ok_or("Missing source manifest")?)
                .map_err(|_| "Invalid source manifest")?;
        if value["version"] != v.packet.version {
            return Err("Версии манифестов не совпадают".into());
        }
        if name == "src-tauri/tauri.conf.json"
            && (value["identifier"] != "dev.local.opencodedesktop"
                || value["productName"] != "Arvela")
        {
            return Err("Источник меняет идентификатор приложения".into());
        }
    }
    let cargo = std::str::from_utf8(
        v.files
            .get("src-tauri/Cargo.toml")
            .ok_or("Missing Cargo manifest")?,
    )
    .map_err(|_| "Invalid Cargo manifest")?;
    if !cargo.contains(&format!("version = \"{}\"", v.packet.version))
        || !cargo.contains("name = \"arvela\"")
    {
        return Err("Invalid native package identity".into());
    }
    Ok(())
}
fn build_args() -> Vec<&'static str> {
    let mut args = platform_args();
    args.extend(["--ci", "--", "--locked"]);
    args
}
fn platform_args() -> Vec<&'static str> {
    #[cfg(target_os = "macos")]
    return vec![
        "run",
        "tauri",
        "--",
        "build",
        "--bundles",
        "app",
        "--config",
        r#"{"bundle":{"macOS":{"signingIdentity":"-"}}}"#,
    ];
    #[cfg(target_os = "windows")]
    return vec!["run", "tauri", "--", "build", "--bundles", "nsis"];
    #[cfg(target_os = "linux")]
    return vec![
        "run",
        "tauri",
        "--",
        "build",
        "--bundles",
        if std::env::var_os("APPIMAGE").is_some() {
            "appimage"
        } else if Path::new("/usr/bin/dpkg").exists() {
            "deb"
        } else {
            "rpm"
        },
    ];
}
fn artifact(dir: &Path) -> Result<PathBuf, String> {
    let root = dir.join("src-tauri/target/release/bundle");
    #[cfg(target_os = "macos")]
    return root
        .join("macos/Arvela.app")
        .is_dir()
        .then(|| root.join("macos/Arvela.app"))
        .ok_or("Сборка не создала Arvela.app".into());
    #[cfg(not(target_os = "macos"))]
    {
        #[cfg(target_os = "windows")]
        let (sub, suffix) = ("nsis", ".exe");
        #[cfg(target_os = "linux")]
        let (sub, suffix) = if std::env::var_os("APPIMAGE").is_some() {
            ("appimage", ".AppImage")
        } else if Path::new("/usr/bin/dpkg").exists() {
            ("deb", ".deb")
        } else {
            ("rpm", ".rpm")
        };
        let candidates: Vec<_> = fs::read_dir(root.join(sub))
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| {
                p.file_name()
                    .is_some_and(|s| s.to_string_lossy().ends_with(suffix))
            })
            .collect();
        if candidates.len() != 1 {
            return Err("Не найден единственный установочный пакет".into());
        }
        Ok(candidates[0].clone())
    }
}
struct Tools {
    node: PathBuf,
    npm: PathBuf,
    path: std::ffi::OsString,
}
impl Tools {
    fn find() -> Result<Self, String> {
        let mut dirs = std::env::var_os("PATH")
            .map(|s| std::env::split_paths(&s).collect::<Vec<_>>())
            .unwrap_or_default();
        if let Ok(home) = crate::paths::user_home() {
            dirs.extend([home.join(".cargo/bin"), home.join(".local/bin")]);
        }
        #[cfg(unix)]
        dirs.extend([
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/usr/bin"),
            PathBuf::from("/bin"),
        ]);
        #[cfg(windows)]
        if let Some(p) = std::env::var_os("ProgramFiles") {
            dirs.push(PathBuf::from(p).join("nodejs"));
        }
        let path = std::env::join_paths(&dirs).map_err(|e| e.to_string())?;
        let locate = |name: &str| -> Result<PathBuf, String> {
            let name = if cfg!(windows) {
                format!("{name}.exe")
            } else {
                name.into()
            };
            dirs.iter().map(|d|d.join(&name)).find(|p|p.is_file()).ok_or(format!("Не установлен {name}. Подготовьте Node.js/npm, Rust/Cargo и зависимости Tauri для вашей ОС."))
        };
        let node = locate("node")?;
        for tool in ["node", "cargo", "rustc"] {
            let mut c = Command::new(locate(tool)?);
            c.arg("--version").env("PATH", &path);
            let out = crate::process::output_with_timeout(&mut c, Duration::from_secs(10), 4096)
                .map_err(|_| format!("{tool}: не удалось проверить инфраструктуру сборки"))?;
            if !out.status.success() {
                return Err(format!(
                    "{tool} недоступен. Проверьте инфраструктуру сборки."
                ));
            }
        }
        let npm = if cfg!(windows) {
            node.parent()
                .ok_or("Missing Node parent")?
                .join("node_modules/npm/bin/npm-cli.js")
        } else {
            dirs.iter()
                .map(|d| d.join("npm"))
                .find(|p| p.is_file())
                .and_then(|p| fs::canonicalize(p).ok())
                .ok_or("Не установлен npm")?
        };
        if !npm.is_file() {
            return Err("Не найден npm-cli.js рядом с Node.js".into());
        }
        Ok(Self { node, npm, path })
    }
}

#[cfg(test)]
pub(super) fn source_fingerprint_for_test(v: &Verified) -> Result<String, String> {
    validate_identity(v)?;
    let dir = std::env::temp_dir().join(format!(
        "arvela-signed-source-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos()
    ));
    packet::extract(&v.files, &dir)?;
    let result = native_fingerprint::fingerprint(&dir.join("src-tauri"));
    let _ = fs::remove_dir_all(dir);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn status_is_renderable_before_any_build() {
        assert_eq!(Build::default().status()["stage"], "idle");
    }
    #[test]
    fn cargo_build_is_locked_and_noninteractive() {
        let args = build_args();
        assert!(args.ends_with(&["--ci", "--", "--locked"]));
    }
}
