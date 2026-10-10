//! Per-OS locations for configuration and app-owned data.
//!
//! Two different owners are involved and they must not be confused:
//!
//! - **OpenCode's** configuration (`opencode.jsonc`). We do not get to decide where
//!   it lives — the separately installed engine does. Writing to a path the engine
//!   never reads would silently discard the user's settings, so resolution is
//!   *evidence first*: an existing directory always wins over a guess.
//! - **This app's** own data (projectless chat workspaces, the computer-control
//!   gate). We own it, but an installed release already has files there, so an
//!   existing directory still wins — an upgrade must not orphan previous chats.
//!
//! Only when nothing exists yet does the platform default apply: on Linux
//! `XDG_CONFIG_HOME` / `XDG_DATA_HOME` (absolute values only, per the XDG spec),
//! on macOS always `$HOME/.config` and `$HOME/.local/share`, byte-for-byte what
//! every verified 0.2.x build used.
//!
//! On Windows OpenCode itself still reports `%USERPROFILE%\.config\opencode`,
//! while Desktop-owned state belongs under `%LOCALAPPDATA%\opencode-desktop`.

use std::path::PathBuf;

pub fn user_home() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    let variable = "USERPROFILE";
    #[cfg(not(target_os = "windows"))]
    let variable = "HOME";
    let home =
        PathBuf::from(std::env::var_os(variable).ok_or_else(|| format!("{variable} недоступен"))?);
    if !home.is_absolute() {
        return Err(format!("{variable} должен быть абсолютным путём"));
    }
    Ok(home)
}

/// An XDG variable is only honoured when it is a non-empty absolute path, as the
/// spec requires. A relative value must be ignored, not joined onto the cwd.
fn xdg_override(variable: &str) -> Option<PathBuf> {
    let path = PathBuf::from(std::env::var_os(variable)?);
    path.is_absolute().then_some(path)
}

/// Candidate roots in preference order. macOS deliberately offers only the home
/// location so an installed release keeps resolving exactly as it did before.
fn candidates(variable: &str, fallback: &str) -> Result<Vec<PathBuf>, String> {
    let home = user_home()?.join(fallback);
    if cfg!(target_os = "linux") {
        if let Some(xdg) = xdg_override(variable) {
            // Both are plausible: the engine may predate the XDG variable being set.
            return Ok(if xdg == home {
                vec![home]
            } else {
                vec![xdg, home]
            });
        }
    }
    Ok(vec![home])
}

/// Pick the first candidate that already contains `leaf`; otherwise the first
/// candidate, which is where a fresh install will create it.
fn resolve(variable: &str, fallback: &str, leaf: &str) -> Result<PathBuf, String> {
    let roots = candidates(variable, fallback)?;
    let existing = roots.iter().map(|r| r.join(leaf)).find(|p| p.is_dir());
    Ok(existing.unwrap_or_else(|| roots[0].join(leaf)))
}

/// Directory holding OpenCode's own `opencode.jsonc` / `opencode.json`.
///
/// Evidence-first on purpose: if the engine already keeps its config under
/// `$HOME/.config/opencode` while `XDG_CONFIG_HOME` points elsewhere, editing the
/// XDG path would write a file OpenCode never loads.
pub fn opencode_config_dir() -> Result<PathBuf, String> {
    resolve("XDG_CONFIG_HOME", ".config", "opencode")
}

/// Root of this application's own data (chat workspaces, computer-control gate).
pub fn app_data_dir() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let root =
            PathBuf::from(std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA недоступен")?);
        if !root.is_absolute() {
            return Err("LOCALAPPDATA должен быть абсолютным путём".into());
        }
        return Ok(root.join("opencode-desktop"));
    }
    #[cfg(not(target_os = "windows"))]
    resolve("XDG_DATA_HOME", ".local/share", "opencode-desktop")
}

