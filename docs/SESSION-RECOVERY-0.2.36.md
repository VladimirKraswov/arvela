# Session recovery and isolation — Arvela 0.2.36 (2026-10-09)

The owner initially requested source/unit work only, then explicitly authorized
stopping stalled processes and deploying the repair. Source publication was not
requested for this repair; this version is installed locally, with no Git push or
release upload.

## Changes

- Running chat input accepts separate queued text/file batches, including files
  without text. Each item captures its model/agent and owns private IndexedDB
  copies. Preferences contain only routing metadata and file descriptors.
- Copy/persistence failures preserve the original draft. Editing restores files;
  removing deletes only the corresponding queue copy. Missing files and
  conversion failures pause before POST. An uncertain POST retains its files and
  is never automatically replayed. Restored queues require explicit resumption.
- Browser ownership comes from OpenCode's actual before-tool session hook or
  Pi's execution session manager, independently of the selected chat. Each
  project/engine/session has its own persistent profile/context. Panel and
  passive monitor project only the selected chat; empty/remote chats show none.
- Stale captures, selection revisions, manual input and monitor presentation
  are guarded against session changes. Background calls retain their own pages.
- Attachment/send/history failures are cleared or rejected on session changes;
  late async failures cannot appear in a different chat.
- Historical pending tools are separated from current busy/retry evidence and
  connection health. Unconfirmed execution no longer receives a running spinner.
  Connection/status failures show an explicit recovery action.

## Live incident

The existing OpenCode 1.18.18 server reported healthy globally, while `GPU Mesh`
project routes returned HTTP 500. Its log recorded EPERM when inspecting that
folder. A normal authorized restart of the same binary restored directory API
access; the precise macOS permission cause was not established.

The infrastructure chat's last assistant response was completed. The web-compass
chat retained an unfinished tool record while server status showed no active run.
No owner prompt or historical tool was replayed. After installation, the same
server was restarted once to load the new configured browser plugin. Health,
session listing/status, providers and connected browser MCP all returned success.
GPU services and global model/permission settings were preserved.

## Independent checks

- Frontend: **672 passed**, 6 existing opt-in skips. Tests include the actual
  running Composer, durable queue reload/edit/quota/ambiguous POST cases,
  foreign browser rejection and detached-window late-frame clearing.
- Rust: **94 passed**, 1 unchanged opt-in vault test ignored. Formatting and
  locked all-targets check passed.
- TypeScript/Vite, 2 Node result-parser tests and offline evaluation self-check
  passed. Existing Vite chunk/dynamic import warnings remain.
- Real isolated Chromium and official SDK stdio proxy: separate OpenCode/Pi
  profiles and localStorage, background ownership, empty selection, old-input
  refusal, retained tabs and out-of-order selection passed. The real OpenCode
  hook arguments and Pi metadata passed through the actual proxy. No inference.
- First isolated browser launch failed because the harness omitted the managed
  browser-cache environment. Correcting that test environment used the existing
  installed Chromium; no assertion or runtime behavior was bypassed.
- Final Mac app/DMG built; signature and DMG checksum passed. Installed binary
  exactly matches the build. Previous 0.2.35 bundle is retained privately.
- Startup refreshed every browser adapter and configured the OpenCode plugin.
  The installed daemon is healthy and projects the selected engine's scope.

Binary SHA256: `d62ab60cd02ebf2557cbbbb3c3823210366b115c9bc436f02037440792f73bb2`

DMG SHA256: `27c66f62aeed175e853301bd1ff73ba89177d9cca8fde20a9f3c844cdca4c8ea`

No fresh model-inference, owner-task completion, Windows/Linux GUI or new visual
acceptance claim is made. The former shared browser profile remains intact for
legacy clients; new isolated chat profiles may require a new login. Session
history, attachment databases and app preferences were retained.
