# Development and verification

## Bootstrap

Official `create-tauri-app` 4.7.4, `react-ts`, npm, Tauri 2. Product name is OpenCode Desktop. Dependencies are tracked by npm and Cargo lockfiles. The initial worker implementation was independently reviewed and corrected; the current shell includes native chat/PTY acceptance evidence.

Run from this project directory. On the current Mac, `NODE_PATH` can point into an unrelated project: use `env -u NODE_PATH npm …` when necessary. The app connects to an already running OpenCode server and does not discover or launch an executable from PATH.

## Verification ladder

1. Unit tests for API normalization, message/event reducer, session scoping, reconnect deduplication and request lifecycle.
2. Component tests for composer, real pending permissions/questions, error/empty states and keyboard behavior.
3. `npm run build` for TypeScript and bundling; `cargo check --manifest-path src-tauri/Cargo.toml` for native changes; Rust tests for native transport/validation where appropriate.
4. Contract fixtures captured without private content; integration tests in a temporary Git repository created by the test.
5. Native manual smoke: connect, select project, create session, submit task, see live tools, inspect diff, terminal, stop/reconnect, restart app. Use exactly one inference request at a time on this system.
6. Release `.app` build and launch without Vite or a developer shell. Record actual results in `docs/VERIFICATION.md`.

Initial Cargo dependency compilation may take several minutes. Use an adequate bounded timeout rather than repeatedly killing/restarting it. Never hide build failures with a successful wrapper command. Don't call `npm test` passed until a real test script exists and runs meaningful tests.

## Build variants

Two reviewed variants, one shared source tree: `npm run build:linux` (`.deb`) and
`npm run build:macos` (`.app` + `.dmg`, ad-hoc signed). The platform-neutral
`tauri.conf.json` carries no macOS chrome or entitlements; `tauri.macos.conf.json`
and `tauri.linux.conf.json` add only their own keys, and `test/bundle-config.test.ts`
fails if either drifts or if an untested Windows variant appears. Exact commands,
the support matrix and the Windows extension points are in `docs/PLATFORMS.md`.

`./scripts/check-linux-prereqs.sh` reports missing Tauri 2 system libraries and prints
the `apt` line; it never installs anything, so an agent can stop cleanly at the
system-package boundary. On Ubuntu 24.04 the required set is `build-essential
pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev libsoup-3.0-dev librsvg2-dev libssl-dev`.

For a headless Linux smoke test start `Xvfb :N -screen 0 1360x900x24`, run the binary
with `DISPLAY=:N` and confirm the window with `xwininfo -root -tree` (software
rendering prints harmless `libEGL warning: DRI3` lines). Do not point a test run at
the owner's real OpenCode server: an unreachable endpoint is the expected result and
exercises the error state.

## Test safety

Use only explicitly created test projects/sessions. Never delete, reset or summarize a user's existing conversation to test behavior. Git status and before/after diffs must demonstrate user work is preserved. Do not mutate another project as a convenience. Do not upgrade/stop OpenCode or restart FreeToken during ordinary UI tests.

## Visual QA

Check dark and light modes, empty app, long message/code, expanded tool error, pending permission, disconnected server, narrow window and three-panel layout. Buttons must perform their labeled action. Native-only APIs can be mocked in explicit frontend development/tests but the packaged release must use real implementations. Save useful screenshots locally and describe what was manually checked.

## Deliverable

A locally built `OpenCode Desktop.app`, source, tested instructions, compatibility notes and honest feature checklist. Install under the user's Applications only after verification; create a Desktop shortcut without overwriting the existing Qwen OpenCode launcher. The user explicitly authorized GitHub publication on 2026-09-22. Publish source/docs/tests to the private repository and attach the built DMG to its release; exclude local receipts, chat histories, credentials and app backups.
