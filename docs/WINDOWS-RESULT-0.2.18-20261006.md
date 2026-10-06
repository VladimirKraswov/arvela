# Windows 0.2.18 — shared browser MCP repair

User authorized implementation and a new-version archive after reporting
`MCP error -32000: Connection closed`. Base administrator main:
`36da30ef006b44ee3dda2494ce90eb784fe2d03f`. No remote push/public release.

## Cause and implementation

Native UI identified the normally launched Desktop as 0.2.17 and its daemon
as ready. The externally managed OpenCode process was originally started from
Codex's MSIX context. In that context the nominal AppData paths instead opened
a shadowed 0.2.16 executable and stale readiness record. A native file-handle
probe confirmed package LocalCache redirection. A real CLI probe reproduced
Connection closed, with stderr reporting that the browser did not respond;
the affected directory-scoped OpenCode MCP inventory showed failed status.

0.2.18 uses `%USERPROFILE%/.opencode-desktop/browser-runtime` on Windows only.
Both Desktop and engines resolve this shared location rather than independent
AppData views. The reserved MCP command points to a byte-identical versioned
copy of the real running Desktop executable under `bridge/0.2.18`, outside
the redirected installation directory. Pi uses the same bridge command.
Non-Windows paths are unchanged. No new dependencies or protocol/tool reimplementation.

During normal Desktop installation/setup, its own old browser profile, pinned
packages and Chromium cache are copied into a private migration staging tree.
The source is not moved/deleted. Chromium's manifest is rebased to the copied
cache. Shared profiles are never overwritten/merged with a different legacy
view. Cancellation is checked throughout; publication happens after copying.
Partial publication after a crash can preserve a profile while requiring a
fresh package install on retry. Nested links/linked profile or runtime are
refused; the existing top-level browser-cache junction can be read. Failed or
cancelled migration staging data may remain privately for recovery; not exported.

The app's other data roots, chat directories, session history, permissions,
provider/models and external server were not changed. Existing script/package
validation, lifecycle lock, headless Chromium sandbox, authenticated loopback,
main-window guards, file roots and no-replay semantics remain intact.

## Verification

- `npm test -- --maxWorkers=4`: **451 passed, 6 opt-in skipped**.
- `cargo test`: **59 Windows tests passed**, including three new migration tests
  for preserved originals/non-overwrite, cancellation and manifest relocation.
  The first manifest assertion exposed a Windows slash-representation mismatch;
  it now compares actual path components rather than JSON path spelling.
- `cargo fmt --check`, `cargo check --all-targets`, TypeScript/Vite and final
  `npm run build:windows` passed. Final production code was rebuilt after review.
- `windows-shared.mjs` passed against both actual debug and final release CLI.
  It copies pinned test tooling into a disposable home and uses two distinct
  LOCALAPPDATA values with one USERPROFILE. Each CLI discovers **32 tools**;
  one navigates and the other reads the same real browser through evaluation.
  No model requests, real profile, global config or user credentials are used.
  This is a controlled cross-environment regression, not installed normal/MSIX
  native UI acceptance. The real normal/MSIX deployment still needs the update.
- Earlier same-base 0.2.17 Windows headless smoke and two official proxy tests
  passed; browser JS production resources/dependency versions are unchanged.
- External OpenCode stayed healthy, version 1.18.33. It was never killed/restarted.

## Artifacts / installation

Unsigned NSIS `OpenCode Desktop_0.2.18_x64-setup.exe`: **2,825,828 bytes**.
SHA256: `C31F6E8A6A93821597B464393521257EB75D33646B9395B279258537A3643462`.
Post-bundling standalone release executable SHA256:
`3BFB7428D17A223121D01FCF1889C9EBA31A8DC615C07FA77827A6542BDF853A`.
7-Zip's supported installer streams passed its integrity test; its old NSIS
parser reports BadCmd=13 and does not fully describe the application payload.
No installed-binary/NSIS-extracted equality claim is made.

**0.2.18 has not been installed.** A previous automatic installer command was
rejected by execution policy; it was not retried via an alternate mechanism.
The owner must close Desktop, run this installer manually with the ordinary
current-user update flow, then reopen it. The installed 0.2.17 text draft must
be preserved. Handle unsigned-publisher/OS warnings personally, without bypass
automation. First setup copies the old browser cache/profile and may take time.
Check Browser settings become ready and the directory-scoped MCP connects, then
verify the built-in panel and DOM tools. Do not delete/reset profiles or engines.
Do not resubmit the owner's draft automatically.

Installed UI, real-profile migration, normal/MSIX deployment, Pi agent loop,
dictation and new Mac/Linux acceptance remain unverified. No test task/chat/
attachment was created in the owner's app. Previous private 0.2.17 backup remains
outside Git/archive. Native scheduling/source chooser acceptance is not newly claimed.
Known Windows unused-code and Vite warnings remain; the administrator-supplied
lockfile's high-severity transitive source-map-js audit remains separately flagged,
with no silent dependency upgrade.

Return archive: full-history bundle, source ZIP, complete diff from supplied
main (including earlier reporting-only checkpoint), installer, standalone binary,
this report, build/test logs and per-file SHA256 manifest. No node_modules,
target trees, private profiles, ready records, tokens, chats or config backups.
