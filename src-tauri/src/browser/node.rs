//! Which Node.js may run the managed browser. Only a user-configured absolute
//! path or a fixed list of well-known absolute locations is considered: PATH
//! and the working directory never choose the interpreter.
use crate::process::{output_with_timeout, RunError};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

const MINIMUM_MAJOR: u32 = 20;
const MISSING: &str =
    "Для браузера нужен Node.js 20+; установите Node.js или задайте его абсолютный путь.";
const TOO_OLD: &str = "Браузеру нужен Node.js версии 20 или новее.";
/// Bound on how many discovered interpreters are version-probed.
const MAX_PROBES: usize = 8;
const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

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

/// Version-manager layout `<base>/<version>/<suffix>`, newest version first.
/// Directory reads are bounded; unparsable names are ignored.
#[cfg_attr(target_os = "windows", allow(dead_code))]
fn versioned(base: &Path, suffix: &str) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(base) else {
        return Vec::new();
    };
    let mut found: Vec<(Vec<u32>, PathBuf)> = entries
        .flatten()
        .take(256)
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            Some((parse_version(&name)?, entry.path().join(suffix)))
        })
        .collect();
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().map(|(_, path)| path).collect()
}

#[cfg_attr(target_os = "windows", allow(dead_code))]
fn parse_version(name: &str) -> Option<Vec<u32>> {
    let parts = name
        .trim_start_matches('v')
        .split('.')
        .map(|part| part.parse().ok())
        .collect::<Option<Vec<u32>>>()?;
    (!parts.is_empty()).then_some(parts)
}

/// Absolute candidates in preference order: user-level shims, system/package
/// manager installs, then version managers (nvm, fnm, mise, asdf). A system
/// Node that is too old does not hide a newer version-manager install.
fn candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    let home = crate::paths::user_home().ok();
    #[cfg(not(target_os = "windows"))]
    {
        if let Some(home) = &home {
            out.extend([home.join(".local/bin/node"), home.join(".volta/bin/node")]);
        }
        out.extend(
            [
                "/opt/homebrew/bin/node",
                "/usr/local/bin/node",
                "/usr/bin/node",
            ]
            .map(PathBuf::from),
        );
        if let Some(home) = &home {
            out.extend(versioned(&home.join(".nvm/versions/node"), "bin/node"));
            out.extend(versioned(
                &home.join(".local/share/fnm/node-versions"),
                "installation/bin/node",
            ));
            #[cfg(target_os = "macos")]
            out.extend(versioned(
                &home.join("Library/Application Support/fnm/node-versions"),
                "installation/bin/node",
            ));
            out.extend(versioned(
                &home.join(".local/share/mise/installs/node"),
                "bin/node",
            ));
            out.extend(versioned(&home.join(".asdf/installs/nodejs"), "bin/node"));
        }
    }
    #[cfg(target_os = "windows")]
    {
        for variable in ["ProgramFiles", "ProgramW6432"] {
            if let Some(root) = std::env::var_os(variable).map(PathBuf::from) {
                out.push(root.join(r"nodejs\node.exe"));
            }
        }
        // nvm-windows points this variable at the active version's directory.
        if let Some(active) = std::env::var_os("NVM_SYMLINK").map(PathBuf::from) {
            out.push(active.join("node.exe"));
        }
        if let Some(home) = &home {
            out.push(home.join(r"AppData\Local\Programs\nodejs\node.exe"));
            out.push(home.join(r"scoop\apps\nodejs\current\node.exe"));
            out.push(home.join(r"scoop\apps\nodejs-lts\current\node.exe"));
        }
        out.push(PathBuf::from(r"C:\Program Files\nodejs\node.exe"));
    }
    let mut seen = std::collections::HashSet::new();
    out.retain(|path| seen.insert(path.clone()));
    out
}

fn major_version(node: &Path) -> Result<u32, String> {
    let mut command = Command::new(node);
    command.arg("--version");
    let output =
        output_with_timeout(&mut command, PROBE_TIMEOUT, 256).map_err(|error| match error {
            RunError::TimedOut => {
                "Проверка Node.js превысила 5 секунд. Проверьте указанный путь.".to_string()
            }
            RunError::Spawn(_) => "Не удалось запустить Node.js.".to_string(),
        })?;
    if !output.status.success() {
        return Err("Не удалось проверить Node.js.".into());
    }
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .trim_start_matches('v')
        .split('.')
        .next()
        .and_then(|major| major.parse().ok())
        .ok_or_else(|| "Не удалось определить версию Node.js.".to_string())
}

