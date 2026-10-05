# Context panel, recurring tasks and embedded browser — source review (2026-10-05)

Scope: exported copy of `f58d058` (0.2.17 candidate). Source-only review and
refactoring of the chat-context panel, recurring chat tasks, the embedded Chromium
panel and the related store/native code.

**No tests, builds, applications or project code were run on Igor computer.**
Every statement below about behaviour is a reading of the source; the new and
changed tests have not been executed. Nothing here is verified until the Mac plan
at the end passes.

## 1. Concrete issues found

Recurring scheduler (`src/schedules/tasks.ts`, `store.runScheduledTask`):

1. **Possible repeated send after a storage failure.** After a successful send the
   outcome was written with `write()`, which threw *before* updating memory when
   `localStorage.setItem` failed. The in-memory task stayed `enabled`,
   `state: "dispatching"` with its old, already-due `nextAt`, so the next 5-second
   tick would dispatch the same prompt again — every 5 seconds.
2. **A hung check blocked everything.** No bound on the pre-send reads, browser
   preparation or the send itself. A hung request kept the scheduler's single
   flight, the per-chat `scheduledLocks` entry (manual sends to that chat silently
   returned `false`) and the task's `dispatching` state (pause/delete disabled)
   indefinitely.
3. **"Uncertain delivery" reported for things that were definitely not sent.**
   Archived/deleted chat (OpenCode 404 or Pi "not found"), a changed chat engine,
   a browser setup error and an HTTP 4xx refusal all surfaced as "Отправку не
   удалось подтвердить…", sending the user to check history for a prompt that was
   never accepted. Transient read failures before sending also paused the task.
4. **No model/agent availability check.** A model, reasoning variant or agent
   removed from the (possibly remote) server config was only discovered by the send
   failing.
5. **Pi silently ignored the saved model.** A running Pi process keeps the model it
   was started with (`ensureSession` reuses the key; there is no `set_model` call),
   so a scheduled Pi prompt could run on a different model than the one saved.
6. **Pi tasks depended on OpenCode.** Browser preparation for a Pi task attached the
   OpenCode MCP for the directory and failed (pausing the task) when OpenCode was not
   reachable, contradicting "Pi does not require a healthy OpenCode".
7. **Corrupt or foreign data was silently destroyed.** Unparseable JSON or any
   invalid entry was dropped and overwritten on the next save; unknown fields were
   carried forward.
8. **Two windows/tabs sharing a profile** (dev browser tabs; any future second
   window) each kept a private copy: one window's edit was overwritten by the other,
   and both could dispatch the same due task.
9. Misleading UI states: "Запрос отправлен" for acceptance; one generic waiting text
   for busy/permission/question/queue; a manual send blocked by a scheduled check
   did nothing visible.

Context panel (`ContextPanel.tsx`, `taskContext.ts`):

10. The panel was absolutely positioned in `.center-main`, so it covered the browser
    projection or the review pane on the right.
11. Source + used an untyped global `window` event: no scope, no feedback when no
    composer was mounted, input was `disabled` while sending (silent no-op), and
    chosen files went to whatever chat was current when the dialog closed.
12. Escape inside the task form closed the whole panel (losing form context); focus
    restore always jumped back to the toolbar, even after "go to message".
13. Child count showed `0` before the first answer; subagent/fork labelling was
    computed in the component; one "Показать все" toggled all lists together.
14. Every store change (including stream deltas of other chats) re-scanned every
    part of the chat with a regular expression.
15. File names were rendered verbatim: bidi overrides (U+202E) or control
    characters could disguise an extension. Links with `:line:col`, `#L4-L9` or
    `file://` URLs were not recognised as results.
16. `ChatView` left a dangling `revealMessage` if the target left the loaded
    history, and did not move focus to the revealed message.

Embedded browser (`BrowserPanel.tsx`, `gateway.rs`):

17. Frames (up to ~8 MB base64 each) were polled every 250 ms regardless of window
    visibility or an open native file chooser, and four times per second even while
    the service failed.
