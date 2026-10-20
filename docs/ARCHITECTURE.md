# Architecture

## Separation

```text
Enki (Tauri + React; independent app version)
  store facade → normalized AgentBackend → OpenCode HTTP/SSE (loopback / strict SSH)
                                    └──→ Pi JSONL RPC (app-owned local process)
  shared capability registry → OpenCode config adapter / Pi extension → same MCP/skills
  native Hub client → HTTPS + OS vault → private Hub catalog/history/project memory
  browser panel → app-owned private gateway → managed Chromium + official Playwright MCP
Agents → separately configured inference providers (local or authorized cloud)
```

Never import OpenCode internal database schemas or maintain a fork of its engine. Use published server interfaces and capabilities, with the live OpenAPI contract as the authority for the installed version. Keep HTTP concerns and schema normalization out of presentation components. An official SDK is acceptable only after validating its version against this server; do not accidentally install a v2 client for incompatible v1 interfaces.

## Boundaries

- `src/api/`: contract types, transport facade, response validation, API version/capability normalization.
- `src/agent/`: the backend-neutral `AgentBackend` contract, its capability flags and the descriptor registry. OpenCode (`src/agent/opencode.ts`) is the default; Pi is a second implementation; see `docs/AGENT-BACKENDS.md`. The state layer calls only this contract, so another agent runtime is an added implementation rather than a UI/state rewrite. PTY, `/mcp` and the JSONC config editor are deliberately outside the contract and reach the OpenCode client through `asOpenCodeClient`, which returns null for any other backend.
- `src/agent/pi/`: the Pi engine — RPC protocol types, a pure translator from Pi's event vocabulary into this app's own event model, the `AgentBackend` implementation and the native bridge. Pi is a local CLI driven over its documented JSONL RPC mode; see `docs/PI-ENGINE.md`.
- `src/state/engines.ts`: which engine drives a folder or chat (per-chat override → folder preference → OpenCode). Pure and unit-tested; the absence of an entry *is* the migration for pre-existing projects and chats.
- `src/state/`: the store remains the public command/subscription facade; `types.ts` defines the schema, `initial.ts` constructs transient state from already-loaded preferences, and `modelChoice.ts` selects models from normalized state without I/O. Type exports from `store.ts` remain compatible. Preferences migration/persistence stays in `prefs.ts`; pure stream/history merge stays in `chatReducer.ts`.
- `src/state/promptQueue.ts`: queue editing, persistence, arming and dispatch policy behind a typed `PromptQueueHost`. The store owns the shared snapshot, backend calls, connection generations and permission/stop reconciliation. The controller does not create a second state store or an agent loop.
- `src/state/submission.ts`: preparation ownership and cancellation. Navigation invalidates an operation even after an away-and-back round trip. Only the operation owning the composer may unlock it. Stop before dispatch cancels preparation; a POST already in flight retains acknowledgement ownership and is never automatically replayed.
- `src/api/sse.ts`: bounded incremental SSE framing, separate from fetch/reconnect in `events.ts`. Cancellation releases the reader; parser/subscriber failures trigger reconciliation through reconnect. HTTP response-body cancellation remains a transport outcome rather than a JSON schema error.
- `src/util/keyedQueue.ts`: synchronous reservation of every resource in a mutation. Attachment transfers reserve both scopes before awaiting work, preventing opposite-copy deadlocks and move/add data loss. IndexedDB commits precede successful cache publication.
- `src/hub/collection.ts` and `identity.ts`: pure collection from one state snapshot and stable Hub identity. Unknown background session metadata is deferred rather than assigned the foreground directory. Native `hub/outbox.rs` validates numeric diagnostics, applies text-sharing policy and rejects enqueue/ack against a different Hub. Package installation also checks the source Hub after asynchronous steps.
- `src-tauri/src/capabilities/skills.rs`: bounded skill discovery/metadata validation; MCP installation stays in the capabilities facade. Filesystem limits and symlink rejection remain unchanged.
- `src/capabilities/` and native `capabilities.rs` / `shared_mcp.rs`: explicit shared catalog/adapters, independent agent capability boundaries and bounded MCP proxy. Native auth/paths never become privileged APIs in web pages.
- `src/outcomes/`, `src/memory/`, `src/hub/` plus native `hub.rs`/`hub/retrieval.rs`: accepted task records, explicit project bindings and approved memory, durable scrubbed telemetry, optional read-only shared memory MCP with per-folder grants. Native Hub/vault credentials never enter MCP arguments; search is off by default and automatic context preparation is not enabled. See `PROJECT-MEMORY.md` and M41 evidence.
- `src/components/` and feature folders: workspace chrome, projects/sessions, conversation/composer, review/files, terminal, settings.
- `src/native/`: the thin Tauri bridges (SSH tunnels, chime, chat workspaces) plus host-platform detection. Platform detection drives presentation only — window-chrome insets, the modifier-key label and OS-specific help text. Feature availability is decided by `AgentBackend.capabilities`, never by the host OS.
- `src-tauri/src/pi.rs`: Pi process ownership — absolute-path launch, one child per (directory, session), strict JSONL framing, extension dialogs surfaced to the UI with default-deny on timeout, and every child killed on app exit.
- `src-tauri/src/process.rs`: shared child-process ownership — bounded waits and bounded captured output, hidden consoles on Windows, Unix process groups, a Windows kill-on-close Job Object and a continuously drained output tail for long-lived children. It only ever signals processes Desktop spawned.
- `src-tauri/src/browser.rs` (+ `browser/files.rs`, `browser/node.rs`, `browser/gateway.rs`): managed browser lifecycle facade over the pinned on-disk runtime, Node.js selection and the private loopback gateway. See `docs/BROWSER.md`. `src/browser/integration.ts` coordinates background setup; `src/browser/preferences.ts` holds the shared enabled/Node.js rules.
- `src-tauri/src/local_server.rs`: narrowly scoped startup of the separately installed local OpenCode CLI. A strict loopback origin, cross-process lock and second health/port check prevent remote fallback or duplicate startup. It neither owns user sessions nor stops an existing server; exit leaves a started local server running.
- `src-tauri/`: native dialog/opener integrations and the bounded ASR multipart command. OpenCode HTTP/SSE/WebSocket stays in the WebView; ASR uses a native request because the configured speech service may be outside the loopback CSP. Never an arbitrary command executor exposed to rendered content.
- `src-tauri/src/control.rs` and `src/control/bridge.ts`: private per-user Unix-socket control plane plus the `--agent-mcp` stdio adapter. External agents invoke bounded semantic actions against the same visible store; no TCP listener, pointer automation, direct `localStorage` edits or second agent loop. See `docs/AGENT-CONTROL.md`.
- `test/`: fixtures, API contract/event tests, component tests; test-owned repositories for any integration edits.