/// A configured interpreter must itself qualify; auto-discovery returns the
/// first candidate that runs and is new enough.
pub fn node_program(configured: Option<&str>) -> Result<PathBuf, String> {
    if let Some(value) = configured.map(str::trim).filter(|value| !value.is_empty()) {
        let path = PathBuf::from(value);
        if !executable(&path) {
            return Err("Укажите абсолютный путь к исполняемому Node.js.".into());
        }
        return if major_version(&path)? >= MINIMUM_MAJOR {
            Ok(path)
        } else {
            Err(TOO_OLD.into())
        };
    }
    let mut too_old = false;
    for candidate in candidates()
        .into_iter()
        .filter(|path| executable(path))
        .take(MAX_PROBES)
    {
        match major_version(&candidate) {
            Ok(major) if major >= MINIMUM_MAJOR => return Ok(candidate),
            Ok(_) => too_old = true,
            Err(_) => {}
        }
    }
    let error = if too_old { TOO_OLD } else { MISSING };
    Err(error.to_string())
}

fn npm_beside(node: &Path) -> Option<PathBuf> {
    let parent = node.parent()?;
    let canonical = fs::canonicalize(node).unwrap_or_else(|_| node.to_path_buf());
    let actual = canonical.parent().unwrap_or(parent);
    [
        parent.join("node_modules/npm/bin/npm-cli.js"),
        parent.join("../lib/node_modules/npm/bin/npm-cli.js"),
        actual.join("node_modules/npm/bin/npm-cli.js"),
        actual.join("../lib/node_modules/npm/bin/npm-cli.js"),
    ]
    .into_iter()
    .find(|path| path.is_file())
}

/// The real interpreter behind a shim (Volta and similar managers): Node
/// reports its own executable, which keeps npm discovery path-free.
fn real_executable(node: &Path) -> Option<PathBuf> {
    let mut command = Command::new(node);
    command.args(["-p", "process.execPath"]);
    let output = output_with_timeout(&mut command, PROBE_TIMEOUT, 4096).ok()?;
    let path = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
    (output.status.success() && path.is_absolute()).then_some(path)
}

pub(super) fn npm_cli(node: &Path) -> Result<PathBuf, String> {
    npm_beside(node)
        .or_else(|| real_executable(node).as_deref().and_then(npm_beside))
        .or_else(|| {
            [
                "/opt/homebrew/lib/node_modules/npm/bin/npm-cli.js",
                "/usr/local/lib/node_modules/npm/bin/npm-cli.js",
                "/usr/share/nodejs/npm/bin/npm-cli.js",
                "/usr/lib/node_modules/npm/bin/npm-cli.js",
            ]
            .map(PathBuf::from)
            .into_iter()
            .find(|path| path.is_file())
        })
        .ok_or_else(|| "Node.js найден, но npm не найден. Установите Node.js вместе с npm.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_manager_directories_are_ordered_newest_first() {
        let root = std::env::temp_dir().join(format!(
            "browser-node-versions-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        for name in [
            "v18.20.1", "v22.3.0", "v22.12.0", "v20.0.0", "system", "lts",
        ] {
            fs::create_dir_all(root.join(name)).unwrap();
        }
        let found: Vec<_> = versioned(&root, "bin/node")
            .into_iter()
            .map(|path| path.strip_prefix(&root).unwrap().to_path_buf())
            .collect();
        assert_eq!(
            found,
            ["v22.12.0", "v22.3.0", "v20.0.0", "v18.20.1"]
                .map(|name| Path::new(name).join("bin/node"))
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn every_candidate_is_absolute() {
        for candidate in candidates() {
            assert!(candidate.is_absolute(), "{}", candidate.display());
        }
    }

    #[test]
    #[cfg(unix)]
    fn an_old_configured_node_is_refused_with_a_version_message() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!("browser-node-old-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let script = root.join("node");
        fs::write(&script, "#!/bin/sh\necho v18.20.1\n").unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o700)).unwrap();
        assert_eq!(node_program(script.to_str()).unwrap_err(), TOO_OLD);
        fs::write(&script, "#!/bin/sh\necho v22.12.0\n").unwrap();
        assert_eq!(node_program(script.to_str()).unwrap(), script);
        fs::remove_dir_all(root).unwrap();
    }
}
