# Verification record

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
