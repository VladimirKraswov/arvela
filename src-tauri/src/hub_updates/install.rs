//! A copy of the current executable applies a locally compiled release only
//! after the parent exits. The plan is private, bounded and hash-bound.
use super::{atomic, packet, read_json, root};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Plan {
    artifact: PathBuf,
    target: PathBuf,
    version: String,
    hash: String,
    parent: u32,
}
fn tree_hash(path: &Path) -> Result<String, String> {
    fn walk(root: &Path, p: &Path, out: &mut Vec<u8>) -> Result<(), String> {
        let meta = fs::symlink_metadata(p).map_err(|e| e.to_string())?;
        let name = p
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        if meta.file_type().is_symlink() {
            out.extend_from_slice(
                format!(
                    "{name}\0link:{}\n",
                    fs::read_link(p).map_err(|e| e.to_string())?.display()
                )
                .as_bytes(),
            );
        } else if meta.is_dir() {
            let mut items = fs::read_dir(p)
                .map_err(|e| e.to_string())?
                .filter_map(Result::ok)
                .map(|e| e.path())
                .collect::<Vec<_>>();
            items.sort();
            for f in items {
                walk(root, &f, out)?;
            }
        } else {
            use sha2::{Digest, Sha256};
            use std::io::Read;
            let mut h = Sha256::new();
            let mut f = fs::File::open(p).map_err(|e| e.to_string())?;
            let mut buffer = [0u8; 65536];
            loop {
                let n = f.read(&mut buffer).map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                h.update(&buffer[..n]);
            }
            out.extend_from_slice(format!("{name}\0{:x}\n", h.finalize()).as_bytes());
        }
        Ok(())
    }
    let mut out = vec![];
    walk(path, path, &mut out)?;
    Ok(packet::digest(&out))
}
impl Plan {
    pub fn create(artifact: &Path, version: &str) -> Result<Self, String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        #[cfg(target_os = "macos")]
        let target = exe
            .parent()
            .and_then(Path::parent)
            .and_then(Path::parent)
            .filter(|p| p.extension().is_some_and(|e| e == "app"))
            .ok_or("Обновление доступно только установленному приложению .app")?
            .to_path_buf();
        #[cfg(not(target_os = "macos"))]
        let target = std::env::var_os("APPIMAGE")
            .map(PathBuf::from)
            .unwrap_or(exe);
        Ok(Self {
            artifact: artifact.into(),
            target,
            version: version.into(),
            hash: tree_hash(artifact)?,
            parent: std::process::id(),
        })
    }
}
pub fn launch(plan: Plan) -> Result<(), String> {
    if tree_hash(&plan.artifact)? != plan.hash {
        return Err("Собранный пакет изменился. Повторите сборку.".into());
    }
    let dir = root()?.join(format!("apply-{}", std::process::id()));
    fs::create_dir(&dir).map_err(|e| e.to_string())?;
    crate::updates::private(&dir)?;
    let helper = dir.join(if cfg!(windows) { "apply.exe" } else { "apply" });
    fs::copy(std::env::current_exe().map_err(|e| e.to_string())?, &helper)
        .map_err(|e| e.to_string())?;
    let file = dir.join("plan.json");
    atomic(&file, &plan)?;
    let log = fs::File::create(dir.join("install.log")).map_err(|e| e.to_string())?;
    let mut cmd = Command::new(helper);
    cmd.arg("--apply-update")
        .arg(file)
        .stdin(Stdio::null())
        .stdout(log.try_clone().map_err(|e| e.to_string())?)
        .stderr(log);
    crate::process::hide_console(&mut cmd);
    crate::process::own_process_group(&mut cmd);
    cmd.spawn()
        .map_err(|e| format!("Не запущен установщик: {e}"))?;
    Ok(())
}
pub fn cli() -> Result<(), String> {
    let file = PathBuf::from(std::env::args_os().nth(2).ok_or("Missing update plan")?);
    let base = fs::canonicalize(root()?).map_err(|e| e.to_string())?;
    let file = fs::canonicalize(file).map_err(|e| e.to_string())?;
    if !file.starts_with(&base) || file.file_name().is_none_or(|n| n != "plan.json") {
        return Err("Invalid private update plan".into());
    }
    let plan: Plan = read_json(&file)?;
    let result = apply(&plan);
    atomic(
        &base.join("last-install.json"),
        &serde_json::json!({"version":plan.version,"installed":result.is_ok(),"error":result.as_ref().err()}),
    )?;
    // If application replacement failed, reopen the previous working version.
    if let Err(e) = &result {
        eprintln!("{e}");
    }
    let reopen_target = if result.is_ok() {
        destination(&plan)
    } else {
        plan.target.clone()
    };
    reopen(&reopen_target)?;
    if result.is_ok() {
        if let Some(build) = plan.artifact.ancestors().find(|p| {
            p.parent() == Some(base.as_path())
                && p.file_name().is_some_and(|n| {
                    n.to_string_lossy()
                        .strip_prefix("build-")
                        .is_some_and(packet::hash_ok)
                })
        }) {
            let _ = fs::remove_dir_all(build);
        }
    }
    result
}
fn destination(p: &Plan) -> PathBuf {
    #[cfg(target_os = "macos")]
    if p.artifact.file_name().is_some_and(|n| n == "Enki.app")
        && p.target.file_name().is_some_and(|n| n == "Arvela.app")
    {
        return p.target.with_file_name("Enki.app");
    }
    p.target.clone()
}
fn apply(p: &Plan) -> Result<(), String> {
    semver::Version::parse(&p.version).map_err(|e| e.to_string())?;
    if p.parent == 0 || p.parent == std::process::id() {
        return Err("Invalid parent process".into());
    }
    if !fs::canonicalize(&p.artifact)
        .map_err(|e| e.to_string())?
        .starts_with(fs::canonicalize(root()?).map_err(|e| e.to_string())?)
        || tree_hash(&p.artifact)? != p.hash
    {
        return Err("Собранный пакет изменён".into());
    }
    wait_parent(p.parent)?;
    let _lease = super::lease()?;
    if tree_hash(&p.artifact)? != p.hash {
        return Err("Пакет изменён после завершения приложения".into());
    }
    #[cfg(target_os = "macos")]
    {
        if p.target.extension().is_none_or(|e| e != "app") || p.target.is_symlink() {
            return Err("Invalid installed application".into());
        }
        let destination = destination(p);
        if destination != p.target && destination.exists() {
            return Err("Enki.app уже существует. Установка не изменяла приложения.".into());
        }
        let staging = p
            .target
            .with_file_name(format!(".Enki-update-{}.app", std::process::id()));
        let previous = p
            .target
            .with_file_name(format!(".Enki-previous-{}.app", std::process::id()));
        if staging.exists() || previous.exists() {
            return Err("Installation staging already exists".into());
        }
        let mut copy = Command::new("/usr/bin/ditto");
        copy.arg(&p.artifact).arg(&staging);
        successful(&mut copy, Duration::from_secs(120))?;
        fs::rename(&p.target, &previous)
            .map_err(|e| format!("Нет права заменить приложение: {e}"))?;
        if let Err(e) = fs::rename(&staging, &destination) {
            let _ = fs::rename(&previous, &p.target);
            return Err(e.to_string());
        }
        // Previous .app is retained beside the installation for manual recovery.
        atomic(
            &root()?.join("previous-app.json"),
            &serde_json::json!({"path":previous}),
        )?;
    }
    #[cfg(target_os = "windows")]
    {
        let destination = p.target.parent().ok_or("Missing install directory")?;
        let mut cmd = Command::new(&p.artifact);
        cmd.arg("/S").arg(format!("/D={}", destination.display()));
        successful(&mut cmd, Duration::from_secs(600))?;
    }
    #[cfg(target_os = "linux")]
    {
        if p.artifact.extension().is_some_and(|e| e == "AppImage") {
            let staging = p.target.with_extension("update-partial");
            if staging.exists() {
                return Err("Installation staging already exists".into());
            }
            fs::copy(&p.artifact, &staging).map_err(|e| e.to_string())?;
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&staging, fs::Permissions::from_mode(0o755))
                .map_err(|e| e.to_string())?;
            fs::copy(&p.target, root()?.join("previous.AppImage")).map_err(|e| e.to_string())?;
            fs::rename(staging, &p.target).map_err(|e| e.to_string())?;
        } else {
            let deb = p.artifact.extension().is_some_and(|e| e == "deb");
            if !deb && p.artifact.extension().is_none_or(|e| e != "rpm") {
                return Err("Unsupported Linux package".into());
            }
            let mut cmd = Command::new("/usr/bin/pkexec");
            cmd.arg(if deb { "/usr/bin/dpkg" } else { "/usr/bin/rpm" })
                .arg(if deb { "-i" } else { "-U" })
                .arg(&p.artifact);
            successful(&mut cmd, Duration::from_secs(600))?;
        }
    }
    Ok(())
}
fn successful(cmd: &mut Command, limit: Duration) -> Result<(), String> {
    let out = crate::process::output_with_timeout(cmd, limit, 65536)
        .map_err(|_| "Установщик не запустился или превысил время ожидания")?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!(
            "Установщик завершился с кодом {:?}. Предыдущая версия сохранена.",
            out.status.code()
        ))
    }
}
#[cfg(unix)]
fn wait_parent(pid: u32) -> Result<(), String> {
    for _ in 0..600 {
        if unsafe { libc::kill(pid as i32, 0) } != 0
            && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
        {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err("Приложение не завершилось за 60 секунд; установка отменена".into())
}
#[cfg(windows)]
fn wait_parent(pid: u32) -> Result<(), String> {
    use std::ffi::c_void;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn OpenProcess(access: u32, inherit: i32, id: u32) -> *mut c_void;
        fn WaitForSingleObject(handle: *mut c_void, ms: u32) -> u32;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }
    let handle = unsafe { OpenProcess(0x00100000, 0, pid) };
    if handle.is_null() {
        return Err("Cannot observe parent exit".into());
    }
    let result = unsafe { WaitForSingleObject(handle, 60000) };
    unsafe { CloseHandle(handle) };
    if result == 0 {
        Ok(())
    } else {
        Err("Приложение не завершилось; установка отменена".into())
    }
}
fn reopen(target: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = Command::new("/usr/bin/open");
        c.arg("-n").arg(target);
        c
    };
    #[cfg(not(target_os = "macos"))]
    let mut cmd = Command::new(target);
    crate::process::hide_console(&mut cmd);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[cfg(target_os = "macos")]
    fn renamed_bundle_has_new_destination_without_overwriting_another_name() {
        let p = Plan {
            artifact: "/build/Enki.app".into(),
            target: "/Applications/Arvela.app".into(),
            version: "0.2.83".into(),
            hash: "a".repeat(64),
            parent: 1,
        };
        assert_eq!(destination(&p), Path::new("/Applications/Enki.app"));
        let custom = Plan {
            target: "/Applications/Custom.app".into(),
            ..p.clone()
        };
        assert_eq!(destination(&custom), custom.target);
        let bridge = Plan {
            artifact: "/build/Arvela.app".into(),
            ..p
        };
        assert_eq!(destination(&bridge), bridge.target);
    }
    #[test]
    fn artifact_hash_detects_post_build_tampering() {
        let p = std::env::temp_dir().join(format!("arvela-artifact-{}", std::process::id()));
        fs::write(&p, b"one").unwrap();
        let before = tree_hash(&p).unwrap();
        fs::write(&p, b"two").unwrap();
        assert_ne!(before, tree_hash(&p).unwrap());
        fs::remove_file(p).unwrap();
    }
}
