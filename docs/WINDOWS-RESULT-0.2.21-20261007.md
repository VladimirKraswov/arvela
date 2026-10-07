# AgentMesh Desktop 0.2.21 — Windows installed, browser panel verified

## Installation addendum — 2026-10-07

User confirmed native installation at action time. Normal Windows launch now
runs `C:\Users\sprot\AppData\Local\AgentMesh Desktop\opencode-desktop.exe`;
native Settings confirms 0.2.21. Existing chat/history and its Qwen Flash Next /
Low / qwen-build selection remain visible; no draft/model request was sent.
External OpenCode remains healthy, version 1.18.33, and was not terminated.

Private backup completed outside Git: configuration, previous installer/binary,
common browser profile, actual normal Windows WebView `EBWebView` and `chats`,
plus separately labelled Codex/MSIX-visible copies. Ordinary Explorer was used
for the normal profile copies because Codex's nominal AppData view is redirected.
These private files are excluded from all handoff artifacts.

The first native launcher inherited Codex/MSIX redirection and installed a shadow
copy. It was closed normally. Launching the same installer from ordinary Explorer
installed and opened the normal Windows copy above. The installer stopped the
old Desktop MCP bridge only; the separately managed engine was preserved.
Old OpenCode Desktop 0.2.18 and its shortcut remain alongside AgentMesh: the
PRODUCTNAME rename did not detect the legacy installation. No uninstallation,
shortcut deletion, registry migration or security bypass was performed. The
closed MSIX shadow copy also remains; cleanup requires separately scoped consent.

Installed NSIS payload SHA256 (and published common bridge 0.2.21):
`78019A6B28EF54FDCA6A1D5F6D67C5C492FAF4AB22B0472E8073415195B5C99F`.
It differs from the standalone build hash below only at three bytes, offsets
7316511..7316513: Tauri's `__TAURI_BUNDLE_TYPE_VAR_UNK` marker becomes
`__TAURI_BUNDLE_TYPE_VAR_NSS` for NSIS. Exact binary comparison confirmed this;
do not mistake the standalone/payload hash distinction for corruption.

Installed `windows-shared.mjs` run passed against a disposable home, including
the real Pi 0.85.1 loader/navigation/snapshot (no inference). Its optional Pi
label still reports `installedAppCli:false`; this label does not imply owner
Desktop/Pi UI acceptance. Normal Desktop Settings instead shows Pi unavailable;
Codex-visible Pi module load success is not proof of normal Windows discovery.

Installed-panel acceptance PASSED using the installed executable and shared
runtime: 33 tools, `browser_keyboard_type`, live projection, real manual input
`PANEL_UI_OK`, button result exactly matching it, and DOM evaluation. The test
used only an idle browser's local HTTP fixture, not an owner website. The first
runner failed parsing the appended `Desktop browser state:` diagnostic, not
performing the input. A minimal test-only parser repair plus two Node regression
tests passed; the complete live panel rerun then exited 0. No browser production
code or permissions changed. Application stays open; test page is cleared.

Remaining NOT TESTED: normal Pi UI/inference and Job Object tree cleanup,
native modes/resize/scale/theme/reconnect/off-on, attachment picker/clipboard/drop,
mic/dictation, stop with images, paused schedules, SSH, Agent Control/Factory.
Legacy duplicate cleanup is pending. The historical pre-install results below
are retained as a dated build checkpoint, superseded by this addendum only where
explicitly stated. This is partial Windows acceptance, not a release approval.

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
