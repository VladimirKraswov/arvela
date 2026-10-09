//! Shared ownership rules for child processes that Desktop itself spawns.
//!
//! - Every wait is bounded: no native command may pin a worker thread forever.
//! - Release builds on Windows have no console, so every console child (node,
//!   ssh, opencode) is created without a window of its own.
//! - Children that may spawn descendants lead their own Unix process group, so
//!   the whole tree can be signalled. Windows uses a kill-on-close Job Object.
//!
//! Nothing here discovers or signals a process Desktop did not start itself.

use std::{
    io::Read,
    process::{Child, Command, ExitStatus, Output, Stdio},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

/// Create a console program without a visible window on Windows; no-op elsewhere.
pub fn hide_console(command: &mut Command) -> &mut Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// Make the child the leader of a new Unix process group; no-op elsewhere.
pub fn own_process_group(command: &mut Command) -> &mut Command {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command
}

/// Poll until the child exits or `limit` passes. `None` means still running
/// (or its state could not be read), never "exited successfully".
pub fn wait_until(child: &mut Child, limit: Duration) -> Option<ExitStatus> {
    let deadline = Instant::now() + limit;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Some(status),
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(25)),
            Ok(None) | Err(_) => return None,
        }
    }
}

/// Stop a child that leads its own process group (see [`own_process_group`]):
/// SIGTERM to the group, a bounded grace period, then SIGKILL, then reap.
/// On Windows only the direct child is killed here; descendants are covered by
/// a [`KillOnCloseJob`] owned next to the child.
pub fn terminate_group(child: &mut Child, grace: Duration) {
    if matches!(child.try_wait(), Ok(Some(_))) {
        return;
    }
    #[cfg(unix)]
    signal_group(child, libc::SIGTERM);
    #[cfg(not(unix))]
    let _ = child.kill();
    if wait_until(child, grace).is_some() {
        return;
    }
    #[cfg(unix)]
    signal_group(child, libc::SIGKILL);
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(unix)]
fn signal_group(child: &Child, signal: libc::c_int) {
    // Safety: a plain syscall addressed to the group led by our own, not yet
    // reaped child, so its pid cannot have been reused by another process.
    unsafe {
        libc::killpg(child.id() as libc::pid_t, signal);
    }
}

#[derive(Debug)]
pub enum RunError {
    Spawn(std::io::Error),
    TimedOut,
}

/// Run a short command (version probes, small SSH helpers) to completion with
/// a deadline. Both pipes are drained concurrently and each is capped at
/// `max_bytes`; on timeout the child's process group is stopped and reaped.
pub fn output_with_timeout(
    command: &mut Command,
    limit: Duration,
    max_bytes: u64,
) -> Result<Output, RunError> {
    own_process_group(command);
    hide_console(command);
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(RunError::Spawn)?;
    let stdout = child.stdout.take().map(|pipe| drain(pipe, max_bytes));
    let stderr = child.stderr.take().map(|pipe| drain(pipe, max_bytes));
    let Some(status) = wait_until(&mut child, limit) else {
        terminate_group(&mut child, Duration::from_millis(500));
        return Err(RunError::TimedOut);
    };
    // A descendant may still hold a pipe open; never wait for it unbounded.
    let collect = |pipe: Option<mpsc::Receiver<Vec<u8>>>| {
        pipe.and_then(|receiver| receiver.recv_timeout(Duration::from_secs(1)).ok())
            .unwrap_or_default()
    };
    Ok(Output {
        status,
        stdout: collect(stdout),
        stderr: collect(stderr),
    })
}

fn drain<R: Read + Send + 'static>(pipe: R, max_bytes: u64) -> mpsc::Receiver<Vec<u8>> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut captured = Vec::new();
        let mut limited = pipe.take(max_bytes);
        let _ = limited.read_to_end(&mut captured);
        let _ = sender.send(captured);
        // Keep consuming so a verbose child never blocks on a full pipe.
        let _ = std::io::copy(&mut limited.into_inner(), &mut std::io::sink());
    });
    receiver
}

