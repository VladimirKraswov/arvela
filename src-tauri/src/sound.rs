//! One short system chime for a task that finished away from the visible chat.
//!
//! Deliberately uses the desktop's own sound tooling instead of bundling an audio
//! stack: the app must not gain an audio-output dependency, and a missing player is
//! never an error — the yellow unread dot already carries the signal.

use std::path::Path;
use std::process::{Command, Stdio};

/// (player, arguments). The first entry whose program and sound file exist wins.
#[cfg(target_os = "macos")]
const PLAYERS: &[(&str, &[&str])] = &[("/usr/bin/afplay", &["/System/Library/Sounds/Glass.aiff"])];

/// freedesktop sound theme, covered by `libcanberra`/PulseAudio/PipeWire on Ubuntu.
#[cfg(target_os = "linux")]
const PLAYERS: &[(&str, &[&str])] = &[
    ("/usr/bin/canberra-gtk-play", &["-i", "complete"]),
    (
        "/usr/bin/paplay",
        &["/usr/share/sounds/freedesktop/stereo/complete.oga"],
    ),
    (
        "/usr/bin/pw-play",
        &["/usr/share/sounds/freedesktop/stereo/complete.oga"],
    ),
];

/// Windows extension point. Left empty on purpose: no Windows variant has been
/// built or tested, and a guessed player is worse than silence — the unread dot
/// already reports the completion. A Windows variant fills this table (and adds
/// `tauri.windows.conf.json`) rather than changing `completion_chime`.
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
const PLAYERS: &[(&str, &[&str])] = &[];

/// A candidate is usable when the player exists and every absolute-path argument
/// (the sound file) exists too. Pure, so the table stays verifiable in tests.
fn is_usable(candidate: &(&str, &[&str]), exists: &dyn Fn(&str) -> bool) -> bool {
    exists(candidate.0)
        && candidate
            .1
            .iter()
            .all(|arg| !arg.starts_with('/') || exists(arg))
}

fn pick<'a>(
    players: &'a [(&'a str, &'a [&'a str])],
    exists: &dyn Fn(&str) -> bool,
) -> Option<&'a (&'a str, &'a [&'a str])> {
    players.iter().find(|c| is_usable(c, exists))
}

#[tauri::command]
pub fn completion_chime() {
    let Some((program, args)) = pick(PLAYERS, &|path| Path::new(path).exists()) else {
        return;
    };
    let (program, args) = (program.to_string(), args.to_vec());
    std::thread::spawn(move || {
        if let Ok(mut child) = Command::new(&program)
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            // Reap the child so a repeatedly chiming session leaves no zombies.
            let _ = child.wait();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const TABLE: &[(&str, &[&str])] = &[
        ("/usr/bin/first", &["-i", "complete"]),
        ("/usr/bin/second", &["/sounds/complete.oga"]),
    ];

    #[test]
    fn skips_players_whose_program_or_sound_file_is_absent() {
        assert!(pick(TABLE, &|_| false).is_none());
        // Second player installed, but the sound theme package is not.
        let only_second = |p: &str| p == "/usr/bin/second";
        assert!(pick(TABLE, &only_second).is_none());
        let with_theme = |p: &str| p == "/usr/bin/second" || p == "/sounds/complete.oga";
        assert_eq!(pick(TABLE, &with_theme).unwrap().0, "/usr/bin/second");
    }

    #[test]
    fn prefers_the_first_usable_player() {
        assert_eq!(pick(TABLE, &|_| true).unwrap().0, "/usr/bin/first");
    }

    #[test]
    fn every_configured_player_uses_an_absolute_program_path() {
        // Never resolve the player through PATH: that would be attacker-influenced.
        for (program, _) in PLAYERS {
            assert!(program.starts_with('/'), "{program} must be absolute");
        }
    }
}
