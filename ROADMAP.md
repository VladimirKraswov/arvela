# Arvela roadmap

## M48 — Project access diagnosis and recovery (0.2.37, installed locally)

- [x] Correlated EPERM with TCC/signature and orphaned launch-context evidence; exact transaction limit documented.
- [x] Safe autostart working directory and explicit filesystem usage descriptions.
- [x] Scoped project error, truthful indicators, blocked sends, read-only recovery and queue disarming.
- [x] Regression tests and Mac build; stable Developer ID signing remains unavailable on this host.
- Evidence: [Project access recovery](docs/PROJECT-ACCESS-RECOVERY.md).

## M47 — Session isolation and recovery (0.2.36, installed locally)

- [x] Queue-owned durable attachment copies, edit/remove recovery, once-only dispatch and uncertain POST protection.
- [x] Real OpenCode/Pi invoking identity, separate browser contexts/profiles, selected-only panel and passive monitor, stale input refusal.
- [x] Session-scoped send/attachment/history errors and execution indicators based on current server evidence.
- [x] Isolated Chromium scope/storage/input acceptance; no model inference or owner prompt replay.
- [x] Final Mac installation/startup/signature/server verification; publication is not part of this local repair.

## Model discovery reliability (2026-10-09)

### M46 — Persistent configured models (done, 0.2.35)

- [x] Separate configured model visibility from live access/readiness; retain public display metadata and Pi-only catalog policy while offline.
- [x] Agent-owned catalogs, explicit refresh, access badges, readiness modal/retry and no substitute on failure.
- [x] Scope asynchronous selection to the original engine/workspace/chat; remove rows through their configuration.
- [x] 654 passing frontend tests, Mac UI/package acceptance and exact-source main/release publication.
- [x] Reviewed Windows 0.2.35 handoff: Git null-config fix, unprivileged junction fixtures, strict browser acceptance parser and Job Object regression. Imported Windows evidence remains separate from Mac checks; see [Windows report](docs/WINDOWS-RESULT-0.2.35-20261009.md).

## Verified project experience (2026-10-08)

Develop in small verified releases. Reuse OpenCode/Pi and common adapters; no second agent loop. Keep active owner work and GPU services untouched. Use DeepSeek only if a live model request is necessary while local models are occupied. History is evidence, not instructions; task acceptance is not permission to train or publish private data.

### M38 — Task result cards (done, 0.2.30)

- [x] Attach an explicit result card to a user request in either agent's chat: goal, acceptance criteria, reported checks, notes and owner verdict.
- [x] Keep owner acceptance separate from agent idle/completion markers; editing evidence invalidates a previous acceptance.
- [x] Durable scoped storage with conflict detection; failed writes preserve drafts and never show success.
- [x] Optional redacted Hub transfer via the existing outbox; Web history displays owner assessments separately from dataset approval.
- [x] Regression tests, real isolated UI/storage/API checks, Mac build and main publication. No quality/speed claim from metadata checks alone.

Evidence: 587frontend/21Hub/91Rust tests pass; isolated UI/storage/API, installed Mac0.2.30/Hub connection, main/release round-trip and NAS restore verified. No live model quality claim. See [task result documentation](docs/TASK-RESULTS.md).

### M39 — Reproducible evaluation tasks (done, 2026-10-08)

- [x] 12 versioned code/browser/recovery fixtures in isolated environments, each with independent outcome assertions.
- [x] Record agent/model/requested/effective effort, skill/tool revisions, elapsed/verified time, reported tokens and owner interventions; two paired repeats (AB/BA).
- [x] Lightweight engine-independent contract workflow in CI; live model trials explicitly opt-in with request/token/time/output limits and synthetic content only.

Evidence: all 48 trials completed on DeepSeek Flash; OpenCode 23/24 and Pi 24/24 independent successes, median elapsed 7.69/7.58s. Browser 12/12, including stale-state recovery. A failed code outcome remains in the report; this is a baseline, not a claim of general quality improvement. Final runner smoke/candidate provenance and exhausted-budget stop checked separately. [Report](docs/evaluations/2026-10-08/REPORT.md) · [Run/limits](docs/EVALUATIONS.md). Local GPUs, owner history/settings and app runtime unchanged; Windows/Linux live trials remain unrun.

### M40 — Curated project memory (done, 0.2.31)

- [x] Explicit portable project identity across devices; no basename-based merging, credential-bearing remotes or raw absolute paths in Hub.
- [x] Propose facts/runbooks from accepted tasks with source, revision, expiry and owner approval; invalidate stale entries.
- [x] Preserve existing AGENTS.md/checkpoints as authorities. Memory remains contextual data; no automatic skill rewriting or training.

