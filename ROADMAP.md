# OpenCode Desktop roadmap

The goal is a full daily-use desktop coding client with the familiar workspace structure requested by the user. This checklist describes planned work. A checkbox is checked only with recorded evidence. Exact equivalence with proprietary/cloud-only Codex features is not assumed; each capability must have an actual implementation or be explicitly marked unsupported.

## M0 — Bootstrap (provided)

- [x] Official Tauri 2 + React + TypeScript starter.
- [x] Product name OpenCode Desktop; independent engine boundary documented.
- [x] Product specification, architecture, agent instructions and API snapshot.
- [x] Dependency installation, starter frontend build and Rust check verified; see docs/VERIFICATION.md.
- [x] Initial Git checkpoint prepared and committed before worker dispatch.

## M1 — Native shell and connection (first vertical slice)

- [x] Replace template with designed application shell, real sidebar, main view, top bar and persistent composer area. (VERIFICATION M1–M5)
- [x] Native window title and controls, reasonable minimum size, resizable panels, keyboard focus, light/dark/system theme. (styles.css splitters + `applyTheme`; shortcuts Cmd+N/Cmd+Shift+R/Ctrl+`)
- [x] Connection manager: existing opencode health/version, actionable disconnected/error UI, configurable local port. (Engine executable stays externally managed — picker intentionally omitted.)
- [x] Typed HTTP adapter; documented WebView fetch over CORS-reflecting loopback (no proxy needed); timeouts, cancellation, no token logging. `test/client.test.ts`.
- [x] Read providers/connected models/agents dynamically; no hard-coded catalog. (Live native screenshot shows real options.)
- [x] Display server version; major-version gate yields an actionable compatibility message instead of a blank screen.
- [x] Unit tests for connection states, invalid endpoints, API errors (client + store-regressions suites).

Acceptance: `tauri dev` launches a useful native window, detects existing OpenCode without spawning a duplicate, and visibly shows real connection/model information. Disconnecting it produces a recoverable state, not a blank page. App exit leaves the existing server running.

## M2 — Projects and conversations

- [x] Project list from OpenCode plus native folder picker (dialog plugin); selection stored in app prefs only.
- [x] Scoped task list, search via command palette, rename, loading/empty/error states. Rechecked in the independent acceptance pass.
- [x] Create, select and resume real sessions; history with older-page pagination; per-session drafts. (Proven live incl. reload-restore.)
- [x] Directory+generation isolation on requests and events; stale results dropped. (Regression tests R1–R5.)
- [x] Archive/restore via engine API; delete behind an explicit confirmation dialog. (Test R4.)
- [x] Status from `/session/status` truth incl. post-reconnect resync. (Test R5.)
- [x] Tests for new session, project switch, stale-response and out-of-order event handling at the store/reducer level. (Archived-filter live check not separately recorded.)

Acceptance: two temporary projects have independent session lists and drafts; reopening the app resumes the chosen session. Existing user histories are unchanged.

## M3 — Complete chat execution (minimum useful release)

- [x] Prompt composer: Enter/Shift+Enter, duplicate-send guard, live model/agent/effort selects.
- [x] Submit through the real async prompt endpoint. (No fake attachment support.)
- [x] SSE with event-ID dedupe, provisional deltas, bounded reconnect and authoritative resync. (Reducer tests + live streamed run.)
- [x] Sanitized markdown (no raw HTML, safe hrefs), copy buttons, collapsible reasoning, tool cards with state/errors.
- [x] Stop via `/session/:id/abort`; submitted prompts are never auto-retried. (Reducer/store tests.)
- [x] Permission card with once/always/reject preserving request IDs. (Unit-tested; this server policy never asked during the live run, so not exercised end-to-end.)
- [x] Question card: options, multi/custom answers, reject; pending requests re-pulled after reconnect. (Unit-tested; not exercised live.)
- [x] Distinct status states from server truth; no dead-model guessing.
- [x] Output-length/context-overflow are surfaced; command palette exposes the engine compaction action. No automatic tool duplication or continuation.
- [x] Reducer tests cover parts/deltas, duplicate replay, abort/error/length, permission lifecycle and switch-while-streaming isolation.

Acceptance: use a dedicated fixture, ask for one small code fix + test, observe tool calls live, answer a permission/question if requested, and verify the resulting diff/tests. Abort a separate safe operation. Restart the UI and see the preserved result. Record actual local Qwen model/variant used.

## M4 — Code, changes and review

- [ ] PARTIAL: files + session changes tab proven live (badge A, real diff lines, patch-part merge for the 1.18.18 empty-diff quirk, binary fallback); renamed-state mapping unverified.
- [ ] NOT IMPLEMENTED beyond a basic lazy file-content preview; no highlighting/find/editor handoff.
- [x] Changed-file list with expandable per-file unified diff, bounded preview. (Live: `+SMOKE42` in the running app.)
- [x] Separate session and working-tree changes; unknown session baselines are labelled honestly, never represented as new files.
- [ ] PARTIAL: read-only branch chip from `/vcs`; dirty badge and any Git actions not implemented.
- [ ] PARTIAL: `test/diff.test.ts` covers binary detection and unified diff shape; path-traversal/spaces/pre-existing tests still missing.

Acceptance: fixture changes in multiple files are accurately inspectable in the app and agree with Git. Reading a diff cannot modify or discard files.

## M5 — Terminal and desktop ergonomics

- [x] Real OpenCode PTY terminal: create/attach/reuse, resize push, explicit close. Live proof `R6_ECHO_42` in xterm (`term-r6.png`).
- [x] Project-scoped PTY (directory query on every call); xterm passthrough; honest transport errors.
- [ ] PARTIAL: Ctrl+` toggle/resize and single reused PTY per project (no reconnect duplicates); multiple terminal tabs not implemented.
- [x] Command palette, project/task search, new task, terminal and review shortcuts; native-safe model/effort/agent menus.
- [ ] Desktop completion notifications are not implemented.
- [ ] PARTIAL: echo/ANSI and disposal verified live in /tmp/oc-smoke; no unit tests for terminal resize yet.

Acceptance: user can execute and interrupt a local test command, then continue chat while inspecting output and diff. Closing the app does not kill an externally managed server or leave duplicate PTYs created by this app.

## M6 — Reliability, independent updates and macOS package

- [ ] PARTIAL: disconnected gate shows actionable instructions and reconnect; the app deliberately never spawns a server, so no start/executable-picker flow.
- [x] The app never spawns or kills OpenCode processes (externally managed) — verified across all live runs; no config rewrites.
- [ ] PARTIAL: shell (0.1.0) and engine (1.18.18) versions are displayed separately and reconnect is bounded/handled; no update flow.
- [x] Reducer/client tests use real 1.18.18 event/patch/question shapes incl. missing/optional fields. No engine upgrade was run.
- [x] Loopback-only WebView CSP, narrow core/opener/dialog capabilities and bounded native ASR command, safe-href markdown, no secrets logged. (Diagnostic export UI still absent.)
- [ ] PARTIAL: prefs live in a separate local store and OpenCode data is untouched; a prefs schema-migration path is not yet written.
- [x] `cargo tauri build` clean: bundle + dmg 0.1.0, id `dev.local.opencodedesktop`, README install steps. Unsigned/notarized — stated plainly.
- [x] Installed final bundle to /Applications; ~/Applications and Desktop aliases resolve to it. Native chat/PTY/session and draft restoration verified; `Qwen OpenCode.app` preserved.
- [ ] NOT VERIFIED: launch was via LaunchServices `open` with the server up; restricted-PATH/offline-draft-restore scenario not run.

Acceptance: packaged app opens outside development tooling, connects to existing OpenCode, resumes a test session, and leaves the CLI/service independently usable. Record bundle path, tested versions, test counts and remaining limitations. Local unsigned build must not be described as notarized.

## M7 — Extended parity backlog, after a verified core

These should have capability/evidence-based designs, not placeholder buttons:

- [ ] Isolated worktrees using actual supported OpenCode endpoints; display creation/cleanup ownership and protect dirty worktrees.
- [ ] Background/multiple tasks and activity inbox, respecting local single-GPU execution limits. Parallel sessions do not imply parallel model capacity.
- [ ] PARTIAL (0.2.1 source): live skill/agent/tool/MCP inventory; local global/project JSONC editor for tool permissions, skill URLs, npm plugins, remote MCP and default agent with key-level review, backup and conflict guard. Native save UI still needs final validation; full line diff and a plugin marketplace are not implemented.
- [ ] Git workflow refinements, branch review, per-line comments and GitHub integration through existing authenticated CLI with explicit publication actions.
- [ ] File/image drag and drop, attachment previews, find in history, export with privacy controls, session fork/branching.
- [ ] Scheduling/automation only after defining persistence, permission boundaries, duplicate prevention and cancellation. Do not silently auto-start work.
- [x] Remote OpenCode through native SSH tunnels, strict host keys, in-memory API password, per-host preferences. See docs/WORKSPACES.md. Direct arbitrary HTTPS endpoints and Keychain persistence remain future work.
- [ ] Browser preview as isolated content without Tauri privileges; optional worktree-aware dev-server handling.
- [ ] Windows/Linux packaging when tested; cloud proprietary functionality only through a real supported service. Document unsupported features plainly.

## Completion evidence

Maintain `docs/VERIFICATION.md` with date, commit, installed OpenCode version, commands/results, relevant screenshots or manual steps, and limitations. Update `.pi/TASK.md` at meaningful checkpoints and before compaction. Mark the deliverable done only after M1–M6 acceptance is satisfied; record M7 separately as a backlog rather than claiming complete Codex parity.

## Дополнения при независимой приёмке (2026-09-22)

- [x] Круговой индикатор реального контекста, порог автосжатия и ручное сжатие.
- [x] Session-scoped режимы доступа OpenCode; существующие правила не теряются молча.
- [x] Очередь, редактирование/удаление, уточнение текущей задачи на безопасной границе шага.
- [x] Диктовка, реальная звуковая визуализация, настройки ASR, native multipart adapter.
- [x] GigaAM v3 CPU on CT 201 configured as local default; health and OpenAI multipart endpoint tested, including a short Russian synthetic speech sample. Native microphone UI acceptance pending 0.2.1 installation.

## M8 — Optional projects and execution hosts (0.2.0)

- [x] New Chat opens a project-optional start screen; project search and explicit projectless choice.
- [x] Separate workspace directory per projectless chat; real tools/PTY/history/drafts/access/context work without Git.
- [x] Local versus SSH host selection; server-scoped project picker, native local folder picker, explicit remote path entry.
- [x] SSH tunnel lifecycle and authentication; generation guards and server identity independent of ephemeral port.
- [x] Regression coverage for new-chat, workspace failure, duplicate send, stale SSH handshake and host isolation.
- [x] Final packaged-native local/SSH chat, tools, PTY, archive/restore, relaunch and installation recorded in VERIFICATION.

## M9 — Completion attention (0.2.1, pending native delivery)

- [x] Source: spinner for busy/retry sessions and projects; yellow dot only for a completed result not yet viewed; separate pending-request marker.
- [x] Source: global event monitoring across projectless chats and projects, unread state scoped by server and persisted; focus/scroll/open transitions clear unread, and a fixed system chime fires once per unattended completion.
- [x] Source: reconnect reconciles previously busy sessions, duplicate events do not repeat sounds, deleted/archived sessions clear attention; focused regression tests cover these transitions.
- [x] Native finding: project-row restoration now loads the session history if needed and clears unread when the completed answer is visible; regression test added.
- [x] V100 Qwen3.8-27B added alongside Flash Next with its own context/output profile and coding agent; Flash Next remains default. The initial HOLD is superseded by the 2026-09-23 corrected NInfer deployment and client acceptance; see LOCAL-MODELS and VERIFICATION.
- [x] NInfer task finished and its raw measurements were reviewed; native 0.2.1 candidate passed settings, V100 chat, attention and re-open checks. DMG verified and 0.2.1 installed; GitHub publication is recorded in VERIFICATION.

## M10 — Project conversation tree (0.2.2)

- [x] Independently expandable project groups with their own session lists; expansion does not navigate away from a conversation or reset its draft.
- [x] Expansion preferences scoped to the selected server and preserved on restart. New chat button per project.
- [x] Recent root sessions across projects and projectless workspaces, paginated global archive with restore.
- [x] Background SSE updates, stale-response protection, retry/loading states, exact directory filtering and session list pagination.
- [x] Native acceptance and installation of 0.2.2 (see VERIFICATION).

## M11 — Project removal and explicit session handoff (0.2.3)

- [x] Remove/restore project entries without deleting folders or sessions; server-scoped persistence and recent filtering.
- [x] Select recipient across projects/projectless workspaces and configured local/SSH servers, searchable/paginated.
- [x] Prepare an editable task packet from full available source history in an isolated, tool-disabled fork; archive on completion and cancel only that fork.
- [x] Recipient profile/directory preserved, append-only draft mode, busy/permission guards, single send and uncertain-acknowledgement handling.
- [x] Native acceptance and release installation (see VERIFICATION).
- [ ] Model-invoked automatic discovery/delegation tool; this release implements the user-authorized UI workflow.

## M12 — Background computer control (0.2.3)

- [x] Separately installed signed Cua Driver with native settings/status/onboarding controls.
- [x] MCP proxy with window-scoped tools, background delivery, read-only permission checks and shared disable gate; emergency revoke.
- [x] JSONC-preserving MCP configuration and OpenCode skill, local-host guard, unchanged model/provider/access settings.
- [x] Native permission onboarding, live tool/vision/overlay acceptance and final installation.
- [ ] Foreground/desktop control, remote desktop and explicit browser-profile integration; excluded from this release.


## M13 — Reading and message tools (0.2.4)

- [x] Explicit follow/reading modes, wheel/touch/keyboard intent, jump-to-latest and resize/prepend anchoring.
- [x] Per-session in-memory reading position; incremental history, day separators and exact timestamp tooltips.
- [x] Safe React Markdown/GFM, syntax highlighting, full-response/code copying and editable code copies.
- [x] User-message edit into an engine fork before the selected message; original retained, access and profile copied, explicit draft/send step.
- [x] Root-session attention reconciliation; hidden subagents/archive/deletion excluded, unread roots exposed beyond sidebar truncation.
- [x] Native installation and release acceptance (see VERIFICATION).
