//! One-way app-owned directory migration; engine databases are never touched.
//! Rename within one parent (no partial copy), retain an alias for absolute paths
//! already persisted by OpenCode/Pi, and record intent before touching the source.
use std::{
    fs,
    path::{Path, PathBuf},
};

fn alias(target: &Path, link: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    return std::os::unix::fs::symlink(target, link);
    #[cfg(windows)]
    return junction::create(target, link);
}
fn is_alias(path: &Path) -> bool {
    #[cfg(windows)]
    if junction::exists(path).unwrap_or(false) {
        return true;
    }
    path.is_symlink()
}
fn same(left: &Path, right: &Path) -> bool {
    fs::canonicalize(left)
        .ok()
        .zip(fs::canonicalize(right).ok())
        .is_some_and(|(a, b)| a == b)
}
fn io(e: std::io::Error) -> String {
    format!("Миграция данных Enki: {e}")
}

/// Read-only resolution also serves MCP helpers of an old running installation.
/// Never silently select a fresh empty tree when there are two different stores.
pub fn resolve(parent: &Path) -> Result<PathBuf, String> {
    let old = parent.join("opencode-desktop");
    let new = parent.join("enki");
    if is_alias(&new) {
        return Err("Каталог данных Enki не должен быть ссылкой".into());
    }
    if old.exists() && new.exists() && !same(&old, &new) {
        return Err("Обнаружены два разных каталога данных: enki и opencode-desktop. Данные сохранены; требуется устранить конфликт перед миграцией.".into());
    }
    Ok(if new.exists() || !old.exists() {
        new
    } else {
        old
    })
}

