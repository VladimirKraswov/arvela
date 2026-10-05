# Source review and refactoring — 2026-10-05

Base: exported main `75eac509a4e9b6cfd5c8782a5a90c42ce7234b0c` (0.2.15), no Git
history in the copy. Reviewer: Claude (Opus 5.5), direct non-interactive CLI
session, file tools only.

**No tests, builds, applications or project code were run on Igor computer.**
Nothing was compiled, type-checked, formatted, installed or executed. Every
change below is unverified source. All execution, checking and fixing is
deferred to the coordinating agent on the owner's Mac. No version, dependency
or lockfile was changed; nothing was committed, pushed or published.

## 1. Scope reviewed

Read in full or in the relevant parts:

- Contracts: `AGENTS.md`, `ROADMAP.md`, `docs/BROWSER.md`, `docs/ARCHITECTURE.md`,
  `docs/PLATFORMS.md`, `docs/WINDOWS-DRIVER-IMPORT-20261005.md`.
- Native: `browser.rs` (all of it), `hosts.rs`, `local_server.rs`, `pi.rs`, `paths.rs`,
  `config.rs`, `lib.rs`, `main.rs`, `control.rs` (startup/status/socket parts),
  `computer.rs` (process helpers only), `Cargo.toml`.
- Browser resources: `daemon.mjs`, `proxy.mjs`, `setup.mjs`, `pi-extension.ts`,
  `test/smoke.mjs`.
- Frontend: `src/browser/integration.ts`, `components/BrowserSettings.tsx`,
  `components/TopBar.tsx`, `components/OpenCodeSettings.tsx`, `control/install.ts`,
  `state/store.ts` (connection, host switching, directory switching, browser, Pi and
  projectless workspace paths), `state/prefs.ts` (`switchEndpointPrefs`),
  `state/computer.ts`, `native/hosts.ts`, `native/localServer.ts`, `util/paths.ts`,
  `agent/pi/backend.ts` (probe/open paths), `api/client.ts` (request/timeout surface).
- Tests read to keep compatibility: `browser-integration`, `browser-settings`,
  `pi-browser`, `ui-copy` (it forbids naming an OS in `src/` copy *and comments*).

Reviewed only at the boundary level, with no changes: `api/client.ts` (it already
has per-request timeouts/abort), `api/events.ts`, `chatReducer.ts`, the
attachments, voice/ASR, usage, handoff, managed runs, Markdown and sidebar
modules. Not reviewed: CSS, `services/helper`, `integrations/opencode-agent`,
`scripts/`, the OpenAPI snapshot. These were outside the requested focus and
nothing in the reviewed boundaries pointed to a defect in them.

## 2. Issues found

Browser native lifecycle (`browser.rs`):

1. **Stop could not cancel an installation.** `browser_install` held the owner
   mutex for the whole installer wait (up to ~21 minutes). `browser_stop`,
   `browser_open` and `browser_start` queued behind it. The cancellation flag was
   set only at app exit.
2. **Crash orphan.** The daemon runs in its own process group. If Desktop crashed,
   it survived. On the next launch `start()` saw it as healthy and returned `Ok`
   without owning it, so Desktop exit never stopped it.
3. **Readiness was ambiguous.** The start loop accepted any healthy answer from
   the readiness record. It did not check that the answering daemon was started
   *after* this attempt.
4. **The Windows manifest update was not atomic.** It ran `remove_file` and then
   `rename`, but `std::fs::rename` already replaces the destination on Windows. A
   crash between the two steps left a "not installed" runtime.
5. **Any script change forced a full reinstall.** `installed_at` compared every
   resource byte for byte. A Desktop update that changed only
   `daemon.mjs`/`proxy.mjs` therefore re-ran `npm ci` and the Playwright installer.
6. **Stale `staging-<pid>` directories** from interrupted installs were never
   removed. Their pid differed from the current one.