18. Every wheel event and every typed character was a separate serialized native
    call, unbounded: a trackpad flick queued dozens of actions behind the agent's.
19. Paste over the native 16 KB limit failed with a generic native error.
20. Tab was always captured (keyboard trap) and Shift+Tab was sent as a plain Tab.
    IME composition keystrokes were forwarded.
21. The address bar was overwritten by each URL change while the user typed.
22. Native: `gateway::request_to` built a new `reqwest::blocking::Client` per call.
    A blocking client spawns and joins an internal runtime thread, i.e. one thread
    per frame.

Composer: window-level `dragover/drop/dragleave` listeners were removed and re-added
on every render (no dependency list) — every stream delta in the open chat.

### File-picker / automation timeout observation

Not reproduced (no execution allowed). Source-level facts relevant to it:

- The chooser is WebKit's `<input type=file>` panel, opened by the composer's
  hidden input from inside the user's click (user activation is preserved both
  before and after this change).
- While the native panel is open, the old code kept polling 4 frames/s of
  multi-megabyte JPEG data plus presence (1.5 s), children (10 s) and scheduler
  (5 s) work. IPC responses are delivered to the WebView through the UI process's
  main thread. If the panel runs a modal loop on that thread, this is sustained
  main-thread work exactly while accessibility clients query the app. This is a
  **plausible contributor, not a confirmed root cause**; the automation tool itself
  may also time out on modal panels.
- No source path was found that blocks the main thread or waits on the chooser
  synchronously. Escape inside the WebView closed the context panel (global and
  panel handlers), which cannot cancel a native panel; that is expected.

Mitigation implemented: frame polling pauses while a chooser is open (tracked by
`change`/`cancel`, with window focus or any user input as fallbacks) or the
document is hidden; failures back off to 2 s; the native client no longer spawns a
thread per frame.

## 2. Changes implemented

### Scheduler (`src/schedules/tasks.ts`, rewritten; `Runtime.tsx`)

- Storage is the source of truth: every mutation and tick re-reads it (`reload`),
  so a change from another window is merged, not overwritten; a `storage` event
  refreshes the panel.
- `parseTasks`: validation per entry, duplicate ids and over-limit entries
  rejected, unknown fields stripped (`normalizeTask`). Skipped entries are counted
  in `status().skipped`; the raw value is copied to `…v1.unreadable` before the list
  is ever rewritten.
- Storage failure: `persist` (fail closed before a send) vs `settle` (records the
  outcome in memory even if storage fails, then halts). Once halted, `tick` and all
  edits refuse; the runtime shows one toast (`STORAGE_FAILED`).
- Typed outcomes: `sent`, `waiting` (nothing sent, retry in 15 s), `cancelled`
  (withdrawn before sending), `ScheduleBlocked` (definite non-delivery, app-authored
  message persisted, task paused), any other throw or no answer = uncertain
  delivery (task paused, never resent).
- Bounds: the dispatch signal aborts read-only checks after 2 minutes (→ waiting);
  a dispatch with no answer after 3 minutes is uncertain (→ paused) and the flight
  is released.
- Pause/delete during this window's flight are recorded as intents
  (`status().pending`) and abort the signal; the store stops before sending, or the
  intent is applied as soon as an in-progress send settles. Another window's
  `dispatching` task stays read-only (`status().flight`).
- Multi-window lease (`owner` option, `ocdesktop.scheduled-prompts.lease.v1`,
  4 minutes > dispatch limit, renewed per tick, released on `pagehide`, owner id in
  `sessionStorage` so a reload reclaims its own lease). Startup recovery skips
  records while another live owner holds the lease; a lease taker pauses orphaned
  `dispatching` records as "interrupted".
- Most-overdue task first; one flight per window. Relaunch still postpones overdue
  tasks; after sleep a task runs at most once. Storage format unchanged (array under
  `ocdesktop.scheduled-prompts.v1`), so existing schedules load as before.