## Correctness rules

Every request/event subscription must carry the intended project directory where applicable. Store messages and parts keyed by session/message/part IDs. A reconnect must resync authoritative history/status and pending requests before consuming further incremental updates; deduplicate replay. Guard request completion with a generation or equivalent to prevent stale results after project switches. Bound retained terminal/log content and render large histories efficiently.

Async submission acknowledgement means accepted, not finished. Handle server errors, uncertain network outcomes, output-length termination, abort and idle separately. Avoid sending a prompt twice on a UI double-click or reconnect. No recursive automated recovery hidden in the frontend.

Queue edits must be durable before removing a draft or its attachment copies.
Failed persistence leaves the draft editable. Preparation and uncertain delivery
are distinct states: only preparation can be safely cancelled or retried.
Workspace identity is the stable SSH/local workspace key, not an ephemeral
forwarding URL; delayed dictation and attachments use that identity.

`npm run check:architecture` checks TypeScript runtime imports for cycles and
rejects dependencies from API/agent/util/attachment layers back into UI, control
or the store facade. Type-only imports do not introduce runtime coupling. CI also
enforces `cargo clippy --all-targets -- -D warnings`. A narrow documented lint
exception preserves the released ASR IPC argument names. These checks complement
behavioral tests; they do not prove correctness or replace platform acceptance.

## Security and ownership

The OpenCode endpoint is loopback-only. The separately configured ASR URL allows HTTPS, or HTTP on private/loopback hosts, with redirects disabled and bounded payloads/timeouts. ASR keys remain in memory and are bound to the selected URL. Validate allowed hosts/schemes/ports; remote workspaces use explicitly configured strict-key SSH tunnels; configured Hub requests use native HTTPS and pinned server identity. Do not disable backend authorization or globally loosen CORS. Use narrow Tauri capabilities and a real production CSP before packaging. Model Markdown and tool/file output are untrusted; never enable raw script-capable HTML. Open external links through controlled native APIs with safe scheme checks. Credentials must not appear in logs, URLs, Git, local storage or generated reports.

Reuse externally managed OpenCode without claiming process ownership. If the app starts its own installed executable, use an explicit argument vector, known working directory, startup health deadline and process identity. Never `pkill opencode` or stop an external daemon on app shutdown. Browser/preview content cannot share privileged Tauri APIs.

## Independent updates

Record shell and detected server versions separately. Feature detection and adapter tests must tolerate additive fields/missing optional capabilities. Missing required endpoints cause a compatibility message with versions, not data migration. Updating the app touches only its own bundle/preferences. Updating the OpenCode CLI does not require changing the model, engine or existing session database.

## Host platforms and verification

macOS, Windows and Linux are separate build overlays on one codebase. Shared
configuration has no macOS window chrome or entitlements; each overlay supplies
its own bundle target and platform settings. Stable app identity, binary name and
paths survive product renames. Windows is an implemented variant; Unix Agent
Control/Factory and macOS-only Cua Driver remain honestly unavailable there.
Native process ownership is centralized; no external server is killed on shutdown.

The three-platform CI builds and verifies packages with toolchain/commit/hash
receipts, without installing an app or running a model. Unit/contract checks,
packaging and live GUI/agent acceptance are separate kinds of evidence. Current
boundaries and commands: [PLATFORMS.md](PLATFORMS.md). Live scenarios and results:
[PLATFORM-ACCEPTANCE.md](PLATFORM-ACCEPTANCE.md), [VERIFICATION.md](VERIFICATION.md).
Historical Windows/Linux reports remain historical, never automatic checkmarks
for a new release.