/// Only the GUI startup calls this, before loading assets or starting agents.
/// An OS advisory lock survives neither a crash nor reboot, so recovery is safe.
pub fn initialize(parent: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(parent).map_err(io)?;
    let lock = parent.join(".enki-migration.lock");
    if lock.is_symlink() {
        return Err("Небезопасная блокировка миграции".into());
    }
    let mut opts = fs::OpenOptions::new();
    opts.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let guard = opts.open(lock).map_err(io)?;
    fs2::FileExt::try_lock_exclusive(&guard)
        .map_err(|_| "Миграция Enki уже выполняется в другом процессе")?;
    migrate(parent)
}
fn migrate(parent: &Path) -> Result<PathBuf, String> {
    let old = parent.join("opencode-desktop");
    let new = parent.join("enki");
    let resolved = resolve(parent)?;
    let marker = parent.join(".enki-migration-v1");
    if marker.is_symlink() {
        return Err("Небезопасный журнал миграции".into());
    }
    if old.exists() && new.exists() {
        return Ok(resolved);
    }
    if is_alias(&old) {
        return Err(
            "Исходный каталог миграции является посторонней или повреждённой ссылкой".into(),
        );
    }
    if old.exists() {
        if !old.is_dir() {
            return Err("Исходный путь данных не является каталогом".into());
        }
        // Never move a live desktop's working directories, even when its agents
        // appear idle. The updater waits for the previous parent to exit first.
        ensure_stopped(&old)?;
        let mut opts = fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let file = opts.open(&marker).map_err(io)?;
        file.sync_all().map_err(io)?;
        sync_parent(parent)?;
        fs::rename(&old, &new).map_err(io)?;
        if let Err(error) = alias(&new, &old) {
            fs::rename(&new, &old).map_err(|rollback| {
                format!(
                    "Миграция Enki: {error}; восстановление: {rollback}. Данные сохранены в {}",
                    new.display()
                )
            })?;
            return Err(io(error));
        }
        sync_parent(parent)?;
    } else if marker.is_file() && new.is_dir() {
        // Crash between rename and alias: finish the recorded operation.
        alias(&new, &old).map_err(io)?;
        sync_parent(parent)?;
    } else {
        fs::create_dir_all(&new).map_err(io)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&new, fs::Permissions::from_mode(0o700)).map_err(io)?;
        }
    }
    Ok(new)
}
fn sync_parent(parent: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        fs::File::open(parent)
            .and_then(|f| f.sync_all())
            .map_err(io)?;
    }
    #[cfg(windows)]
    {
        let _ = parent;
    }
    Ok(())
}
fn ensure_stopped(root: &Path) -> Result<(), String> {
    let descriptor = root.join("agent-control/control.json");
    if descriptor.is_symlink() {
        return Err("Небезопасное описание работающего приложения".into());
    }
    let Ok(meta) = fs::metadata(&descriptor) else {
        return Ok(());
    };
    if meta.len() > 65536 {
        return Err("Повреждённое описание работающего приложения".into());
    }
    let value: serde_json::Value = serde_json::from_slice(&fs::read(&descriptor).map_err(io)?)
        .map_err(|_| "Не удалось проверить предыдущий процесс Enki")?;
    #[cfg(unix)]
    if let Some(pid) = value["pid"]
        .as_u64()
        .filter(|p| *p > 0 && *p <= i32::MAX as u64)
    {
        let alive = unsafe { libc::kill(pid as i32, 0) } == 0
            || std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH);
        if alive {
            return Err(
                "Сначала завершите предыдущий экземпляр приложения. Миграция не изменяла данные."
                    .into(),
            );
        }
    }
    #[cfg(windows)]
    {
        let _ = value;
    } // Agent Control is Unix-only.
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    fn fixture() -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "enki-migration-{}-{}-{}",
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&p).unwrap();
        p
    }
    #[test]
    fn rename_preserves_bytes_paths_permissions_and_is_idempotent() {
        let p = fixture();
        let old = p.join("opencode-desktop");
        fs::create_dir_all(old.join("chats/session")).unwrap();
        fs::write(old.join("chats/session/archive.zip"), [0, 255, 23, 42]).unwrap();
        let new = initialize(&p).unwrap();
        assert_eq!(new, p.join("enki"));
        assert!(is_alias(&old));
        assert_eq!(
            fs::read(old.join("chats/session/archive.zip")).unwrap(),
            [0, 255, 23, 42]
        );
        fs::write(new.join("new"), b"after").unwrap();
        assert_eq!(initialize(&p).unwrap(), new);
        assert_eq!(fs::read(old.join("new")).unwrap(), b"after");
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn collision_preserves_both_stores_and_fails_closed() {
        let p = fixture();
        for n in ["enki", "opencode-desktop"] {
            fs::create_dir(p.join(n)).unwrap();
            fs::write(p.join(n).join("data"), n).unwrap();
        }
        assert!(initialize(&p).is_err());
        for n in ["enki", "opencode-desktop"] {
            assert_eq!(fs::read_to_string(p.join(n).join("data")).unwrap(), n);
        }
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn interrupted_rename_is_recovered_without_copying_or_empty_store() {
        let p = fixture();
        fs::create_dir(p.join("enki")).unwrap();
        fs::write(p.join("enki/data"), b"keep").unwrap();
        fs::write(p.join(".enki-migration-v1"), b"").unwrap();
        initialize(&p).unwrap();
        assert_eq!(fs::read(p.join("opencode-desktop/data")).unwrap(), b"keep");
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn fresh_install_has_only_enki_store() {
        let p = fixture();
        assert_eq!(initialize(&p).unwrap(), p.join("enki"));
        assert!(!p.join("opencode-desktop").exists());
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    #[cfg(unix)]
    fn live_parent_or_untrusted_link_never_moves_data() {
        let p = fixture();
        let old = p.join("opencode-desktop");
        fs::create_dir_all(old.join("agent-control")).unwrap();
        fs::write(
            old.join("agent-control/control.json"),
            format!("{{\"pid\":{}}}", std::process::id()),
        )
        .unwrap();
        assert!(initialize(&p).is_err());
        assert!(!p.join("enki").exists());
        fs::remove_dir_all(&old).unwrap();
        std::os::unix::fs::symlink(p.join("outside"), &old).unwrap();
        assert!(initialize(&p).is_err());
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn concurrent_migration_is_rejected() {
        let p = fixture();
        let lock = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(p.join(".enki-migration.lock"))
            .unwrap();
        fs2::FileExt::lock_exclusive(&lock).unwrap();
        assert!(initialize(&p).is_err());
        drop(lock);
        initialize(&p).unwrap();
        fs::remove_dir_all(p).unwrap();
    }
}
