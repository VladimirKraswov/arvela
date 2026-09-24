# Verification record

## Coordinator macOS acceptance — 0.2.9, 2026-09-25

- Pi 0.85.1 was detected at `/opt/homebrew/bin/pi`. Its model catalog was
  populated on startup, before opening Settings. Short direct requests to
  `local-qwen/qwen38-flash-next` and `local-qwen-v100/qwen-v100` both returned
  the requested text; the app then verified both independently with a nonempty
  response and showed only those two models in the Pi picker. No cloud model
  was configured on the Mac. The 5090 Flash Next remains OpenCode's default.
- The app-owned Pi LSP extension found TypeScript Language Server 6.0.1 and
  rust-analyzer 1.96.0 as «готов». Global `~/.pi` configuration was not edited.
  A native Pi projectless chat returned `PI_FINAL_OK`; its context meter showed
  **10 195 / 131 072** tokens and the composer remained usable after completion.
  A separate native OpenCode projectless chat returned `OC_FINAL_OK` with the
  existing local Flash Next, and the new-chat default was restored to OpenCode.
- Native review found and fixed two defects before release: projectless Pi
  routing previously required an OpenCode workspace, and Pi chats were absent
  from cross-project «Недавние». The project list and recent history now merge
  both engines; Pi history remains visible when the OpenCode server is down.
  OpenCode-only agent, terminal, changes and edit controls are hidden in Pi;
  Pi's context meter uses its own model window.
- Final source checks: `tsc --noEmit`, **280 passed / 6 skipped** frontend tests,
  `cargo fmt --check`, `cargo check --all-targets`, **29/29** Rust tests.
  The six skipped cases are opt-in live suites, run separately on Igor's machine
  with isolated test engines and a DeepSeek key outside the repository.

The sections below record earlier review stages; their interim “source only”
and “Mac not checked” labels describe those stages, not the final 0.2.9 result.

## Coordinator review follow-up — 0.2.9, 2026-09-25 (source only, not released)

Twenty coordinator findings were re-checked against the code; the real ones were
fixed and each is backed by a test or a measurement.

- **Existing chats no longer change engine when a folder's default does.**
  `engineForSession` now resolves an existing chat from durable evidence —
  explicit per-chat override, then Pi session metadata, then OpenCode — and the
  folder preference governs new chats only. Previously, setting a project to Pi
  would have reinterpreted every historical OpenCode id as a Pi chat.
- **Handoff works both ways and the composer leads into it.** Choosing the other
  engine for an existing chat opens a dialog explaining that engines cannot share
  a transcript, then creates a chat on the target engine seeded with an editable
  transcript. Provenance is engine-neutral and shown in the new chat. The
  transcript now carries tool outcomes (path/command plus trimmed output), and
  when it does not fit it sheds tool output before whole turns, reporting both.
- **Pi's built-in tools are gated.** A first-party `tool-gate.ts` extension is
  loaded into every real Pi session by the native layer. Anything not on the
  read-only list — including unknown tools — requires `ctx.ui.confirm()`, which
  the app shows as a modal; no answer, no UI or a native timeout all deny.
  "Full access" exists only as an explicit setting; an unset or unrecognized
  value means "ask". **Measured live:** the model was told to write a file,
  really called `write`, the gate asked, the answer was cancel, and no file was
  created — the test asserts the attempt and the prompt so it cannot pass
  vacuously.
- **Process-tree shutdown.** Pi runs in its own process group; shutdown closes
  stdin, waits 3 s, then SIGTERMs the group, waits 1.5 s, then SIGKILLs it. A
  Rust test drives a tree that ignores both EOF and SIGTERM and asserts the whole
  group is gone within bounds. Live: closing stdin ends Pi with code 0 and the
  language server disappears. Note for accuracy: hard-killing Pi alone did *not*
  orphan `typescript-language-server`, because it exits when its stdin closes;
  the group fallback is there for servers that do not.
- **The explicit DeepSeek model works.** Pi's bundled catalog is treated as
  evidence, not a gate: a pinned `provider/model` is used even when absent from
  it, `piModelInfo` falls back to conservative metadata, and prompts pass Pi's
  own `provider/id` form. Picker entries are labelled "каталог Pi · доступ не
  проверен" / "свой идентификатор · доступ не проверен" / "проверена".
- **Readiness is measured, not assumed.** "Проверить доступ" sends one minimal
  real request in an ephemeral session. **Measured in the built app:** with
  `deepseek/deepseek-flash` pinned — a model absent from Pi's catalog — it
  reported «Подтверждён · Модель ответила на тестовый запрос». The Mac review
  now requires an actual nonempty assistant response (not just `agent_settled`)
  and offers only separately verified models in the chat picker.
- **Capability probes leave nothing behind**: they run with `--no-session` and no
  extensions, and any `probe-*` transcript from an older build is filtered out of
  the chat list.
- **Pi settings tell the truth**: the LSP toggle is disabled and reads "Не
  установлено" until the extension exists; credentials are described as Pi's own;
  extensions and language-server paths can now be added, not only removed.
  Explicit absolute server paths are tried first, which is what a Finder-launched
  macOS app needs since it inherits neither `/opt/homebrew/bin` nor `~/.cargo/bin`.
- **The composer no longer shows OpenCode's access selector for Pi chats**; it
  shows the Pi tool policy instead.
- **Live tests use the real model and real events.** `test/pi-live.test.ts`
  defaults to `deepseek/deepseek-flash` and waits for `agent_settled` instead of
  sleeping; the suite dropped from ~22 s to ~6 s and no longer depends on
  provider latency.
- **Both engines were accepted on Linux.** A test-owned OpenCode 1.18.18 was run
  with an isolated config/XDG home on loopback port 43067 against a disposable
  fixture project; `test/opencode-live.test.ts` proved health and provider, a real
  conversation reaching the stream reducer (`OPENCODE_LIVE_OK`), history agreeing
  with the stream, and cancel. The owner's own services were never touched.
- Verified: `tsc --noEmit`; **273 passed / 6 skipped** frontend tests across 39
  files (the 6 skipped are the opt-in live suites, run separately and passing —
  3 Pi, 3 OpenCode); `npm run build`; `cargo fmt --check`; `cargo check
  --all-targets` with zero warnings; **31/31** Rust tests; `npm run build:linux`
  → `OpenCode Desktop_0.2.9_amd64.deb`; native UI smoke of the Pi settings.
  After the app exited: no Pi processes and no language servers left.
- Still not verified: macOS (coordinator), Windows (no variant), image
  attachments to Pi in a live run, and third-party Pi extensions raising dialogs.

## Pi as a second engine — 0.2.9, 2026-09-25 (source only, not released)

Performed on the owner's Ubuntu 24.04 x86_64 machine. **macOS was not built or
tested here; Windows does not exist as a variant.**

- **Pi is real, not a picker.** `src/agent/pi/` implements `AgentBackend` over
  Pi's documented JSONL RPC mode (`docs/rpc.md` of the installed
  `@earendil-works/pi-coding-agent@0.85.1`). Pi events are translated into this
  app's own event vocabulary, so the existing reducer, renderer and scrolling
  work unchanged — there is no second agent loop. Both engines are registered in
  the backend registry.