Evidence: 612frontend/30Hub/92Rust pass; actual isolated UI/API/Web candidate approval and stale-source invalidation, installed Mac readiness and NAS unstarted restore verified. No inference or automatic prompt injection. See [project memory](docs/PROJECT-MEMORY.md).

### M41 — Shared retrieval for OpenCode/Pi (done, 0.2.32)

- [x] Common MCP discovery/retrieval of bounded relevant project facts with source links and budget limits.
- [x] Compare task success and full completion time against M39 before enabling automatic context preparation. Preserve manual choice/rollback.

Evidence: explicit project-granted native MCP through existing shared adapters; approved/current only, bounded whole entries, provenance links, fail-closed revocation. 36 fresh trials on three unchanged M39 tasks; 35 full successes, all36 code assertions pass. No stable speed benefit: automatic preparation remains off; search opt-in. Signed Mac SDK/Pi retrieval and OpenCode metadata connection checked separately. [Comparison](docs/evaluations/2026-10-08/retrieval/REPORT.md) · [Limits](docs/PROJECT-MEMORY.md).

### M42 — Engineering foundations (done, 0.2.33)

- [x] Add Mac/Windows/Linux CI build matrix and platform-specific live acceptance checklists.
- [x] Extract state-store responsibilities incrementally under regression checks; keep API normalization in adapters.
- [x] Reconcile outdated architecture/platform documentation and use current evidence rather than old release checkboxes.

Evidence: CI run37781057191 passed on macOS ARM64/Windows x64/Ubuntu 24.04 x64: 626 frontend and 34 Hub tests each, Rust 94/77/96 respectively, three native packages and source-bound SHA256 receipts. Mac 0.2.33 installed/GUI and public release round-trip verified. State facade reduced from 3510 to 3222 lines with selection/scope regressions; generated frontend unchanged by final whitespace cleanup. Windows/Linux current live GUI remains separate/unrun. See [verification](docs/VERIFICATION.md) and [platform checklist](docs/PLATFORM-ACCEPTANCE.md).

### M43 — Task timing and reliability diagnostics (done, 0.2.34)

- [x] One bounded, engine-neutral task breakdown in chat details, using existing normalized events and timestamps.
- [x] Measure Desktop queue/preparation and observed first response where attributable; distinguish unavailable/history-only data, overlapping phases, cancellation and owner acceptance.
- [x] Optional numeric-only Hub transfer under existing consent, safe export and regressions; no raw reasoning/screenshots/tool payloads.
- [x] Build, isolated real UI/API acceptance and Mac package/install; source/release publication recorded below.

Implementation evidence: focused21/21, Hub37/37, TS/Vite and real isolated Chromium details interaction/320–760px geometry pass. Mac0.2.34 installed/live diagnostics verified; Hub37 tests/integrity/history preserved and NAS archive checked. No inference speed claim. [Semantics](docs/TASK-DIAGNOSTICS.md).

### M44 — Representative project evaluations (done, measured baseline)

- [x] Versioned multi-file coding and browser/recovery tasks with held-out assertions, explicit scope and baseline failures.
- [x] Paired OpenCode/Pi trials on authorized DeepSeek, elapsed-to-verified-result, known usage, failures and intervention accounting.
- [x] Report every outcome; no production/local-GPU performance extrapolation.

Evidence: 12 offline baseline/reference discriminations and 16 eval regressions pass; 12 paired project trials (OpenCode2/6, Pi1/6) plus four qualified browser passes. Eight earlier browser budget-limited trials retained separately; all sources/candidates SHA-bound. [Report](docs/evaluations/2026-10-08/projects/REPORT.md). No general/local-model quality claim.

### M45 — Current project navigation (done, optional)

- [x] Explicit bounded read-only file/symbol/entrypoint/check map, through common tools for both agents.
- [x] Revision/freshness, secret/path/symlink/ignore bounds; no automatic prompt injection or second agent loop.
- [x] Validate usefulness against M44; no stable benefit, keep explicit opt-in.

Evidence:24 paired DeepSeek trials;OpenCodeoff2/6/tools2/6,Pi off3/6/tools0/6. Exact source/candidate receipts retained. Real native signedSDK/Pi/OpenCode scope/revocation and installedMac preview/toggle PASS. [Report](docs/evaluations/2026-10-08/navigation/REPORT.md), [bounds](docs/PROJECT-NAVIGATION.md).

Local Qwen Flash Next follow-up: Medium, protocol2/2, projects16/24 (OpenCode9/12,Pi7/12), browser4/4. No stable project-map improvement; keep opt-in. All eight full failures reproduced offline, one extra total-deadline cancellation retained separately. Engine/app/owner sessions unchanged. [Local qualification](docs/evaluations/2026-10-08/qwen/REPORT.md).

