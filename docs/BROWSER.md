# Managed browser in OpenCode Desktop 0.2.15

Desktop owns installation and browser lifecycle. The independently installed OpenCode owns inference, sessions, permissions and its agent loop. Pi 0.85.1 uses a thin extension that exposes the same official MCP tools; there is no second agent loop or copied browser implementation.

## Startup and configuration

On a local Desktop connection, a detached bootstrap detects the separately installed OpenCode and Pi. Missing engines are skipped; their existing installation offers remain available. Checking/installing an engine again triggers browser setup. Remote SSH workspaces never rewrite local browser configuration or attach local tools.

The runtime installs pinned `@playwright/mcp` 0.0.83, its lockfile dependencies and Chromium into app-owned data. `npm ci --ignore-scripts` verifies lockfile integrity, then the explicit Playwright installer downloads Chromium. Node.js 20+ and npm are required. Node can be discovered or selected by absolute path in Settings → Browser; engine paths remain separately configurable. One rule applies everywhere: the browser's Node.js path, else Pi's Node.js path, else discovery. Discovery checks only fixed absolute locations (user shims, Homebrew/system, then nvm/fnm/mise/asdf version directories, newest first; on Windows Program Files, `NVM_SYMLINK`, per-user and Scoop installs) and takes the first interpreter that actually reports version 20 or newer, so an old system Node no longer hides a newer one. PATH and the working directory never choose it. Linux needs the normal Chromium system libraries; setup does not invoke sudo or modify the host automatically.

Desktop-owned scripts (`daemon.mjs`, `proxy.mjs`, `setup.mjs`, the skill and the Pi extension) are validated separately from dependencies. When a newer Desktop only changes those scripts, they are replaced atomically in place under the lifecycle lock, without another `npm ci` or Chromium download. A changed `package.json`/`package-lock.json` still requires a full verified installation in a fresh staging directory. Staging directories left by an interrupted installation are removed by the next installation.

Only the reserved `mcp.desktop_browser` entry and the browser skill path are added to OpenCode's global JSONC configuration. Comments, providers, models, plugins, unrelated MCP servers, and permission rules are retained. Writes compare the previously read content and create a backup. A conflicting reserved name is refused. An entry that this app wrote from another install location (same executable name, the private `--browser-mcp` flag, an absolute path) is recognised as its own and updated to the current executable, so moving or reinstalling the app does not strand the integration; drive-letter paths compare the name without case. Disabling browser control stops the service first and then disables only this app's own entry; a foreign entry with the reserved name is left untouched. The running local server receives a directory-scoped `/mcp` attachment and must confirm actual connection. It is not killed or restarted. The skill is discovered when OpenCode reloads its configuration normally.

Pi receives `--extension` only for real, enabled Desktop sessions, and only after the runtime is installed. Metadata probes never start a browser proxy. Tool discovery runs in the background with bounded timeouts. Native sessions keep their existing approval gate; full access applies only if the owner selected it explicitly. Pi's existing model/credential settings are not rewritten. Reopen an already running Pi session to load newly installed tools.

## Window and profile

The top bar's Browser button and Settings → Browser open a visible, ordinary Chromium window. The service starts without a window; navigation opens one lazily. One persistent app-owned profile is shared by Desktop, OpenCode and Pi. Ordinary browsers are unaffected; cookies/logins in this profile survive Desktop restarts. No special password-field restriction is imposed: official browser tools can fill fields under the agent's normal permissions and the user's task authorization. This is not an OS credential vault or a new password manager.

The browser is a separate Playwright Chromium process, not a webview with privileged Tauri IPC. Chromium's sandbox stays enabled. There is no publicly exposed CDP or LAN listener. A private authenticated loopback gateway and stdio MCP proxy connect engines to Microsoft's unmodified Playwright implementation. Native browser configuration commands accept only Desktop's main window. Gateway credentials are not put into URLs or logs.

