# OpenCode Desktop roadmap

The goal is a full daily-use desktop coding client with the familiar workspace structure requested by the user. This checklist describes planned work. A checkbox is checked only with recorded evidence. Exact equivalence with proprietary/cloud-only Codex features is not assumed; each capability must have an actual implementation or be explicitly marked unsupported.

## M0 — Bootstrap (provided)

- [x] Official Tauri 2 + React + TypeScript starter.
- [x] Product name OpenCode Desktop; independent engine boundary documented.
- [x] Product specification, architecture, agent instructions and API snapshot.
- [x] Dependency installation, starter frontend build and Rust check verified; see docs/VERIFICATION.md.
- [x] Initial Git checkpoint prepared and committed before worker dispatch.

## M1 — Native shell and connection (first vertical slice)

- [ ] Replace template with designed application shell, real sidebar, main view, top bar and persistent composer area.
- [ ] Native window title and controls, reasonable minimum size, resizable panels, keyboard focus, light/dark/system theme.
- [ ] Connection manager: existing local OpenCode health/version, actionable disconnected/error UI, configurable local port and executable location.
- [ ] Typed HTTP adapter; safe native transport or a documented working Tauri-compatible alternative; timeouts, cancellation, redacted logs.
- [ ] Read providers/connected models/agents dynamically. Prefer configured Qwen + Medium; do not hard-code the model catalog or credentials.
- [ ] Display supported server version/capabilities. Unsupported API fields yield a useful compatibility message.
- [ ] Unit tests for connection states, invalid endpoints, API errors and unsupported capabilities.

Acceptance: `tauri dev` launches a useful native window, detects existing OpenCode without spawning a duplicate, and visibly shows real connection/model information. Disconnecting it produces a recoverable state, not a blank page. App exit leaves the existing server running.

## M2 — Projects and conversations

- [ ] Project list from OpenCode plus explicit native folder picker; remember UI selection separately from engine data.
- [ ] Session list scoped to project, sorting, search, rename, recent activity, loading/empty/error states.
- [ ] Create, select and resume real sessions; load message history, pagination when supported, preserve scroll and per-session draft.
- [ ] Route/project isolation. Cancel stale requests when switching. Never display one project's tools/files inside another.
- [ ] Archive using supported engine API; restore archived session; destructive deletion requires explicit confirmation and clear wording.
- [ ] Session status (idle/running/waiting/error) based on server truth, not a speculative timeout.
- [ ] Tests for new session, project switch, archived filtering and out-of-order request completion.

Acceptance: two temporary projects have independent session lists and drafts; reopening the app resumes the chosen session. Existing user histories are unchanged.

## M3 — Complete chat execution (minimum useful release)

- [ ] Prompt composer: Enter send, Shift+Enter newline, disabled duplicate submission, editable model/agent/effort selection with supported values.
- [ ] Submit through actual async prompt endpoint; optional file/image attachments only with API validation and real model capabilities.
- [ ] SSE streaming of text, reasoning and tool activity; stable IDs, deduplication, correct ordering, reconnect then authoritative resync.
- [ ] Render sanitized Markdown/code/copy, collapsible reasoning, tool inputs/results/errors/duration, no execution of model HTML.
- [ ] Stop requests through abort API, restore accurate idle state; no automatic retry of a submitted prompt after an ambiguous network error.
- [ ] Real permission UI: once/always/reject supported replies, preserve request IDs and show the action being authorized.
- [ ] Real question UI: options, multi-select/free text where supported, reject, refresh pending requests after reconnect.
- [ ] Distinguish thinking, tool running, awaiting user, disconnected and finished. Never label a model dead solely because it emitted no visible text.
- [ ] Finish reasons and context/output exhaustion are visible. Compaction is explicit and uses the engine API. No infinite continuation loop or automatic duplication of a tool.
- [ ] Tests for stream parts/deltas, duplicate replay, reconnect, abort/error/length, permission lifecycle, session switch while streaming.

Acceptance: use a dedicated fixture, ask for one small code fix + test, observe tool calls live, answer a permission/question if requested, and verify the resulting diff/tests. Abort a separate safe operation. Restart the UI and see the preserved result. Record actual local Qwen model/variant used.

## M4 — Code, changes and review

