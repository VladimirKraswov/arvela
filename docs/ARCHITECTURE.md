# Architecture

## Separation

```text
OpenCode Desktop (Tauri app; independent version)
  React UI → typed application adapter → native HTTP/SSE/WebSocket transport
                                            ↓ loopback API
Separately installed OpenCode server (independent version)
  sessions / execution / permissions / PTY / agents / model providers
                                            ↓ configured provider
Local Qwen / FreeToken (already managed outside this project)
```

Never import OpenCode internal database schemas or maintain a fork of its engine. Use published server interfaces and capabilities, with the live OpenAPI contract as the authority for the installed version. Keep HTTP concerns and schema normalization out of presentation components. An official SDK is acceptable only after validating its version against this server; do not accidentally install a v2 client for incompatible v1 interfaces.

## Suggested boundaries (implement as needed)

- `src/api/`: contract types, transport facade, response validation, API version/capability normalization.
- `src/state/`: selected project/session, normalized message store, stream reducer, pending permissions/questions, drafts; unit-testable without Tauri.
- `src/components/` and feature folders: workspace chrome, projects/sessions, conversation/composer, review/files, terminal, settings.
- `src-tauri/`: narrow native commands for trusted local transport, streams and native integrations. Never an arbitrary command executor exposed to rendered content.
- `tests/`: fixtures, API contract/event tests, component tests; test-owned repositories for any integration edits.

## Correctness rules

Every request/event subscription must carry the intended project directory where applicable. Store messages and parts keyed by session/message/part IDs. A reconnect must resync authoritative history/status and pending requests before consuming further incremental updates; deduplicate replay. Guard request completion with a generation or equivalent to prevent stale results after project switches. Bound retained terminal/log content and render large histories efficiently.

Async submission acknowledgement means accepted, not finished. Handle server errors, uncertain network outcomes, output-length termination, abort and idle separately. Avoid sending a prompt twice on a UI double-click or reconnect. No recursive automated recovery hidden in the frontend.

## Security and ownership

Default endpoint is loopback-only. Validate allowed hosts/schemes/ports; remote support is a later explicit trust feature. Do not disable backend authorization or globally loosen CORS. Use narrow Tauri capabilities and a real production CSP before packaging. Model Markdown and tool/file output are untrusted; never enable raw script-capable HTML. Open external links through controlled native APIs with safe scheme checks. Credentials must not appear in logs, URLs, Git, local storage or generated reports.

Reuse externally managed OpenCode without claiming process ownership. If the app starts its own installed executable, use an explicit argument vector, known working directory, startup health deadline and process identity. Never `pkill opencode` or stop an external daemon on app shutdown. Browser/preview content cannot share privileged Tauri APIs.

## Independent updates

Record shell and detected server versions separately. Feature detection and adapter tests must tolerate additive fields/missing optional capabilities. Missing required endpoints cause a compatibility message with versions, not data migration. Updating the app touches only its own bundle/preferences. Updating the OpenCode CLI does not require changing the model, engine or existing session database.