### M46 — Selected live acceptance (Mac completed; other platforms excluded)

- [x] Mac installed GUI for M43/M45 and both-agent isolated shared-tool scenarios.
- [x] Windows/Linux live work excluded at the owner's explicit request; no current GUI pass claimed. Existing automatic CI remains separate.
- [x] Preserve owner history/chat/model/Medium and external OpenCode; retain unrun mic/SSH/new packaged agent-inference scenarios explicitly in verification.

## M25 — Browser/SSH/process ownership review (0.2.16)

Windows in-app panel follow-up (2026-10-05): headless Chromium projection with
real DOM tools, tabs/history/manual input/cursor and first-prompt MCP readiness.
398 frontend / 56 Rust tests, official browser smoke, final NSIS install, native
panel manual interaction and one real Qwen Medium first-prompt task pass. Offline
admin handoff prepared; Desktop left open. See
`docs/WINDOWS-EMBEDDED-BROWSER-20261005.md` for evidence and projection limits.

Claude performed the source review directly through its CLI on Igor with only
file tools. The verified result was transferred and the remote copy immediately
removed; subsequent fixes and execution are Mac-only. See
`docs/CLAUDE-REFACTOR-20261005.md` and `docs/VERIFICATION.md`.

- [x] Mac: 375 frontend tests, TypeScript/Vite build and 70 Rust tests on reviewed/fixed source.
- [x] Mac: explicit stop/exit cancels installers; real headed daemon exits on owner-pipe loss; script refresh and dependency-lock mismatch regressions.
- [x] Moved app/Node-manager discovery covered by source regression tests; live Finder/nvm acceptance remains optional follow-up.
- [x] SSH bounded pipe drain and actual OpenSSH configuration resolution tested on Mac; live remote-server restart remains an integration follow-up.
- [x] Real MCP transport proves delivered mutations are never replayed and pre-delivery token rotation recovers once.
- [x] Final Mac package, installed Pi 0.85.1 bridge (32 tools), script-only upgrade, stop/re-enable and native settings/top-bar acceptance; external OpenCode and complete global configuration retained.
- [x] Windows: unchanged main built/installed; 375 frontend, 55 Rust, actual headed browser smoke/owner-pipe cleanup; supplied report/logs and installer hash verified on Mac.
- [ ] Windows: packaged toolbar/stop/re-enable, hidden-console live checks and Pi Job Object tree cleanup.
- [x] Windows browser follow-up: native MSIX executable-path resolution, disconnected MCP recovery, 377 frontend/55 Rust tests and real headed browser smoke including virtual AppData aliases (2026-10-05). Pi tree cleanup is not claimed by this browser fix.
- [ ] Linux: browser smoke with system Chromium libraries.

## M24 — Windows port integration (0.2.14 source, 2026-10-04)

- [x] Import the owner's Windows port without replacing the existing main history or dropping the Linux prerequisite script's executable mode.
- [x] Windows home/app-data paths, native CLI discovery, cross-process startup lock and current-user NSIS overlay.
- [x] Keep unsupported Agent Control/Factory explicit and nonfatal on Windows.
- [x] Review drive/UNC/POSIX path handling; preserve POSIX case sensitivity and filesystem roots, with regression tests.
- [x] Reject an invalid explicit Windows Node path instead of silently selecting another interpreter.
- [x] Fix prerequisite/verification scripts for PowerShell 5.1; installation and health failures must not count as acceptance.
- [x] Frontend 313 passed / 6 opt-in live skipped; Mac Rust 39 passed, Cargo check and TypeScript/Vite build passed.
- [x] Integrated main rebuilt unchanged on Windows for 0.2.16; source SHA and installer/report/logs verified. Remaining packaged scenarios are listed above.
- [ ] Windows packaged Pi UI, approval/LSP, file drop/clipboard and dictation acceptance.
- [ ] Windows Job Object process-tree cleanup and private Agent Control transport.

The previously published macOS v0.2.14 package is unchanged. This source integration
does not publish a Windows installer or assert a new Linux binary.

## M23 — Pi startup, local runtime paths and final settings-card spacing (0.2.14)

