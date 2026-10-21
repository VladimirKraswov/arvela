//! Immutable module URLs: Bun/Node cache modules for the life of the engine.
use fs2::FileExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{fs, path::Path};
const FILES: &[(&str, &str)] = &[
    (
        "access-policy.mjs",
        include_str!("../resources/browser/access-policy.mjs"),
    ),
    (
        "execution-feedback.mjs",
        include_str!("../resources/browser/execution-feedback.mjs"),
    ),
    (
        "session.mjs",
        include_str!("../resources/browser/session.mjs"),
    ),
    (
        "opencode-session-plugin.mjs",
        include_str!("../resources/browser/opencode-session-plugin.mjs"),
    ),
];
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub access_plugin_path: String,
    pub browser_plugin_path: String,
    pub retired_access_plugin_paths: Vec<String>,
    pub retired_browser_plugin_paths: Vec<String>,
}
fn digest(files: &[(&str, &str)]) -> String {
    let mut hash = Sha256::new();
    for (name, content) in files {
        hash.update(name);
        hash.update([0]);
        hash.update(content);
        hash.update([0]);
    }
    format!("{:x}", hash.finalize())
}
fn private(path: &Path) -> Result<(), String> {
    if path.is_symlink() {
        return Err("Каталог расширений не должен быть ссылкой".into());
    }
    fs::create_dir_all(path).map_err(|_| "Каталог расширений недоступен")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| "Каталог расширений не защищён")?;
    }
    Ok(())
}
fn owned(path: &Path) -> bool {
    if path.is_symlink() || !path.is_dir() {
        return false;
    }
    let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
        return false;
    };
    if name.len() != 64
        || !name
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return false;
    }
    let mut contents = Vec::new();
    for (file, _) in FILES {
        let file = path.join(file);
        if !fs::symlink_metadata(&file)
            .is_ok_and(|m| m.is_file() && !m.file_type().is_symlink() && m.len() <= 65536)
        {
            return false;
        }
        let Ok(content) = fs::read_to_string(file) else {
            return false;
        };
        contents.push(content);
    }
    let files: Vec<_> = FILES
        .iter()
        .zip(contents.iter())
        .map(|((name, _), text)| (*name, text.as_str()))
        .collect();
    digest(&files) == name
}
pub(crate) fn ensure() -> Result<Catalog, String> {
    ensure_at(&crate::capabilities::root()?)
}
fn ensure_at(root: &Path) -> Result<Catalog, String> {
    private(root)?;
    let bundles = root.join("agent-plugins");
    private(&bundles)?;
    let lock_path = bundles.join("install.lock");
    if lock_path.is_symlink() {
        return Err("Небезопасная блокировка расширений".into());
    }
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(lock_path)
        .map_err(|_| "Блокировка расширений недоступна")?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    loop {
        match lock.try_lock_exclusive() {
            Ok(()) => break,
            Err(e)
                if e.kind() == std::io::ErrorKind::WouldBlock
                    && std::time::Instant::now() < deadline =>
            {
                std::thread::sleep(std::time::Duration::from_millis(10))
            }
            Err(_) => return Err("Расширения заняты; повторите проверку".into()),
        }
    }
    let current = bundles.join(digest(FILES));
    private(&current)?;
    for (name, content) in FILES {
        let file = current.join(name);
        if fs::symlink_metadata(&file).is_ok() {
            if file.is_symlink() || fs::read_to_string(&file).ok().as_deref() != Some(*content) {
                return Err("Неизменяемое расширение повреждено; файлы сохранены".into());
            }
        } else {
            crate::config::write_at(&file, "", content)?;
        }
    }
    // Accept only filesystem-verified app-root aliases, never a name substitution.
    let data = root.parent().ok_or("Нет каталога приложения")?;
    let mut roots = vec![root.to_path_buf()];
    if let Some(parent) = data.parent() {
        for name in ["enki", "opencode-desktop"] {
            let alias = parent
                .join(name)
                .join(root.file_name().ok_or("Нет каталога расширений")?);
            if alias
                .canonicalize()
                .ok()
                .zip(root.canonicalize().ok())
                .is_some_and(|(a, b)| a == b)
            {
                roots.push(alias);
            }
        }
    }
    roots.sort();
    roots.dedup();
    let mut revisions = Vec::new();
    for (index, item) in fs::read_dir(&bundles)
        .map_err(|_| "Расширения недоступны")?
        .enumerate()
    {
        if index >= 256 {
            return Err("Слишком много записей расширений; файлы сохранены".into());
        }
        let item = item.map_err(|_| "Расширения недоступны")?;
        if owned(&item.path()) {
            revisions.push(item.file_name());
        }
    }
    if revisions.len() > 128 {
        return Err("Слишком много версий расширений; файлы сохранены".into());
    }
    let mut access = Vec::new();
    let mut browser = Vec::new();
    for root in roots {
        access.push(root.join("access-policy.mjs").display().to_string());
        browser.push(
            root.parent()
                .ok_or("Нет каталога приложения")?
                .join("browser-runtime/current/opencode-session-plugin.mjs")
                .display()
                .to_string(),
        );
        for revision in &revisions {
            access.push(
                root.join("agent-plugins")
                    .join(revision)
                    .join("access-policy.mjs")
                    .display()
                    .to_string(),
            );
            browser.push(
                root.join("agent-plugins")
                    .join(revision)
                    .join("opencode-session-plugin.mjs")
                    .display()
                    .to_string(),
            );
        }
    }
    Ok(Catalog {
        access_plugin_path: current.join("access-policy.mjs").display().to_string(),
        browser_plugin_path: current
            .join("opencode-session-plugin.mjs")
            .display()
            .to_string(),
        retired_access_plugin_paths: access,
        retired_browser_plugin_paths: browser,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn immutable_graph_and_verified_aliases() {
        let base = std::env::temp_dir().join(format!(
            "enki-plugins-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let root = base.join("enki/capabilities");
        let first = ensure_at(&root).unwrap();
        let second = ensure_at(&root).unwrap();
        assert_eq!(first.access_plugin_path, second.access_plugin_path);
        assert!(owned(
            Path::new(&first.access_plugin_path).parent().unwrap()
        ));
        assert_eq!(
            Path::new(&first.access_plugin_path).parent(),
            Path::new(&first.browser_plugin_path).parent()
        );
        let changed: Vec<_> = FILES
            .iter()
            .map(|(n, c)| {
                (
                    *n,
                    if *n == "execution-feedback.mjs" {
                        "changed"
                    } else {
                        *c
                    },
                )
            })
            .collect();
        assert_ne!(digest(FILES), digest(&changed));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(base.join("enki"), base.join("opencode-desktop")).unwrap();
            let next = ensure_at(&root).unwrap();
            assert!(next
                .retired_access_plugin_paths
                .iter()
                .any(|p| p.contains("opencode-desktop/capabilities/access-policy.mjs")));
            fs::remove_file(base.join("opencode-desktop")).unwrap();
            fs::create_dir_all(base.join("opencode-desktop/capabilities")).unwrap();
            let next = ensure_at(&root).unwrap();
            assert!(!next
                .retired_access_plugin_paths
                .iter()
                .any(|p| p.contains("opencode-desktop")));
        }
        fs::write(&first.access_plugin_path, "foreign edit").unwrap();
        assert!(ensure_at(&root).is_err());
        assert_eq!(
            fs::read_to_string(&first.access_plugin_path).unwrap(),
            "foreign edit"
        );
        fs::remove_dir_all(base).unwrap();
    }
}
