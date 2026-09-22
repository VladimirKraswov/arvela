# Verification record

## Window dragging hotfix — 0.1.1, 2026-09-22

- Root cause: the custom titlebar invoked `start_dragging` without the required capability; bare drag regions also excluded their nested label/spacer hit targets. See [Tauri window guidance](https://v2.tauri.app/learn/window-customization/).
- Added only `core:window:allow-start-dragging` to the existing main-window capability. The installed Tauri 2.11.6 `window/scripts/drag.js` supports `data-tauri-drag-region="deep"`, including descendants while excluding buttons/interactive controls. Both titlebar regions now use this native mode; text selection is disabled only on native window chrome.
- App/settings version updated to 0.1.1. The settings display reads package.json instead of a stale literal.
- 68 frontend tests passed; frontend production build, cargo check and final app/DMG build passed. No Rust implementation changes; the two native ASR tests from0.1.0 remain previous evidence, not a new run.
- Installed native0.1.1 was dragged from free titlebar space and from the title text. The review button still toggled on/off, and settings showed0.1.1. No inference request or user project change was needed.
- Installed to `/Applications/OpenCode Desktop.app`, aliases unchanged. `hdiutil verify`: VALID. Build/installed executable hashes match.
- Executable SHA256: `01c70536f7f6b349593043869fda39bb831720288c54a9fa0a8b558e634cfe0f`.
- DMG SHA256: `4c7aa0453c87aa5b0c13ebde3bbe95ff958de4bf6322c06e32227e9b3295a28c`.

## Original 0.1.0 acceptance pass — 2026-09-22

Supersedes the original worker's completion claims below. See [independent corrections](ACCEPTANCE-2026-09-22.md) and [context, access, queue and voice contracts](CONTEXT-QUEUE-VOICE.md).

### Automated checks and package

- `env -u NODE_PATH npm test`: **68/68 passed**. Includes model/Medium defaults, endpoint/project isolation, late archives, duplicate sends, stale acknowledgements, snapshot/delta races, opaque pagination, strict origins, PTY tickets, CRLF SSE, compaction accounting, queue/access and five popup placement regressions.
- The five original independent review reproducers passed unchanged; equivalent assertions remain in the main suite. They are additional acceptance evidence, not five extra product features.
- `env -u NODE_PATH npm run build`: passed (TypeScript + Vite production build).
- `cargo check --manifest-path src-tauri/Cargo.toml`: passed.
- `cargo test --manifest-path src-tauri/Cargo.toml`: **2/2 passed**, including endpoint validation and an actual multipart roundtrip with synthetic audio.
- `CARGO_BUILD_JOBS=2 env -u NODE_PATH npm run tauri -- build --bundles app,dmg`: passed for the final source; native app and DMG exist.
- `hdiutil verify` on the delivered DMG: VALID. SHA256: `06a8475ca73c48aa386ca3dbabd0d12a6aefeb47b2c80d82cbb9897ff4b4d20c`.
- Build bundle and installed executable match: SHA256 `dec4302d6558fc1072b62bf62d8654eb83603c989e7761b89f40ed5f42bca145`.

### Real browser and native acceptance

All new inference checks used local Qwen3.8 Flash Next / Medium sequentially, in a disposable project. No user project or existing conversation was modified.

- Live API pagination: 200 recent + 124 older messages, zero overlap, using `X-Next-Cursor`. A message-ID cursor reproduced HTTP 400 and was replaced.
- Project/session selection, model defaults, archive/restore, project/endpoint draft isolation and ticket-authenticated PTY reconnect were exercised in the browser.
- While a real bash tool was running, one queued correction was sent with “Скорректировать сейчас”. The same engine loop consumed it at the next step and returned `LIVE_STEER_42`. A separate queued prompt then dispatched automatically once and returned `QUEUE_AUTO_42`.
- Context meter displayed actual usage 9434/131072 and 72486 tokens remaining to the installed engine's 81920 compaction threshold. Engine automatic compaction remains enabled. Manual compaction completed with a real compaction part and successful summary response; a separate automatic overflow run was not forced.
- Read-only access changed the test session's actual permission rules through the API. No global permission configuration changed.
- Final native application selected/resumed the test session, streamed a real read-tool call and answer `NATIVE_CHAT_42`, and displayed the existing file content `SMOKE42`.
- Real native terminal executed `printf "NATIVE_TERMINAL_42\n"; pwd`; output and the correct disposable working directory were visible. The test PTY was closed explicitly.
- A draft was saved, the app was quit and the final bundle installed. Reopening the installed app restored both session and draft. The test draft was then cleared.
- The external OpenCode 1.18.18 server remained running independently. TinyCAD's port 1420 was not used or altered; our development port is 1425.

Popup correction: real browser checks at 1280×720 and 900×620 show unclipped menus, a scrolling model list and upward-flipping sidebar actions; no browser warnings/errors. The rebuilt installed native app also showed the complete agent menu, scrolling model list and filtering by `qwen`, with no clipping. See acceptance notes.

### Installation and limitations

Canonical installed app: `/Applications/OpenCode Desktop.app`. `~/Applications/OpenCode Desktop.app` and the Desktop shortcut resolve to it. Both earlier app copies were backed up locally; the original `Qwen OpenCode.app` launcher was preserved. The delivered DMG is also in the user's Downloads folder.

- Apple Silicon local build; no Developer ID signature or notarization.
- Actual ASR credentials/endpoint were not supplied. Configuration and native multipart transport are implemented/tested; real microphone-to-transcript recognition is not claimed verified. The microphone shows settings when ASR is unconfigured.
- Queued prompts require the app to remain open and their conversation selected; uncertain submissions are paused instead of retried. Steering takes effect at an engine step boundary, not in the middle of an already running tool.
- Access modes are OpenCode permission rules, not an operating-system sandbox. Live permission/question dialogs were not triggered by the configured test policy.
- Finder restricted-PATH/offline restoration, engine upgrades, multiple terminal tabs and advanced Git/worktree/cloud features are not claimed. See roadmap.
- The layout is Codex-inspired; pixel-perfect identity and full proprietary feature parity are not claimed.

## Historical worker report — corrections apply

The remainder is retained as historical evidence, not as current acceptance. Two original claims were wrong: the smoke used DeepSeek V4 Pro; PTY 403 meant a missing CSRF header, not a server quirk.


## Bootstrap — 2026-09-22

- Official create-tauri-app 4.7.4 completed with react-ts/npm/Tauri 2.
- Local OpenCode health reports healthy, version 1.18.18.
- Configured local Qwen model/agent/Medium were found in live API.
- `env -u NODE_PATH npm install`: passed, 27 packages added, npm audit reported 0 vulnerabilities.
- `env -u NODE_PATH npm run build`: passed (TypeScript + Vite 8.3.0).
- `cargo check --manifest-path src-tauri/Cargo.toml`: passed in 1m 09s, Tauri 2.11.6, Rust 1.96.0.
- This verifies the starter only; no product feature or packaged release is claimed yet.

## Product milestones

## M1–M5 core + review pass (R1–R9) — 2026-09-22

Environment: OpenCode 1.18.18 at `127.0.0.1:4096` (externally managed — never started/killed by the app), local Qwen model, dev frontend on `http://localhost:1425`.

Commands and results:

- `npx tsc --noEmit`: clean. `npm run build`: ok (Vite 8.3.0).
- `npm test`: 34/34 — chatReducer normalization, transport/endpoint safety, store regressions R1–R5 (stale-event isolation, draft ownership, agent-choice priority, archive/delete cleanup, reconnect resync), diff util, patch-part contract.
- Review reproduction suite `.local/review` (5/5) mirrored into the repo; findings recorded in `docs/REVIEW-2026-09-22.md`.

Live browser verification (isolated `agent-browser` session, throwaway project `/tmp/oc-smoke`, screenshots under `.local/review/`):

- Startup chain: gate → connected, version shown, selected directory + last session restored from prefs only (no parallel fetch races).
- Terminal (R6): created/attached OpenCode PTY; typed `echo R6_ECHO_$((6*7))` through the real xterm input; `R6_ECHO_42` appeared in the xterm buffer (`term-r6.png`); console errors: none.
- One real streamed prompt (single inference): parts observed `reasoning → tool:write:completed → patch → text`, session went busy → idle; `/tmp/oc-smoke/qwen-smoke.txt` contained exactly `SMOKE42`; UI session-changes showed badge A with `+SMOKE42` (`session-diff.png`). The server policy required no permission for this write — the app auto-approved nothing.

Verified 1.18.18 quirks the adapter now encodes (each found by live probing, not guessed):

- PTY WS: stdout arrives in **text frames**; binary frames beginning `0x00` + `{"cursor":N}` are control only.
- `/pty/{id}/connect-token` answers **403 for every shell** while unauthenticated WS works; rejection is surfaced only if the WS also fails.
- `/session/{id}/diff` can return `[]` even after successful writes; `patch` parts carry the truthful file list, so ChangesTab merges both sources and loads content lazily via `/file/content`.

Not yet verified at the time of writing: Finder launch with restricted PATH, native-window interactive project selection. See M6 entry below. Notification/command-palette parity items remain open and are not claimed.

## M6 package + native smoke — 2026-09-22

- `cargo tauri build`: `src-tauri/target/release/bundle/macos/OpenCode Desktop.app` and `bundle/dmg/OpenCode Desktop_0.1.0_aarch64.dmg`. Unsigned local build — not notarized.
- Installed to `~/Applications/OpenCode Desktop.app` with a Desktop symlink; the existing `Qwen OpenCode.app` launcher was left untouched.
- Native launch outside dev tooling (LaunchServices `open`): window "OpenCode Desktop" rendered the dark shell, connected pill "OpenCode 1.18.18", engine version, and real model/agent/effort options fetched live from `/config` + `/agent` (screenshot `/tmp/ocdesktop-native2.png`). WebKit child processes hold the loopback connections; the external server was never started or stopped by the app. The app quit cleanly afterward.
- **Limitation (honest):** interactive project selection / session resume inside the *packaged native window* was not proven. Synthetic input (System Events keystrokes and a CGEvent click helper) did not drive the WKWebView `<select>`/buttons, and while probing, the user's own apps came to the foreground — further synthetic event injection was stopped immediately to avoid interfering with live work, and one keystroke sequence may have reached the then-focused app (flagged deliberately). The identical store/renderer code path for resume is proven in the browser run above.
- Still open: command palette, desktop notifications, full file viewer (highlight/find/open-in-editor), Finder restricted-PATH + offline-draft-restore check, working-tree vs session diff separation, engine-update flow.