/// Path used *on the remote machine* by the SSH chat-workspace helper. It is a
/// literal, not a local resolution: the remote host has its own HOME and may not
/// be the same OS, and existing remote chats already live here.
pub const REMOTE_CHATS_SUBPATH: &str = ".local/share/opencode-desktop/chats";

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;
    use std::sync::{Mutex, MutexGuard};

    /// `set_var` is process-global; these tests must not run concurrently.
    static ENV: Mutex<()> = Mutex::new(());
    fn lock() -> MutexGuard<'static, ()> {
        ENV.lock().unwrap_or_else(|e| e.into_inner())
    }

    struct Scoped(&'static str, Option<std::ffi::OsString>);
    impl Scoped {
        fn set(name: &'static str, value: Option<&Path>) -> Self {
            let previous = std::env::var_os(name);
            match value {
                Some(path) => std::env::set_var(name, path),
                None => std::env::remove_var(name),
            }
            Scoped(name, previous)
        }
    }
    impl Drop for Scoped {
        fn drop(&mut self) {
            match self.1.take() {
                Some(previous) => std::env::set_var(self.0, previous),
                None => std::env::remove_var(self.0),
            }
        }
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "ocdesktop-paths-{tag}-{}-{stamp}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn only_absolute_xdg_values_are_honoured() {
        let _guard = lock();
        const VAR: &str = "OCDESKTOP_TEST_XDG_DIR";
        assert_eq!(xdg_override("OCDESKTOP_TEST_UNSET_VARIABLE"), None);
        // A relative or empty value must be ignored, not joined onto the cwd.
        for ignored in ["", "relative/path", ".."] {
            let _scoped = Scoped::set(VAR, Some(Path::new(ignored)));
            assert_eq!(xdg_override(VAR), None, "{ignored:?}");
        }
        let absolute = std::env::temp_dir().join("custom-xdg");
        let _scoped = Scoped::set(VAR, Some(&absolute));
        assert_eq!(xdg_override(VAR), Some(absolute));
    }

    /// The bug this guards: OpenCode keeps its config in `$HOME/.config/opencode`,
    /// the user exports `XDG_CONFIG_HOME` for some other tool, and the settings
    /// editor silently starts writing a file the engine never reads.
    #[test]
    #[cfg(target_os = "linux")]
    fn an_existing_engine_config_wins_over_an_unused_xdg_location() {
        let _guard = lock();
        let root = temp_dir("existing");
        let home = root.join("home");
        let xdg = root.join("xdg");
        fs::create_dir_all(home.join(".config/opencode")).unwrap();
        fs::create_dir_all(&xdg).unwrap();
        let _home = Scoped::set("HOME", Some(&home));
        let _config = Scoped::set("XDG_CONFIG_HOME", Some(&xdg));
        assert_eq!(
            opencode_config_dir().unwrap(),
            home.join(".config/opencode")
        );
        // Once the XDG location exists it is authoritative again.
        fs::create_dir_all(xdg.join("opencode")).unwrap();
        assert_eq!(opencode_config_dir().unwrap(), xdg.join("opencode"));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn a_fresh_linux_install_creates_under_xdg() {
        let _guard = lock();
        let root = temp_dir("fresh");
        let home = root.join("home");
        let xdg = root.join("xdg");
        fs::create_dir_all(&home).unwrap();
        let _home = Scoped::set("HOME", Some(&home));
        let _data = Scoped::set("XDG_DATA_HOME", Some(&xdg));
        assert_eq!(app_data_dir().unwrap(), xdg.join("opencode-desktop"));
        fs::remove_dir_all(&root).unwrap();
    }

    /// Without XDG variables the result must be identical to the shipped 0.2.x
    /// behaviour on both platforms.
    #[test]
    #[cfg(not(target_os = "windows"))]
    fn without_xdg_variables_both_platforms_use_the_home_layout() {
        let _guard = lock();
        let root = temp_dir("home-only");
        let home = root.join("home");
        fs::create_dir_all(&home).unwrap();
        let _home = Scoped::set("HOME", Some(&home));
        let _config = Scoped::set("XDG_CONFIG_HOME", None);
        let _data = Scoped::set("XDG_DATA_HOME", None);
        assert_eq!(
            opencode_config_dir().unwrap(),
            home.join(".config/opencode")
        );
        assert_eq!(
            app_data_dir().unwrap(),
            home.join(".local/share/opencode-desktop")
        );
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn the_remote_helper_path_stays_relative_to_the_remote_home() {
        assert!(!REMOTE_CHATS_SUBPATH.starts_with('/'));
        assert!(REMOTE_CHATS_SUBPATH.ends_with("/chats"));
    }
}

/// OpenCode owns one shared database under its data root.
pub fn opencode_data_dir() -> Result<PathBuf, String> {
    resolve("XDG_DATA_HOME", ".local/share", "opencode")
}