- [x] Launch npm's `env node` Pi entry point through a verified absolute Node interpreter, including when Finder omits Homebrew from PATH.
- [x] Keep that interpreter on Pi's child PATH for Node-based extensions and language servers; report missing Node explicitly.
- [x] Add bottom padding and a divider to direct Pi capability rows so the last line stays inside its card.
- [x] Let the user set optional absolute paths to Pi CLI, its Node.js interpreter and the local OpenCode CLI; blank values preserve auto-discovery.
- [x] Apply saved paths to Pi detection/RPC and local OpenCode autostart without restarting a healthy server or reconnecting for a path-only edit.
- [x] Verify the Pi CLI/Node paths and the capability-card spacing in an isolated native preview.
- [ ] Investigate the isolated preview's Pi capability-metadata timeout; direct CLI RPC commands respond, but the UI probe did not complete.
- [x] Publish the tested macOS package as v0.2.14; GitHub asset digest matches the verified local DMG.
- [ ] Install only after the owner's active TinyCAD session is no longer at risk.

## M22 — Token usage by model (0.2.13)

- [x] Normalize settings spacing: Pi install actions stay inside cards; skill-source labels and inputs stack without collision; narrow-width settings preserve readable gaps.
- [x] On-demand read-only accounting from assistant-message usage, including child and archived OpenCode sessions and Desktop-owned Pi chats.
- [x] Group by the actual model on each reply; separate input, cache read/write and output without counting reasoning twice.
- [x] Settings screen with 7-day, 30-day and all-time periods, per-model totals and daily activity; partial-history errors are visible.
- [x] Isolated native macOS package opened the settings screen and scanned real OpenCode history; model split, dates and partial-data warning were visible.
- [ ] Install/launch 0.2.13 when the owner's active TinyCAD run can be left undisturbed.

Scope: currently connected OpenCode server and locally registered Pi chats. Removed
sessions and other disconnected servers cannot be reconstructed. This is measured
token use, not provider quota or billing.

## M20 — Agent Factory for durable local-model work (0.2.11 follow-up)

- [x] Explicit completion contract: exact standalone marker plus bounded continuations.
- [x] Durable server/session-scoped supervision state survives Desktop restart.
- [x] Optional safe project-relative checkpoint path injected into the visible task contract.
- [x] Separate completed, incomplete, needs-input, failed, timeout and recovery-exhausted outcomes.
- [x] Bounded malformed tool-call repair remains independent from semantic continuation budget.
- [x] Explicit stop and rejected recovery remove the contract; no later resurrection.
- [x] Stored records are schema-validated, age/count bounded and contain no prompts/tool output.
- [x] Agent API can inventory and explicitly forget durable contracts without deleting chats.
- [x] Native live continuation, full Desktop restart/resume and explicit-stop acceptance.

Acceptance: start a test-owned managed task, observe at least one bounded continuation,
restart Desktop between waits, complete only on the exact marker, and prove explicit stop
cannot resume it. Preserve the external OpenCode server and all unrelated sessions.

## M19 — Agent control plane and MCP (0.2.11)

- Private per-user Unix socket owned by the running Desktop process; no LAN listener.
- Bundled `--agent-mcp` stdio server for semantic project/session/model/run control.
- Commands execute through the visible frontend store and are serialized with bounded payloads/timeouts.
- Explicit permission/question handling, without automatic approval or hidden retries.
- Settings page installs the local MCP into OpenCode while preserving JSONC and unrelated entries.
- Native acceptance covers MCP handshake, visible state synchronization, one real bounded agent task and transcript retrieval.

The goal is a full daily-use desktop coding client with the familiar workspace structure requested by the user. This checklist describes planned work. A checkbox is checked only with recorded evidence. Exact equivalence with proprietary/cloud-only Codex features is not assumed; each capability must have an actual implementation or be explicitly marked unsupported.

## M0 — Bootstrap (provided)

- [x] Official Tauri 2 + React + TypeScript starter.
- [x] Product name Arvela; independent engine boundary documented.
- [x] Product specification, architecture, agent instructions and API snapshot.
- [x] Dependency installation, starter frontend build and Rust check verified; see docs/VERIFICATION.md.
- [x] Initial Git checkpoint prepared and committed before worker dispatch.

## M21 — Local OpenCode server autostart (0.2.12)

- [x] On local connection failure, native Desktop checks the loopback port and starts the separately installed CLI only when absent.
- [x] Cross-process startup lock, bounded health wait, executable discovery under a restricted app PATH, and a private startup log.
- [x] Remote SSH workspaces, occupied ports, HTTP/auth errors and browser preview never trigger a local server launch.
- [x] App exit leaves the server running; no existing server is restarted or killed.
- [x] When local OpenCode or Pi CLI is missing, offer its official installation instructions; never install either engine silently.
- [ ] Packaged macOS acceptance: missing test-owned local endpoint starts and connects; already running OpenCode is reused; existing user sessions are preserved.

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

