# Project access recovery — 2026-10-09

## Evidence and cause

The previous OpenCode 1.18.18 process (PID 3714) answered `/global/health`, but directory-scoped requests for GPU Mesh returned HTTP 500. Its private log recorded EPERM in `realpathSync`/`lstat`, before normal session handling. The HTTP response was an opaque `UnknownError` with a reference, not the underlying filesystem error. The project remains owned by the user, mode 0755, with no deny ACL observed; no chmod/chown is warranted.

macOS unified TCC logs provide additional evidence:

- 20:42:20 Moscow: `Failed to match existing code requirement` for `dev.local.opencodedesktop`, SystemPolicyAllFiles, followed by denial. The two recorded code hashes differ.
- 20:42:21: OpenCode PID 3714 retained Arvela as its responsible identity, but TCC repeatedly reported `Failed to fetch responsible file descriptor`. TCC fell back to the CLI path. That particular Documents request was **allowed**; it must not be presented as the exact denied request that caused the later HTTP 500.
- 20:48:48: an Arvela-attributed shell also lacked a responsible file descriptor; TCC explicitly denied Documents access without a prompt.
- Installed Arvela uses an ad hoc signature with a designated requirement consisting of a code hash. `security find-identity -v -p codesigning` found no valid signing identities.

Together these establish an unstable privacy identity and orphaned launch context during the incident; they are the strongest explanation of the access failures, rather than ordinary folder permissions. The exact denied filesystem request of PID 3714 was not independently correlated to a TCC transaction. Restarting the same CLI from the current authorized execution context restored directory API access. That is recovery evidence, not proof that a future GUI-launched process has the same access.

Apple documents that ad hoc requirements bind to a specific build and compatible designated requirements permit sharing privacy-protected resources: [TN3127](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements). [Files and folders access](https://support.apple.com/guide/mac-help/control-access-to-files-and-folders-on-mac-mchld5a35146/mac) is separate from POSIX mode bits.

## Prevention and handling

- Autostart uses the application data directory as its working directory, never an inherited project location. An existing healthy external server is still reused, never killed/replaced automatically.
- Native bundle declares Documents/Desktop/Downloads usage descriptions. These explain requests; they do **not** grant access or fix an orphaned existing server.
- Package verification checks these descriptions and warns when the designated requirement is ad hoc.
- Project status/list/metadata/history failures are scoped to the current directory generation. A healthy global API does not clear a failed project status.
- Explicit EPERM/EACCES is distinguished from an opaque 500. The latter suggests checking access/configuration and includes only a validated error reference; it never invents a confirmed permission cause.
- Known project failure blocks OpenCode manual/queued sends and suppresses confirmed running indicators. Pi is not blocked by an OpenCode error. History, attachments, selection and draft remain intact.
- A failed project disarms its OpenCode queue. The read-only “Проверить доступ к проекту” button refreshes sessions/status/history/metadata without reconnecting the whole workspace, posting prompts, restarting a server, or resuming that queue. The user explicitly resumes queued work.
- macOS help is shown only on macOS. OS access is restored by the user through supported settings; no TCC database edits, privacy resets, broad grants or permission bypasses.

## Stable release signing

A bundle ID alone is insufficient with ad hoc signing. Future releases should use the same Developer ID Application identity and stable bundle ID, plus normal notarization. No certificate is available on this Mac, so current local builds cannot guarantee preservation of privacy grants across updates. Do not fabricate a stable requirement or automatically install a self-signed identity as a workaround.

With an already provisioned Developer ID identity, build using Tauri directly (the local npm Mac shortcut intentionally uses ad hoc signing):

```sh
npm exec tauri -- build --bundles app,dmg --config '{"bundle":{"macOS":{"signingIdentity":"Developer ID Application: YOUR NAME (TEAMID)"}}}'
python3 scripts/verify-macos.py src-tauri/target/release/bundle/macos/Arvela.app
codesign -d -r- src-tauri/target/release/bundle/macos/Arvela.app
```

After any identity-changing local upgrade, verify project reads in the application/server launch context. If access is denied, explain which launcher requires access and let the user renew it. Do not silently use another launcher's permissions as a permanent substitute.

## Verification

677 frontend tests passed, 6 existing opt-in skips; 94 Rust tests passed, 1 existing vault opt-in ignored; TypeScript/Vite, rustfmt and locked all-target checks passed. Native autostart fixture asserts the child working directory. Regression tests cover healthy transport with failed project reads, retained chat/queue, blocked send, explicit read-only recovery and late failure after a project switch. One prior Composer test used a fixed 40ms delay; the full suite exposed its race. It now waits for the actual send lifecycle to finish without weakening its attachment assertions. The browser-start regression also relied on a fixed number of promise turns; it now waits for the real browser-start call with unchanged assertions. Platform copy regression required generic link text.

Real isolated Chromium acceptance passed: global health succeeds while scoped requests return an opaque 500; the project warning appears, and explicit recovery removes it with no mutations. This fixture makes no owner/model requests.

Final Mac 0.2.37 app and DMG built; strict codesign/usage descriptions and DMG CRC verified. Installed final executable equals build SHA256 `cfd4fcf945d6985b93b00fc3f928edabb7c57d85b162b6b77a3a4dcfd2be4530`; previous 0.2.36 and intermediate 0.2.37 bundles retained privately. Native Desktop control reports connected/open streams/no project error. Existing OpenCode PID 40352 is unchanged: GPU Mesh session list, status and provider requests all return 200. No task/inference replay, server stop, GPU reassignment, OS permission changes, Git push or release publication occurred in this task. Existing server was launched from Codex during prior recovery; its successful reads do not certify a fresh GUI-launched server's TCC access. No Windows/Linux live verification.

Two browser-parser Node tests and offline evaluation self-check passed. Stable release signing remains an external prerequisite; graceful handling is installed, permanent OS permission preservation is not claimed. Private diagnostic logs and original TCC output are not published.