### Pre-send checks (`src/schedules/preflight.ts`, new; `store.runScheduledTask`)

- `chatBlocker`: specific waiting reasons (permission, question/Pi dialog, user
  queue, app lock, busy/retry/waiting status). Includes Pi extension dialogs.
- `modelProblem`: saved provider/model/variant/agent must exist in the server's
  directory-scoped `/provider` and `/agent` answers. An empty catalog never blocks.
- `liveModelProblem` + `PiBackend.liveModel` (read-only `get_state`, 10 s): a
  running Pi process with another model/thinking level blocks instead of silently
  substituting.
- Store: reads take the signal and are raced with it (`src/util/abort.ts`
  `untilAborted`); the prompt itself is never given the signal. 404/missing Pi chat,
  archived/moved chat, changed engine, browser setup failure and HTTP 4xx refusals
  throw `ScheduleBlocked` without backend bodies. Read failures return `waiting`.
  `current()` also checks `engineStillActive(backend)`. Pi browser preparation uses
  `configureBrowser(…, null)` (runtime only, no OpenCode attachment). After the lock
  is released the active chat's user queue is drained.
- `sendPrompt` blocked by a scheduled check now sets an explanatory `sendError`;
  the draft is untouched.

### Context panel

- `ContextPanel.tsx`: shell (scope key, focus, Escape) plus `FileSection`,
  `ChildrenSection` and `useChildSessions`. Headings (`h2/h3`, `aria-labelledby`),
  lists (`ul/li`), per-section "Показать все (N)" with `aria-expanded/controls`,
  `aria-busy` while loading, `aria-controls` on the toolbar button. Focus returns
  only if it would otherwise be lost.
- `ScheduleSection.tsx` (new): task list/form, interval with unit (min/h/days),
  saved model/variant/agent shown before and after saving, honest status lines
  ("Последний запрос принят агентом … Результат — в истории чата"), pending
  pause/delete, storage/skipped notices, count of active tasks in other chats.
  Escape in the form closes only the form. Pi tasks do not store an OpenCode agent.
- `taskContext.ts`: per-part `WeakMap` cache; newest-first lists; result provenance
  (`origin`); `linkedPath` (`file://`, `%20`, `:line:col`, `#L…`); `safeLabel`
  (control/bidi characters → U+FFFD, length bound); `subagentRuns` (task tool status).
- Layout: the panel is rendered inside `.chat-col` (now `position: relative`) and no
  longer overlays the browser/review panes; `overscroll-behavior: contain`, focus
  outlines, wrapping of long paths.
- `ChatView`: focuses the revealed message; drops a reveal whose message left the
  loaded history (only when history is loaded and idle).

### Composer bridge (`src/attachments/composerBridge.ts`, new)

- `registerComposer`/`requestComposerFiles(scope)`/`focusComposer(scope)` replace
  the `composer-add-files` window event and the `document.querySelector` focus hack.
  Requests are honoured only for the same server/directory/chat scope; the caller
  learns `false` and the panel explains it.
- `openFileInput` tracks the open chooser (`fileChooserOpen`, `subscribeFileChooser`).
  The composer captures the chat scope at open time; files land in that draft.
- Drag listeners registered once.

### Browser panel

- `src/browser/inputQueue.ts` (new): ordered, never-replayed manual input; merges
  waiting text/wheel for the same `expected` page state within native limits;
  bounded backlog (32) with an explicit message; cleared on connection change.
- Polling: first frame always; then suspended while hidden/chooser open (400 ms
  re-check), exponential backoff on failure.
- Address editing is not overwritten; Escape restores; Shift+Tab exits; IME keys
  are not forwarded; >16 KB paste refused with an explanation.
- `gateway.rs`: one cached blocking client per timeout class with
  `pool_max_idle_per_host(0)`, so each request still uses a fresh connection (no
  keep-alive reuse that could resend on a stale socket).