- [x] Disconnected gate shows actionable errors and reconnect; installed local OpenCode is started automatically when absent, with no executable picker or engine auto-update.
- [x] Existing OpenCode processes are never killed or restarted; a Desktop-started local server remains independent after app exit. No config rewrites.
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
- [x] Linux packaging: `.deb` built and smoke-tested on Ubuntu 24.04 (0.2.9), with a platform-neutral
      Tauri config plus reviewed per-OS overlays. See `docs/PLATFORMS.md`.
- [x] Pi as a second local engine in 0.2.9: separate settings and model verification,
      per-project/per-chat choice, projectless chats, guarded tools, LSP, history
      alongside OpenCode and explicit two-way handoff. Native Mac and Linux
      acceptance is recorded in `docs/VERIFICATION.md`.
- [ ] Windows packaging: extension points named in `docs/PLATFORMS.md`, nothing built or tested.
- [ ] Cloud proprietary functionality only through a real supported service. Document unsupported features plainly.

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

## M14 — Cohesive assistant turns (0.2.5)

- [x] Adjacent engine steps grouped by request, with user/parent/compaction boundaries and stable message/part anchors.
- [x] Compact progress rail with expandable reasoning/tools; final answer and single copy/time/details footer.
- [x] Completed history starts folded; live progress stays open and disclosure state survives conversation switching.
- [x] Tool errors remain discoverable; aborted/limited output is not labelled as a successful final answer; invisible engine markers no longer create gaps.
- [x] Native installation and final package validation (see VERIFICATION).

## M15 — Full-page settings and appearance (0.2.6)

- [x] Settings navigation/search, grouped rows, back/escape and preserved conversation/draft; Cmd+, shortcut.
- [x] Theme, accessible palette/custom accent, independent UI/chat/code sizes, chat width/line spacing, live preview and reset.
- [x] Validated app-global persistence and old-preferences migration, unaffected by SSH workspace snapshots.
- [x] Separate connection/ASR saves, staged JSONC edits retained across sections with exit protection; original backup/conflict logic retained.
- [x] Unit and browser acceptance, including maximum fonts at the minimum native window size; no model inference.
- [x] Final native installation and package verification (see VERIFICATION).

## M16 — Native microphone permission repair (0.2.7)

- [x] Signed macOS audio-input entitlement, retaining Hardened Runtime and normal system consent.
- [x] Russian capture diagnostics distinguish permission, missing and unavailable devices; cancellation stops a late-granted microphone stream without transcription.
- [x] Regression tests for refusal/cancellation and release-artifact signature/entitlement/usage-description check.
- [x] Installed native capture/cancel acceptance, strict package verification and preserved configuration (see VERIFICATION).

## M17 — Attachments and CPU helper (0.2.8)

- [x] File picker, drag/drop and clipboard files; large pasted text as a file; reload-safe attachment drafts scoped to host/directory/session.
- [x] Route by live model input capabilities; direct images and supported media, PDF/video/audio conversion on isolated CT205 with GigaAM transcription for sound.
- [x] Loopback SSH tunnel with dynamic CT address, restricted source IP, helper endpoint/status in Desktop settings; OpenCode MCP connections remain separately configurable.
- [x] Explicit size, context and queue limits; failures retain draft and never silently discard unsupported content.
- [x] Packaged app, native helper/status and picker draft, real browser-to-OpenCode PDF roundtrip, source checks and installation (see VERIFICATION). Finder drop is handled by Tauri's native event and narrowly scoped file read after an owner-reported regression. The native acceptance outcome is recorded in VERIFICATION.

## M18 — Voice composer and attachment layout (0.2.10)

- [x] Recording uses a full-width, anchored composer row with visible cancel, waveform, timer and stop controls; model, agent and access controls cannot crowd it offscreen.
- [x] Attachment chips scroll within a bounded area, and long model/agent names shrink in the idle toolbar. The text area also respects viewport height.
- [x] Microphone capture no longer waits for Web Audio visualization to resume. Cancellation stops late grants and does not transcribe.
- [x] Native Mac acceptance with three long-name images, active recording, cancel and clean draft; installed app smoke. Linux `.deb` built and window-smoked from the same source. See VERIFICATION.

## M19 — Managed agent browser (0.2.15)

- [x] Official Playwright MCP, headed persistent Chromium, private lifecycle proxy, shared serialized tools with per-project file roots.
- [x] Local first-start/after-install setup for installed OpenCode/Pi, absent-engine skip, JSONC preservation and normal engine permissions.
- [x] Browser window button and settings, optional Node path, bounded install/start/error recovery.
- [x] Windows archive native-driver import with window guards; honest Linux unsupported native-control UI.
- [x] Final packaged Mac acceptance and installation (see VERIFICATION).
- [ ] Live Windows/Linux browser acceptance. Shared source implemented; no claim of live verification.

