/// Play the fixed macOS system chime only for a newly finished unattended task.
#[tauri::command]
pub fn completion_chime() {
    #[cfg(target_os = "macos")]
    std::thread::spawn(|| {
        use std::process::{Command, Stdio};
        if let Ok(mut child) = Command::new("/usr/bin/afplay")
            .arg("/System/Library/Sounds/Glass.aiff")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            let _ = child.wait();
        }
    });
}