### Tests written (not run)

- `test/schedules.test.ts`: +8 (storage failure after send, ScheduleBlocked detail,
  pause withdraws, check/dispatch timeouts with fake timers, backup of unreadable
  data, normalisation/duplicates, two-window lease and edits, orphan recovery).
- `test/schedule-preflight.test.ts` (new): blockers, model/variant/agent, Pi live model.
- `test/store-regressions.test.ts`: +3 (definite non-deliveries without bodies,
  withdrawn/failed checks release the lock, explained manual-send block).
- `test/context-panel-model.test.ts`: +3; `test/context-panel-ui.test.ts`: the
  source-plus test now registers a composer through the bridge (same assertion:
  exactly one chooser request), +3 (other chat refused with message,
  subagent/fork labels and "…" count, bidi names and other-chat tasks).
- `test/browser-input-queue.test.ts`, `test/composer-bridge.test.ts` (new);
  `test/browser-panel.test.ts`: +3 (chooser suspends polling, address editing,
  Shift+Tab).
- All pre-existing assertions are unchanged; the one edited test replaced the
  removed window-event mechanism with the bridge.

## 3. Preserved boundaries and compatibility

- No new dependencies, manifests, lockfiles, versions, capabilities, CSP, ports or
  permissions. No AGENTS/policy files touched.
- OpenCode/Pi still own sessions, inference, permissions and tools. No auto-approval,
  no second agent loop, no server/model fallback, no resend of a possibly delivered
  prompt. Scheduling is still created only by the user in the panel; the control
  plane exposes no scheduling.
- Scheduled prompts never consume drafts, attachments or the user's queue.
- Stored schedule format and key are unchanged; new keys are additive
  (`…unreadable`, `…lease.v1`, per-window `sessionStorage` owner).
- Browser: still pixel-only projection through the same native allowlist and
  `expected` page guards; no change to the daemon, proxy, MCP setup, token
  handling or headless/sandbox settings.
- `configureBrowser(…, undefined)` keeps the previous behaviour; only `null` is new.

## 4. Known risks, rejected and unimplemented ideas

- `localStorage` durability on crash depends on the WebView's flush; a lost
  "dispatching" write after a crash leaves the task with its old due time, which
  relaunch postpones by one interval (no immediate resend, but one later run).
  A native file store was rejected for this change (Rust + capability work).
- The lease is best-effort across **processes**: WebView storage coherence between
  two Desktop processes is platform-specific and unverified. Same-process windows
  and tabs are covered by tests with a shared storage.
- Pi `get_state` model ids may be formatted differently for custom models; a
  mismatch pauses the task (safe, explained) rather than sending. Manual Pi sends
  have the same "live process ignores the chosen model" behaviour; **not changed**
  here (would need a Pi `set_model` design), recorded for follow-up.
- Manual Pi sends still fail when OpenCode is installed but unreachable and the
  browser is enabled (attachment step); only the scheduled path was changed.
- The chooser-open fallback (`focus`, pointer or key input) could end the
  "suspended" state early on a platform that neither blurs the window nor fires
  `cancel`; the only effect is resumed polling.
- Merged text is sent as one `insertText`; a page that reacts per keystroke sees
  the same characters, but fewer key events.
- Rejected: switching the composer to `@tauri-apps/plugin-dialog` (would need new
  fs scopes for arbitrary chosen paths); a "run now" button (an extra execution
  path without Mac evidence); skipping tasks missed during sleep entirely (the
  existing test contract runs an overdue task once).

## 5. Reviewed but left unchanged

`src/browser/integration.ts` (setup/attach flight caching), `view.ts` frame
validation, `browser.rs` command allowlist and lifecycle, `daemon.mjs` frame
coalescing, `chatReducer` immutability (relied on by the part cache),
`loadOlderMessages`, queue dispatch (`dispatchQueued`), `prefs.ts` persistence,
`engines.ts` resolution, the OpenCode client timeouts (20 s default).

