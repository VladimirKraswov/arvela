# Architecture

## Separation

```text
Arvela (Tauri + React; independent app version)
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
- `src/state/`: the store remains the public command/subscription facade; `types.ts` defines the schema, `initial.ts` constructs transient state from already-loaded preferences, and `modelChoice.ts` selects models from normalized state without I/O. Type exports from `store.ts` remain compatible. Preferences migration/persistence stays in `prefs.ts`; pure stream/history merge stays in `chatReducer.ts`. Connection generations, queues, permission/stop ownership stay in the facade for this incremental extraction; no API normalization moved into selectors.
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