- **Installed on Igor** into an app-owned location:
  `~/.local/share/opencode-desktop/pi-runtime` with the version pinned exactly to
  0.85.1 (matching the owner's Mac). Nothing global was changed; `~/.pi` was
  created by Pi itself and is never written to by this app.
- **Live acceptance** (`test/pi-live.test.ts`, opt-in, real CLI + real model):
  a streamed answer reached the app's chat state (`PI_LIVE_OK`), `agent_settled`
  swapped the provisional streaming ids for Pi's durable entry ids, one process
  per session, and reopening the same session id returned the same transcript.
  The DeepSeek key was passed only in the child environment; it is not printed,
  logged, committed or placed in any argument.
- **LSP works end to end.** A first-party extension
  (`src-tauri/resources/pi/lsp-extension.ts`) registers `lsp_diagnostics`,
  `lsp_hover` and `lsp_definition`. Live: the model called `lsp_diagnostics` and
  received `Type 'number' is not assignable to type 'string'` from
  typescript-language-server and `E0308 mismatched types` from rust-analyzer.
  The third-party candidate `samfoy/pi-lsp-extension@f2433d1` was read but **not
  installed**: it spawns a detached per-workspace daemon that outlives the Pi
  session, which conflicts with this app's process-ownership rule. Full audit in
  `docs/PI-ENGINE.md`.
- **Language servers on Igor**: `typescript-language-server@5.1.1` installed into
  the app-owned runtime directory; `rust-analyzer` added as a rustup component.
  Detection now *probes* a server before offering it — `rustup` leaves a shim at
  `/usr/bin/rust-analyzer` even when the component is absent, and the first live
  run caught exactly that.
- **Native UI acceptance** on the built Linux app under Xvfb: the settings screen
  shows a separate "Pi" group; detection reported the managed path and version
  0.85.1; the model list showed the real 4-model DeepSeek catalog with context
  and modalities read from Pi; "Настроить LSP" found both servers as "готов".
- **Process ownership verified in the real app**: 3 Pi children while running, 0
  after the window exited.
- **Safety**: no network transport (stdio only), program path always absolute and
  never from `PATH`, one child per (directory, session), blocking
  `extension_ui_request` surfaced to a modal with default-deny on timeout or when
  nothing can display it.
- **OpenCode is unchanged as the default**: folders and chats without an explicit
  choice resolve to OpenCode, and its model-preference keys keep their historic
  unprefixed form. A regression test asserts OpenCode still refuses to send while
  its server is unreachable, while a Pi chat is allowed to run.
- Verified: `tsc --noEmit`; **258 passed / 2 skipped** frontend tests across 37
  files (the 2 skipped are the opt-in live ones, run separately and passing);
  `npm run build`; `cargo fmt --check`; `cargo check --all-targets`; **30/30**
  Rust tests; `npm run build:linux` → `OpenCode Desktop_0.2.9_amd64.deb`.
- Not verified: macOS (coordinator), Pi extension dialogs against a real
  extension that raises them, image attachments to Pi in a live run, and Pi with
  a remote OpenCode host (deliberately unsupported and reported as such).

## Linux variant and agent-backend seam — 0.2.9, 2026-09-24 (source only, not released)

Performed on the owner's Ubuntu 24.04 x86_64 machine, in a temporary review checkout.
**macOS and Windows were not built or tested here.**

- Agent-backend seam: the state layer now talks to `AgentBackend` (`src/agent/`), with
  OpenCode as the only registered implementation and still the default. Transport,
  stream URLs and SSE parsing no longer leak into `src/state/store.ts`. PTY, `/mcp`
  and the JSONC config editor stay OpenCode-specific and are reached through
  `asOpenCodeClient`; the review panel and terminal are mounted only when
  `backend.capabilities.vcsDiff` / `.pty` are true, so that escape hatch cannot be hit
  during render. Re-connecting resolves the active backend's descriptor strictly — a
  lenient fallback would silently move a live workspace onto another runtime.
- Two reviewed build variants. `tauri.conf.json` is platform-neutral; macOS window
  chrome and `Entitlements.plist` live only in `tauri.macos.conf.json`, deb targets only
  in `tauri.linux.conf.json`. `test/bundle-config.test.ts` fails on drift between the
  duplicated window object (Tauri replaces arrays), on a macOS key reaching the shared
  config, on a version mismatch across package/Cargo/Tauri, and if an untested
  `tauri.windows.conf.json` appears.
- Per-OS paths are resolved in one place (`src-tauri/src/paths.rs`) and are
  **evidence-first**: an existing `opencode` / `opencode-desktop` directory always wins
  over an XDG guess, so the settings editor cannot write a config the engine never
  reads and an upgrade cannot orphan existing chats. Without XDG variables the result is
  byte-for-byte the shipped 0.2.x layout on both platforms.
- Linux runtime fixes: completion chime now picks the first installed system player
  (`canberra-gtk-play` → `paplay` → `pw-play`, all absolute paths, silence if none);
  macOS overlay-window-control insets are scoped to a `mac-chrome` class; `ssh` is
  resolved from an absolute allow-list, never PATH. Platform detection falls back to
  `navigator.platform`, so a stripped user agent cannot drop the macOS chrome inset.
- User-visible copy that claimed macOS on every platform was corrected in 10 places
  (settings, workspace picker, host dialogs, connection gate, OpenCode settings,
  microphone errors, keyboard hints). `test/ui-copy.test.ts` fails if shared copy names
  an OS again, unless the line explicitly scopes the claim ("Только macOS").
- Correctness fixes with regression tests: abort/стоп is routed with the session's own
  project directory (a session created in project A and stopped from project B used to
  get a 404 and keep running); malformed `message.part.updated` / `session.error` events
  no longer create phantom session slots; a 200 response with a malformed body is
  reported as an API fault instead of "cannot reach the server"; a session's own
  directory is authoritative over the listing directory it was seen in.
- Verified on Linux: TypeScript `tsc --noEmit`; **213/213** frontend tests across 32
  files; `npm run build`; `cargo fmt --check`; `cargo check --all-targets`; **24/24**
  Rust tests; `npm run build:linux` producing `OpenCode Desktop_0.2.9_amd64.deb`
  (`Package: open-code-desktop`, `Depends: libwebkit2gtk-4.1-0, libgtk-3-0`,
  `Categories=Development`, no `Entitlements.plist` / `Info.plist` / `.icns` inside).
  Headless smoke under Xvfb: `xwininfo` showed `"OpenCode Desktop" 1360x900+0+0` and a
  screen capture showed the rendered UI with no dead macOS chrome gap and the expected
  "no connection" state. The owner's OpenCode server, sessions and GPUs were not touched.
- Not verified here and left to the maintainer on a Mac: the `.app`/`.dmg` build, ad-hoc
  signature, Hardened Runtime, the audio-input entitlement surviving the config split
  (`scripts/verify-macos.py` is the gate), and the macOS chime. Not verified on any
  platform after these changes: SSH tunnels, ASR dictation, the PTY terminal and
  drag-and-drop attachments.

## Attachments and CPU helper — 0.2.8, 2026-09-24

- Deployed isolated unprivileged Proxmox CT205 `oc-helper` (Debian 12, 4 vCPU/4 GB, 20 GB) with bounded PDF/audio/video conversion. Its source SHA256 matches `services/helper/server.py`; `oc-helper.service` is active. Mac access is through a persistent loopback SSH tunnel on port 18107; direct Mac requests to the CT return 403. `/health` reports version 0.1.0 and the three conversion services. PDF text/page, video frames/audio and audio conversion fixtures passed. Existing GigaAM ASR on CT201 remains the transcription backend and was not moved.
- Desktop routes attachments according to the selected model's actual `/provider` input capabilities. Both configured local Qwen models advertise image input, not native PDF/audio/video input. The composer supports file picker, drag/drop, clipboard files and large-text paste, with per-chat IndexedDB drafts and explicit 12-file/50-MiB limits. Converted PDF/video frames go to Vision; sound goes through GigaAM. The helper address and health are visible under Settings → Services; MCP servers remain separately configurable. CT205 currently has no MCP endpoint.
- Full frontend suite **184/184** passed (single worker under high system load); TypeScript/Vite production build and `cargo check` passed. Final app+DMG build, strict local ad-hoc signature/entitlement verification and `hdiutil verify` passed. Browser UI connected to the real OpenCode server: picker attached a PDF, reload restored the unsent attachment, and removal worked. A separate one-shot live PDF test passed through CT205 and local Qwen: OpenCode stored `sample.pdf.описание.txt` plus `sample.pdf.page-1.jpg` and answered **«Контрольная фраза — HELLO, число — 42.»** The disposable test session was archived; no existing user conversation was modified.
- Installed `/Applications/OpenCode Desktop.app` 0.2.8 and copied the verified DMG to Downloads. Native Settings showed helper **«Работает · версия 0.1.0»** and all three services. The native file picker opened and an attachment chip was created; native selection of the intended fixture was not reliably completed by the macOS computer-control tool, so native end-to-end PDF sending is not claimed. A mistakenly selected unrelated file was removed from the unsent draft without transmission. The native UI was reopened after the automation dialog stopped responding. After the owner reported that Finder/Desktop drag did not work, the installed app was rebuilt with Tauri WebView native drag/drop events and narrowly scoped `fs:allow-stat`/`fs:allow-read-file` permissions. Native file preflight rejects folders, symlinks, oversize and changed files; 3 regression tests pass. The owner confirmed that dragging files from the Desktop now works in the installed build. No model request was sent for this regression check.
- Pre-install check found all 27 remembered OpenCode scopes idle. The independent OpenCode PID 27982 remains alive; the model server and user MCP processes were not restarted. The installed app retained all prior preference fields except the selected directory/new-chat mode changed during acceptance; the user's previous HyperMQ conversation remains intact and unread. New `helperEndpoint` is `http://127.0.0.1:18107`. Original bundle backup: `/Users/vladimirkrasov/.local/share/opencode-desktop/backups/0.2.7-before-0.2.8-20260924-202206`. Private receipts are in `.local/attachments-0.2.8/`.
- Final installed executable SHA256: `f18f492d8683b5b80b1222b0ed03de38fd84ef7a5e1a64c77783cdcd8d15b535`; final Downloads DMG SHA256: `d4f0d3caab31a8ca0ddc6d9479171a39bdbab922e3db42e8d7d22da95ec87378`. The previous 0.2.8 bundle was backed up under `/Users/vladimirkrasov/.local/share/opencode-desktop/backups/0.2.8-before-dragfix-20260924-214747`. Apple Silicon local ad-hoc signature; no Developer ID/notarization.
- Source commits `5bfe2d2` and `9ae9ad2f35a9f84397e2412faff74da2c3b427b7` were pushed. [Release v0.2.8](https://github.com/VladimirKraswov/opencode-desktop/releases/tag/v0.2.8) points to the latter commit; the remote asset SHA256 matches the installed/Downloads DMG. The later overloaded-host test repeat timed out one unrelated project-switching test; that test and the new native-drop tests passed together, 8/8, when rerun separately.

## Microphone permission repair — 0.2.7, 2026-09-24

- Reproduced owner's English WebKit capture refusal in installed 0.2.6. The macOS microphone switch was already ON and NSMicrophoneUsageDescription was present. TCC at 17:25 explicitly denied capture because Hardened Runtime required the missing `com.apple.security.device.audio-input` entitlement. Existing ad-hoc code requirement also differed after the prior update. No TCC database edits or global permission resets.
- Added the single audio-input entitlement to the signed bundle; retained Hardened Runtime and normal OS consent. Capture failures now explain local permission/device problems in Russian. A canceled AudioContext startup cannot make a later getUserMedia call; late granted streams are stopped without transcription.
- 171/171 frontend tests pass, including 4 new capture/cancellation regressions. TypeScript/Vite production build passes. New `scripts/verify-macos.py` checks the actual bundle's strict signature, signed audio-input entitlement and microphone usage description; rejects the installed 0.2.6 artifact as expected. Final Tauri app+DMG build, strict codesign, signed-entitlement check and hdiutil verification passed.

- Installed `/Applications/OpenCode Desktop.app` 0.2.7. Native microphone click produced a running timer and sound-level canvas; cancel returned to the microphone button without error or ASR submission. The existing microphone grant was usable. This verifies actual capture/start/cancel; speech-to-transcript was not repeated in this fix.
- All 26 preferences categories, drafts and global OpenCode configuration compared unchanged. All 26 remembered scopes were idle before installation. External OpenCode PID 27982 and the four pre-existing MCP processes remained alive; engine 1.18.18 healthy. Backup: `/Users/vladimirkrasov/.local/share/opencode-desktop/backups/0.2.6-before-0.2.7-20260924-173755`. Private receipts: `.local/microphone-0.2.7/`.
- Installed executable SHA256: `c68e60ce6b9eb8563732f3085eaca6b6203173878db498dbc0c0434ba460d666`. Downloads DMG SHA256: `143b48f24f9d47dbf9cd33e85f9b4e40b0186b3667e652dd34f2af8c0cdc1602`. Hardened Runtime remains enabled; local ad-hoc signature, no Developer ID/notarization.
- Source `c04f053b2fc7a67c937689a8363418b62e913ef3` pushed; [v0.2.7](https://github.com/VladimirKraswov/opencode-desktop/releases/tag/v0.2.7) published. Remote tag and DMG digest match the verified local artifact.

## Settings and appearance — 0.2.6, 2026-09-24

- Replaced the modal/tab layout with a full-window screen: searchable sections, independent navigation/content scrolling, grouped settings rows, back/Escape and Cmd+, keyboard access. The conversation remains mounted but inert/hidden, preserving its draft, stream and reading state. Completion behind settings remains unread until the visible chat is viewed.
- App-global appearance: validated migration/persistence, independent UI/chat/code fonts, themes, palette/custom HEX accent with contrast-aware foregrounds, width and line spacing, preview/reset. Existing host snapshots cannot restore an obsolete appearance. No inference/config/model payload uses these values.
- Existing OpenCode config editor is preserved and driven by the new navigation; staged edits stay mounted across sections. Connection and ASR edits have separate save actions and exit protection. No additional engine restart, privileges or dependencies introduced.
- Full frontend tests **167/167**, `npm test -- --maxWorkers=2`. TypeScript/Vite passed. Tests cover preference migration, validation/CSS input rejection, remote workspace return, accent contrast, DOM application, search, independent saves, dirty exit/navigation and unread completion behind settings.
- Browser acceptance through private local API fixture, no inference: both themes; default and maximum fonts at1280×720/900×620; no horizontal content overflow, sidebar remains scrollable. Actual chat computed sizes18pxUI/24pxchat/22pxcode and composer24px, width1060px, relaxed line height44.4px confirmed. Settings reload retained all values; return retained the exact test draft; discarded ASR edit restored GigaAM; search reached appearance. Private receipts `.local/settings-0.2.6/`.
- Native installed acceptance: settings search/Cmd+, separate font changes and blue accent, live preview, actual SQLite persistence, reset to original neutral/dark defaults. Staged bash permission stayed pending across Appearance navigation and exit protection; discarded without writing the config (hash unchanged). Existing GigaAM endpoint/model/language retained. Cua Driver0.28.2 remains enabled, connected, with both grants. About confirms Desktop0.2.6 and OpenCode1.18.18 connected/open. Original Compute Mesh and empty composer restored; final screen intentionally shows Appearance.
- Final Tauri app+DMG build, strict ad-hoc codesign and hdiutil checksum verification passed. Installed `/Applications/OpenCode Desktop.app`, executable SHA256 `87bd0855e095b0354d7f4174c5b713336221e760aac8c07ac4ee59e7eba934f1`. Downloads DMG SHA256 `7ad462b508845224d828c6c0589949efea868f7d16a0e830a65b5487e1c291e9`. Backup: `/Users/vladimirkrasov/.local/share/opencode-desktop/backups/0.2.5-before-0.2.6-20260924-165520`. Not Developer ID signed/notarized.
- All25scopes idle before replacement. OpenCode27982 and all four existing MCP processes unchanged. Fourteen preference categories including all5drafts, models/agents/ASR/hosts/layout/selection/theme compared unchanged; only the new default appearance field was added. No prompts/inference or server restart. Owned fixture4314/Vite1425 and browser14 closed.
- Source/tag `e0b2324f9dfe2a508e3f629afd286012c8061f82` pushed and [v0.2.6](https://github.com/VladimirKraswov/opencode-desktop/releases/tag/v0.2.6) published; remote asset digest matches the verified Downloads/installed receipt.


## Cohesive assistant output — 0.2.5, 2026-09-24

- Read-only inspection of actual OpenCode 1.18.18 history confirmed many `tool-calls` messages share one user parent and precede a `stop` text answer. The view now groups those adjacent steps without mutating messages or session state. User steering, different parents and compaction summaries remain separate boundaries.
- One compact progress rail retains explanatory text, collapsed reasoning and expandable tools; one final footer copies only the final Markdown. Model profiles and total known output tokens appear under «Сведения», with incomplete/paginated usage labelled. Tool errors remain discoverable when progress is folded; abort/budget failures remain visible and are never promoted to final answers. Internal compaction is a separate folded disclosure.
- Browser acceptance used a private local HTTP/SSE fixture, without model requests. Manual reading stayed exactly at scrollTop2275 as height grew3076→3713; the final-answer transition preserved3090.5 as height grew3820→4121. Jump resumed following. Switching away/back preserved expanded progress and top2867.5. Exact final Markdown clipboard, history prepend, light/dark layouts and no console errors verified.
- Native review exposed internal summaries opening as large transcript blocks and short tool durations wrapping beside long commands; both corrected. A separate browser reproduction found folded zero-size anchors being selected when the viewport was above the window edge. Its regression test failed before the fix and passed after; invisible anchors are now excluded from capture/restore.
- Final full frontend suite: **157/157**, `npm test -- --maxWorkers=2`; TypeScript/Vite production build passed. Regression coverage includes request boundaries, pagination-stable group identity, final/error/compaction classification, exact copy, retained live folds and navigation state. No Rust implementation changed. Native candidate verified the real Compute Mesh history with29/19tool actions, distinct finals and actual error states; connected/open, engine1.18.18, app0.2.5. The final installed build also confirms «Сжатие контекста» starts collapsed and offers «Копировать сводку».

- Final Tauri app+DMG build passed, app `codesign --verify --deep --strict` and DMG `hdiutil verify` passed. Installed `/Applications/OpenCode Desktop.app`; executable SHA256 `83190f6c007f363cf631c51c5282e0f39a46225f101f154db6a85bda83b59bf4`. Downloads DMG SHA256 `ce4fbdf9d899906418ccdfd15ad126f0ee721c40c8cf43867c582cc775cc5edb`. Local ad-hoc signing only; no Developer ID/notarization.
- All25remembered directory scopes were idle before both installations. Original0.2.4 backup: `~/.local/share/opencode-desktop/backups/0.2.4-before-0.2.5-20260924-161613`; the intermediate candidate is separately backed up. OpenCode PID27982 and existing MCP processes retained. Model/agent/ASR/host/access/theme, all drafts, selected Compute Mesh conversation, expanded projects and globalconfig were compared unchanged. No prompts or GPU requests were sent. Private receipts: `.local/turns-0.2.5/`; owned fixture/Vite/browser closed.


## Chat reading and attention — 0.2.4, 2026-09-24

- Confirmed the owner’s phantom GPU Mesh indicator was persisted attention for a hidden explore child. Metadata reconciliation now removes confirmed child/archive/deleted marks, preserves unknown marks on network errors, and includes older unread roots beyond the first page. Late lookup/host races are guarded.
- Browser acceptance used an isolated local HTTP/SSE fixture with 140 messages and 180 streamed paragraphs, without inference. While paused, scrollTop stayed exactly 14500 as scrollHeight grew from 15195 to 15865; jump resumed at the actual bottom. History prepend moved scrollTop from 0 to 4652 while the same message stayed at y=191. The initial date-separator anchor defect was reproduced and fixed by anchoring stable messages/parts.
- Browser clipboard verified exact Python code without fences, full Markdown response, edited local code copy, and prompt-edit branch draft. Dark and light layouts reviewed, no browser console errors. Untrusted Markdown HTML/unsafe links, unknown/large code, copy and streamed local edits covered by tests.
- Independently verified the real OpenCode 1.18.18 fork boundary with a disposable noReply session: the selected message is excluded, earlier context retained, and permission rules are NOT inherited by the engine. Desktop explicitly restores source rules before presenting a branch. Both probe sessions were archived; no model request was made.
- Final full frontend suite: **145/145**; focused final metadata/edit regressions **14/14** after two review corrections. TypeScript/Vite production build and `git diff --check` pass. No Rust implementation changed; final Tauri release build completed. Existing large-chunk advisory remains (about 292KB gzip for the primary frontend bundle).
- Native installed acceptance: settings reports **0.2.4**, engine **1.18.18**, connected/open; actual user history renders date/time and code controls. Code copy reports success. Manual upward scrolling exposes «Вниз» and the button returns to the tail. GPU Mesh collapses without phantom attention; persisted hidden-child mark is gone. A separate owned session was edited through native UI: the branch contains exactly the earlier control message, source history is unchanged, deny-all rules and Qwen/Medium/agent are retained, correction is in its draft and no inference ran. Test sessions were archived, temporary project hidden, original user chat/empty draft and project expansion restored.
- Original model/agent selections, ASR, hosts, access, theme and global OpenCode config were independently compared and preserved. External OpenCode PID27982 and existing MCP processes were not restarted. All 24 inspected directory scopes were idle before installation. Prior app backed up locally.
- Initial bundle carried only a linker signature and failed strict resource verification. Re-bundled the same compiled release using an explicit ad-hoc macOS identity (`tauri bundle --bundles app,dmg --config '{"bundle":{"macOS":{"signingIdentity":"-"}}}'`). Final app passes `codesign --verify --deep --strict`; final DMG passes `hdiutil verify`. README build command includes the signing option. No Developer ID/notarization claim.
- Installed `/Applications/OpenCode Desktop.app`; executable SHA256 `1e6225c0508f52b7567e86a50915871b4c1cab13604a097b8840fe378aee6fc5`. Downloads/release DMG SHA256 `80738a55250510020a17fc671b51b2bbd47126914501ac9c6af7a0ba2633285b`. Private acceptance/backup receipts are under `.local/scroll-0.2.4/`. Release: [v0.2.4](https://github.com/VladimirKraswov/opencode-desktop/releases/tag/v0.2.4).


## Background computer control — 0.2.3, 2026-09-23

- Official Cua Driver 0.28.2 installed separately. Archive SHA256 `818ddefa0fa8ba2ec9cba837c7aa634a4b064221c748752cf49c5b08e2c94e8c`; Developer ID Cua AI, Inc. / YCK386LBJ7 and notarization verified. Driver telemetry disabled. User explicitly approved Accessibility and Screen Recording; the signed daemon's own permission report confirmed both grants.
- Native settings detected the driver and grants, connected `cua_desktop`, and wrote a backed-up JSONC entry with the canonical installed Desktop executable. Model/provider/access fields were unchanged. OpenCode's global config cache needed its documented config-update API to load the new entry and skill; all existing scopes were idle and existing directories had no PTYs. The OpenCode server process was not restarted. The UI now distinguishes immediate connection in the current project from the server's cached configuration.
- Real Qwen Flash Next / Medium acceptance used one disposable OpenCode session and a TextEdit test note. The model discovered the app/window, read its screenshot and accessibility tree, performed a background pixel click after AXPress proved unsupported by the text field, set its value and read it back. Fresh AX + screenshot independently confirmed `CUA_BACKGROUND_OK_5729`.
- Physical pointer coordinates before/after were exactly `(1050, -1013)`; Cua's separate agent cursor was enabled at `(416, 355)`. The named control session ended normally. The test conversation was archived and the owned note moved into private acceptance artifacts; no user document was edited.
- Native emergency stop disabled the shared gate; a new MCP caller then received `isError:true` before any driver tool could act. Post-stop acceptance found that the driver retains runtime suspension even after the MCP transport reconnects. Explicit UI Connect now closes only a runtime with `authorization_suspended`, reconnects under its normal policy and verifies actual permission readiness; model tool calls never trigger restart and other refusals remain errors. Focused frontend/Rust regressions cover this condition. Final native reconnect is checked below.
- Native testing caught two integration defects: OpenCode consumes MCP `content` but omits `structuredContent` from model-visible text, so the adapter now adds a JSON content block without altering images; ambiguous target formats confused the local model, so action schemas expose required `pid` + `window_id`, and JSON-encoded nested targets are accepted for compatibility. Focused Rust regressions cover both. Unsupported driver instructions to escalate to foreground are replaced with the actual Desktop contract.
- Limitation reproduced: a window on another macOS Space can be captured, but input is refused with `off_space_or_ax_unresolved`. The user brought the owned note to the current Space; only then did input pass. This is stated in settings, skill and documentation. Foreground/full-desktop control, remote desktop and browser-profile attachment are excluded. Cua 0.28.2 can also report an invalid cursor-state output while its position is null before any action; the post-action cursor report passed. No claim of complete Codex equivalence.
- Final automated checks: 126 frontend tests and 15 Rust tests. One earlier run concurrent with compilation timed out in unchanged R3; the complete rerun without compilation passed all 126 without modifying assertions or timeouts. Release build/installation receipt recorded after packaging.

## Installed bundle — 0.2.3, 2026-09-23

- `env -u NODE_PATH npm run tauri build -- --bundles app,dmg` passed with the final reconnect fix. Final app installed at `/Applications/OpenCode Desktop.app`, existing `~/Applications` and Desktop aliases retained. Previous 0.2.2 app/preferences are backed up privately.
- Installed executable matches the built candidate: SHA256 `4c1b9eeaa22e5e991ff3c990e4d60c6df46bc73f78069fb96e9bd2a5fd84354d`. `hdiutil verify` passed; the same DMG is in Downloads: SHA256 `3c304fcaf1334db32ca68012ee6f966ceb1d23d843a100e48732e68bea0ab34c`.
- Final native settings correctly showed the revoked driver as **Не готово**. Explicit Connect recovered it and displayed **Включено / Подключён**, Accessibility and Screen Recording **Разрешена**. A separate MCP handshake against the installed binary verified 22 tools, required exact-window schemas, permission checks under `com.trycua.driver`, and model-visible structured results. No additional inference was needed.
- Settings fit the native window; IgorPC was restored with an empty composer. ASR, model/provider/default/permission fields and chat history were preserved. Existing session/PTY scopes were checked idle before replacement; external OpenCode PID27982 stayed healthy at 1.18.18 without restart.
- Desktop remains an Apple Silicon ad-hoc local build; the separately installed Cua Driver has its own Developer ID signature. No Desktop notarization claim. Published release: [v0.2.3](https://github.com/VladimirKraswov/opencode-desktop/releases/tag/v0.2.3).

- Release tag `v0.2.3` points to source commit `abf4e2e7b846f261d7aa4cc9d4f18b6ab5215f0c`; GitHub asset digest matches the local DMG SHA256 above. Subsequent checkpoint-only documentation commit records publication and does not alter the packaged source.

## Project removal and task handoff — 0.2.3, 2026-09-23

- `env -u NODE_PATH npm test`: **122/122** tests pass. Added coverage for project remove/restore and server isolation, append-only recipient drafts, full-history fork preparation and cancellation, recipient model/directory preservation, busy/permission guards, SSH credential isolation, and uncertain delivery without resending. A raw HTTP fixture covers assistant `parentID` normalization; native testing exposed that previously missing field.
- Native project-menu acceptance: removed a disposable project from the sidebar, verified the current IgorPC conversation stayed selected, and restored the project through **Убранные проекты**. No filesystem or session deletion occurs.
- Native handoff acceptance used two disposable local sessions with real Qwen Flash Next / Medium. Important facts were deliberately placed in the **first** source message, followed by unrelated messages. **Собрать важный контекст** produced a 7,578-character editable packet in 123 seconds containing the original protocol, port, SSH alias, application path, service, database restriction, passed test and next action. The isolated preparation fork was archived automatically; the source still contained exactly its three original messages. A separate cancellation check stopped/archived only its preparation fork.
- **Отправить и начать** delivered exactly one user message to the selected recipient. Its real response began `HANDOFF_RECEIVED` and reproduced all eight control facts, explicitly distinguishing source-machine coordinates from the receiving workspace. There were no tool calls and no parallel inference requests.
- Native draft mode appended a second packet after `EXISTING_DRAFT_KEEP`, preserving the existing text and generating no additional API message/model response. Cleared the disposable draft and archived only the acceptance sessions afterward. Restored IgorPC with its empty composer and original model; ASR, host and endpoint preferences matched the pre-test backup.
- Native visual review found flex shrinking the recipient list in short windows; the final layout keeps fields intact and scrolls the dialog instead.
- Scope: title search and explicit recipient selection are implemented in the UI. A model-invoked automatic discovery/delegation tool is not included. Preparation quality depends on the selected model and available source context; the user reviews/edits the packet before sending. Remote client/profile/auth isolation has automated coverage, but no configured second-host native roundtrip was available for acceptance.
- Final installation passed; see the shared 0.2.3 receipt below.


## Expandable project sidebar — 0.2.2, 2026-09-23

- `env -u NODE_PATH npm test`: **105/105** tests pass, including the original store regressions. New coverage: independent expansion without navigation/draft/SSE changes, persistence on reconnect, directory/subagent filtering, events received during slow snapshots, host isolation, recent pagination, background project actions and retry/load-more. Existing attention/queue/history/model tests still pass.
- `env -u NODE_PATH npm run tauri build -- --bundles app,dmg`: TypeScript, Vite and native release build pass. Native source unchanged except package version. Existing chunk-size advisory remains.
- Native macOS candidate: GPU Mesh expands into all six imported sessions. A second project can remain expanded while IgorPC stays selected. A temporary unsent draft survived collapse/re-expand and was then cleared. Blogger Scout and IgorPC opened their real imported history. Project “+” starts a new draft in that project without creating/sending a server request; returning to the existing session works.
- Collapsed GPU Mesh remained collapsed after quitting/reopening the candidate; expanded state persisted into the installed app. Recent sessions appear below projects, and switching to the global archive lists archived sessions with restore controls. Archive/restore mutations are unit tested in this revision; no user session was archived/deleted during native acceptance.
- Installed `/Applications/OpenCode Desktop.app` **0.2.2** after checking OpenCode had no running sessions. Previous bundle and WebKit preferences backed up locally. Installed executable SHA256 matches the tested candidate (`13ffa0e9f92a211571e8f895513f45b7cb8b10fe82dd1e8d74f66352839a16e2`). OpenCode process stayed unchanged and healthy at 1.18.18; no inference request or model configuration change.
- Installed UI shows expanded GPU Mesh, all six sessions and the restored IgorPC history with an empty composer. Existing Applications/Desktop aliases retained. DMG copied to Downloads and passed `hdiutil verify`; SHA256 `a7cdbb9e42dc65ce986a5f220c1b1b67f536863007872691074d9560a49106b2`.
- Cross-project recent/archive API is verified against OpenCode1.18.18 `/experimental/session`. Unsupported future/older versions show a retryable list error. Apple Silicon ad-hoc local build; no notarization claim.


## V100 NInfer migration — configuration only, 2026-09-23

This supersedes the deployment decision in the older 0.2.1 acceptance entry below.
The app binary remains 0.2.1; only the external model/agent configuration changed.

- The corrected NInfer fork now serves `local-qwen38/qwen-v100`: NVFP4, context262144,
  Vision, MTP4, prefill2048. Production startup/restart and sole GPU ownership passed.
- Model and agent JSONC/Markdown were backed up; Flash Next provider/default and
  existing sessions were preserved. The native model picker displayed both Flash
  Next and **Qwen3.8 27B NVFP4 (NInfer · V100)** after metadata reload.
- Real OpenCode `read`/`write`/`bash` task: 8/8 independent tests passed after its fix,
  test file unchanged. Serving logs confirmed Medium8192 and Low2048 thinking
  budgets, with the actual OpenCode response ceiling32000.
- Corrected quality smoke suite:107/108 first attempts; code51/51, tools11/11 and
  Vision10/10. One exact string-reversal error remains. This does not prove broad
  quality parity. Old clock/seed/retry methodology errors are documented in the
  [fork report](https://github.com/VladimirKraswov/ninfer-v100/tree/master/deploy/v100/results/2026-09-23).
- Cold226022-token input plus image passed scattered-fact/OCR checks and completed
  normally in604.43s. Old active Qwen GGUF/projector and standalone llama.cpp were
  removed after client acceptance; unrelated archives and CPU services were retained.
- No app source change, repackaging or duplicate GPU inference was needed. Current
  limits, compaction threshold and operation are in [LOCAL-MODELS.md](LOCAL-MODELS.md).

## Completion attention, settings and V100 model — 0.2.1, 2026-09-23

Historical release-time decision; superseded by the migration entry above. The
old aggregate quality figures also had scorer/seed/retry methodology problems.

- Independently recalculated all six context-bucket decode medians and the 225K-token cold probe from the raw llama.cpp/NInfer JSONL files. NInfer reached 262144 context and 1.42–1.95× decode, but the 116-case quality suite was 113/116 versus 116/116 for llama.cpp. A code error and fine-detail Vision error reproduced, so NInfer remains stopped and `llama-v100.service` remains healthy. See [model profile and decision](LOCAL-MODELS.md).
- Added live V100 profile `local-qwen38/qwen-v100` through the separate `127.0.0.1:18021` SSH tunnel. `/v1/models` reports `qwen-v100` and 262144 context; OpenCode `/provider` shows V100 and Flash Next simultaneously. A short OpenCode test request recorded assistant `providerID=local-qwen38`, `modelID=qwen-v100`, `variant=medium`, while global `model` and `default_agent` remain Flash Next/`qwen-build`.
- Source checks after the project-row unread fix: 97/97 frontend tests, frontend build, six Rust tests and `git diff --check` passed. The test covers returning via the project row, where the completed session becomes visible without another session-row click.
- In the packaged native 0.2.1 candidate, the model picker displayed both local GPUs. Selecting V100 changed the context meter to 262144/196608 threshold without borrowing the prior Flash Next token usage; switching back restored Flash Next's 131072 context and its measured usage. The V100-specific `qwen-v100-build` agent and Medium option appeared in the composer.
- Native settings showed live tools, skills, plugin, MCP and agent sections. In a disposable project, changing `permission.bash` through the UI created a backup, preserved a JSONC comment and unrelated field, and showed the saved value. A second staged edit was rejected after an external file change, proving stale-write protection. The installed GigaAM ASR endpoint/model/language appeared in the native 0.2.1 candidate settings.
- A real V100 chat in the disposable project called the `read` tool and answered `deny` from that file. While another chat was visible, the project row indicated the running task and then showed a yellow unread dot after completion. Opening the specific session cleared the dot. Native review found that returning via the project row displayed the answer but left the dot; this was fixed in source and is covered by a new regression test.
- The final rebuilt native app repeated that scenario: after a second V100 read-tool response (`dark`), the project row showed unread; returning through that row restored the answer and cleared the dot without a separate session click. No duplicate GPU jobs were run.
- Final `npm run tauri -- build --bundles app,dmg` completed for the fixed source; `hdiutil verify` reported **VALID**. DMG SHA256: `387826b644f8d199024b9e6e2716364852f167b3387f8d00eceaddaa977ae4c2`; executable SHA256: `c7cc170b52d6c6c859ee492bb47c3e615045fbf59df5d1e4b7383d910977b497`.
- Backed up installed 0.2.0 locally, installed 0.2.1 to `/Applications/OpenCode Desktop.app`, and copied the same DMG to `~/Downloads`. Installed executable hash matches the bundle. The `~/Applications` and Desktop aliases still resolve to it; `Qwen OpenCode.app` remains present. The installed app displayed **0.2.1**, OpenCode **1.18.18**, connection **connected**, SSE **open**, and the configured GigaAM endpoint. The pre-existing benchmark conversation and context meter survived installation. The OpenCode server remained healthy on `127.0.0.1:4096`.
- Source commit `471e78082072ee152c931e61e8617f16573b18d9` was pushed. [GitHub release v0.2.1](https://github.com/VladimirKraswov/opencode-desktop/releases/tag/v0.2.1) points at that commit; GitHub reports the uploaded DMG SHA256 matching the local artifact.


## Optional projects and SSH execution — 0.2.0, 2026-09-22

### Automated checks and final package

- `env -u NODE_PATH npm test`: **83/83 passed**, preserving the previous 68 tests and adding 15 workspace/host regressions. Covers lazy per-chat workspace creation, duplicate submissions, failed/stale preparations, new-chat versus resume, stable SSH identity, local/remote drafts and PTY isolation, failed remote never falling back to Mac, late handshakes, auth non-persistence, deleted-session reconciliation, non-Git folders and Medium defaults.
- TypeScript + Vite production build, `cargo check`, `cargo fmt`, `git diff --check`: passed. `cargo test --lib`: **5/5 passed**, including SSH argument validation, mandatory known-host verification and workspace traversal/injection rejection.
- Final `env -u NODE_PATH npm run tauri build -- --bundles app,dmg`: passed. `hdiutil verify`: **VALID**.
- Installed `/Applications/OpenCode Desktop.app` reports **0.2.0**, and its executable matches the final build. Existing `~/Applications` and Desktop links still resolve correctly; the old Qwen launcher is preserved. Previous installed version backed up locally.
- Executable SHA256: `2564a5754e5f2b0cd077d2aa71c264848abd43336ef3489b65e6da358445c194`.
- DMG SHA256: `752dab42bb118d9f0591a801257ab2281c0e767c0f1d298fb22962a1d166d26c`. A matching copy is in Downloads.

- Delivery: source commit `452df23e18cfacb21a2c62578524c330d555b5e2` pushed to the existing private repository. [Release v0.2.0](https://github.com/VladimirKraswov/opencode-desktop/releases/tag/v0.2.0) has the DMG; GitHub reports the same SHA256 as the local artifact.

### Real native acceptance

These were actual packaged Tauri UI actions with OpenCode 1.18.18, not only unit tests. Inference checks used local Qwen3.8 Flash Next / Medium sequentially, in app-owned test directories. No user project was modified.

- New Chat opens an enabled composer, optional project picker and explicit projectless choice. Local and remote execution selectors are independent of project selection; local project menus list actual server projects.
- Opening the terminal before sending a prompt creates a separate managed workspace. Real xterm `pwd; uname -s` showed its Mac path and Darwin. A subsequent UI prompt invoked the real read tool in that workspace and returned the exact fixture marker `LOCAL_PROJECTLESS_FILE_020`.
- Context meter for that chat showed **9208/131072**, compaction threshold **81920**, remaining **72712**. Medium was confirmed by UI and actual message metadata. Automatic compaction uses the unchanged existing OpenCode configuration; no extra long-context inference was forced for this release.
- A temporary, isolated OpenCode instance on a POSIX SSH host exercised the actual native tunnel and API Basic authentication: HTTP, streamed chat and PTY all worked. Terminal output showed the remote directory, Linux and the remote host. The real remote read tool returned `REMOTE_PROJECTLESS_FILE_020`; context showed **8159/131072**.
- Remote project selection accepted the real server directory through its path dialog; a nonexistent server path was rejected by the file API. It did not open a Mac folder picker. Returning to Local restored local project/history/model state without remote entries leaking across hosts.
- Local projectless chat archive and restore worked through the native UI. Its history survived app exit, final installation and relaunch. The installed final build displayed the prior read result and context usage, opened a fresh projectless terminal, and reported app **0.2.0**, engine **1.18.18**, SSE **open** in settings.
- Temporary remote engine, its temporary data/config, forwarding connection, remote test workspace and test connection profile were removed. Test PTYs were closed. The independently managed local OpenCode server remained healthy and was not restarted. The app is left on New Chat / this computer.

### Scope and remaining limitations

See [workspace/host contract](WORKSPACES.md). The remote engine must already exist and serve its API on remote loopback; Desktop owns only its SSH connection. SSH requires a working key and known host. API passwords are memory-only with standard HTTP user `opencode`; no Keychain persistence/custom HTTP username yet. Managed chat folders are not a filesystem sandbox. This Apple Silicon build is not Developer ID notarized. Full Codex feature/pixel parity, cloud execution and Windows remote workspace creation are not claimed.

## Window dragging hotfix — 0.1.1, 2026-09-22

- Root cause: the custom titlebar invoked `start_dragging` without the required capability; bare drag regions also excluded their nested label/spacer hit targets. See [Tauri window guidance](https://v2.tauri.app/learn/window-customization/).
- Added only `core:window:allow-start-dragging` to the existing main-window capability. The installed Tauri 2.11.6 `window/scripts/drag.js` supports `data-tauri-drag-region="deep"`, including descendants while excluding buttons/interactive controls. Both titlebar regions now use this native mode; text selection is disabled only on native window chrome.
- App/settings version updated to 0.1.1. The settings display reads package.json instead of a stale literal.
- 68 frontend tests passed; frontend production build, cargo check and final app/DMG build passed. No Rust implementation changes; the two native ASR tests from0.1.0 remain previous evidence, not a new run.
- Installed native0.1.1 was dragged from free titlebar space and from the title text. The review button still toggled on/off, and settings showed0.1.1. No inference request or user project change was needed.
- Installed to `/Applications/OpenCode Desktop.app`, aliases unchanged. `hdiutil verify`: VALID. Build/installed executable hashes match.
- Executable SHA256: `01c70536f7f6b349593043869fda39bb831720288c54a9fa0a8b558e634cfe0f`.
- DMG SHA256: `4c7aa0453c87aa5b0c13ebde3bbe95ff958de4bf6322c06e32227e9b3295a28c`.

## Original 0.1.0 acceptance pass — 2026-09-22

Supersedes the original worker's completion claims below. See [independent corrections](ACCEPTANCE-2026-09-22.md) and [context, access, queue and voice contracts](CONTEXT-QUEUE-VOICE.md).

### Automated checks and package

- `env -u NODE_PATH npm test`: **68/68 passed**. Includes model/Medium defaults, endpoint/project isolation, late archives, duplicate sends, stale acknowledgements, snapshot/delta races, opaque pagination, strict origins, PTY tickets, CRLF SSE, compaction accounting, queue/access and five popup placement regressions.
- The five original independent review reproducers passed unchanged; equivalent assertions remain in the main suite. They are additional acceptance evidence, not five extra product features.
- `env -u NODE_PATH npm run build`: passed (TypeScript + Vite production build).
- `cargo check --manifest-path src-tauri/Cargo.toml`: passed.
- `cargo test --manifest-path src-tauri/Cargo.toml`: **2/2 passed**, including endpoint validation and an actual multipart roundtrip with synthetic audio.
- `CARGO_BUILD_JOBS=2 env -u NODE_PATH npm run tauri -- build --bundles app,dmg`: passed for the final source; native app and DMG exist.
- `hdiutil verify` on the delivered DMG: VALID. SHA256: `06a8475ca73c48aa386ca3dbabd0d12a6aefeb47b2c80d82cbb9897ff4b4d20c`.
- Build bundle and installed executable match: SHA256 `dec4302d6558fc1072b62bf62d8654eb83603c989e7761b89f40ed5f42bca145`.

### Real browser and native acceptance

All new inference checks used local Qwen3.8 Flash Next / Medium sequentially, in a disposable project. No user project or existing conversation was modified.

- Live API pagination: 200 recent + 124 older messages, zero overlap, using `X-Next-Cursor`. A message-ID cursor reproduced HTTP 400 and was replaced.
- Project/session selection, model defaults, archive/restore, project/endpoint draft isolation and ticket-authenticated PTY reconnect were exercised in the browser.
- While a real bash tool was running, one queued correction was sent with “Скорректировать сейчас”. The same engine loop consumed it at the next step and returned `LIVE_STEER_42`. A separate queued prompt then dispatched automatically once and returned `QUEUE_AUTO_42`.
- Context meter displayed actual usage 9434/131072 and 72486 tokens remaining to the installed engine's 81920 compaction threshold. Engine automatic compaction remains enabled. Manual compaction completed with a real compaction part and successful summary response; a separate automatic overflow run was not forced.
- Read-only access changed the test session's actual permission rules through the API. No global permission configuration changed.
- Final native application selected/resumed the test session, streamed a real read-tool call and answer `NATIVE_CHAT_42`, and displayed the existing file content `SMOKE42`.
- Real native terminal executed `printf "NATIVE_TERMINAL_42\n"; pwd`; output and the correct disposable working directory were visible. The test PTY was closed explicitly.
- A draft was saved, the app was quit and the final bundle installed. Reopening the installed app restored both session and draft. The test draft was then cleared.
- The external OpenCode 1.18.18 server remained running independently. TinyCAD's port 1420 was not used or altered; our development port is 1425.

Popup correction: real browser checks at 1280×720 and 900×620 show unclipped menus, a scrolling model list and upward-flipping sidebar actions; no browser warnings/errors. The rebuilt installed native app also showed the complete agent menu, scrolling model list and filtering by `qwen`, with no clipping. See acceptance notes.

### Installation and limitations

Canonical installed app: `/Applications/OpenCode Desktop.app`. `~/Applications/OpenCode Desktop.app` and the Desktop shortcut resolve to it. Both earlier app copies were backed up locally; the original `Qwen OpenCode.app` launcher was preserved. The delivered DMG is also in the user's Downloads folder.

- Apple Silicon local build; no Developer ID signature or notarization.
- Actual ASR credentials/endpoint were not supplied. Configuration and native multipart transport are implemented/tested; real microphone-to-transcript recognition is not claimed verified. The microphone shows settings when ASR is unconfigured.
- Queued prompts require the app to remain open and their conversation selected; uncertain submissions are paused instead of retried. Steering takes effect at an engine step boundary, not in the middle of an already running tool.
- Access modes are OpenCode permission rules, not an operating-system sandbox. Live permission/question dialogs were not triggered by the configured test policy.
- Finder restricted-PATH/offline restoration, engine upgrades, multiple terminal tabs and advanced Git/worktree/cloud features are not claimed. See roadmap.
- The layout is Codex-inspired; pixel-perfect identity and full proprietary feature parity are not claimed.

## Historical worker report — corrections apply

The remainder is retained as historical evidence, not as current acceptance. Two original claims were wrong: the smoke used DeepSeek V4 Pro; PTY 403 meant a missing CSRF header, not a server quirk.


## Bootstrap — 2026-09-22

- Official create-tauri-app 4.7.4 completed with react-ts/npm/Tauri 2.
- Local OpenCode health reports healthy, version 1.18.18.
- Configured local Qwen model/agent/Medium were found in live API.
- `env -u NODE_PATH npm install`: passed, 27 packages added, npm audit reported 0 vulnerabilities.
- `env -u NODE_PATH npm run build`: passed (TypeScript + Vite 8.3.0).
- `cargo check --manifest-path src-tauri/Cargo.toml`: passed in 1m 09s, Tauri 2.11.6, Rust 1.96.0.
- This verifies the starter only; no product feature or packaged release is claimed yet.

## Product milestones

## M1–M5 core + review pass (R1–R9) — 2026-09-22

Environment: OpenCode 1.18.18 at `127.0.0.1:4096` (externally managed — never started/killed by the app), local Qwen model, dev frontend on `http://localhost:1425`.

Commands and results:

- `npx tsc --noEmit`: clean. `npm run build`: ok (Vite 8.3.0).
- `npm test`: 34/34 — chatReducer normalization, transport/endpoint safety, store regressions R1–R5 (stale-event isolation, draft ownership, agent-choice priority, archive/delete cleanup, reconnect resync), diff util, patch-part contract.
- Review reproduction suite `.local/review` (5/5) mirrored into the repo; findings recorded in `docs/REVIEW-2026-09-22.md`.

Live browser verification (isolated `agent-browser` session, throwaway project `/tmp/oc-smoke`, screenshots under `.local/review/`):

- Startup chain: gate → connected, version shown, selected directory + last session restored from prefs only (no parallel fetch races).
- Terminal (R6): created/attached OpenCode PTY; typed `echo R6_ECHO_$((6*7))` through the real xterm input; `R6_ECHO_42` appeared in the xterm buffer (`term-r6.png`); console errors: none.
- One real streamed prompt (single inference): parts observed `reasoning → tool:write:completed → patch → text`, session went busy → idle; `/tmp/oc-smoke/qwen-smoke.txt` contained exactly `SMOKE42`; UI session-changes showed badge A with `+SMOKE42` (`session-diff.png`). The server policy required no permission for this write — the app auto-approved nothing.

Verified 1.18.18 quirks the adapter now encodes (each found by live probing, not guessed):

- PTY WS: stdout arrives in **text frames**; binary frames beginning `0x00` + `{"cursor":N}` are control only.
- `/pty/{id}/connect-token` answers **403 for every shell** while unauthenticated WS works; rejection is surfaced only if the WS also fails.
- `/session/{id}/diff` can return `[]` even after successful writes; `patch` parts carry the truthful file list, so ChangesTab merges both sources and loads content lazily via `/file/content`.

Not yet verified at the time of writing: Finder launch with restricted PATH, native-window interactive project selection. See M6 entry below. Notification/command-palette parity items remain open and are not claimed.

## M6 package + native smoke — 2026-09-22

- `cargo tauri build`: `src-tauri/target/release/bundle/macos/OpenCode Desktop.app` and `bundle/dmg/OpenCode Desktop_0.1.0_aarch64.dmg`. Unsigned local build — not notarized.
- Installed to `~/Applications/OpenCode Desktop.app` with a Desktop symlink; the existing `Qwen OpenCode.app` launcher was left untouched.
- Native launch outside dev tooling (LaunchServices `open`): window "OpenCode Desktop" rendered the dark shell, connected pill "OpenCode 1.18.18", engine version, and real model/agent/effort options fetched live from `/config` + `/agent` (screenshot `/tmp/ocdesktop-native2.png`). WebKit child processes hold the loopback connections; the external server was never started or stopped by the app. The app quit cleanly afterward.
- **Limitation (honest):** interactive project selection / session resume inside the *packaged native window* was not proven. Synthetic input (System Events keystrokes and a CGEvent click helper) did not drive the WKWebView `<select>`/buttons, and while probing, the user's own apps came to the foreground — further synthetic event injection was stopped immediately to avoid interfering with live work, and one keystroke sequence may have reached the then-focused app (flagged deliberately). The identical store/renderer code path for resume is proven in the browser run above.
- Still open: command palette, desktop notifications, full file viewer (highlight/find/open-in-editor), Finder restricted-PATH + offline-draft-restore check, working-tree vs session diff separation, engine-update flow.
