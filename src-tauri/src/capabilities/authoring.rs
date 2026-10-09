//! One shared, versioned authoring recipe. No execution, transcript capture or agent loop.
use super::{private, read_at, validate, Source};
use fs2::FileExt;
use sha2::{Digest, Sha256};
use std::{fs, path::Path};
const ID: &str = "arvela-authoring";
const SKILL: &str = include_str!("../../resources/skills/create-shared-skill/SKILL.md");

pub(super) fn ensure(root: &Path) -> Result<(), String> {
    private(root)?;
    let lock_path = root.join("registry.lock");
    if lock_path.is_symlink() {
        return Err("Блокировка общих навыков не должна быть ссылкой".into());
    }
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(lock_path)
        .map_err(|_| "Общие навыки недоступны")?;
    lock.try_lock_exclusive()
        .map_err(|_| "Общие навыки заняты; повторите проверку")?;
    let (mut registry, expected) = read_at(root, "global")?;
    let bundles = root.join("builtin-skills");
    private(&bundles)?;
    let source = bundles.join(format!("{:x}", Sha256::digest(SKILL.as_bytes())));
    private(&source)?;
    let directory = source.join("create-shared-skill");
    private(&directory)?;
    let file = directory.join("SKILL.md");
    if file.is_symlink() {
        return Err("Встроенный навык не должен быть ссылкой".into());
    }
    if file.exists() {
        if fs::read_to_string(&file).map_err(|_| "Навык недоступен")? != SKILL {
            return Err("Встроенный навык изменён. Сохраните правки как пользовательский навык и восстановите встроенный файл".into());
        }
    } else {
        crate::config::write_at(&file, "", SKILL)?;
    }
    let path = source.display().to_string();
    if let Some(existing) = registry.sources.iter_mut().find(|s| s.id == ID) {
        if existing.path == path {
            return Ok(());
        }
        if !Path::new(&existing.path).starts_with(&bundles) {
            return Err("Идентификатор arvela-authoring занят пользовательским источником; переименуйте его в настройках".into());
        }
        // An explicitly disabled source remains disabled across updates.
        existing.path = path;
    } else {
        registry.sources.push(Source {
            id: ID.into(),
            path,
            enabled: true,
        });
    }
    validate(&registry)?;
    crate::config::write_at(
        &root.join("global.json"),
        &expected,
        &serde_json::to_string_pretty(&registry).map_err(|_| "Некорректный реестр навыков")?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn installs_once_preserves_other_sources_and_disabled_choice() {
        let root = std::env::temp_dir().join(format!(
            "arvela-authoring-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        ensure(&root).unwrap();
        let (mut registry, _) = read_at(&root, "global").unwrap();
        assert_eq!(registry.sources.len(), 1);
        let skill = Path::new(&registry.sources[0].path).join("create-shared-skill/SKILL.md");
        assert_eq!(fs::read_to_string(&skill).unwrap(), SKILL);
        registry.sources[0].enabled = false;
        registry.sources.push(Source {
            id: "owner".into(),
            path: root.display().to_string(),
            enabled: true,
        });
        fs::write(
            root.join("global.json"),
            serde_json::to_string(&registry).unwrap(),
        )
        .unwrap();
        ensure(&root).unwrap();
        let after = read_at(&root, "global").unwrap().0;
        assert_eq!(after.sources.len(), 2);
        assert!(!after.sources[0].enabled);
        fs::write(&skill, "owner edits").unwrap();
        assert!(ensure(&root).is_err());
        assert_eq!(fs::read_to_string(&skill).unwrap(), "owner edits");
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn rejects_redirected_bundle_directory() {
        let root = std::env::temp_dir().join(format!(
            "arvela-authoring-link-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        std::os::unix::fs::symlink(std::env::temp_dir(), root.join("builtin-skills")).unwrap();
        assert!(ensure(&root).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