## M26 — Embedded browser and chat context (0.2.17)

- [x] Reviewed Windows ca99367/7452a0e archive, retained later main documentation.
- [x] Shared headless Chromium projection, manual input/cursor/tabs/history, stale input guards and first-prompt attachment; no privileged remote HTML or new network exposure.
- [x] Chat context: real sources/results/children, history navigation and existing composer picker/draft actions.
- [x] Durable recurring prompts scoped to server/directory/chat/engine/model, normal permission checks, no catch-up bursts or ambiguous retries.
- [x] 451 frontend / 71 Mac Rust checks and official browser transport/view smoke.
- [x] Reviewed direct source-only Opus 5.5 changes; fixed additional storage/delivery, child routing, stream cache and stale endpoint cases on Mac. All 451 frontend / 71 Rust checks pass; see `docs/CLAUDE-CONTEXT-REVIEW-20261005.md`.
- [x] Final Mac package installed: exact DOM input/key/click, real Pi loader/32 tools, context placement/history navigation, source chooser acceptance/cancel and paused schedule persistence passed. Original engine, configuration and draft preserved. See VERIFICATION.
- [ ] Live Windows/Linux 0.2.17 acceptance; archived Windows 0.2.16 results remain separate evidence.

## M27 — Windows shared browser transport (0.2.18)

- [x] Browser-only runtime outside per-process MSIX AppData redirection; versioned MCP executable outside shadowed install paths.
- [x] Copy legacy browser profile/cache without deleting originals or overwriting an existing shared profile.
- [x] 451 frontend / 59 Windows Rust checks, final NSIS build and debug/release cross-AppData real CLI regression (32 tools, one disposable browser).
- [ ] Manual installation and installed native 0.2.18 acceptance; Mac/Linux new source acceptance remains pending.

## M27 — Shared Windows browser MCP runtime (0.2.18)

- [x] Imported verified Windows history 5132356/8ae3e93; all archive checksums and source content matched.
- [x] Shared USERPROFILE browser runtime and versioned executable bridge outside MSIX AppData redirection, with cancellable profile migration preserving originals.
- [x] 451 frontend and 78 Mac Rust tests; TypeScript/Vite, Cargo fmt/all-targets check and native CLI build passed.
- [x] Disposable Mac native CLI: 32 shared tools; headless browser and two proxy regressions passed without inference or user configuration changes.
- [x] Windows NSIS preserved as a release asset with checksum and original build provenance.
- [ ] Installed Windows 0.2.18 normal/MSIX acceptance and real-profile migration. Mac 0.2.18 installation and Linux runtime acceptance are not claimed.


## Arvela 0.2.19 — Mac release verified

- [x] Neutral product name and equal agent overview/badges; stable identity and data paths.
- [x] Pi native model/effort confirmation, unopened-session compaction, prepared text attachments and durable message branching.
- [x] Shared workspace terminal/Git for Pi, without inventing Pi PTY/permission-queue capabilities.
- [x] Generic model-service bindings, catalog agent policy and real switch progress, ordinary/queued/scheduled/compact readiness gates.
- [x] Native Mac UI/package acceptance, real V100 model qualification and switch deployment; final permissions and Pi-only picker checks recorded in docs/VERIFICATION.md.
- [x] Reviewed runtime source published and installed as Mac 0.2.19; final release archive verified.

See [model services and capability matrix](docs/MODEL-SERVICES.md). Windows/Linux new release acceptance remains pending.

## Arvela 0.2.20 — responsive composer

- [x] Short model labels with full-name details; routing unchanged.
- [x] Container-based wrapping and separate send/voice actions.
- [x] In-flow dictation row; compact honest model-switch state.
- [x] 476 frontend tests and eight real browser geometry cases.
- [x] Signed Mac bundle and installed UI acceptance; source/release publication recorded in verification.
- [ ] Windows/Linux live acceptance.


## M30 — Browser modes and responsive projection (0.2.21)

- [x] Compact tabs, centered address pill, mode selector and expand/collapse; narrow container layout.
- [x] Fast semantic-first and enforced human mouse/keyboard mode, shared by OpenCode/Pi.
- [x] Bounded keyboard input tool, normal agent permissions and workspace upload policy preserved.
- [x] Debounced actual Chromium reflow; pending old panel input discarded and disabled until matching frame.
- [x] Per-client screenshot/page/viewport observation guard; stale XY input rejected before action with fresh image/dimensions, no click replay.
- [x] Decoded-image manual coordinates, shared-user input invalidation, bounded read-only frame refresh after capture races.
- [x] Isolated real Mac Chromium responsive-target, modes, password/upload/profile/transport acceptance.
- [x] Final Mac package/signature/microphone/DMG checks; installed mode/viewport/panel and actual MCP CLI acceptance. Publication recorded in VERIFICATION.
- [ ] Live Windows/Linux acceptance; shared source only.

