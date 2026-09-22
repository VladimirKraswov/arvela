# Verification record

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
