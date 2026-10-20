# Managed model services

## Hub coordinator — 0.2.75

The normal path for the owner's shared models is now:

```text
Enki (Windows / macOS / Linux)
  → authenticated, pinned HTTPS → Hub catalog + reservations + status
      → private control API → gateway in VM 5100 → one resident V100 model
      → truthy loaded health + exact model ID → fixed Strata gateway in VM 5200
Agent → its existing inference URL / SSH tunnel → streaming model response
```

Hub coordinates models; it does not proxy token streams, run agents, execute
commands, move GPUs or implicitly boot VMs. A VM's gateway alone owns unloading,
loading and health checks of its child engine. Separate physical GPUs have separate
resource IDs and do not block one another. Two services for one physical GPU must
share one resource ID. Existing OpenCode/Pi provider URLs and headers are retained.

The shared model catalog has an optional explicit field:

```json
"control": {
  "service": "v100",
  "bindings": { "artemis31-v100": "artemis31-v100" }
}
```

It accompanies the provider definitions, so adding a provider cannot silently
omit its readiness gate again. Clients receive service IDs and model bindings,
never gateway credentials. Routing discovery is independent of whether the device
has opted into writing Hub providers to its engine config. A known Hub-managed
model fails closed when Hub is unavailable or removes its binding. Remote clients
use the same Hub identity and need no model-control SSH tunnel or control key.
Their inference transport remains configured in their owning agent.

Only the Hub operator configures `/etc/enki-hub/model-services.json`, a private
0600 file readable by the Hub service user. Example:

```json
{"services":{"v100":{
  "label":"Tesla V100 · VM 5100",
  "resource":"tesla-v100",
  "endpoint":"http://192.168.31.93:8080",
  "tokenFile":"/etc/enki-hub/model-services-v100.key"
}}}
```

The key file must also be a private regular 0600 file. The existing systemd sandbox
keeps `/etc` read-only for the service. `ARVELA_MODEL_SERVICES_CONFIG` can override
the operator path. No HTTP endpoint accepts a gateway URL, shell command or key.
A fixed service additionally sets `kind: "fixed"`, its exact `model` and `agents`;
it is checked via `/health` and `/v1/models` without inference or implicit startup.

All coordinator routes require the usual device authentication:

| Route | Request / result |
|---|---|
| `GET /api/model-services/catalog` | Public explicit routes for both engines |
| `POST /api/model-services/inspect` | `{providerID,modelID,agent}`; read-only status |
| `POST /api/model-services/prepare` | Same IDs + opaque `requestKey`, `mode: select/run`; status with a ticket in `operation_id` |
| `POST /api/model-services/status` | `{ticket}`; observe progress and renew the reservation |
| `POST /api/model-services/release` | `{ticket}`; release this device's reservation, without stopping the model |

Prepare is idempotent for a device and request key. After a lost acknowledgement,
an explicit retry reuses that key; the client does not automatically replay a
prompt. FIFO reservations are persisted in `model-reservations.sqlite3`, scoped
to the authenticated device. Same-model clients can share residency. Another
model waits while an earlier request or an active run owns that GPU, including
gaps when the agent is running tools rather than generating tokens. A selection
only warms the model; a run reservation is acquired again at the final dispatch
boundary after preparing attachments. Manual, queued and scheduled prompts use it.

While waiting/loading, status is polled about every 800 ms. Active agent sessions
renew every 15 seconds; terminal sessions release on the next renewal tick.
The UI preserves reservation receipts across reloads and allows startup/POST
resynchronization. Abandoned reservations expire after 10 minutes without contact;
this is a bounded network-failure policy, not a promise to protect an offline
client indefinitely. Hub restart retains reservations without restarting prompts.
Loader failure or an out-of-Hub model change is terminal, with no automatic
inference replay. Upgrade older clients to participate: direct legacy controllers
cannot provide a whole-turn reservation to Hub, though the VM gateway still drains
their active HTTP streams. Coordination does not grant additional tool permissions.

Progress is scoped to the requesting chat and engine. Checking, waiting, unloading,
loading and warming show concise Russian status; byte progress is shown only if
the loader reports it. No invented overall percentage. Ready status disappears.
Stop/cancel keeps the draft and prevents dispatch; cancelling selection retains
the previous model. A prompt is sent only after the exact requested model is ready.

Legacy explicitly configured local services remain supported for other deployments.
Additional providers at an already bound agent API root inherit its control gate
and require fresh registry authorization for their exact ID; names/prefixes do not
establish ownership. Hub routes take precedence over these local bindings.

Enki separates an **agent** (OpenCode or Pi), its provider/model
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

## Discovery, offline models and selection

Since 0.2.35, configured models remain in the picker when their inference service
is offline. OpenCode uses connected/configured providers, not its entire global
model database; Pi keeps its own catalog, custom IDs and access badges. Service
bindings supplement providers configured in the owning agent. Removing a model
from its agent configuration or its binding removes that source of the row;
removing a service alone does not erase an independent provider configuration.

The service catalog stores only last-known public display metadata in preferences,
scoped to its endpoint. This retains labels and Pi-only visibility across relaunch
and temporary network failures. Cached metadata never authorizes inference; an
unknown policy must be obtained from the service before execution. Fresh policy
changes replace the display metadata. Keys remain in the system credential vault.

