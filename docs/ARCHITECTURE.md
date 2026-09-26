# Architecture

## Separation

```text
OpenCode Desktop (Tauri app; independent version)
  React UI → typed application adapter → WebView HTTP/SSE/WebSocket transport
                                            ↓ loopback API
Separately installed OpenCode server (independent version)
  sessions / execution / permissions / PTY / agents / model providers
                                            ↓ configured provider
Local Qwen / FreeToken (already managed outside this project)
```

Never import OpenCode internal database schemas or maintain a fork of its engine. Use published server interfaces and capabilities, with the live OpenAPI contract as the authority for the installed version. Keep HTTP concerns and schema normalization out of presentation components. An official SDK is acceptable only after validating its version against this server; do not accidentally install a v2 client for incompatible v1 interfaces.

## Boundaries

- `src/api/`: contract types, transport facade, response validation, API version/capability normalization.
- `src/agent/`: the backend-neutral `AgentBackend` contract, its capability flags and the descriptor registry. OpenCode (`src/agent/opencode.ts`) is the default and the only implementation; see `docs/AGENT-BACKENDS.md`. The state layer calls only this contract, so another agent runtime is an added implementation rather than a UI/state rewrite. PTY, `/mcp` and the JSONC config editor are deliberately outside the contract and reach the OpenCode client through `asOpenCodeClient`, which returns null for any other backend.
- `src/agent/pi/`: the Pi engine — RPC protocol types, a pure translator from Pi's event vocabulary into this app's own event model, the `AgentBackend` implementation and the native bridge. Pi is a local CLI driven over its documented JSONL RPC mode; see `docs/PI-ENGINE.md`.
- `src/state/engines.ts`: which engine drives a folder or chat (per-chat override → folder preference → OpenCode). Pure and unit-tested; the absence of an entry *is* the migration for pre-existing projects and chats.
- `src/state/`: selected project/session, normalized message store, stream reducer, pending permissions/questions, drafts; unit-testable without Tauri.
- `src/components/` and feature folders: workspace chrome, projects/sessions, conversation/composer, review/files, terminal, settings.
- `src/native/`: the thin Tauri bridges (SSH tunnels, chime, chat workspaces) plus host-platform detection. Platform detection drives presentation only — window-chrome insets, the modifier-key label and OS-specific help text. Feature availability is decided by `AgentBackend.capabilities`, never by the host OS.
- `src-tauri/src/pi.rs`: Pi process ownership — absolute-path launch, one child per (directory, session), strict JSONL framing, extension dialogs surfaced to the UI with default-deny on timeout, and every child killed on app exit.
- `src-tauri/`: native dialog/opener integrations and the bounded ASR multipart command. OpenCode HTTP/SSE/WebSocket stays in the WebView; ASR uses a native request because the configured speech service may be outside the loopback CSP. Never an arbitrary command executor exposed to rendered content.
- `src-tauri/src/control.rs` and `src/control/bridge.ts`: private per-user Unix-socket control plane plus the `--agent-mcp` stdio adapter. External agents invoke bounded semantic actions against the same visible store; no TCP listener, pointer automation, direct `localStorage` edits or second agent loop. See `docs/AGENT-CONTROL.md`.
- `test/`: fixtures, API contract/event tests, component tests; test-owned repositories for any integration edits.

## Correctness rules

Every request/event subscription must carry the intended project directory where applicable. Store messages and parts keyed by session/message/part IDs. A reconnect must resync authoritative history/status and pending requests before consuming further incremental updates; deduplicate replay. Guard request completion with a generation or equivalent to prevent stale results after project switches. Bound retained terminal/log content and render large histories efficiently.

Async submission acknowledgement means accepted, not finished. Handle server errors, uncertain network outcomes, output-length termination, abort and idle separately. Avoid sending a prompt twice on a UI double-click or reconnect. No recursive automated recovery hidden in the frontend.

## Security and ownership

The OpenCode endpoint is loopback-only. The separately configured ASR URL allows HTTPS, or HTTP on private/loopback hosts, with redirects disabled and bounded payloads/timeouts. ASR keys remain in memory and are bound to the selected URL. Validate allowed hosts/schemes/ports; remote support is a later explicit trust feature. Do not disable backend authorization or globally loosen CORS. Use narrow Tauri capabilities and a real production CSP before packaging. Model Markdown and tool/file output are untrusted; never enable raw script-capable HTML. Open external links through controlled native APIs with safe scheme checks. Credentials must not appear in logs, URLs, Git, local storage or generated reports.

Reuse externally managed OpenCode without claiming process ownership. If the app starts its own installed executable, use an explicit argument vector, known working directory, startup health deadline and process identity. Never `pkill opencode` or stop an external daemon on app shutdown. Browser/preview content cannot share privileged Tauri APIs.

## Independent updates

Record shell and detected server versions separately. Feature detection and adapter tests must tolerate additive fields/missing optional capabilities. Missing required endpoints cause a compatibility message with versions, not data migration. Updating the app touches only its own bundle/preferences. Updating the OpenCode CLI does not require changing the model, engine or existing session database.

## Host platforms

macOS and Linux are two separately configured build variants of the same codebase
(`docs/PLATFORMS.md`). The shared Tauri config is platform-neutral; each variant adds
only its own window chrome, bundle targets and signing/entitlement settings, so a
Linux bundle can never pick up macOS chrome or entitlements. Per-OS preference paths
are resolved in one place (`src-tauri/src/paths.rs`): Linux honours `XDG_CONFIG_HOME`
/ `XDG_DATA_HOME` when they are absolute, macOS keeps `$HOME/.config` and
`$HOME/.local/share` byte-for-byte so an installed release keeps its data. Windows is
an unimplemented extension point, not a shipped variant. Platform-specific pieces are
narrow and explicit: the completion chime picks the first installed system player from
an absolute-path table (`afplay` on macOS, `canberra-gtk-play`/`paplay`/`pw-play` on
Linux) and silently does nothing when none is present; only macOS reserves space for
overlay window controls; the Cua Driver computer-control integration is macOS-only and
reports itself unavailable elsewhere without disabling any other tool. `ssh` is always
launched from an absolute path, never resolved through PATH.
