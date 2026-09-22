# OpenCode Desktop task

## Goal
Build the standalone OpenCode Desktop Tauri shell from the provided specification. Product implementation is delegated to local Qwen3.8 Flash Next through OpenCode (Medium).

## Current state
Official Tauri 2 + React/TypeScript starter created. Product metadata set. Documentation and roadmap supplied. No application features implemented yet. Bootstrap npm install, TypeScript/Vite build and cargo check all passed; see docs/VERIFICATION.md. The starter will be committed before worker dispatch.

## Verified facts (worker, this session)
- Live API OpenCode 1.18.18 at 127.0.0.1:4096; CORS reflects Origin → WebView fetch + fetch-SSE works, no Rust proxy needed.
- PTY protocol probed live (CORRECTED 2026-09-22 evening, see .local/review/pty-probe.json): create via POST /pty?directory, **size must be set via PUT /pty/{id}?directory (404 without directory query) or zsh renders nothing**; WS /pty/{id}/connect?directory: PTY stdout arrives in **TEXT frames (write them straight to xterm)**; a binary frame starting with 0x00 + JSON {"cursor":N} is a control message only; client→server raw bytes. connect-token endpoint answers **403 PtyForbiddenError on 1.18.18 for every shell** while unauthenticated WS works — token rejection is only fatal if the following WS connect also fails (verified: 403 tolerated + WS open + `echo R6_ECHO_$((6*7))` → `R6_ECHO_42` in xterm buffer).
- Implemented: api client/events/types, pure chatReducer (dedupe, provisional deltas, merge, permissions/questions), prefs + central store, Sidebar/TopBar/Chat/Composer/RightPanel(files+diff)/TerminalPanel(xterm)/Dialogs, App shell with splitters + shortcuts, full light/dark stylesheet, dialog plugin (Cargo + capabilities), explicit loopback-only CSP in tauri.conf.json.
- Checks so far: `npx tsc --noEmit` clean; `npm run build` ok; `cargo check` ok; `npm test` 20/20 green (reducer + transport + endpoint safety + SSE/PTY URL scoping).

## Evidence 2026-09-22 (review plan docs/REVIEW-2026-09-22.md R1–R9)
- Store regressions R1–R5 moved into repo suite: `test/store-regressions.test.ts` 5/5 (`npm test` → 34/34 with diff/sessionPatchFiles tests, `npx tsc --noEmit` clean, `npm run build` ok).
- R6 live browser proof: `R6_ECHO_42` in real xterm buffer (.local/review/term-r6.png), console clean.
- M3 one real prompt (only inference run): prompt → busy → parts [text, step-start, reasoning, tool:write:completed, step-finish, patch, text] → idle; file /tmp/oc-smoke/qwen-smoke.txt == "SMOKE42"; no permission was required by server policy (nothing auto-approved by app).
- 1.18.18 quirk found live: `/session/{id}/diff` returns [] even after a successful write; the `patch` part (files:[abs paths]) is the real signal → ChangesTab merges server diff + patch-part files (lazy `/file/content`, GeneratedDiff) → UI shows badge A + "+SMOKE42" (.local/review/session-diff.png).
- Startup chain verified in running app: connect → projects → metadata → restored directory /tmp/oc-smoke; ports vite 1425 / hmr 1426 / tauri devUrl 1425 (1420 is a foreign app — untouched).

## Evidence 2026-09-22 (M6 package + native smoke)
- `cargo tauri build` ok: `src-tauri/target/release/bundle/macos/OpenCode Desktop.app` + dmg 0.1.0 (unsigned, not notarized). Installed to ~/Applications + Desktop symlink; old Qwen launcher untouched.
- Native launch via LaunchServices: real window, connected pill 1.18.18, live model/agent/effort data (/tmp/ocdesktop-native2.png); quit cleanly; external server never touched.
- LIMITATION: native-window project selection/resume not proven — synthetic events (System Events/CGEvent) don't reach WKWebView controls; probing stopped when user's own apps took foreground (one keystroke sequence may have reached the focused app — reported to user). Same resume code path proven in browser.
- Docs synced: ROADMAP checkboxes mark only evidence-backed items (palette/notifications/file-viewer/Finder-PATH left open with notes); README + VERIFICATION M6 entry current.

## Status
DONE with recorded limitation (native interactive resume; see VERIFICATION M6). Remaining roadmap backlog: command palette, notifications, file viewer, working-tree vs session diff split, engine update flow.

## Next action
Nothing pending in this task beyond user direction. Possible follow-ups: the open backlog items above; native interaction testing should be done by the human (or via a dedicated a11y-enabled harness), not blind synthetic keystrokes while the user is at the machine.

## Test artifacts
- /tmp/oc-smoke — test-owned scratch project for UI verification. Throwaway probe scripts live only in temp dir.

## Constraints
Only this repo and test-owned folders. Existing OpenCode daemon on 127.0.0.1:4096 is externally managed. Keep user's real sessions, global configuration and model server untouched. One local inference at a time. No publication requested.
