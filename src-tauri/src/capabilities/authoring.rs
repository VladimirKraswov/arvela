//! One shared, versioned authoring recipe. No execution, transcript capture or agent loop.
use super::{private, read_at, validate, Source};
use fs2::FileExt;
use sha2::{Digest, Sha256};
use std::{fs, path::Path};
const CATALOG: &str = include_str!("../../resources/skills/create-shared-skill/scripts/catalog.py");
const SEARCH: &str = include_str!("../../resources/skills/reliable-web-search/SKILL.md");
const ID: &str = "arvela-authoring";
const SKILL: &str = include_str!("../../resources/skills/create-shared-skill/SKILL.md");

// Root migration retains the old absolute path as an alias. Compare actual
// locations, not text prefixes; never adopt an unrelated or redirected bundle.
fn owned_bundle(path: &Path, bundles: &Path) -> bool {
    if !path.is_absolute() || path.is_symlink() {
        return false;
    }
    let (Ok(actual), Ok(base)) = (path.canonicalize(), bundles.canonicalize()) else {
        return false;
    };
    actual.parent() == Some(base.as_path())
        && actual
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|name| {
                name.len() == 64
                    && name
                        .bytes()
                        .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            })
}

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
    let source = bundles.join(format!(
        "{:x}",
        Sha256::digest([SKILL.as_bytes(), CATALOG.as_bytes(), SEARCH.as_bytes()].concat())
    ));
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
    let scripts = directory.join("scripts");
    private(&scripts)?;
    let catalog = scripts.join("catalog.py");
    if catalog.is_symlink() {
        return Err("Каталог навыков не должен быть ссылкой".into());
    }
    if catalog.exists() {
        if fs::read_to_string(&catalog).map_err(|_| "Каталог навыков недоступен")? != CATALOG
        {
            return Err(
                "Встроенный каталог навыков изменён; сохраните пользовательскую копию".into(),
            );
        }
    } else {
        crate::config::write_at(&catalog, "", CATALOG)?;
    }
    let search_dir = source.join("reliable-web-search");
    private(&search_dir)?;
    let search_file = search_dir.join("SKILL.md");
    if search_file.is_symlink() {
        return Err("Навык поиска не должен быть ссылкой".into());
    }
    let current = fs::read_to_string(&search_file).unwrap_or_default();
    if !current.is_empty() && current != SEARCH {
        return Err("Встроенный навык поиска изменён; сохраните пользовательскую копию".into());
    }
    if current.is_empty() {
        crate::config::write_at(&search_file, "", SEARCH)?;
    }
    let path = source.display().to_string();
    if let Some(existing) = registry.sources.iter_mut().find(|s| s.id == ID) {
        if existing.path == path {
            return Ok(());
        }
        if !owned_bundle(Path::new(&existing.path), &bundles) {
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
        assert_eq!(
            fs::read_to_string(skill.parent().unwrap().join("scripts/catalog.py")).unwrap(),
            CATALOG
        );
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
    fn adopts_legacy_root_alias_preserving_disabled_and_foreign_sources() {
        let base = std::env::temp_dir().join(format!(
            "enki-authoring-migration-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let old = base.join("opencode-desktop").join("capabilities");
        let new = base.join("enki").join("capabilities");
        ensure(&old).unwrap();
        let (mut registry, _) = read_at(&old, "global").unwrap();
        registry.sources[0].enabled = false;
        registry.sources.push(Source {
            id: "owner".into(),
            path: base.join("owner").display().to_string(),
            enabled: true,
        });
        fs::write(
            old.join("global.json"),
            serde_json::to_string(&registry).unwrap(),
        )
        .unwrap();
        fs::create_dir_all(new.parent().unwrap()).unwrap();
        fs::rename(old.parent().unwrap(), new.parent().unwrap()).unwrap();
        std::os::unix::fs::symlink(new.parent().unwrap(), old.parent().unwrap()).unwrap();
        ensure(&new).unwrap();
        let after = read_at(&new, "global").unwrap().0;
        assert_eq!(after.sources.len(), 2);
        assert!(!after.sources[0].enabled);
        assert!(Path::new(&after.sources[0].path).starts_with(new.join("builtin-skills")));
        assert_eq!(after.sources[1].path, registry.sources[1].path);
        let expected = fs::read(new.join("global.json")).unwrap();
        ensure(&new).unwrap();
        assert_eq!(fs::read(new.join("global.json")).unwrap(), expected);
        fs::remove_dir_all(base).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn keeps_foreign_source_and_rejects_redirected_leaf_bundle() {
        let root = std::env::temp_dir().join(format!(
            "enki-authoring-foreign-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        ensure(&root).unwrap();
        let (mut registry, _) = read_at(&root, "global").unwrap();
        let outside = root.join("owner").join("b".repeat(64));
        fs::create_dir_all(&outside).unwrap();
        registry.sources[0].path = outside.display().to_string();
        let before = serde_json::to_string(&registry).unwrap();
        fs::write(root.join("global.json"), &before).unwrap();
        assert!(ensure(&root)
            .unwrap_err()
            .contains("занят пользовательским"));
        assert_eq!(
            fs::read_to_string(root.join("global.json")).unwrap(),
            before
        );
        let linked = root.join("builtin-skills").join("a".repeat(64));
        std::os::unix::fs::symlink(&outside, &linked).unwrap();
        assert!(!owned_bundle(&linked, &root.join("builtin-skills")));
        assert!(!owned_bundle(&outside, &root.join("builtin-skills")));
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