## 6. Mac-only validation plan

1. `npm ci` not needed (no manifest change). Run `npx tsc --noEmit`, `npm test`,
   `npm run build`. Expected: previous 415 + new tests pass, 6 opt-in skipped. Pay
   attention to fake-timer tests in `schedules.test.ts` and jsdom visibility in
   `browser-panel.test.ts`.
2. `cargo fmt --check` and `cargo check`/`cargo test` in `src-tauri` (only
   `browser/gateway.rs` changed); real browser smoke/proxy tests from BROWSER.md.
3. Build/sign the app; verify signature/entitlements as before.
4. Browser panel: open a real page, scroll with trackpad and type fast in a form
   (one coherent result, no backlog), paste >16 KB (explained refusal), Shift+Tab
   leaves the page, edit the address while the agent navigates, minimise the window
   and confirm `browser_view` calls stop (e.g. temporary logging in a debug build).
5. File chooser: with the browser panel live, open Context → Sources + and the
   composer clip button; cancel with mouse, then with Escape; check UI responsiveness
   and Activity Monitor main-thread load; repeat the computer-use AX cancel attempt
   and record whether it still times out. Pick a file, switch chat while the dialog
   is open, confirm the file lands in the original chat's draft.
6. Context panel next to an open browser and the review pane (no overlap); keyboard
   only: open, Tab through sections, "Показать все", Escape in the form vs panel,
   go to message (focus lands on it), load older history.
7. Scheduling (local Qwen; one job at a time): 1-minute task in an idle chat →
   accepted once; busy chat waits; pending permission waits; pause during check;
   delete during check; remove the model from config → paused with reason; archive
   the chat → paused; quit during send → paused "interrupted" after relaunch; Pi task
   with a running Pi chat on another model → paused with reason. Confirm no
   duplicate user messages in history.
8. Optional: make storage fail (e.g. fill quota in a debug build) after a send and
   confirm no second prompt and a single toast.
9. Windows/Linux remain unverified for these changes.


## 7. Coordinator review on Mac

The transfer was verified against the SHA256 archive and every one of 281 file
hashes before the unique remote working copy was removed. The stream audit contains
only Read (54), Glob (5), Grep (38), Write (14) and Edit (56); no external file paths
or execution tools. Manifests, dependency locks, versions and instruction files
were unchanged. There were 32 changed source/document/test files.

The coordinator reproduced and fixed further cases before accepting this revision:

- A child opened from the context panel lost its model, agent, title and permission
  metadata because root sidebar listings exclude children. The existing activity
  catalog now supplies the open child's metadata without promoting it to a root;
  permission updates update that catalog. Two routing/permission regressions pass.
- Accessing the localStorage property itself can throw before TaskScheduler's
  guarded reads. A guarded storage adapter keeps the app usable and stops sending.
- The chat reducer replaces changed parts but retains the chat container. Memoizing
  context by that container froze streamed source/results updates. Per-part caching
  remains; the outer mutable-container memo was removed after a failing stream test.
- A failed backup write must not allow corrupt raw schedules to be overwritten.
  It now stops scheduling and preserves the original; the new regression passed
  only after this fix. Lease write failures also stop scheduling visibly.
- Browser input completions and child reads now retain connection identity. Late
  input errors cannot alter a new connection's UI; old queued inputs are discarded;
  SSH endpoint replacement under an unchanged host identity cancels old child reads.
- An existing engine-routing unit fixture queried runtime metadata on the owner's
  live server and occasionally hit its hook timeout. Those read-only dependencies
  are now mocked; original behavioral assertions were preserved.

Verification on Mac: 451 frontend tests passed / 6 opt-in skipped, 71 Rust passed,
TypeScript/Vite build, cargo fmt/check --all-targets, and two real MCP proxy transport
regressions passed. Mac package and installed UI evidence are recorded separately
in VERIFICATION.md. These Mac runs do not alter the no-execution statement for Igor.
