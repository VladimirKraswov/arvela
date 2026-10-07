# AgentMesh Desktop 0.2.21 — Windows build verified, installation pending

Date: 2026-10-07 (Europe/Moscow). Windows 11 Home Single Language,
10.0.26200 x64. Public HTTPS main base:
`620fb78afe597a6da2c317a0dd49c352a670bba2` (unchanged on final fetch).
Branch: `windows/agentmesh-0.2.21-validation-20261007`.
Fresh checkout: `C:\Dev\agentmesh-desktop-0.2.21`; old archive/checkouts preserved.
Production runtime/manifests/dependency locks unchanged; fixes affect acceptance
helpers, tests and documentation only. Version remains 0.2.21.

## Artifacts

NSIS: `AgentMesh Desktop_0.2.21_x64-setup.exe`, 2,844,356 bytes.
SHA256: `08F2BEEEB34B86D566308369D37A6A35E1A0AE18D9E575063F2492006D2F247B`.
Compiled executable: 7,895,040 bytes;
SHA256: `F5D4D6F6765D963AD57318EE2188498F2444FE1DBE39B3E175A4A4E4406126E5`.
Installer is unsigned (`NotSigned`), per-user x64 NSIS.
Local output: `C:\Dev\agentmesh-validation-20261007\outputs`.
Offline desktop archive includes installer, executable, full Git bundle,
source ZIP, patch, report, logs and a payload SHA256 manifest. Private backups,
profiles, histories, tokens, node_modules and target are excluded.

## Commands and evidence

Native exit codes checked; required build commands ran sequentially. Node
24.16.0, Rust 1.99.0 stable-x86_64-pc-windows-msvc, VS18 BuildTools C++ workload,
WebView2 154.0.4258.62; prerequisites script passed in PowerShell 7.

| Check | Result |
| --- | --- |
| `npm.cmd ci` | PASS, lockfile unchanged |
| `npm.cmd test -- --maxWorkers=2` | PASS: 488 tests / 6 opt-in skipped (base: 487/6) |
| `npm.cmd run build` | PASS, existing chunk/dynamic-import warnings |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | PASS |
| `cargo check --manifest-path src-tauri/Cargo.toml --all-targets --locked` | PASS, repeated after final helper changes |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked` | PASS: 63 / 1 OS-vault opt-in ignored |
| `npm.cmd run build:windows` | PASS, final NSIS produced |
| `scripts/test-windows-install-selection.ps1` | PASS: 8 behavioral fixture cases, no registry writes |
| `scripts/verify-windows.ps1 ... -ArtifactOnly` | PASS, size/hash/signature recorded; no installation/health claim |
| `7z t <NSIS>` | PASS with NSIS-3 Unicode `BadCmd=13`; not full payload extraction evidence |
| `node .../test/smoke.mjs <temporary runtime>` | PASS: real Chromium, 33 tools, auth/Origin, DOM, fixture upload, workspace isolation, images/projection, manual input, tabs/history, profile/client restart, owner-pipe cleanup |
| Same smoke: human/fast, actual resize, stale manual/agent input, recovery image, responsive XY click, keyboard paste | PASS, no action replay |
| `node .../test/windows-shared.mjs <final exe> <temporary runtime> <installed Pi package>` | PASS: two AppData views, same disposable home/browser, final CLI 33 tools; real Pi 0.85.1 loader/argument validation/navigation/snapshot |
| Installed 0.2.21, upgrade/data persistence, new bridge publication | NOT TESTED: Windows UI installation confirmation pending |
| Installed panel input, native window resize/scale, light/dark, reconnect/off-on | NOT TESTED on 0.2.21; isolated runtime results are not packaged UI acceptance |
| Live file picker, multiple attachments, clipboard/drop, mic/dictation, stop with images, paused schedule persistence | NOT TESTED on installed 0.2.21 |
| Pi inference/UI, process-tree Job Object cleanup, SSH, Agent Control/Factory | NOT TESTED; existing capability limitations remain |

All browser runtime writes used `%TEMP%\oc-browser-agentmesh-20261007` or
test-owned shared homes. Chromium binaries reused read-only from the app cache.
No owner browser navigation or model requests; no global configuration writes.
Pi result reports `installedAppCli:false`: this was the final **built** CLI,
not an installed application. Recovery propagation remains covered by source
tests, not a live Pi inference run. npm audit reports one high-severity
`source-map-js@1.2.1` issue via jsdom/css-tree and Vite/postcss
(GHSA-68fv-2mgg-jv7q); report-only, no automatic dependency upgrade.

## Changes

- Installed verifier recognizes both product DisplayNames, selects the expected
  version rather than the first stale record, and rejects duplicate matching
  versions. Artifact-only health stays null instead of falsely reporting failure.
- Installed-panel runner expects all 33 tools including `browser_keyboard_type`.
  Frontend source-contract regression guards this acceptance expectation.
- Windows shared-runtime runner can additionally invoke the real Pi loader
  within the disposable home, bounded to 120 seconds, without owner navigation.
- Acceptance README updated to the 33-tool contract. No production browser,
  CSP, permissions, credential or process-management code changed.

## Installation state and preservation

Before update, actual native UI showed **OpenCode Desktop 0.2.18** at
`C:\Users\sprot\AppData\Local\OpenCode Desktop\opencode-desktop.exe` (PID22152).
The browser bridge was `.opencode-desktop\browser-runtime\bridge\0.2.18`.
Codex/MSIX nominal uninstall view showed stale 0.2.16, so that shadow registry
cannot establish the normally launched installed version. The user's chat,
draft and browser page were observed but not submitted or navigated. App left
open; external OpenCode 1.18.33 remains healthy, existing server not terminated.

Private config, old shared 0.2.18 binary and hash-verified previous installer
were backed up outside Git under
`C:\Users\sprot\.opencode-desktop-backups\20261007-before-agentmesh-0.2.21`.
Live browser/WebView profiles have **not** yet been backed up: do this after
normal Desktop closure, before installation. This is not a complete pre-update
backup. No installation/security barrier was bypassed and no install success
is claimed.

Generated NSIS uses PRODUCTNAME-based uninstall/manufacturer keys. Since the
name changed, fresh AgentMesh installation may not detect legacy OpenCode
automatically; duplicate shortcut/old-app cleanup and data-preserving upgrade
must be checked in the real installer. No speculative registry migration or
automatic legacy uninstallation was added. Preserve application ID/data paths.

## Mac coordinator / next steps

Review the helper/test PR; do not treat this report as full Windows acceptance.
Re-run frontend tests on Mac and review optional Pi runner isolation. Mac/Linux
runtime code is unchanged. Complete ordinary Windows installation with user
confirmation, private profile backup and data-preserving legacy upgrade, then
verify actual binary/path/version, unique shortcuts, common 0.2.21 bridge,
owner history/settings and installed browser/Pi/native UI scenarios above.
Do not merge/publish a Windows release solely because this build passed.