7. **Node discovery** picked the *first existing* interpreter and then failed if
   it was older than 20. An old system Node, such as Ubuntu 24.04's v18, hid a
   newer nvm/fnm/mise/asdf install. nvm, which is common on Macs, was not searched
   at all. A Volta shim also broke npm discovery.
8. `browser_pi_support` ran a Node version probe (up to 5 s) on an async-runtime
   worker thread.
9. `json!(node)` with a non-UTF-8 path would panic. Release builds use
   `panic = "abort"`, so that would abort the app.
10. Relative `PATH` entries were passed to managed Node children.
11. The `--browser-mcp` shim failed at once when an engine started it during
    Desktop's own launch, before the daemon was ready.

Proxy/daemon scripts:

12. When fetch failed, `proxy.mjs` raised a raw `fetch failed` with no meaning. It
    also had no recovery when the daemon restarted between the health check and
    the RPC (token rotated → 403). It did not exit on stdin EOF while a request
    was in flight. It used `AbortSignal.any`, which is missing in Node 20.0–20.2.

OpenCode/Pi setup coordination (`integration.ts`, `store.ts`, `BrowserSettings.tsx`):

13. **A stale attach was reported as connected.** Suppose setup was invalidated
    while an OpenCode `POST /mcp` was in flight. The old attach promise returned
    without checking the inventory, and the *newer* setup awaited the same
    deduplicated promise and published "Подключён" even if OpenCode had reported
    a failure.
14. **The phase could get stuck.** A setup made stale by switching to an SSH host
    (with no newer local setup) returned silently. The UI stayed in
    "checking/installing/configuring" and "Настроить и проверить" stayed disabled.
15. **The cached failure was replayed.** After a failed setup, the toolbar button
    reused the failed flight and showed the same error forever, until the user
    found "Настроить и проверить" in Settings.
16. **A moved app looked like a foreign integration.** The `desktop_browser` entry
    written by this app at its old path (moved bundle, reinstall in another
    folder) was treated as a foreign collision. The integration was stranded and
    needed a manual config edit.
17. **Disable depended on the config.** If the config could not be read or parsed,
    the browser kept running, because the config step came before stopping. A
    foreign entry with the reserved name produced an error instead of being left
    alone.
18. **Re-adding a connected MCP.** Opening Pi settings (`refreshPiHealth`) or
    changing an engine path forced a full invalidation, which re-POSTed `/mcp` for
    the current directory. OpenCode then re-created a connected MCP client, which
    can break another session's in-flight browser call.
19. **The Node path rule differed.** Setup used `browser || pi`; Settings and the
    toolbar used `browser ?? pi`, so a blank browser path hid Pi's Node.

SSH/host and other process handling:

20. **The ssh stderr pipe was never drained.** ssh writes for the tunnel's whole
    life, for example "channel N: open failed" each time a forwarded connection
    hits a stopped remote server. Once the pipe buffer filled, ssh could block and
    the tunnel would hang.
21. The tunnel health probe used reqwest defaults, which honour `HTTP(S)_PROXY`
    from the environment and follow redirects. That is not appropriate for a
    loopback forward.
22. **Readiness could be claimed after the tunnel was gone.** If the tunnel
    disappeared during the health wait (a superseded failed attempt, or exit), the
    loop kept polling and could report readiness for a port it no longer owned.
23. `pi --version` (via `wait_with_output`) and the LSP `--version` probes had no
    time limit. A hung CLI pinned a blocking worker thread forever; the UI only
    stopped *waiting* after 10 s.
24. **Windows consoles.** Only the browser daemon had `CREATE_NO_WINDOW`. ssh.exe
    tunnels, Pi/node, `opencode serve` and the version probes could each open a
    visible console window from the GUI-subsystem release build. Closing the
    `opencode serve` window would also kill the server.
25. **Windows Pi tree.** On Windows Pi's process tree was not owned. Language
    servers and the browser proxy survived Pi shutdown.
26. **Agent Control could stop the app starting.** Its startup failure aborted the
    whole application, even though the integration is optional. One example is a
    socket path over the platform's `sun_path` limit when the data directory is
    long.