/// The last bytes a long-lived child wrote to a pipe. The pipe is drained
/// continuously, so the child can never block on it, and memory stays bounded.
#[derive(Clone, Default)]
pub struct OutputTail(Arc<Mutex<Vec<u8>>>);

impl OutputTail {
    pub fn follow<R: Read + Send + 'static>(mut pipe: R, limit: usize) -> Self {
        let tail = Self::default();
        let sink = tail.0.clone();
        thread::spawn(move || {
            let mut chunk = [0_u8; 4096];
            loop {
                match pipe.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => {
                        if let Ok(mut buffer) = sink.lock() {
                            buffer.extend_from_slice(&chunk[..read]);
                            if buffer.len() > limit {
                                let excess = buffer.len() - limit;
                                let recent = buffer.split_off(excess);
                                *buffer = recent;
                            }
                        }
                    }
                }
            }
        });
        tail
    }

    pub fn text(&self) -> String {
        self.0
            .lock()
            .map(|buffer| String::from_utf8_lossy(&buffer).trim().to_string())
            .unwrap_or_default()
    }
}

#[cfg(target_os = "windows")]
pub use windows_job::KillOnCloseJob;

#[cfg(target_os = "windows")]
mod windows_job {
    use std::{ffi::c_void, os::windows::io::AsRawHandle, process::Child};
    #[repr(C)]
    #[derive(Default)]
    struct Basic {
        process_time: i64,
        job_time: i64,
        flags: u32,
        min_working_set: usize,
        max_working_set: usize,
        active_limit: u32,
        affinity: usize,
        priority: u32,
        scheduling: u32,
    }
    #[repr(C)]
    #[derive(Default)]
    struct Io {
        read_operations: u64,
        write_operations: u64,
        other_operations: u64,
        read_bytes: u64,
        write_bytes: u64,
        other_bytes: u64,
    }
    #[repr(C)]
    #[derive(Default)]
    struct Extended {
        basic: Basic,
        io: Io,
        process_memory: usize,
        job_memory: usize,
        peak_process_memory: usize,
        peak_job_memory: usize,
    }
    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: u32 = 9;
    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x2000;
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateJobObjectW(attributes: *const c_void, name: *const u16) -> *mut c_void;
        fn SetInformationJobObject(
            job: *mut c_void,
            class: u32,
            info: *const c_void,
            length: u32,
        ) -> i32;
        fn AssignProcessToJobObject(job: *mut c_void, process: *mut c_void) -> i32;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }

    /// Closing this handle (drop, or Desktop exiting/crashing) terminates every
    /// process in the job: the child and all descendants it started.
    pub struct KillOnCloseJob(*mut c_void);
    // Job handles can be closed from any thread; ownership remains unique.
    unsafe impl Send for KillOnCloseJob {}
    impl KillOnCloseJob {
        pub fn attach(child: &Child) -> Result<Self, String> {
            unsafe {
                let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if job.is_null() {
                    return Err("Windows не создал Job Object для дочернего процесса.".into());
                }
                let mut info = Extended::default();
                info.basic.flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                if SetInformationJobObject(
                    job,
                    JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
                    &info as *const _ as *const c_void,
                    std::mem::size_of::<Extended>() as u32,
                ) == 0
                    || AssignProcessToJobObject(job, child.as_raw_handle()) == 0
                {
                    CloseHandle(job);
                    return Err(
                        "Windows не смог привязать дочерний процесс к Job Object Desktop.".into(),
                    );
                }
                Ok(KillOnCloseJob(job))
            }
        }
    }
    impl Drop for KillOnCloseJob {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(target_os = "windows")]
    fn job_close_terminates_its_child_and_grandchild() {
        use std::ffi::c_void;
        use std::io::{BufRead, BufReader, Write};
        #[link(name = "kernel32")]
        extern "system" {
            fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut c_void;
            fn WaitForSingleObject(handle: *mut c_void, milliseconds: u32) -> u32;
            fn CloseHandle(handle: *mut c_void) -> i32;
        }
        struct ProcessHandle(*mut c_void);
        impl Drop for ProcessHandle {
            fn drop(&mut self) {
                unsafe { CloseHandle(self.0) };
            }
        }
        let powershell =
            std::path::PathBuf::from(std::env::var_os("SystemRoot").expect("Windows SystemRoot"))
                .join("System32/WindowsPowerShell/v1.0/powershell.exe");
        let mut command = Command::new(powershell);
        // Attach before releasing stdin, so the fixture's descendant inherits
        // the job. All processes are test-owned; no process-name discovery.
        command.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$null=[Console]::ReadLine(); $p=Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList '-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 60' -WindowStyle Hidden -PassThru; [Console]::WriteLine($p.Id); [Console]::Out.Flush(); Start-Sleep -Seconds 60",
        ]);
        hide_console(&mut command);
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn fixture child");
        let job = match KillOnCloseJob::attach(&child) {
            Ok(job) => job,
            Err(error) => {
                terminate_group(&mut child, Duration::from_secs(1));
                panic!("fixture job attachment failed: {error}");
            }
        };
        let stdout = child.stdout.take().unwrap();
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            let mut line = String::new();
            let result = BufReader::new(stdout).read_line(&mut line);
            let _ = sender.send(result.map(|_| line));
        });
        child.stdin.take().unwrap().write_all(b"start\n").unwrap();
        let pid: u32 = receiver
            .recv_timeout(Duration::from_secs(15))
            .expect("bounded grandchild startup")
            .expect("read fixture PID")
            .trim()
            .parse()
            .expect("grandchild PID");
        // SYNCHRONIZE only. Retain the actual handle to avoid PID reuse races.
        let grandchild = ProcessHandle(unsafe { OpenProcess(0x0010_0000, 0, pid) });
        assert!(!grandchild.0.is_null(), "open test-owned descendant");
        assert_eq!(unsafe { WaitForSingleObject(grandchild.0, 0) }, 258);
        assert!(matches!(child.try_wait(), Ok(None)));
        drop(job);
        assert_eq!(unsafe { WaitForSingleObject(grandchild.0, 5000) }, 0);
        assert!(wait_until(&mut child, Duration::from_secs(5)).is_some());
    }

    #[test]
    #[cfg(unix)]
    fn bounded_output_returns_captured_streams() {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "printf out; printf err >&2; exit 3"]);
        let output = output_with_timeout(&mut command, Duration::from_secs(5), 1024).unwrap();
        assert_eq!(output.status.code(), Some(3));
        assert_eq!(output.stdout, b"out");
        assert_eq!(output.stderr, b"err");
    }

    #[test]
    #[cfg(unix)]
    fn bounded_output_kills_a_hanging_child_within_its_deadline() {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "sleep 30"]);
        let started = Instant::now();
        assert!(matches!(
            output_with_timeout(&mut command, Duration::from_millis(300), 1024),
            Err(RunError::TimedOut)
        ));
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    #[cfg(unix)]
    fn verbose_children_cannot_deadlock_and_capture_is_capped() {
        // 512 KiB is far beyond any pipe buffer; a reader that stopped at the
        // cap would leave the child blocked until the deadline.
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "head -c 524288 /dev/zero"]);
        let started = Instant::now();
        let output = output_with_timeout(&mut command, Duration::from_secs(10), 1024).unwrap();
        assert!(output.status.success());
        assert_eq!(output.stdout.len(), 1024);
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn output_tail_keeps_only_the_most_recent_bytes() {
        let tail = OutputTail::follow(std::io::Cursor::new(b"0123456789abcdef".to_vec()), 6);
        let deadline = Instant::now() + Duration::from_secs(2);
        while tail.text() != "abcdef" && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(tail.text(), "abcdef");
    }
}
