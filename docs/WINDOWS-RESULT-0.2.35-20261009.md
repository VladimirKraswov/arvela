# Arvela 0.2.35 — Windows build and acceptance (2026-10-09)

Base main: `0705a1491494a03115a1da20b9e4c77753dc4e34`.
Branch: `windows/arvela-0.2.35-validation-20261009`.
Windows 11 Home Single Language 10.0.26200 x64; Node 24.16.0,
Rust 1.99.0 stable MSVC, VS18 C++ BuildTools, WebView2 154.0.4258.62.
Reused the clean existing checkout, preserving both earlier Windows branches
and PR2. Upstream now uses the canonical HTTPS `VladimirKraswov/arvela` name.
No version bump, manifest/lock change, main push, merge or release publication.

PR publication is blocked by existing GitHub OAuth permissions: pushing the
new upstream history to the old fork rejects inherited workflow files without
`workflow` scope. Direct upstream-ref creation returned 404 because that commit
was not in the fork. Created only the named review branch at the fork's old
620fb78 base; standard merge-upstream of that branch was also rejected (422).
No force push, token-scope change or main mutation. Local corrected commit and
offline patch/bundle are preserved; no new PR was created. User must authorize
GitHub workflow access through their own login before retrying publication.

## Confirmed defects and repairs

- Upstream Windows CI run 37936390986 fails both Git-backed project-map tests.
  Reproduced the underlying production error: Git exits 128 with
  `fatal: unable to access '\\.\nul': Invalid argument` when Node's Windows
  `os.devNull` is passed as `GIT_CONFIG_GLOBAL`. Use Git-compatible `NUL` on
  Windows only. Global/system configuration remain disabled; hooks/fsmonitor,
  workspace boundaries and fail-closed behavior are unchanged.
- This ordinary non-admin laptop also fails two tests creating symlinks (EPERM).
  Windows fixtures now use real directory junctions, including a source-looking
  link name. Outside-root traversal/non-regular-file refusal, unchanged owner
  data and exact error assertions stay enabled. Unix file-symlink tests remain.
  This does not claim individual file-symlink coverage on unprivileged Windows.
- Installed-panel acceptance still contained the diagnostic parsing defect from
  the open PR2. Retained its minimal test-only result-section parser with two
  Node behavioral regressions; all 36 tools are still required. No browser
  production code/permissions or assertion weakening.
- Added a Windows-only Rust behavioral test of existing KillOnCloseJob: attach
  before releasing a fixture child to spawn a grandchild, retain the descendant
  process handle, verify both alive, close job, verify both exit within bounds.
  It passed on this laptop. No discovery/killing of unrelated processes and no
  production process-management change. Actual Pi stop/UI fallback is separate.

## Verification

| Check | Result |
| --- | --- |
| Windows prerequisite script / npm ci | PASS |
| Initial base frontend run | FAIL: 651 pass, 3 fail, 6 skipped; retained log |
| Focused project-map/evaluation tests after repair | PASS: 26 |
| Complete frontend reruns | PASS: 654 / 6 existing opt-in skipped |
| TypeScript/Vite build | PASS; existing large-chunk/dynamic-import warnings |
| Offline eval:check | PASS, no inference |
| Hub Python unit/TLS tests | PASS: 37; first 3 errors were absent openssl PATH |
| Rust fmt / locked all-targets check | PASS |
| Rust tests after Job Object regression | PASS: 78 / 1 OS-vault opt-in ignored |
| NSIS per-user x64 build | PASS, unsigned; optimized compile 5m25s |
| Windows install-selector fixture | PASS: 10 cases, no registry writes |
| Artifact verifier | PASS; does not establish installation/health |
| 7-Zip NSIS test | PASS, parser BadCmd=13; not full payload extraction proof |
| Real disposable Chromium smoke | PASS: 36 tools, auth/Origin/DOM/password fixture/upload/workspace isolation, projection/manual input/tabs/history, profile/client restart/owner-pipe cleanup, modes/resize/scroll stale refusal and recovery, keyboard/atomic sequences/no replay/numeric telemetry |
| Final built Desktop CLI across two AppData views | PASS: same disposable home/browser, 36 tools |
| Real Pi 0.85.1 browser extension loader | PASS: argument validation/navigation/snapshot; no inference |
| Real shared SDK + final Desktop CLI + Pi loader | PASS: alias/discovery without calls/project scope/errors without replay/revocation fail closed; no owner OpenCode attachment |
| Installed 0.2.35 native UI/history/browser panel | PASS: normal per-user path, Settings version, retained recent chats/Qwen Medium, actual installed CLI 36 tools + panel input/click + DOM assertions |
| Native dictation/attachments/SSH/vault/Hub credentials/Pi inference | NOT RUN; no new support claim |