27. **Pi probe sessions could collide.** Capability probe ids were `probe-<ms>`.
    Two probes in the same folder within one millisecond shared one native
    process, and the first to finish closed the other. This may be related to the
    open M23 "capability-metadata timeout" item, but that is not proven.

## 3. Changes implemented and why

### New shared process module — `src-tauri/src/process.rs`

One place for the ownership rules every module had re-implemented or missed:

- `hide_console`: adds `CREATE_NO_WINDOW` on Windows (fixes #24).
- `own_process_group`: wraps `process_group(0)` on Unix.
- `wait_until`: a bounded wait.
- `terminate_group`: SIGTERM to the group, a grace period, then SIGKILL and reap.
  On Windows it kills the direct child.
- `output_with_timeout`: deadline, both pipes drained concurrently with a capped
  capture, and the group killed and reaped on timeout. A descendant that holds a
  pipe open cannot block the collection.
- `OutputTail`: drains a long-lived pipe continuously and keeps only the last N
  bytes (fixes #20).
- `KillOnCloseJob`: the Windows Job Object moved here unchanged from `browser.rs`,
  with named constants, and is now reused for Pi.

Unit tests cover captured streams, killing a hung child, no deadlock on 512 KiB
of output, and the tail bound.

### Browser native split — `browser.rs` + `browser/{files,gateway,node}.rs`

- **`files.rs`** owns the on-disk runtime:
  - `DEPENDENCIES` (package/lockfile) are separate from `SCRIPTS`.
  - `dependencies_installed` is separate from `installed_at`.
  - `refresh_scripts` atomically replaces only changed scripts (fixes #5).
  - `replace_file` writes a private temp file and renames it over the target
    (fixes #4; the Windows `remove_file` is gone).
  - `record_node`/`recorded_node` reject non-object manifests and non-UTF-8 paths
    (fixes #9).
  - `remove_stale_staging` runs under the lifecycle lock and never follows
    symlinks (fixes #6).
  - `promote` swaps with rollback and removes the rollback copy after success.

  Tests use a structurally complete fake runtime, with nothing downloaded or run.
- **`gateway.rs`** holds a typed `Ready` record, validated for port, 64-hex token
  and a non-empty instance id, plus an `Endpoint` enum with per-endpoint
  timeouts. `health()` returns the record together with the answer. RPC timeouts
  get a specific message. The token is used only in the Authorization header.
- **`node.rs`** handles discovery:
  - A configured path must itself qualify.
  - Auto-discovery probes up to 8 absolute candidates in order and returns the
    first that runs and is ≥ 20 (fixes #7). Candidates are user shims, then
    Homebrew/system, then nvm/fnm/mise/asdf version directories (newest first,
    bounded reads). On Windows they are `ProgramFiles`/`ProgramW6432`,
    `NVM_SYMLINK`, per-user and Scoop installs.
  - npm discovery falls back to `process.execPath` reported by the interpreter
    itself, which handles Volta-style shims.
  - The version probe uses the shared bounded runner. The existing "5 секунд"
    timeout message and test are kept.
- **`browser.rs`** is the lifecycle facade (fixes #1–#3, #8, #10, #11):
  - `BrowserRuntime` has named fields:
    - `owner`, held only briefly;
    - `operation`, which serializes install/start inside the process;
    - `shutting_down`;
    - `stop_epoch`.

    Lock order is `operation` → `owner`.
  - `Cancellation` is captured at command entry and checked at every polling step.
    An explicit stop bumps the epoch, so queued and in-flight install/start give
    up and terminate only their own children.
  - `start` re-checks cancellation *under the owner lock* before storing the
    daemon, so there is no window in which a stop misses a just-started daemon.
  - The daemon gets a private owner pipe on stdin, opted in through
    `OCDESKTOP_BROWSER_OWNER_PIPE=1`. If Desktop crashes the pipe hits EOF and
    the daemon closes the browser. Manual `smoke.mjs` runs don't set the variable
    and are unaffected.
  - Readiness requires a *new* instance id compared with the record that existed
    before spawning, and the owned child must still be alive. This avoids
    pid-based checks, which break with shim interpreters.
  - App exit waits up to 10 s for in-flight operations to clean up, then stops
    only the owned daemon. That is the same guarantee as before, now without the
    long-held mutex.
  - All commands run on blocking threads through a single `blocking()` helper.
  - The `--browser-mcp` shim waits up to 10 s for a starting daemon. The proxy
    stays in the engine's process group, so the engine's own cleanup reaches it.
  - Managed children drop relative `PATH` entries and get hidden consoles.
  - New tests cover explicit stop cancelling an in-flight installer, a stop before
    a queued operation, and the owner-pipe opt-in marker. The existing tests are
    kept with the same assertions; only the cancellation argument type changed.

### Browser scripts

- `daemon.mjs`: adds an opt-in owner-pipe EOF/error → `close()`. The HTTP API,
  security checks and the readiness format are unchanged.
- `proxy.mjs` (fixes #12):
  - It retries **once** after waiting up to 5 s for a fresh record, and only on
    provable non-delivery: ECONNREFUSED, a 403 from a rotated token, or a
    missing/invalid record. A tool call that was sent is never repeated.
  - Errors are explicit: cancelled, timed out ("inspect the current page before
    retrying"), interrupted, stopped, restarted.
  - It has an `AbortSignal.any` fallback, and exits on stdin EOF.

Because of the script refresh, these script changes apply on the next setup
without `npm ci` or a Chromium download.

### OpenCode/Pi setup coordination — `src/browser/*`, `store.ts`, `BrowserSettings.tsx`

- `src/browser/preferences.ts` (new) holds `browserNodeProgram` (browser path,
  else Pi path, else null; trimmed, so blanks never hide the fallback; fixes #19)
  and `browserEnabled`. It is used by setup, Settings, the toolbar and Pi session
  options. It is a separate module because component tests mock `integration.ts`.
- `integration.ts`:
  - `ownedEntry` recognises this app's entry at another absolute path by
    executable name plus the private flag. Drive-letter/UNC names compare without
    case and POSIX names stay case-sensitive. A foreign or relative program is
    still refused (fixes #16, and the existing collision tests still hold).
  - The disabled path stops first and then disables only an owned entry (#17).
  - Attachment outcomes are facts about the server: the deduplicated `attach()`
    always checks the inventory and throws on failure. Only a still-current caller
    caches the confirmed attachment and publishes (#13).
  - A superseded flight that is still the newest settles an in-progress phase back
    to `idle` (#14).
  - `invalidateBrowserSetup({ keepAttachments })` reruns setup without
    re-attaching. The store uses it for Pi settings, the OpenCode CLI path and
    Pi health refresh. Reconnects, "Настроить и проверить" and browser preference
    changes still re-verify attachments, which is the default (#18).
  - The loopback check reuses `isLocalComputer`.
- `BrowserSettings.tsx`:
  - The status line is phase-specific, including "both engines missing".
  - Stop is available while setup runs, to cancel it, and disables first so the
    cancelled job cannot flash a setup error.
  - The toolbar button retries a failed setup from scratch (#15) and its tooltip
    explains why it is disabled: remote host, web preview, disabled, or setup
    running.

### SSH, Pi, local server and Agent Control

- `hosts.rs`:
  - Tunnel stderr is drained into a 4 KiB `OutputTail`, which the exit error
    message uses (#20).
  - The probe client uses `no_proxy()` and no redirects (#21).
  - A tunnel that disappears during the wait is an error, never readiness (#22).
  - The short SSH workspace helper uses the shared bounded runner.
  - ssh has a hidden console on Windows.
  - Strict host keys, BatchMode, absolute ssh and target validation are unchanged.
- `pi.rs`:
  - `--version` and LSP probes are bounded to 15 s (#23).
  - Pi has a hidden console on Windows.
  - On Windows a best-effort `KillOnCloseJob` owns Pi's tree and drops after the
    graceful EOF/terminate sequence (#25). If the job is refused, Pi still runs,
    with the previous direct-child cleanup.
- `local_server.rs`: `opencode serve` gets a hidden console on Windows (#24). It
  is still detached and still survives Desktop exit; external servers are still
  never killed.
- `lib.rs`/`control.rs`: an Agent Control start failure is logged instead of
  aborting the app. `agent_control_status.supported` now means the socket really
  exists (#26).
- `agent/pi/backend.ts`: `probeSessionId()` adds a random suffix and keeps the
  `probe-` prefix (#27).

### Tests added (not run)

- Rust:
  - `process::tests` (4)
  - `browser::files::tests` (5)
  - `browser::gateway::tests` (1)
  - `browser::node::tests` (3)
  - `browser::tests`: two new tests (explicit stop cancels an installer; a stop
    before a queued operation) plus an owner-pipe opt-in check.
- TypeScript:
  - `test/browser-integration.test.ts`: six new cases, covering a moved bundle,
    drive-letter case handling, a foreign entry when disabled, a superseded flight
    settling, attachments kept across engine-path changes, and a stale failed
    attach.
  - `test/browser-preferences.test.ts`
  - `test/pi-probe-id.test.ts`

No existing assertion was changed.

## 4. Files and architecture

New:
- `src-tauri/src/process.rs`
- `src-tauri/src/browser/files.rs`
- `src-tauri/src/browser/gateway.rs`
- `src-tauri/src/browser/node.rs`
- `src/browser/preferences.ts`
- `test/browser-preferences.test.ts`
- `test/pi-probe-id.test.ts`
- this document

Modified:
- `src-tauri/src/browser.rs`, `lib.rs`, `hosts.rs`, `pi.rs`, `local_server.rs`, `control.rs`
- `src-tauri/resources/browser/daemon.mjs`, `proxy.mjs`
- `src/browser/integration.ts`, `src/components/BrowserSettings.tsx`, `src/state/store.ts`,
  `src/agent/pi/backend.ts`
- `test/browser-integration.test.ts`
- `docs/BROWSER.md`, `docs/PLATFORMS.md`, `docs/ARCHITECTURE.md`, `ROADMAP.md` (a new
  unchecked M25 validation list)

`include_str!` paths in `browser/files.rs` are `../../resources/browser/...`. They
are relative to the new file and point at the same resources.

## 5. Compatibility decisions

- **Dependencies and versions:** no new crates or npm packages, no lockfile or
  version change.
- **Tauri commands:** names, arguments and `BrowserStatus` fields are unchanged.
  The only new frontend export is additive (`invalidateBrowserSetup` options), and
  its default behaviour is the old one.
- **Daemon contract:** the readiness record, the daemon HTTP API, auth/Origin/Host
  checks, Chromium sandbox, profile, workspace output roots, the 32-connection
  cache, the single tool queue, lazy headed start and "reveal without URL keeps
  the page" are all unchanged.
- **OpenCode config:** the entry shape, the skill path, JSONC preservation,
  compare-and-swap with backup, and collision refusal for foreign programs are
  unchanged. Ownership now also covers this app at another path.
- **Prefs:** no schema change; browser prefs remain app-global.
- **Process ownership:** externally managed OpenCode servers are still never
  killed, and loopback-only, strict SSH host keys and no auto-approval still hold.
- **New Russian error strings:** cancellation by stop or exit, RPC timeout, Pi
  `--version` timeout, and "SSH tunnel closed".
- **One-time effect on upgrade:** the first setup after installing this build
  refreshes the changed scripts, which stops the current daemon once. A recorded
  Node.js path that differs from newly discovered Node also restarts it once.

## 6. Risks and remaining improvements

Risks, all unverified:

- **The Rust is uncompiled.** Spots to watch:
  - `let … else` and the `TryLockError` loop in `browser::shutdown`;
  - the `#[cfg(target_os = "windows")]` blocks (`OwnedBrowser::adopt`, the
    installer job, `PiProcess._job`), which cannot be checked on a Mac without a
    Windows target;
  - closure type inference in `gateway::request_to` and `node::npm_cli`;
  - the `Send` requirement of the `connect_ssh` future (the std mutex guard is
    block-scoped before every `.await`).
- **Owner pipe.** Its correctness assumes nothing else holds the pipe's write
  end. Rust marks pipe fds close-on-exec. Verify that killing Desktop with
  `kill -9` stops the daemon and Chromium.
- **Shim wait.** The `--browser-mcp` shim now waits up to 10 s before failing
  while the daemon is down. This matters only in transitional states, because a
  disabled browser also disables its MCP entry.
- **Node choice.** Node discovery may now pick a different, newer interpreter than
  before, for example nvm instead of an old system Node. That is intended, and
  causes one daemon restart.
- **Hidden `opencode serve` on Windows.** The server is now invisible, like on the
  other platforms. Stop it through the OS tools, not a console window.
- **Agent Control wording.** If the socket fails, the UI says "Недоступен на этой
  платформе", which is slightly imprecise. A stderr line records the cause.

Not done:

- **Pi tool errors.** Pi turns an MCP `isError` result into a generic error and
  drops the official error text, which OpenCode shows to its model. An existing
  test enforces this, so it is left for the owner to decide.
- **SSH tunnels after host removal.** The tunnels of removed or abandoned hosts
  stay alive until Desktop exits; add an explicit `close_ssh` command. The health
  wait (≤ 13 s) also continues after the user switches away.
- **Multiple Desktop instances.** There is no single-instance guard. A second
  instance shares the runtime, does not own the daemon, and its Stop stops the
  first instance's daemon.
- **Installer after a crash.** `setup.mjs` does not watch an owner pipe, so after
  a Desktop crash on Unix an installer finishes its download. Its staging
  directory is removed by the next install.
- **Config commands and backups.** `read/write_opencode_config` are synchronous
  commands on the main thread, and config backups are not pruned.
- **`computer.rs`.** It could reuse `process::output_with_timeout`. It was left
  alone because it is a freshly reviewed import.
- **OpenCode discovery.** Windows `opencode.cmd` npm shims are not supported, and
  OpenCode discovery still consults PATH (documented existing behaviour).
- **Closed Chromium window.** If the user closes the window, shared Playwright MCP
  backends should keep working, but this was not inspected beyond the daemon's
  context reset.

## 7. Mac validation plan (for the coordinating agent)

Use a test-owned HOME or a copy of the data directory wherever a step touches
browser state. Do not use the owner's live profile, OpenCode sessions or
inference.

1. **Static checks.** In the repo root, run `npm ci` (the lockfile is unchanged),
   then `npm test` and `npm run build`. Then run
   `cargo check --manifest-path src-tauri/Cargo.toml --all-targets` and
   `cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1`. Fix
   compile errors first; expect them mainly in the spots listed in §6. Optionally
   run `cargo clippy --all-targets`.
2. **Windows type check (best effort).** Run
   `rustup target add x86_64-pc-windows-msvc && cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`.
   If native build scripts block it on a Mac, record that and defer to a Windows
   host.
3. **Browser smoke (unchanged procedure).** Run
   `node src-tauri/resources/browser/test/smoke.mjs /tmp/oc-browser-<id>` against a
   test-owned runtime. This also exercises the new `proxy.mjs`
   ("sameClientAfterRestart").
4. **Script refresh.** Use an isolated HOME with an installed 0.2.15 runtime.
   Launch the new dev build. Setup should finish quickly with no network
   download: `browsers/` is unchanged, there is no `staging-*`, the
   `current/proxy.mjs` content is new, and `installed.json` is intact.
5. **Stop cancels install.** In the isolated HOME with no runtime, enable the
   browser, wait for "Установка…", then click "Остановить управление". Expect:
   - no `setup.mjs`/npm/playwright processes within about 5 s (check with `ps`);
   - no staging directory;
   - phase "Управление браузером выключено";
   - no error toast.

   Re-enable, and the installation completes.
6. **Crash orphan.** With the browser running and its window open, `kill -9` the
   Desktop process. The `daemon.mjs` node process and its Chromium should exit
   within a few seconds. Relaunch: the browser starts under the new owner.
7. **Moved bundle.** Copy the built `.app` to another folder in a test HOME that
   already has the entry from the old path. Expect the global config entry
   rewritten to the new executable, a backup created, and other keys and comments
   unchanged.
8. **Node discovery.** In a test HOME with only `~/.nvm/versions/node/v22.x/bin/node`
   (symlinked to a real Node ≥ 20), launch from Finder or LaunchServices. The
   browser should install and start, and Settings should show that path.
9. **Proxy follow.** With an OpenCode session attached, change the browser Node
   path in Settings (the daemon restarts). The next browser tool call in the same
   session succeeds without reconnecting the MCP. Use a fixture page with a hit
   counter to confirm no call is executed twice.
10. **Attachments.** While an OpenCode browser call runs, open Settings → Pi. The
    call must not fail, and there must be no second `POST /mcp` (check the OpenCode
    logs or MCP status).
11. **SSH.** Connect to a test SSH host. Stop the remote `opencode serve` and hit
    the forwarded port about 2000 times (each attempt makes ssh write to stderr).
    Restart the remote server; the same tunnel must still forward. Also check
    that a bad host key still fails with the ssh message.
12. **Pi.** Open a real Pi session with the browser enabled, then quit Desktop. No
    Pi, language-server or proxy node processes remain. Two quick Pi settings
    refreshes must not produce probe timeouts.
13. **Agent Control.** Status shows "Готов" on the Mac, and installing the MCP
    still works.
14. **Regression sanity (unchanged areas).** Check chat send and stop, drafts,
    attachments, history scroll, voice, usage, and session switching while
    streaming. Model settings must be untouched.

Windows and Linux live acceptance remain open (see ROADMAP M25). Nothing in this
document claims they pass.

## 8. Coordinator review and Mac validation

The preceding sections record the original source-only review, not results of
executing it. The coordinator verified the returned archive and every project
file hash before removing the exact remote task directory immediately. The
direct CLI transcript confirms `claude-opus-5-5`, only Read/Edit/Write/Glob/Grep,
no MCP servers and no project execution tools. No Cloud Task was created.

Mac review retained the refactoring and added:

- One-shot SSH workspace commands clear inherited forwards, with a real
  `ssh -G` fixture regression. Tunnel commands preserve their forwarding policy.
- A browser-context close handler only clears the context it originally owned.
- A real headed-browser test closes the owner pipe without a stop RPC or signal,
  verifies daemon exit, then reopens the persistent fixture through the same MCP
  client.
- Real SDK/proxy transport tests prove that a delivered mutation with a lost
  response is not repeated, and a token rejection before delivery recovers once.

Results: 375 frontend tests passed (six opt-in live tests skipped), 70 Rust tests
passed, TypeScript/Vite build, native all-targets check, formatting and diff check
passed. Real Chromium acceptance passed all 32 official tools' discovery plus
forms, password fixture, uploads, workspace isolation, screenshot, persistent
profile, restart and owner-pipe cleanup. The two proxy transport tests passed.
Packaged acceptance and artifact hashes are recorded in `docs/VERIFICATION.md`.

Remaining scope is explicit: Windows/Linux live acceptance, live Finder/nvm and
remote-server restart scenarios were not performed on Igor. No model inference,
user-session submission, engine upgrade or GPU/service change was needed.

Final frontend review reproduced and fixed two status regressions: a retained confirmed attachment now restores its connected caption after a Pi/path recheck; disabling keeps stopped/browser-closed status even when the later config read fails. Final full frontend suite passes375; the intermediate package predating these fixes is superseded and was never installed or published.
