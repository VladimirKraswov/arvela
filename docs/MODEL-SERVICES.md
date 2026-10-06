# Managed model services

AgentMesh Desktop separates an **agent** (OpenCode or Pi), its provider/model
selection, and the **inference service** holding weights in VRAM. OpenCode remains
the default for new projects. Pi settings, histories, credentials and extensions
remain independent. Selecting an agent does not rename or reinterpret a transcript;
use the explicit context continuation to create a chat with another agent.

## Configuring a service

In Settings → Services of models, add a name, the exact provider ID, a loopback
HTTP origin and mappings, one per line: `model-in-agent=model-in-service`.
For another provider pointing at the same engine, add another binding with the
same origin. Those bindings share one switch operation, progress and credential.
The API must use the version-1 contract below. An unmanaged model keeps its
existing behavior; managed models require a verified catalog before sending.

Connect remote services through an authenticated SSH tunnel; the WebView cannot
connect to arbitrary LAN origins. Never put a token in the URL or mapping. Enter
the control key and select “Connect and check”. Keys use the system credential
store and are restored after relaunch; credentials never enter preferences.
Removing a binding does not
stop the external service or erase an agent's provider configuration.

Provider URLs and models are still configured in their owning agents. For a
Pi-only service model, configure Pi's provider header `X-Ninfer-Agent: pi`.
The NInfer gateway conservatively treats missing headers as `opencode`. This is
an explicit client compatibility policy, not cryptographic proof of agent identity;
protect inference endpoints with the existing private network/tunnel controls.
The catalog's `agents` list determines visibility. No model-name matching is used.

## Version-1 control contract

All control requests require `Authorization: Bearer <control-key>`.

| Route | Behavior |
|---|---|
| `GET /v1/model-control/catalog` | `{schema:1,models:[{id,label,agents,context_window}]}` |
| `POST /v1/model-control/select` | `{model,agent}`; returns status, 202 while switching, 200 when ready |
| `GET /v1/model-control/status` | Current operation and real loader events |

Status includes `operation_id`, `phase`, `ready`, `active_model`, `target_model`,
`elapsed_seconds`, `active_requests`, `error`, and optional `loader` with
`phase`, `current`, `total`, `unit` (`bytes` or null). Phases are `unloaded`,
`draining`, `unloading`, `loading`, `warming`, `ready`, `failed`. Bytes measure the
current loader stage, not an invented overall completion percentage. Ready means
the native engine passed health and confirmed the requested public model ID.

Desktop waits for the exact selected model before normal, queued, scheduled or
compaction requests. It keeps the draft on failure. A changed configuration,
conflicting operation or changed workspace cancels dependent sending. Changing
a model during the current chat's running turn is disabled. Remote clients and
other chats still need coordination: gateway draining covers active HTTP requests,
including streams and native queued requests, not an entire agent tool loop.
It never chooses a substitute model after a failure.

## Pi and common surfaces

| Function | OpenCode | Pi |
|---|---|---|
| Streaming text, reasoning, tools, abort, usage | Native server | Native RPC |
| Model and effort selection | Explicit prompt profile | RPC selection and confirmation |
| History, edit as branch, compaction | Native session APIs | Native durable fork/compact |
| Images | Provider capabilities | Direct native images |
| Text files / prepared PDF, audio, video | Common helper | Common helper → text/images |
| Dictation, browser, sources, schedules, results | Shared Desktop | Shared Desktop |
| File and shell approvals, questions | Server queues | Pi extension dialogs |
| LSP and extensions | Agent configuration | Pi extensions and server paths |
| Terminal / files / working-copy Git | Workspace server | Same workspace server when connected |
| OpenCode per-session diff / child-session inventory | Server API | No identical Pi API; working-copy Git remains available |
| Remote SSH execution | Supported OpenCode host | Not implemented for Pi |

Pi does not pretend to have OpenCode's permission queues or PTY protocol. An
unreachable workspace server does not prevent local Pi chat; its workspace-only
panels are disabled. Changing a selection in an already-open Pi process explicitly
calls `set_model` / `set_thinking_level` and checks `get_state`; an unconfirmed
selection or a busy model change cannot silently send to the wrong model.

## Product rename

Version 0.2.19 uses **AgentMesh Desktop** in the window, bundle and UI. The native
identifier `dev.local.opencodedesktop`, executable `opencode-desktop`, data paths,
MCP command names and preference keys remain stable. GitHub repository and existing
integration configuration retain their original names. Install the new Mac bundle
as a replacement for the old app, with the prior bundle backed up; do not run two
copies against the same profile. Windows/Linux install migration still requires
platform acceptance before claiming it verified.

On Mac installation, update existing managed MCP executable paths to the new
bundle (`cua_desktop` / `--computer-mcp`, `opencode_desktop` / `--agent-mcp`).
Preserve their enabled state, credentials and unrelated configuration. Browser
auto-configuration already resolves the current executable. The installed Mac
acceptance confirmed tool lists from all three interfaces (17 / 22 / 32 tools).

Control keys use the OS credential store (macOS Keychain, Windows Credential
Manager, Linux Secret Service), separate from preferences and provider API keys.
The stable vault namespace survives the product rename. A locked/unavailable store
is a visible error, with no plaintext-file fallback. «Забыть ключ» removes the
shared endpoint credential; both agent bindings lose authenticated discovery.
Browser-only development keeps credentials in memory. Linux requires an unlocked
Secret Service session; Windows/Linux vault acceptance has not been run on Mac.

## Local model comparison

The actual Pi RPC comparison of the two V100 checkpoints, Medium/XHigh, independent
checks and timing limitations are recorded in [the comparison report](PI-MODEL-COMPARISON-20261007.md).
Pi is an additional checkpoint choice, not a general speedup claim.