“Обновить список” in the picker reads the owning agent and service catalogs without
loading weights or prompting a model. Partial failures retain configured rows and
show the error. Selecting a managed target waits for its exact ready state; Pi
additionally performs its existing small real access probe. Failure opens a modal
with retry, leaves the row and the previous selection intact, and never selects a
substitute. A late readiness result cannot change another chat or workspace.
Previously selected configured models also remain selected when offline.

## Model connection failures

Since 0.2.50, an assistant model transport error is displayed once, separately
from the OpenCode event-stream connection. “Проверить модель” on a managed model's
failed message reads a fresh catalog and status for that message's exact model.
It never calls select, changes weights or sends a prompt. A reachable service
with a different active model, a loading operation or failed engine is not
reported ready. Configuration changes invalidate in-flight checks; their result
does not appear in another chat. HTTP authentication/balance errors retain their
own meaning rather than being classified as a tunnel outage.

After a transport failure, completed tools are retained. Continue the agent or
its paused queue explicitly after verifying readiness; do not replay an entire
turn automatically, because commands may already have changed files or websites.

For an external inference tunnel, use the service VM's SSH host directly when
reachable, avoiding an unnecessary dependency on the hypervisor's SSH server.
On macOS a LaunchAgent can supervise `ssh -N` with:

```text
BatchMode=yes
ExitOnForwardFailure=yes
ConnectTimeout=10
ConnectionAttempts=1
ServerAliveInterval=10
ServerAliveCountMax=3
TCPKeepAlive=yes
StrictHostKeyChecking=yes
ControlMaster=no
ControlPath=none
ForkAfterAuthentication=no
PermitLocalCommand=no
```

Bind every local forward explicitly to `127.0.0.1`; retain the service's actual
remote bind address. Set `RunAtLoad=true`, `KeepAlive=true` and
`ThrottleInterval=10` in the LaunchAgent, with private stdout/stderr log files.
This bounds failed connection attempts, detects an unresponsive SSH peer and
restarts exited SSH processes, including successful exits. It cannot guarantee
service availability during network loss or prevent interruption of a request
already streaming when the network fails. After recovery verify `/v1/models`
and the authenticated control status, not merely that the local port listens.
Do not disable host-key verification, expose a LAN listener or restart the
externally managed agent/inference server as a recovery shortcut.

For a listening but stalled forward, `scripts/model-tunnel-supervisor.py` also
checks the actual HTTP endpoint every 15 seconds with a 5-second timeout. Three
consecutive transport failures stop only the SSH child it owns and reconnect
with 10–60-second backoff. Any HTTP response, including 401/503, proves transport
and does not cause an SSH restart. It ignores environment proxies and does not
follow redirects. It never makes inference requests or retries user work.

Run this optional macOS helper from a private stable local directory using a
LaunchAgent and an installed Python 3 interpreter. Pass a private JSON file:

```json
{
  "ssh_host": "service-vm",
  "forwards": [{"local_port": 18021, "remote_host": "10.0.0.5", "remote_port": 8080}],
  "health_port": 18021,
  "health_path": "/health"
}
```

The alias uses existing SSH keys/known hosts. Health must be a cheap endpoint on
the same gateway, independent of model generation. Keep this file and logs
private; no credentials belong in it. A timeout can interrupt a streaming request
if a gateway also stalls its health endpoint, so that endpoint must remain
responsive under load. The helper supervises only its child, never searches for
or terminates external SSH/agent/model processes. Offline unit/HTTP tests are in
`scripts/test-model-tunnel-supervisor.py`; live qualification here is macOS only.

## Общие V100-профили

С 2026-10-15 Qwen, Qwen Pi и Gemma 4 31B используют один gateway и одну
VM 5100. NInfer и llama.cpp запускаются последовательно через явные профили
реестра; смена движка не требует передачи GPU между VM. Gemma доступна обоим
агентам под провайдером `local-gemma4`; профиль Qwen Pi сохраняет свою политику.
Подробности и фактические проверки: [локальные модели](LOCAL-MODELS.md).

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

Version 0.2.24 uses **Enki** in the window, bundle, installers and UI;
the public repository is `VladimirKraswov/enki`. The native identifier
`dev.local.opencodedesktop`, compatibility executable `opencode-desktop`, data
paths, MCP command names and preference keys remain stable. No separate history
or credential store is created. Existing integrations keep their reserved IDs.
On Mac install the new bundle in `/Applications/Enki.app`, back up the prior
bundle and retain the prior application path as a compatibility symlink so loaded
MCP clients still resolve it. Never run both bundles against the same profile.
Windows/Linux installation migration still requires platform acceptance before
claiming it verified. Historical test reports/releases keep their original names.

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

## RTX5090: Strata — 2026-10-19

Сохранены service/resource `rtx5090`, served ID и прежние URL OpenCode/Pi.
НаVM5200 работает независимый Strata и inference-only gateway; полный
сервер доступен только через loopback с отдельным закрытым ключом.
Каталог Hub обновляет название и исправляет Pi contextWindow до262144;
провайдеры, ключи клиентов и V100-привязки сохранены. Отдельной версии
Desktop для смены этого серверного движка не требуется.

Fixed-проверка теперь читает JSON health: HTTP200 не открывает gate при
loaded=false, status=loading/error, maintenance!=serving или чужом model.
Рекламируемое наличие модели в `/v1/models` само по себе не доказывает готовность.
Ни inspect, ни watchdog не запускают inference и не повторяют промпт.
См. [инструкцию Strata](../services/strata/README.md).
