//! App-owned JSON stores for usage accounting: the incremental message cache and
//! the closed-day money ledger. They live in the app data directory and are
//! written atomically with an optimistic sha256 guard, so a scan started before
//! another writer never silently overwrites fresher data.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_BYTES: u64 = 64 * 1024 * 1024;

fn valid_name(name: &str) -> bool {
    let Some(stem) = name.strip_suffix(".json") else {
        return false;
    };
    !stem.is_empty()
        && stem.len() <= 32
        && stem.bytes().all(|b| b.is_ascii_lowercase() || b == b'-')
}

fn store_path(name: &str) -> Result<PathBuf, String> {
    if !valid_name(name) {
        return Err("Недопустимое имя файла данных использования".into());
    }
    let dir = crate::paths::app_data_dir()?;
    fs::create_dir_all(&dir)
        .map_err(|_| "Не удалось создать каталог данных приложения".to_string())?;
    let path = dir.join(name);
    if path
        .symlink_metadata()
        .is_ok_and(|m| m.file_type().is_symlink())
    {
        return Err("Файл данных использования не должен быть символьной ссылкой".into());
    }
    Ok(path)
}

fn sha_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

#[derive(Serialize)]
pub struct StoredFile {
    pub content: String,
    pub sha: String,
}

#[tauri::command]
pub fn read_usage_file(name: String) -> Result<Option<StoredFile>, String> {
    let path = store_path(&name)?;
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(read_stored(&path)?))
}

fn read_stored(path: &Path) -> Result<StoredFile, String> {
    let metadata = fs::metadata(path)
        .map_err(|_| "Не удалось прочитать файл данных использования".to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_BYTES {
        return Err("Файл данных использования слишком большой".into());
    }
    let bytes =
        fs::read(path).map_err(|_| "Не удалось прочитать файл данных использования".to_string())?;
    let content = String::from_utf8(bytes.clone())
        .map_err(|_| "Файл данных использования не в UTF-8".to_string())?;
    Ok(StoredFile {
        content,
        sha: sha_hex(&bytes),
    })
}

#[tauri::command]
pub fn write_usage_file(
    name: String,
    content: String,
    expected_sha: Option<String>,
) -> Result<StoredFile, String> {
    if content.len() as u64 > MAX_BYTES {
        return Err("Данные использования слишком большие".into());
    }
    let path = store_path(&name)?;
    if path.exists() {
        let current = read_stored(&path)?;
        let expected = expected_sha.unwrap_or_default();
        if expected != current.sha {
            return Err("Файл данных использования изменился другой записью. Перечитайте данные и повторите".into());
        }
    } else if expected_sha.is_some_and(|previous| !previous.is_empty()) {
        return Err("Файл данных использования исчез с момента последнего чтения".into());
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "Не удалось определить время".to_string())?
        .as_nanos();
    let temp = path.with_extension(format!("usage-{now}.tmp"));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|_| "Не удалось создать временный файл данных использования".to_string())?;
    let result = (|| -> Result<(), String> {
        file.write_all(content.as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|_| "Не удалось записать данные использования".to_string())?;
        fs::rename(&temp, &path)
            .map_err(|_| "Не удалось опубликовать файл данных использования".to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result?;
    let bytes = content.into_bytes();
    let sha = sha_hex(&bytes);
    Ok(StoredFile {
        content: String::from_utf8(bytes).map_err(|_| "Содержимое не в UTF-8".to_string())?,
        sha,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Guard;
    impl Guard {
        fn dir() -> PathBuf {
            let base = std::env::temp_dir().join(format!(
                "arvela-usage-store-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&base).unwrap();
            base
        }
    }

    #[test]
    fn names_are_restricted_to_plain_lowercase_json() {
        assert!(valid_name("usage-cache.json"));
        assert!(valid_name("usage-ledger.json"));
        assert!(!valid_name(""));
        assert!(!valid_name("Usage.json"));
        assert!(!valid_name("a/b.json"));
        assert!(!valid_name("../evil.json"));
        assert!(!valid_name("usage.txt"));
        assert!(!valid_name(".json"));
    }

    #[test]
    fn read_stored_roundtrips_and_flags_utf8() {
        let base = Guard::dir();
        let path = base.join("usage-cache.json");
        fs::write(&path, "{\"a\":1}").unwrap();
        let stored = read_stored(&path).unwrap();
        assert_eq!(stored.content, "{\"a\":1}");
        assert_eq!(stored.sha.len(), 64);
        fs::write(&path, [0xff_u8, 0xfe]).unwrap();
        assert!(read_stored(&path).is_err());
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn commands_guard_names_and_sizes_before_touching_disk() {
        assert!(read_usage_file("Bad.json".into()).is_err());
        assert!(write_usage_file("../evil.json".into(), "x".into(), None).is_err());
        assert!(write_usage_file(
            "usage-cache.json".into(),
            "y".repeat(64 * 1024 * 1024 + 1),
            None
        )
        .is_err());
    }
}