## M31 — General browser performance (0.2.22)

- [x] Compact observations and atomic action/wait/observe over official MCP.
- [x] Six-step prevalidated sequences, interruption, partial results and no replay.
- [x] Shared queue and coordinate policy retained; numeric-only diagnostics.
- [x] Explicit per-chat supported effort / separate browser chat; Pi effort selector.
- [x] Idle capture throttling; no skills, owner-session search or model changes.
- [x] Final Mac package/install acceptance; native Low/new task/browser/diagnostics and installed CLI verified.
- [x] Reviewed main pushed; v0.2.22 matched Mac DMG published and downloaded SHA256/GitHub digest/integrity verified.
- [ ] Live Windows/Linux acceptance and task-based speed/quality A/B.

## M32 — Shared skills and tools (0.2.23)

- [x] Versioned global/project registry, portable skill sources and unified catalog.
- [x] Shared MCP tools with official SDK, Pi adapter and scoped OpenCode attachment.
- [x] Actual connection/session availability, dependencies and reload states.
- [x] Regression/real isolated MCP/Pi acceptance; Mac build/install and publication.
- [ ] Live Windows/Linux acceptance.

## M33 — Arvela identity (0.2.24)

- [x] Public product/repository/UI/docs use Arvela; stable data, vault and MCP identities preserved.
- [x] Windows verifier recognizes current and both legacy product names.
- [x] Regression/build, verified Mac replacement and publication.
- [ ] Live Windows/Linux rename upgrade acceptance.

## M34 — Passive browser observation window (0.2.25)

- [x] Fixed separate live preview; no browser input or viewport resize.
- [x] Dock/restore/hide and lifecycle/scope guards; one browser remains running.
- [x] Regression/security checks and real Mac window/Chromium acceptance.
- [x] Verified Mac replacement and publication; Windows/Linux live acceptance pending.

## M35 — Balanced agent settings and Arvela icon (0.2.26)

- [x] Common settings separated; equal OpenCode/Pi entries with owned navigation.
- [x] Pi drafts retained and covered by the settings exit guard.
- [x] Original generated icon with matching UI/macOS/Windows/Linux resources.
- [x] Tests, real Mac settings acceptance, installed build and main publication; Windows/Linux live acceptance pending.

## M36 — Private LAN knowledge and telemetry hub (0.2.27)

- [x] Small isolated Proxmox LXC, authenticated HTTPS API, catalog/versioning and Web UI.
- [x] Cross-device Arvela pull through existing shared skills/tools adapters.
- [x] Redacted texts/steps/errors/usage, durable retry/dedup and per-device/global metrics.
- [x] Private issue candidates, reviewed dataset export and bounded NAS backups.
- [x] Regression/security/real API/UI checks, Mac package/install and publication.

## M37 — History-guided reliability (0.2.28)

- [x] Analyze all available Hub records privately; distinguish controlled refusals/cancellation from defect candidates and missing usage from measured tokens.
- [x] Complete keyset pagination, latest-first message view and preserved review drafts.
- [x] Read-only error diagnostics, scoped session links and explicit coverage limits.
- [x] Stable repeated secret redaction and stale private-dialog/logout guards.
- [x] Revise three existing portable skills from observed edit/target/verification failures; publish catalog revisions without bypassing busy guards.
- [x] Frontend/service/native regression checks, isolated Web interaction and real TLS API pagination.
- [x] Mac0.2.28 build/signature/install and NAS full archive; isolated restore checked.
- [x] Updated Mac vault/HTTPS access and idle-applied skill revisions; actual Pi/OpenCode loaders checked without inference.
- [x] Main/release publication and downloaded Mac asset verification; live Windows/Linux acceptance remains separate.

## Shared skill authoring (0.2.38)

- [x] Common bundled creation recipe, shared adapters and persistent disable choice.
- [x] Selected-chat draft action: analysis, reuse/migration, portable package and verification; no automatic send or old-job replay.
- [x] Reviewed document-download skill with partial/edition/access evidence and portable helper failure checks.
- [ ] Qualify usefulness and automatic skill selection on future owner tasks; no unmeasured performance claim.

## Compact prompt queue (installed in 0.2.39)