Hub tests used the existing `C:\Program Files\Git\usr\bin\openssl.exe` by
adding it only to that test process's PATH. No machine PATH/security change.
Browser and shared-tools tests use disposable homes, runtime/profile/fixtures
and read-only existing Chromium cache. Shared test's `installedDesktopCLI:true`
labels a supplied native command: here it is the final **built** executable,
not installed UI evidence. Its `realOpenCodeAttachment:false` is intentional.
No local/cloud inference, GPU operations or provider/model/permission changes.

## Artifacts and preservation

Installer `Arvela_0.2.35_x64-setup.exe`: 4,357,020 bytes, NotSigned.
SHA256 `CF7E4B7EA833BE96C3A750D1CFB5379A8E61443D76BEB98CC326A4B8777F2D0B`.
Standalone executable: 9,865,216 bytes.
SHA256 `9FDCB7ED915FC7D1E78ED3EB5D5C40CDD7A3403C9661B0CBF62459CDC9204E67`.
Tauri patches its bundle-type marker inside NSIS; standalone/installed hashes
are expected to differ. Installed payload and published common bridge both hash
`D40F6A1A7706FFAB11424EAB72E2A51BD5F150ED42DAD17616097A0E96514434`.
Exactly three bytes differ from standalone at offsets 9224407..9224409:
`UNK` becomes `NSS`, the expected Tauri bundle-type marker.

Private backup outside Git:
`C:\Users\sprot\.opencode-desktop-backups\20261009-before-arvela-0.2.35`.
Contains config (not dependency caches), common browser profile, ordinary
Explorer-copied normal WebView and chat attachment folders, previous bridge
binary and previous 0.2.21 installer. Originals preserved. The test-launched
old Desktop MSIX copy was closed normally; owner server OpenCode 1.18.33 is
healthy and was never terminated. Existing aborted history was not continued.
No old app/shortcut uninstall, data deletion or security barrier bypass.
The old normal/MSIX installations remain until separately scoped cleanup.

## Installed acceptance addendum (2026-10-09)

Owner approved installation, then personally completed the installer's running
old bridge warning/Next and reported that Desktop opened. The agent did not
press the kill confirmation. At the next inventory no Desktop window remained;
opened the already-installed executable through ordinary Explorer (not inherited
MSIX launch). Sky confirmed the normal process path
`C:\Users\sprot\AppData\Local\Arvela\opencode-desktop.exe` and Settings
`Arvela 0.2.35`. Existing recent chat list loaded, composer empty, local Qwen
Medium/qwen-build selected; no prompt, abort or history mutation was sent.

Opened the in-app panel at idle about:blank. Ran `installed-panel.mjs` with the
actual installed executable/common runtime; navigated only its own loopback
fixture, entered `PANEL_UI_OK` and clicked its button using native UI. Real MCP
snapshot/evaluate asserted exact input and result. Exit 0:
`{"installedAppCli":true,"tools":36,"liveProjection":true,"panelManualInputAndClick":true,"realDomEvaluation":true}`.
No external Chrome launch. Returned panel to about:blank, exited Settings,
left Desktop open. Common bridge 0.2.35 matches installed payload hash.
External OpenCode remains healthy 1.18.33. This proves installed MCP and manual
panel operation, not a fresh model-driven browser task, Pi inference/stop,
dictation, attachment upload, or exhaustive preservation of every setting.
Full live platform checklist remains partially unrun. Old pending-install
handoff/archive is retained unchanged; a new installed-result archive supersedes it.
Offline handoff must exclude all private backups/profiles/config/chat screenshots.
