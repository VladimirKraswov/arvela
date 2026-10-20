//! Compatibility covers native code, dependencies, capabilities, configuration
//! and resources. Only the application's release number is excluded.
use sha2::{Digest, Sha256};
use std::{fs, path::Path};
pub fn fingerprint(root: &Path) -> Result<String, String> {
    fn walk(root: &Path, dir: &Path, files: &mut Vec<String>) -> Result<(), String> {
        for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name().to_string_lossy().to_string();
            if matches!(
                name.as_str(),
                "target" | "gen" | ".git" | ".DS_Store" | "node_modules"
            ) {
                continue;
            }
            if entry.file_type().map_err(|e| e.to_string())?.is_symlink() {
                return Err("Native input is a symbolic link".into());
            }
            if entry.path().is_dir() {
                walk(root, &entry.path(), files)?;
            } else {
                files.push(
                    entry
                        .path()
                        .strip_prefix(root)
                        .map_err(|e| e.to_string())?
                        .to_string_lossy()
                        .replace('\\', "/"),
                );
            }
        }
        Ok(())
    }
    let mut files = vec![];
    walk(root, root, &mut files)?;
    files.sort();
    let mut hash = Sha256::new();
    for name in files {
        let mut bytes = fs::read(root.join(&name)).map_err(|e| e.to_string())?;
        if name == "tauri.conf.json" {
            let mut config: serde_json::Value =
                serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
            config
                .as_object_mut()
                .ok_or("Invalid config")?
                .remove("version");
            bytes = serde_json::to_vec(&config).map_err(|e| e.to_string())?;
        } else if let Ok(text) = std::str::from_utf8(&bytes) {
            let text = text.replace("\r\n", "\n");
            if matches!(name.as_str(), "Cargo.toml" | "Cargo.lock") {
                let mut own = false;
                let lines: Vec<_> = text
                    .lines()
                    .filter(|line| {
                        if line.starts_with('[') {
                            own = false;
                        }
                        if matches!(*line, "name = \"arvela\"" | "name = \"enki\"") {
                            own = true;
                        }
                        !(own && line.starts_with("version = "))
                    })
                    .collect();
                bytes = lines.join("\n").into_bytes();
            } else {
                bytes = text.into_bytes();
            }
        }
        hash.update(name.as_bytes());
        hash.update([0]);
        hash.update(format!("{:x}\n", Sha256::digest(&bytes)).as_bytes());
    }
    Ok(format!("{:x}", hash.finalize()))
}
