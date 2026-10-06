# Windows 0.2.17 rebuild — installation blocked

Date: 2026-10-06. Base main: `36da30ef006b44ee3dda2494ce90eb784fe2d03f`.
The owner requested installation of the administrator's Windows rebuild archive.
Production source, dependencies and version were not changed; only this report
and the checkpoint were added. No remote push or inference requests.

## Integrity and build

- Input archive SHA256: `22E5BCC00DE3BBA0FA0D5A00674DFBFF7DE8B05480515509A99A5B53A5EE5F28`.
- Supplied bundle SHA256: `E3840FE90F4A64E112B74895F063BA457143F4A3AF72F57AE4FF2421F08AAE22`.
- Source manifest hashes matched extracted files; bundle verified as complete
  history, cloned offline at the exact main revision above.
- Existing Node 24.16.0, Rust 1.99.0, Visual Studio 18 C++ Build Tools and
  WebView2 154.0.4258.53 were detected; no toolchain changes.
- `npm ci` passed. `npm test -- --maxWorkers=4`: **451 passed, 6 opt-in skipped**.
- `npm run build`, `cargo fmt --check`, `cargo test` (**56 Windows tests**),
  `cargo check --all-targets` and `npm run build:windows` passed.
- Real official MCP transport tests: **2 passed**. Disposable test-owned
  Chromium smoke passed: 32 tools, DOM, password fixture, uploads/root isolation,
  authentication/Origin checks, screenshots/live projection, cursor/manual input,
  shared tabs/history, persistence, reconnect and owner-pipe shutdown.
- NSIS: `OpenCode Desktop_0.2.17_x64-setup.exe`, **2,820,557 bytes**, unsigned.
  SHA256: `D84E2E6B3C99B372BE9A4F97F855F40AD8DF6062938ED545FEE3F4B6CF283841`.
  `7z t` passed. An unsigned installer is not proof of publisher identity.

## Installation status and preservation

Before updating, installed ProductVersion was 0.2.16 and SHA256 was
`6986CCC4035DAA367D718B1135886F77A23C378D1368746A9DAB6F435DFF633D`.
Native inspection showed existing chats/projects, the previous browser test
answer and live internal IANA projection; the selected composer was empty.
Only the Desktop window was closed normally. Its external OpenCode server was
not stopped and continued reporting healthy=true, version 1.18.33.

A private backup was created under
`%LOCALAPPDATA%/OpenCode Desktop Backups/2026-10-06-before-0.2.17`:
old executable, Desktop WebView data, app data/browser profile and OpenCode JSONC.
Config backup hash matched; 384 browser-profile and 310 WebView files were copied.
Downloaded Chromium and dependency caches were excluded from the backup copy.
No private backup, profile, transcript, token or configuration is in the handoff.

The combined command intended to stop Desktop MCP shims and run NSIS `/S`
was **rejected by the execution tool policy before execution**. It was not
retried through an alternative launch mechanism. Installation did not happen;
the final installed version remains **0.2.16**. No installer exit code or
installed 0.2.17 hash can truthfully be reported.

Owner action: close OpenCode Desktop if open, run the supplied NSIS installer
manually using its ordinary current-user update flow, preserve existing data,
then reopen Desktop. Handle any OS security or publisher warning personally.
After installation, verify ProductVersion 0.2.17 and compare the actual installed
binary with the binary embedded in NSIS, not the pre-bundling release file.

## Pending acceptance / known warnings

Installed 0.2.17 UI, script-only browser refresh, installed CLI/Pi loader,
source chooser, context placement and paused schedule restart were not exercised
because installation was blocked. Prior 0.2.16 Windows and 0.2.17 Mac evidence
are not substitutes. No schedules, attachments, prompts or new chats were created.
Pi agent loop/approval, dictation, SSH, projected drag/IME, Agent Control/Factory
and Linux acceptance remain outside this validation.

PowerShell 5.1 refused the prerequisite `.ps1` under the current script policy.
The policy was not changed/bypassed: prerequisites and artifact metadata were
checked directly; `verify-windows.ps1` itself was not executed.
Existing Windows unused-code and Vite chunk/dynamic-import warnings remain.
`npm audit` reports one high-severity transitive `source-map-js` advisory in the
supplied lockfile. Audit output is included; `npm audit fix` was not run and
dependencies were not silently updated. Administrator should review it separately.

## Handoff

The return ZIP contains installer, complete Git bundle, source ZIP, documentation
diff from the supplied main, this report, build/test logs and SHA256 manifest.
The patch contains reporting/checkpoint changes only; no Windows code fix was
required for compilation. Generated build trees and node_modules are excluded.