- [x] Single-line summaries, bounded queue scrolling and attachment counts.
- [x] Composer-based Apply/Cancel with original position/model/attachment preservation and paused dispatch while editing.
- [x] Failure, cancellation and idle-during-edit tests; isolated narrow/large-text browser layouts.
- [x] Included in the owner-authorised 0.2.39 Mac installation.

## Detached browser group (installed in 0.2.39)

- [x] Selected-chat page cards, draggable ordering, layered previews and native group header.
- [x] Passive page selection without changing agent tab/input/viewport; stale capture and scope isolation.
- [x] Component drag/layout, isolated real Chromium and native checks on Mac.
- [x] Included in 0.2.39 Mac installation; Windows/Linux and OS-window drag acceptance remain separate.

## Queue recovery and shared skill improvement (0.2.39)

- [x] Explicit recovery acknowledges prior terminal error, preserves queue order/files, and allows deliberate rebinding of ready entries to the selected model.
- [x] Balance failure explains pause; new errors pause again and ambiguous POSTs never replay automatically. Pending dispatch updates authoritative local activity to busy.
- [x] Shared authoring recipe routes editing requests, resolves available source/revision through portable read-only catalogue, preserves concurrent edits and managed copies, and requires isolated verification.
- [x] 688 frontend / 96 native tests; catalogue fixtures and narrow actual Composer recovery/layout checks pass.
- [x] Mac 0.2.39 signature/DMG CRC/install binary equality, native connected/open status, GUI version and installed shared recipe bytes verified. No owner prompt or automatic old-job replay.

## Compact detached browser cards (0.2.40)

- [x] Fit passive window to the observed page ratio (preview capped at 420×300 logical pixels); no Chromium viewport/input changes.
- [x] Transparent native corners, one rounded outline, compact title/controls/status and full preview area without nested frame or empty stage.
- [x] Keep selected-session isolation, passive page selection and drag ordering; isolated actual layout checks for landscape, square and portrait pages.
- [x] Mac 0.2.40 package signature/DMG CRC/binary equality and GUI version verified; installed after explicit owner permission to interrupt browser. Native control and external server healthy. Owner preview after restart and Windows/Linux live acceptance remain separate.

## Resizable browser panel (0.2.41)

- [x] Pointer-captured left border and keyboard width controls; 280px minimum, preserve room for chat.
- [x] Save chosen width through existing layout preferences; cancelled drag retains the prior choice, overlay/fullscreen behave independently.
- [x] Defer page resize until drag release, clear stale input, ignore disconnected observer callbacks.
- [x] Component regressions and actual isolated Chromium pointer drag, durable settings/reload, keyboard and narrow viewport checks.
- [x] Final Mac 0.2.41 app signature/DMG CRC/install binary equality and GUI version verified; native connection healthy. Owner live splitter after restart and Windows/Linux native checks remain separate.

## Session-guided browser reliability (0.2.42)

- [x] Privately review the selected session history; classify parameter refusals, timeouts, state guards and agent/file-root issues without publishing private transcripts.
- [x] Bounded short observations, typed value-free argument recovery, partial-action guidance and retained underlying failure text for OpenCode/Pi.
- [x] Independent per-session queues, cancellable bounded preparation, controlled 45s deadline and retained mutation ordering/no replay; numeric timeout failure accounting.
- [x] Unit and real isolated MCP/Chromium regression checks, including a slow backend and independent second session.
- [x] Final Mac package signature/DMG CRC, installed binary and four runtime resource equality, GUI0.2.42 and connected native API verified; owner inference and Windows/Linux acceptance remain separate.


## Concise interface copy (0.2.43)

- [x] Remove redundant context-meter and application explanatory paragraphs; retain labels, counters, actions, errors, empty states and concise data-sharing facts.
- [x] Move optional setting help to label hover; retain helper dictation as an actionable setting.
- [x] Frontend build and 696 tests pass.
- [x] Isolated Chromium and installed Mac GUI context/settings checks, signed package/DMG CRC/binary equality and healthy native connection verified; Windows/Linux native qualification separate.


## Session attachment gallery (0.2.44)

- [x] Shared message/source thumbnails and scoped gallery with search and navigation; compact three-source list and earlier-history loading.
- [x] Image zoom, bounded passive text/media and PDF canvas pages; preserve remote/file security boundaries, cleanup and scope isolation.
- [x] Unit and isolated Chromium acceptance including real PDF, inert HTML text, narrow layout and no owner mutations.
- [x] Final Mac signature/DMG CRC/install equality, native0.2.44 and actual historic image/gallery acceptance; source publication. Packaged WK PDF and Windows/Linux native acceptance remain separate.
