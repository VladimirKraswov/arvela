# Independent acceptance and corrections — 22 September 2026

The original implementation was committed as `8f75fa2`. Its 34 tests and the five original review reproducers passed, but independent inspection found further real defects. The user then explicitly authorized Codex to implement corrections and the UI redesign directly. The Qwen worker is idle and its supervision heartbeat is paused to prevent competing writers.

## Defects corrected

1. **Wrong default model.** Provider catalog order selected DeepSeek V4 Pro even when `qwen-build` explicitly configured local Qwen/Medium. The original smoke conversation confirms `deepseek-v4-pro`, not Qwen. Model precedence is now explicit user choice → session → chosen agent model/variant → project config → provider fallback. Metadata is project-scoped.
2. **Cross-endpoint state leakage.** Server changes now create a new client and connection generation. Metadata/project responses are guarded; drafts, session IDs, agent/model preferences and owned PTY IDs are partitioned per endpoint. A failed new endpoint cannot silently resume the old stream.
3. **Late project mutations.** A delayed archive/create/rename/delete result cannot update another project's selection. New-draft revisions survive prompt acknowledgements.
4. **Duplicate submission and stale busy.** Busy/retrying sessions reject duplicate Enter. Completion received before HTTP acknowledgement is retained rather than overwritten with busy.
5. **History/live races.** Snapshot reconciliation retains older pages and live parts without applying a token delta twice. Reconnect replaces stale status but retains subsequent status events.
6. **Broken history pagination.** Passing a message ID as `before` produces HTTP 400 on 1.18.18. The adapter now uses the opaque `X-Next-Cursor` response header. Live read-only check retrieved 200 recent + 124 older messages with zero overlap; unit test also covers pagination plus concurrent live output.
7. **Incorrect PTY authentication.** The original “403 is normal” claim was false. Local 1.18.18 implementation requires `x-opencode-ticket: 1`; its response is `{ticket, expires_in}`, not `{token}`. The adapter uses that contract and surfaces authorization/origin errors. No unauthenticated fallback. Tickets are short-lived and never logged. Text frames are output; NUL-prefixed JSON frames are control metadata.
8. **PTY ownership/lifecycle.** App attaches only to its recorded project-owned shell; endpoint changes detach it, stale creates are cleaned up, resize timers are cleared, reconnect resets the replay buffer and cannot leave an invisible “New” shell behind.
9. **Fabricated session diffs.** A patch part proves that a file was touched, not its before-content. Missing baselines now show a neutral current-content preview with an explicit explanation. The separate working-tree view uses actual `/vcs/diff?mode=git` patches.
10. **Small correctness fixes.** CRLF SSE frames; body-read timeouts; strict loopback origin validation; stale file/diff responses; exclusive custom/radio answers; normal `tool-calls` no longer rendered as a failed finish.

## Workspace redesign

Neutral dark/light palettes; native overlay title bar; project/task sidebar; persistent task selection; searchable command palette (⌘K); compact model/effort/agent menus; centered new-task composer; bottom composer for existing conversations; collapsible tools/reasoning; review and terminal panels; archive/restore and rename controls. No decorative fake actions. The app keeps the OpenCode name and engine boundary.

Reference: [OpenAI's public Codex app description](https://openai.com/index/introducing-the-codex-app/). The computer-use tool disallows inspecting the Codex app itself. Therefore pixel-for-pixel equality with the user's current Codex build is **not verified or claimed**. Proprietary/cloud features and the M7 backlog are not recreated by visual styling.

## Evidence

See `VERIFICATION.md` for final test counts, release installation and native runtime checks. Local screenshots and supervision receipts remain in `.local/review/` and are not committed with private session history. The original five tests remain intact in `.local/review/store-regressions.test.ts`; equivalent tests also remain in the main suite.

## Added session controls

See [CONTEXT-QUEUE-VOICE.md](CONTEXT-QUEUE-VOICE.md) for the actual engine contracts, 81,920-token compaction threshold, session permission modes, serial queue and safe-boundary correction, microphone capture/waveform and configurable multipart ASR. No API key or proprietary Codex implementation is bundled. HMR disposal now aborts the replaced store's SSE connection, and refreshed session snapshots clear obsolete list errors.

## Popup clipping reported during final handoff

The composer retained `overflow:hidden`, so its absolutely positioned agent/model menus lost their first rows above the composer's top edge. Increasing z-index cannot escape ancestor clipping. All select menus, context details and sidebar task menus now use a shared body portal with fixed viewport coordinates, available-space height limits, top/bottom flipping and horizontal edge clamping. Resize/scroll updates keep the popup attached to its trigger; outside click/focus and Escape close it.

Five placement regressions added. Live browser checks at 1280×720 and 900×620 confirmed the complete agent menu, scrolling model list, access/context panels and a sidebar menu flipping upward. No browser warnings/errors were captured. Final native app and DMG rebuilt and reinstalled after this correction. The actual installed app showed the complete agent menu and scrolling/filterable model list without clipping.