Calls are serialized. Each project has its own official MCP connection and file roots while sharing the browser context. Uploads outside that connection's project roots are rejected by Playwright MCP. Snapshots, clicks, forms, tabs, uploads, downloads, screenshots and PDF capabilities come from official tools. Default outputs go into a private per-project subdirectory of the managed browser workspace. Official MCP also permits that connection's own output directory for file operations. The bounded cache supports up to 32 workspace connections per service lifetime; restart the browser to release older connections. Agents must reinspect the current tab because another session or the user can change it.

Stopping browser control disables automatic setup and stops the owned service; the checkbox can reenable it. Stop also cancels an installation or start that is queued or already running: native install/start no longer hold the owner lock while they wait, and they check a stop generation at every polling step and terminate only their own child tree. Exiting Desktop cancels them the same way, waits a bounded time for them to clean up, then closes its own browser tree but leaves an externally managed OpenCode server alive. Unix uses owned process groups; Windows uses a kill-on-close Job Object for the daemon/browser and installer. The daemon additionally watches a private owner pipe (opt-in through `OCDESKTOP_BROWSER_OWNER_PIPE`, so manual smoke runs are unaffected): if Desktop crashes, the pipe closes and the daemon shuts the browser down instead of becoming an unowned orphan. A start counts as ready only when a daemon started after that point answers (a new instance identifier), never because an older readiness record is still present. Browser profiles and downloaded runtime survive shutdown. Disabling tools doesn't delete the profile.

## Paths and troubleshooting

macOS: `~/.local/share/opencode-desktop/browser-runtime`.
Linux: existing app data directory or absolute `XDG_DATA_HOME/opencode-desktop`.
Windows: `%LOCALAPPDATA%/opencode-desktop/browser-runtime`.

`current` holds pinned tooling, `skills/desktop-browser/SKILL.md`, and the Pi extension; `browsers` holds Chromium; `profile` holds browser state; `workspace` holds outputs. The ready record is private and short-lived. Do not copy live authentication records into reports or Git.

Settings shows the actual installation, service, OpenCode and Pi state. The proxy reads and verifies the private readiness record before each request, so an existing MCP connection can follow a browser-service restart. A request is retried once, after waiting up to five seconds for a fresh record, only when it provably never reached the daemon (connection refused, or 403 because the token had rotated); a sent tool call is never repeated. Timeouts and interrupted connections are reported as such and ask the agent to inspect the page before retrying. The `--browser-mcp` shim waits up to ten seconds for a daemon that is still starting. While Desktop/browser is stopped, calls fail closed. A background setup that is superseded without a successor (for example by switching to an SSH host) settles back to idle instead of showing a permanent "installing"; the toolbar button retries a failed setup from scratch and explains why it is disabled. Changing engine paths or rechecking Pi reruns setup without re-adding an already confirmed OpenCode MCP attachment, so another session's in-flight browser call is not interrupted; reconnecting and "Configure and check" still re-verify it. Use Configure and check after an engine-side MCP disconnection. A failed setup is not labelled ready. Browser startup/install are bounded and idempotent; closing Desktop cancels its active installer/startup and terminates only owned child processes; configuration changes don't silently enable global permissions. Windows and Linux are implemented in shared source, but this release's live verification is **macOS only**.

## Reproducible smoke

After preparing a test-owned runtime, transport-only regressions can run with
`node src-tauri/resources/browser/test/proxy.mjs /absolute/test-runtime/current`.
They use a disposable HTTP gateway and the real MCP SDK/proxy, with no model
requests or user browser profile. The headed smoke additionally verifies the
daemon's owner-pipe shutdown and persistence after another restart.

Prepare a test-owned `/tmp/oc-browser-*` root with the installed runtime under `current` and Chromium under `browsers`, then run its fixture from the repository:

```
node src-tauri/resources/browser/test/smoke.mjs /tmp/oc-browser-test-runtime
```

Use the script's actual invocation/arguments documented in its header. It owns a temporary profile/fixture/children, never uses real credentials and never requests model inference. Acceptance checks cover auth/Origin rejection, lazy headed startup, navigation/snapshot, form/password filling, project file upload and rejection outside roots, screenshots, and persisted browser state after daemon restart.

Primary implementation: https://github.com/microsoft/playwright-mcp
OpenCode MCP configuration: https://opencode.ai/docs/mcp-servers/