- [ ] Right-side panel for task/project files and actual session/worktree diff; correct added/removed/binary/renamed states where supported.
- [ ] File viewer with line numbers, language highlighting, copy path, find and open in configured editor/Finder.
- [ ] Changed-file navigation and readable inline/split diff. Large files/diffs bounded or virtualized.
- [ ] Show working tree changes separately from session changes; avoid attributing pre-existing edits to the agent.
- [ ] Branch and dirty-state badges; read-only Git status initially. Revert/stage/commit actions require clear scope and deliberate user action.
- [ ] Tests for new/deleted file, paths with spaces, no traversal outside selected root, binary/oversized file fallback, pre-existing modifications.

Acceptance: fixture changes in multiple files are accurately inspectable in the app and agree with Git. Reading a diff cannot modify or discard files.

## M5 — Terminal and desktop ergonomics

- [ ] Real integrated terminal via OpenCode PTY/WebSocket; shell listing, create/attach, resize, reconnection and explicit close lifecycle.
- [ ] Terminal is scoped to selected project; sanitize transport failures but preserve ANSI output through a suitable terminal component.
- [ ] Bottom panel toggles/resizes; multiple terminal tabs if backend supports them; no duplicated shell on a reconnect.
- [ ] Command palette, new conversation shortcut, project/session search, sidebar/review/terminal shortcuts, accessible labels and reduced motion.
- [ ] Desktop notifications for completed/needs-input tasks when enabled, with no secrets in notification previews by default.
- [ ] Tests for resize and disposal; manual `pwd`/Unicode/ANSI/interrupt checks in a throwaway project.

Acceptance: user can execute and interrupt a local test command, then continue chat while inspecting output and diff. Closing the app does not kill an externally managed server or leave duplicate PTYs created by this app.

## M6 — Reliability, independent updates and macOS package

- [ ] Missing OpenCode onboarding with install instructions/executable picker; optionally start user-installed `opencode serve` on loopback after an explicit action.
- [ ] Track ownership of any spawned child; no broad process-kill or global config rewriting. Safe arguments and startup timeout/logs.
- [ ] Separate shell version from engine version. Update shell and CLI independently. Reconnect after an engine restart.
- [ ] API contract tests using observed 1.18.18 snapshot plus fixtures with optional/missing fields. Do not run an OpenCode upgrade just to test this without user intent.
- [ ] Explicit production CSP, minimal Tauri capabilities, safe URL handling, sanitized Markdown, redacted diagnostic export.
- [ ] Data migration for shell preferences; no migration/rewrite of OpenCode's own databases.
- [ ] Clean build on macOS, `OpenCode Desktop.app` bundle, unique app identity/icon and useful README installation steps.
- [ ] Install to user Applications and create a Desktop shortcut after successful smoke test; preserve the old Qwen OpenCode launcher.
- [ ] Test startup from Finder with its restricted PATH and network unavailable. Restore connection without losing draft.

Acceptance: packaged app opens outside development tooling, connects to existing OpenCode, resumes a test session, and leaves the CLI/service independently usable. Record bundle path, tested versions, test counts and remaining limitations. Local unsigned build must not be described as notarized.

## M7 — Extended parity backlog, after a verified core

These should have capability/evidence-based designs, not placeholder buttons:

- [ ] Isolated worktrees using actual supported OpenCode endpoints; display creation/cleanup ownership and protect dirty worktrees.
- [ ] Background/multiple tasks and activity inbox, respecting local single-GPU execution limits. Parallel sessions do not imply parallel model capacity.
- [ ] Skill/agent/tool/MCP inventory and settings with correct server APIs, validation and a review of config changes before saving.
- [ ] Git workflow refinements, branch review, per-line comments and GitHub integration through existing authenticated CLI with explicit publication actions.
- [ ] File/image drag and drop, attachment previews, find in history, export with privacy controls, session fork/branching.
- [ ] Scheduling/automation only after defining persistence, permission boundaries, duplicate prevention and cancellation. Do not silently auto-start work.
- [ ] Optional remote OpenCode support with authentication/TLS/explicit endpoint trust. Local-only is the first release boundary.
- [ ] Browser preview as isolated content without Tauri privileges; optional worktree-aware dev-server handling.
- [ ] Windows/Linux packaging when tested; cloud proprietary functionality only through a real supported service. Document unsupported features plainly.

## Completion evidence

Maintain `docs/VERIFICATION.md` with date, commit, installed OpenCode version, commands/results, relevant screenshots or manual steps, and limitations. Update `.pi/TASK.md` at meaningful checkpoints and before compaction. Mark the deliverable done only after M1–M6 acceptance is satisfied; record M7 separately as a backlog rather than claiming complete Codex parity.
