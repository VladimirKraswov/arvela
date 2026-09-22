# Development and verification

## Bootstrap

Official `create-tauri-app` 4.7.4, `react-ts`, npm, Tauri 2. Product name is OpenCode Desktop. Dependencies are tracked by npm and Cargo lockfiles. The default starter screen is intentional: Qwen is responsible for the application implementation.

Run from this project directory. On the current Mac, `NODE_PATH` can point into an unrelated project: use `env -u NODE_PATH npm …` when necessary. GUI launches have a smaller PATH than terminal shells; test the packaged application from Finder before claiming executable discovery works.

## Verification ladder

1. Unit tests for API normalization, message/event reducer, session scoping, reconnect deduplication and request lifecycle.
2. Component tests for composer, real pending permissions/questions, error/empty states and keyboard behavior.
3. `npm run build` for TypeScript and bundling; `cargo check --manifest-path src-tauri/Cargo.toml` for native changes; Rust tests for native transport/validation where appropriate.
4. Contract fixtures captured without private content; integration tests in a temporary Git repository created by the test.
5. Native manual smoke: connect, select project, create session, submit task, see live tools, inspect diff, terminal, stop/reconnect, restart app. Use exactly one inference request at a time on this system.
6. Release `.app` build and launch without Vite or a developer shell. Record actual results in `docs/VERIFICATION.md`.

Initial Cargo dependency compilation may take several minutes. Use an adequate bounded timeout rather than repeatedly killing/restarting it. Never hide build failures with a successful wrapper command. Don't call `npm test` passed until a real test script exists and runs meaningful tests.

## Test safety

Use only explicitly created test projects/sessions. Never delete, reset or summarize a user's existing conversation to test behavior. Git status and before/after diffs must demonstrate user work is preserved. Do not mutate another project as a convenience. Do not upgrade/stop OpenCode or restart FreeToken during ordinary UI tests.

## Visual QA

Check dark and light modes, empty app, long message/code, expanded tool error, pending permission, disconnected server, narrow window and three-panel layout. Buttons must perform their labeled action. Native-only APIs can be mocked in explicit frontend development/tests but the packaged release must use real implementations. Save useful screenshots locally and describe what was manually checked.

## Deliverable

A locally built `OpenCode Desktop.app`, source, tested instructions, compatibility notes and honest feature checklist. Install under the user's Applications only after verification; create a Desktop shortcut without overwriting the existing Qwen OpenCode launcher. No remote publication is requested for this new repository.
