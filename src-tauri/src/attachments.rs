//! Original ZIP bytes, stored privately for either agent's own file tools.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{fs, io::Write, path::Path};
use tauri::State;

const MAX_BYTES: usize = 50 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveReference {
    version: u8,
    name: String,
    path: String,
    url: String,
    size: usize,
    sha256: String,
    remote: bool,
}

pub(crate) fn validate_id(id: &str) -> bool {
    id.len() == 36 && id.bytes().all(|c| c.is_ascii_hexdigit() || c == b'-')
}
fn validate_zip(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() < 4
        || bytes.len() > MAX_BYTES
        || ![b"PK\x03\x04", b"PK\x05\x06"]
            .iter()
            .any(|magic| bytes.starts_with(*magic))
    {
        return Err("Нужен ZIP-архив размером до 50 МБ.".into());
    }
    Ok(())
}
fn save_local(root: &Path, id: &str, bytes: &[u8]) -> Result<String, String> {
    if !validate_id(id) {
        return Err("Некорректный идентификатор вложения.".into());
    }
    if fs::symlink_metadata(root).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("Каталог вложений не должен быть ссылкой.".into());
    }
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let directory = root.join(id);
    fs::create_dir(&directory).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(directory.join("archive.zip.part"))
            .map_err(|e| e.to_string())?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(unix))]
    {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(directory.join("archive.zip.part"))
            .map_err(|e| e.to_string())?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
    }
    let file = directory.join("archive.zip");
    fs::rename(directory.join("archive.zip.part"), &file).map_err(|e| e.to_string())?;
    Ok(fs::canonicalize(file)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .into_owned())
}

#[tauri::command]
pub async fn stage_archive(
    id: String,
    name: String,
    data: String,
    server_home: String,
    ssh_target: Option<String>,
    endpoint: String,
    hosts: State<'_, crate::hosts::Hosts>,
) -> Result<ArchiveReference, String> {
    if !validate_id(&id)
        || name.len() > 1024
        || name.chars().any(char::is_control)
        || !name.to_lowercase().ends_with(".zip")
        || data.len() > MAX_BYTES.div_ceil(3) * 4
    {
        return Err("Некорректное ZIP-вложение.".into());
    }
    let handles = hosts.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = STANDARD.decode(data).map_err(|_| "Не удалось прочитать ZIP-вложение.")?;
        validate_zip(&bytes)?;
        let remote = ssh_target.is_some();
        let path = if let Some(target) = ssh_target {
            crate::hosts::upload_archive(&handles, &target, &endpoint, &id, &bytes)?
        } else {
            let home = crate::paths::user_home()?;
            if fs::canonicalize(home).map_err(|e| e.to_string())? != fs::canonicalize(server_home).map_err(|e| e.to_string())? {
                return Err("Сервер находится на другой машине. Подключитесь через SSH для передачи архива.".into());
            }
            save_local(&crate::paths::app_data_dir()?.join("attachments"), &id, &bytes)?
        };
        let url = if remote {
            let mut url = url::Url::parse("file:///").map_err(|e| e.to_string())?;
            url.set_path(&path); url
        } else { url::Url::from_file_path(&path).map_err(|_| "Некорректный путь вложения.")? };
        Ok(ArchiveReference { version: 1, name, path, url: url.to_string(), size: bytes.len(),
            sha256: format!("{:x}", Sha256::digest(&bytes)), remote })
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn archive_is_preserved_without_extraction_or_overwriting() {
        let root = std::env::temp_dir().join(format!("arvela-archive-test-{}", std::process::id()));
        fs::create_dir(&root).unwrap();
        let id = "12345678-1234-1234-1234-123456789abc";
        let bytes = include_bytes!("../../test/fixtures/source-archive.zip");
        validate_zip(bytes).unwrap();
        let path = save_local(&root, id, bytes).unwrap();
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert!(!root.join(id).join("src/example.ts").exists());
        assert!(save_local(&root, id, b"other bytes").is_err());
        assert!(save_local(&root, "../../outside", bytes).is_err());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn refuses_non_zip_and_linked_archive_storage() {
        assert!(validate_zip(b"not a zip").is_err());
        #[cfg(unix)]
        {
            let root =
                std::env::temp_dir().join(format!("arvela-archive-link-{}", std::process::id()));
            std::os::unix::fs::symlink(std::env::temp_dir(), &root).unwrap();
            assert!(save_local(
                &root,
                "12345678-1234-1234-1234-123456789abc",
                b"PK\x05\x06data"
            )
            .is_err());
            fs::remove_file(root).unwrap();
        }
    }
}
