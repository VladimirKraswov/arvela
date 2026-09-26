# OpenCode Desktop 0.2.11 — Agent control MCP (DONE 2026-09-26)

Owner requested a first-class API for controlling OpenCode Desktop without
physical mouse/UI automation, then using it as a subagent. Source 0.2.11 adds a
private per-user Unix socket, bundled `--agent-mcp` stdio adapter, semantic tools
for project/session/model/run state, a settings installer and documentation.
Frontend/Rust unit, production TypeScript build, fmt/check and live native MCP
acceptance passed. Permission requests remain explicit; there is no second agent
loop or network listener. Installed 0.2.11 and OpenCode registration are live.
Real bounded Qwen review session `ses_f213ab959ffeqKwsKiqqTdhGx5` completed via
send/wait/conversation tools; its six useful findings were fixed and reverified.
Concurrent live wait/status/stop passed. Final: frontend 286 pass / 6 skipped,
Rust 32 pass, build/check/fmt/diff and signed app/DMG verification pass. Evidence
and hashes are in docs/VERIFICATION.md. No remaining work in this task.

## Previous task — 0.2.10 (DONE, released 2026-09-25)

Owner-reported dictation controls were clipped by model/agent selectors and
attachments. Recording now has a full-width anchored row, bounded attachment
height and a single-line idle toolbar. The microphone starts independently of
Web Audio resume; a permanently pending Web Audio regression test passes.
Native candidate with three long-name PNGs showed waveform, timer, cancel and
stop in view; canceled with no ASR call and removed the test files. Installed
0.2.10 also recorded and canceled; original tiny-cad chat/draft stayed intact.

Mac: 281 frontend passed / 6 live skipped, 29 Rust passed, Tauri DMG build,
signature/microphone verification and hdiutil verification. Installed app
executable SHA256 `0b4408484fd7854991e0e89ed020fcb3941000106b6954bdec58293722f0e2f8`;
DMG `548a2441cdfff53807c373592e19970fb56a786b92c6c01cdb003566f0ea206e`.
Previous app backup at
`~/.local/share/opencode-desktop/backups/0.2.9-before-0.2.10-20260925-112515/`.
Linux Ubuntu: 281 frontend passed / 6 live skipped, 31 Rust passed, real
1360×900 Xvfb window. DEB
`4463440656dd0626cb3b9c3a8109d174c7f48c1f6449d4cbe317aee8795204a5`.
Igor's test checkout was removed. OpenCode server and GPUs were untouched;
API status was idle and no prompts or ASR audio were sent. Source fix `54fe7a3`
pushed; [v0.2.10](https://github.com/VladimirKraswov/opencode-desktop/releases/tag/v0.2.10)
contains both verified packages. The 09:10 tiny-cad message and reply both
record V100; a different pre-send UI selection is not established by that
read-only history. Full evidence is in `docs/VERIFICATION.md`.

# OpenCode Desktop 0.2.9 — DONE (released 2026-09-25)

Igor's direct Claude Code CLI refactor, the Pi backend, and separate Linux/Mac
variants were reviewed and completed by the Mac coordinator. OpenCode remains
the default; Pi is optional per project/chat, local only, with separate settings,
verified model access, guarded tools, LSP and two-way context handoff. Project
and recent lists include both engines. The Mac uses only the owner's local Qwen
models; no DeepSeek or OpenAI model was added there.

Final acceptance: native Pi `PI_FINAL_OK` and OpenCode `OC_FINAL_OK` chats on Mac;
both local Qwen Pi model checks passed with nonempty replies; Pi TypeScript/Rust
LSP shown ready. Installed 0.2.9 in `/Applications/OpenCode Desktop.app`, with
previous 0.2.8 backed up under
`~/.local/share/opencode-desktop/backups/0.2.8-before-0.2.9-20260925-015339/`.
The independent OpenCode server 1.18.18, existing user chats and local model
services were preserved. Three coordinator-owned test chats were removed.

Mac: 280 frontend tests passed / 6 opt-in live skipped, 29 Rust passed,
signature/microphone capability and `hdiutil verify` passed. DMG SHA256
`f5c38b32d4541757503f88a6dc2d22cf2e5d2bfd5c5e3e904a1edce858777741`.
Linux Ubuntu 24.04 x86_64: same frontend result, 31 Rust passed, package
metadata and real Xvfb window passed. DEB SHA256
`b8690c93a7a372e39ea8937875a8b4c20c611ca75b0b4f0bc1432491bf057f69`.
Both GitHub release v0.2.9 assets have matching remote digests. Source commits
`6b5d05e` and `91f19b2` pushed; release tag points to `91f19b2`. Windows is
not built or tested; macOS is ad-hoc signed without Developer ID notarization.
Igor's marker-verified, clean test-owned checkout and test key were removed
after publication; his other projects, services and user configuration remain.
Details: `docs/VERIFICATION.md`, `docs/PI-ENGINE.md`, `docs/PLATFORMS.md`.

# OpenCode Desktop 0.2.9 — coordinator review follow-up — historical pre-release checkpoint

Twenty coordinator findings re-checked against the code and fixed where real.
Headlines: existing chats keep their engine when a folder default changes
(durable origin, not folder fallback); handoff works OpenCode↔Pi with the
composer leading into it; Pi's built-in write/edit/bash are gated by a
first-party approval extension that denies on no-UI/timeout (proved live);
Pi runs in its own process group with a graceful-EOF→SIGTERM→SIGKILL shutdown
(Rust test on a tree that ignores both); an explicit `deepseek/deepseek-flash`
is selectable and was verified live in the built app; capability probes use
`--no-session`; Pi settings and the model picker stopped overclaiming.

Both engines accepted on Linux: live Pi with the real model, and a test-owned
OpenCode 1.18.18 on an isolated config/XDG home at loopback 43067.

Verified: tsc; 273 passed / 6 skipped frontend tests; live suites 3 Pi + 3
OpenCode passing separately; `npm run build`; `cargo fmt --check`;
`cargo check --all-targets` clean; 31/31 Rust tests; `npm run build:linux`;
native UI smoke; no orphaned Pi or language-server processes after exit.

NEXT (maintainer, on the Mac): `npm run build:macos`, `scripts/verify-macos.py`,
then Pi against `/opt/homebrew/bin/pi` with local Qwen (not DeepSeek), adding
explicit language-server paths in Pi settings since a Finder-launched app does
not inherit PATH. Details in `docs/PI-ENGINE.md` and `docs/VERIFICATION.md`.

# OpenCode Desktop 0.2.9 — Pi as a second engine — IN REVIEW (not released)

Owner asked for Pi to become a real second agent engine beside OpenCode, with
separate settings, per-folder/per-chat engine selection, working local Pi RPC
sessions, safe tool dialogs, and LSP. Direct Claude Code CLI work in the
temporary checkout on Igor's Ubuntu machine. No commits, push or release.

Delivered: `src-tauri/src/pi.rs` (process ownership, strict JSONL framing,
default-deny extension dialogs, LSP setup) and `src/agent/pi/` (protocol,
pure event translator, `AgentBackend`, native bridge). Engine selection lives in
`src/state/engines.ts`: per-chat override → folder preference → OpenCode, which
is also the migration for everything that existed before. Separate "Pi" settings
group; OpenCode settings untouched and never applied to Pi. Honest cross-engine
handoff: a new Pi chat seeded with a labelled transcript, provenance shown in the
chat, nothing sent without the user. First-party LSP extension after auditing and
rejecting the third-party candidate (detached daemon).

Pi installed on Igor at `~/.local/share/opencode-desktop/pi-runtime` pinned to
0.85.1; `typescript-language-server` there too; `rust-analyzer` via rustup
component. The DeepSeek test key was used only in child environments.

Verified on Linux: tsc; 258 passed / 2 skipped frontend tests; `npm run build`;
`cargo fmt --check`; `cargo check --all-targets`; 30/30 Rust tests;
`npm run build:linux`; live Pi run with a real model; live LSP diagnostics for
TypeScript and Rust; native UI smoke of the Pi settings; zero orphaned Pi
processes after app exit.

NEXT (maintainer, on the Mac): build `npm run build:macos`, run
`scripts/verify-macos.py`, then exercise Pi against the already-installed
`/opt/homebrew/bin/pi` and the local Qwen models (not DeepSeek), and OpenCode as
usual. Install language servers there and press «Настроить LSP». Details and
remaining limits in `docs/PI-ENGINE.md` and the 0.2.9 entries in
`docs/VERIFICATION.md`.

# OpenCode Desktop 0.2.9 — platform variants — IN REVIEW (source only, not released)

Owner asked for a deep quality refactor on his Ubuntu 24.04 machine, an agent-facing
layer that keeps OpenCode the default while allowing future backends, two explicit
build variants (Linux + macOS) with architecture ready for Windows, and product version
0.2.9 everywhere. Direct Claude Code CLI work in the temporary checkout
`~/work/opencode-desktop-claude-review-20260924`. No commits, no push, no release.

Delivered: `src/agent/` (`AgentBackend` contract, capability flags, descriptor
registry, OpenCode adapter); `src/state/store.ts` drives the neutral contract and owns
no transport; OpenCode-only surfaces (PTY, `/mcp`, JSONC editor) go through
`asOpenCodeClient` and the panels using them are capability-gated. Only OpenCode is
implemented — no other backend is claimed. Platform-neutral `tauri.conf.json` plus
`tauri.macos.conf.json` (Overlay chrome + `Entitlements.plist` + app/dmg) and
`tauri.linux.conf.json` (deb); no `tauri.windows.conf.json` on purpose. Per-OS paths in
`src-tauri/src/paths.rs` resolve evidence-first so an existing engine config or chat
directory always wins over an XDG guess. Linux runtime: system chime player table,
macOS chrome insets scoped to a `mac-chrome` class, absolute-path `ssh` resolution,
`navigator.platform` fallback for platform detection, and 10 pieces of macOS-only UI
copy made platform-accurate. Correctness fixes with regression tests: abort routed with
the session's own directory, no phantom session slots from malformed events, malformed
JSON bodies reported as API faults, session-owned directory authoritative.

Verified on Linux only: `tsc --noEmit`; 213/213 frontend tests (32 files);
`npm run build`; `cargo fmt --check`; `cargo check --all-targets`; 24/24 Rust tests;
`npm run build:linux` → `OpenCode Desktop_0.2.9_amd64.deb` with correct Depends,
Categories and no macOS artifacts inside; headless Xvfb smoke showing the real rendered
window. The owner's OpenCode server, sessions, models and GPUs were untouched; no
system packages installed and DKMS/kernel packages not altered.

NEXT (maintainer, on a Mac): `npm run build:macos` then
`python3 scripts/verify-macos.py "…/OpenCode Desktop.app"` — this is the gate proving
the audio-input entitlement and Hardened Runtime survived moving entitlements into the
macOS overlay. Also re-check macOS window chrome, the chime, and — on both platforms —
SSH tunnels, ASR dictation, the PTY terminal and drag-and-drop attachments. Only then
consider packaging/publishing 0.2.9. See `docs/PLATFORMS.md`, `docs/AGENT-BACKENDS.md`
and the 0.2.9 entry in `docs/VERIFICATION.md`.

# OpenCode Desktop 0.2.8 — DONE

Owner requested Codex-like file/image/audio/video/PDF attachments, a reusable Proxmox CPU helper and Desktop service settings. CT205 `oc-helper` runs on Debian12; PDF/MP4/audio conversion fixtures, private loopback tunnel and health passed. GigaAM ASR CT201 remains separate. A real browser-to-OpenCode PDF roundtrip through CT205 and local Qwen passed. Native Settings showed all three services. Finder/Desktop drag initially failed because the native WebView intercepted the drop before HTML. The final installed build uses Tauri native drag/drop with narrowly scoped read/stat; the owner confirmed drag works. No additional model prompt was sent for this fix. Full frontend suite passed 184/184 before release; a later overloaded-host repeat timed out one unrelated project-switching test, which passed in an isolated 8/8 run with native-drop tests. TypeScript/Vite, cargo check, native app+DMG build, strict signature/entitlement check and hdiutil verification passed. Source commits `5bfe2d2` and `9ae9ad2` pushed; [v0.2.8](https://github.com/VladimirKraswov/opencode-desktop/releases/tag/v0.2.8) tag and remote DMG digest match the installed/Downloads build. DMG SHA256 `d4f0d3caab31a8ca0ddc6d9479171a39bdbab922e3db42e8d7d22da95ec87378`. Previous installed app backed up twice, most recently under `~/.local/share/opencode-desktop/backups/0.2.8-before-dragfix-20260924-214747`. OpenCode server, models, user sessions and MCP processes were preserved. CT205 is a host for future MCP but currently has no MCP endpoint. See `docs/ATTACHMENTS.md` and `docs/VERIFICATION.md`; no pending work or automation for this release.

# OpenCode Desktop 0.2.7 — DONE

Microphone capture denial fixed: the old0.2.6 Hardened Runtime app lacked audio-input entitlement despite macOS permission ON. Added narrowly scoped signing entitlement, Russian capture diagnostics and startup cancellation guard. 171frontend tests, TypeScript/Vite and native release build pass. New artifact verifier rejects old0.2.6 and accepts final installed0.2.7; strict codesign/hdiutil pass, Hardened Runtime retained. Native microphone recording timer/waveform and cancel verified with no ASR submission. Full speech transcription was not repeated. All26preference categories/globalconfig unchanged;26scopes idle preinstall; OpenCode27982 and4MCP processes retained. Receipts .local/microphone-0.2.7. Source c04f053b2fc7a67c937689a8363418b62e913ef3 pushed and v0.2.7 released; remote tag and DMG SHA256 verified. Initial GitHub500 recovered on one retry. Installed0.2.7 and DownloadsDMG retained; previous0.2.6 backed up under ~/.local/share/opencode-desktop/backups/0.2.6-before-0.2.7-20260924-173755. No pending work or automation. Release https://github.com/VladimirKraswov/opencode-desktop/releases/tag/v0.2.7.

# OpenCode Desktop 0.2.6 — DONE

Full-page settings/navigation/search and app-global appearance implemented. Theme/accent/HEX, independent fonts, width/spacing, preview/reset, persistence/migration, explicit connection/ASR saves and retained JSONC staged edits/exit guards. 167tests, frontend and native release build pass. Browser both themes/max fonts at900x620, actual24pxchat/22pxcode, reload/draft/scroll2368.5 verified. Native installed0.2.6 verified palette/fonts+SQLite/reset, staging/exit/discard/hash unchanged, GigaAM, Cua grants/connected, search and Cmd+,. Original Compute Mesh preserved with empty draft; final UI shows Appearance for user. All14preference categories unchanged,5drafts intact, new appearance defaults14/14/12 neutraldark. Engine27982 and four original MCPs retained, all25scopes idle preinstall, no inference. Private receipts .local/settings-0.2.6; owned browser14/fixture4314/Vite1425 closed.

Installed /Applications/OpenCode Desktop.app, signed ad-hoc/strict verified, DMG hdiutil valid. Backup ~/.local/share/opencode-desktop/backups/0.2.5-before-0.2.6-20260924-165520. Executable87bd0855e095b0354d7f4174c5b713336221e760aac8c07ac4ee59e7eba934f1, DownloadsDMG7ad462b508845224d828c6c0589949efea868f7d16a0e830a65b5487e1c291e9. Source e0b2324f9dfe2a508e3f629afd286012c8061f82 pushed; v0.2.6 published, tag and remote DMG digest match. Release https://github.com/VladimirKraswov/opencode-desktop/releases/tag/v0.2.6. All work complete; no further testing/build or automation without a new request.

# OpenCode Desktop 0.2.5 — DONE

Cohesive assistant output implemented and final package installed. Engine steps grouped by request with compact progress, collapsed reasoning/tools, one final footer/copy and aggregate details. Final errors/compaction/partial output remain distinct; compaction starts folded. Stable anchors ignore hidden zero-size rows, live progress and navigation disclosure retained. Full157frontend tests, final TypeScript/Vite+Tauri build, strict ad-hoc codesign and hdiutil checks pass. Browser deterministic streaming/pagination/copy/dark+light and native real Compute Mesh29/19-action groups verified. Final native AX confirms collapsed compaction and correct summarycopy label. A stale native control pipe required CUA reset/rebinding after replacement; no engine restart.

Installed /Applications/OpenCode Desktop.app0.2.5, Downloads DMG SHA256ce4fbdf9d899906418ccdfd15ad126f0ee721c40c8cf43867c582cc775cc5edb, executable83190f6c007f363cf631c51c5282e0f39a46225f101f154db6a85bda83b59bf4. Original0.2.4 backup ~/.local/share/opencode-desktop/backups/0.2.4-before-0.2.5-20260924-161613. All25scopes idle before replacement. OpenCode27982 andMCPpreserved; all prefs/drafts/model/ASR/host/access/globalconfig unchanged. Compute Mesh remains selected; no prompts/inference. Owned fixture4314/Vite1425/browser13 closed. Private receipts .local/turns-0.2.5. Published v0.2.5 at d349aaf4ccfb414be07093b1c04504230038eac5; tag and remote asset SHA256 verified. No remaining work for 0.2.5.

# OpenCode Desktop 0.2.4 — DONE

Implemented stable streaming scroll/manual reading/jump, anchored history and remembered reading position, dated 60-message history disclosure, code/full Markdown copy, syntax highlight/local code editing, own-message edits via new engine fork+draft preserving history/profile/access. Fixed phantom project unread caused by hidden explore child; archived/deleted metadata reconciled and real unread roots remain visible beyond sidebar truncation. No parallel GPU or prompts sent in acceptance.

Verified:145 frontend tests/full build; final focused14 after review corrections; browser deterministic streaming/pagination/copy/light+dark/switchback; native installed0.2.4 actual history copy/jump, GPU Mesh no phantomdot; owned real fork preserved earlycontext/denyall/QwenMedium/agent and originalsource, draftcorrect. All test sessions archived, testprojecthidden, original @clip_cut_bot chat restored with emptydraft andGPU Meshexpanded. ASR/hosts/theme/access/model/agent andglobalconfig preserved, OpenCodePID27982 andexistingMCPleftalive. Receipts .local/scroll-0.2.4.

Tauri app+DMGbuilt. Initial linker-onlysignaturefailedstrictverification; rebundledsamebinary with explicitadhocsigningIdentity"-" (READMEcommandupdated). Finalcodesignstrict/hdiutilvalid. Appinstalled /Applications/OpenCode Desktop.app; backup ~/.local/share/opencode-desktop/backups/0.2.3-before-0.2.4-20260924-142806; DownloadsDMG SHA25680738a55250510020a17fc671b51b2bbd47126914501ac9c6af7a0ba2633285b.
Source commit b6148f7 pushed to main. GitHub release v0.2.4 published, tag points to the full source commit, remote DMG digest matches installed/downloaded receipt. Release https://github.com/VladimirKraswov/opencode-desktop/releases/tag/v0.2.4. Owned fixture listener4314, Vite1425 and browser12 closed; nativeapp remains open on originalchat. Noautomationresumed. All required work complete; do not rebuild or repeat acceptance without a new request.


# OpenCode Desktop 0.2.3 — DONE

Scope: project remove/restore, task handoff with important full-history context, and native Mac computer control with independent cursor. User authorized implementation, installation and GitHub publication. Read AGENTS.md and the local Qwen guardrails on resume. Do not restart external OpenCode, change model defaults or resume the completed heartbeat.

Implemented and independently accepted:
- Remove/restore projects without deleting data; server-scoped preferences. Native hide/restore passed.
- Handoff UI selects host/project/session, prepares editable context from an isolated tool-disabled full-history fork, archives/cancels only that fork, sends once or appends recipient draft. Real Qwen packet retained all eight early control facts, source unchanged; exactly one recipient message and reply; no parallel inference. UI fallback is intentional; no model-invoked cross-session discovery tool.
- Cua Driver 0.28.2 signed/notarized separately installed with user-approved Accessibility/Screen Recording. MCP proxy exposes 22 window-scoped background tools, preserves images, adds structured result text for OpenCode, simplifies exact-window schemas, gates every call, and provides emergency revoke. Explicit Connect recovers a revoked runtime; model tools never restart it or bypass other denials.
- Real Qwen controlled owned TextEdit note and independently verified CUA_BACKGROUND_OK_5729. Physical pointer stayed (1050,-1013), agent cursor (416,355). Owned sessions archived and note removed from user space into ignored .local artifacts. Other-Space input is a documented driver limitation. No foreground/desktop/remote/browser-profile controls.

Final source tests: 126 frontend and 15 Rust pass, fmt/diff checks and full Tauri release build pass. An earlier concurrent-build run timed out in unchanged R3; full isolated rerun passed without weakened assertions or timeout changes.
Final installed /Applications/OpenCode Desktop.app is 0.2.3; aliases and Downloads DMG retained. hdiutil verify and executable/DMG hashes match .local/install-0.2.3.json and docs/VERIFICATION.md. Final native reconnect after emergency stop passed; both grants shown, 22-tools MCP contract/permission check passed via installed binary. IgorPC restored with empty composer. All model/ASR/host/access configuration retained. OpenCode PID27982 remains unchanged. Backup path in .local/handoff-backup-path. Private evidence .local/computer-acceptance.json, installed-mcp-acceptance.json and handoff-*.

Source commit abf4e2e7b846f261d7aa4cc9d4f18b6ab5215f0c pushed to main; v0.2.3 release published and tag verified against that commit. Remote asset SHA256 matches the installed/downloaded DMG (3c304fcaf1334db32ca68012ee6f966ceb1d23d843a100e48732e68bea0ab34c). Release: https://github.com/VladimirKraswov/opencode-desktop/releases/tag/v0.2.3. No required work remains in this deliverable. Do not rebuild, repeat GPU tests, or restart the completed heartbeat without a new request.

## Latest follow-up — 2026-09-23, model access (DONE)

Owner cancelled OpenAI setup. Existing DeepSeek key verified by successful short
requests to both listed models. No OpenAI key was created or reused from Codex.
Configured opencode.ai + subdomains on the owner's server VPN (CT250), not the
unused local Mac proxy. Fresh Mac requests exit through Finland; geographic error
is gone on fresh OpenCode CLI connections, but Zen still returns FreeTierError403.
Seven auto-listed free models were unusable. No saved Zen key or active browser
login; the owner authorized hiding models when access could not be obtained.
Disabled only provider opencode via global config, preserving defaults and all
other fields, with backup. Waited for idle and verified no PTYs before config
cache reload. OpenCode process and VPN tunnel processes were not restarted.
Installed native picker now has exactly four models: two DeepSeek, Flash Next,
and V100 NInfer. Original chat and Flash Next selection preserved. No app rebuild.
Private probe/backup receipts are in .local/model-access; public summary is in
docs/LOCAL-MODELS.md. Do not re-enable the completed heartbeat.

## Current checkpoint — 2026-09-23, NInfer migration

The owner explicitly requested a NInfer fork, corrections and full replacement of
the active V100 llama.cpp deployment. This supersedes the historical HOLD below.
NInfer fork `VladimirKraswov/ninfer-v100` now runs as `ninfer-v100.service` on VM5100,
262144 context, NVFP4 v2, MTP4, prefill2048, KVint8, Vision. Service start/restart
passed. Old active GGUF/projector, standalone llama.cpp/runtime transfer and unit
were removed after acceptance; unrelated MIMIR/Gemma archives and CPU services stay.
The dormant MIMIR GPU unit is guarded against simultaneous startup.

OpenCode V100 ID/tunnel preserved; UI name updated, thinking budgets Low2048,
Medium8192 and XHigh24576. Real read/write/bash acceptance: independently8/8 tests,
unchanged test file. Medium/Low forwarding verified in server logs; OpenCode caps
output at32000. Native0.2.1 picker shows NInfer and Flash Next; Flash Next default
and original user conversation retained. No new app build/release is needed.
Fork qualification107/108 smoke cases with one exact string error; cold226022-token
Vision/retrieval test passed. See docs/LOCAL-MODELS.md and docs/VERIFICATION.md for
current evidence and old benchmark methodology corrections. No active work remains
on Desktop; do not re-enable the completed heartbeat.

## Historical 0.2.1 delivery checkpoint

Owner request: while a task runs show a spinner; after it finishes away from the visible, focused conversation show a yellow unread dot and one completion chime; clear it when the result is opened/read. Preserve this across projectless/project navigation, reconnect and app restart. User explicitly requires waiting for the currently running OpenCode task before packaging or replacing the installed app, reviewing that task's final work, then building DMG and updating the app.

Current installed app and published release: 0.2.0. Working source has version 0.2.1 but is NOT packaged or installed. OpenCode session to wait for: `ses_f3585ea15ffeVp5t3mUebj7Dmc`, local API `http://127.0.0.1:4096`, directory `/Users/vladimirkrasov/.local/share/opencode-desktop/chats/a06ebf26-abad-4b99-8cad-f7997c62d2ae`. Its assignment is a real V100 llama.cpp vs NInfer benchmark; on 2026-09-22 22:08–22:12 Moscow it was still `busy`, working on NInfer dependencies/model download. DO NOT abort, restart or send it prompts, do not make concurrent GPU inference requests.

Implemented in working tree: global OpenCode event stream complements the selected-directory stream; activity transitions tracked by session; unread per server persisted with session directory; project rows surface unread work; projectless index and session rows show spinner while busy and yellow dot only for completed unread; visible/focused chat at bottom auto-marks read; native fixed macOS completion chime once per background completion; reconnect polls previously busy session directories. Added focused tests for busy→idle→read, duplicate guard, active/inactive window, scrolled-up reading, projectless navigation, stale host and global SSE envelope. No installed app change.

Additional user scope: make the composer closer to Codex (left command/access, right model/effort/agent/mic and filled Stop), add genuinely functional settings for OpenCode tools/skills/plugins/MCP/agents, and connect the local CPU ASR. Source now includes JSONC-preserving global/project config editor with native atomic compare-and-save + backup; API inventories; plugin npm package, skill HTTPS source, remote MCP, tool permissions and default agent controls. Browser preview visually inspected, but native write/apply UI is not yet tested. GigaAM v3 CPU on CT 201, 192.168.31.59 was checked by health and multipart speech requests; a real `audio/mp4`/M4A roundtrip recognized «Проверка диктовки на компьютере» exactly in 0.55 s. Set as default ASR for 0.2.1. See docs/SETTINGS.md.

The currently installed 0.2.0 app was also safely configured through its existing settings UI on 2026-09-22 ~22:42 Moscow: ASR endpoint 192.168.31.59:8080/api/asr/v1/audio/transcriptions, model gigaam-v3-e2e-rnnt, language ru. Reopened settings to verify persistence, then returned to the ongoing chat; the benchmark remained running. No app or OpenCode server restart occurred. Thus dictation is available now, before the 0.2.1 installation.

New owner requirement 2026-09-22 ~23:05 Moscow: only **after** V100 tests finish and the final configuration is selected, expose its Qwen3.8-27B model in OpenCode Desktop alongside the current Qwen Flash Next, never replace Flash Next/default. Read-only inspection: `~/.config/opencode/opencode.jsonc` already has `local-qwen38/qwen3.8-27b-coding` at `http://127.0.0.1:18005/v1`, tunnel listens, and `/provider` currently lists it and `local-qwen-next/qwen38-flash-next`. This is the pre-benchmark RVN Q5_K_M GGUF configuration; it is NOT proof that the final V100 NInfer model/endpoint will match. Do not edit config, restart OpenCode, or call V100 inference while benchmark busy. Once benchmark is fully complete/reviewed, verify final service endpoint, served model ID, real context/Vision capabilities, add or update a distinct OpenCode V100 provider as appropriate while preserving the Flash Next provider and default, and verify both models appear/select and one short V100 request works. Include result in docs/release acceptance.

Additional quality requirement: configure the V100 model for OpenCode using its **own measured** context/output limits, supported reasoning variants, tool-call and Vision behavior, and generation parameters. Do not copy the Flash Next limits or agent prompt blindly. If the chosen V100 engine needs a distinct coding agent, add it without replacing the Flash Next default. Switching models must not leak the other model's effort or context meter state.

Source fix completed 2026-09-22 ~23:16 Moscow: existing-session model/effort and agent choices are now scoped to that session; directory preferences remain the defaults for new chats. Model switching resets effort to the new model's Medium variant when available, rather than carrying a prior model's effort. The context meter reports unknown usage until the selected model provides its own token report instead of applying a previous model's usage to the new context limit. Three new regression tests failed before the fix and pass after it. `npm test -- --run`: 96/96; `npm run build`: pass; `git diff --check`: pass. This is source-only and not packaged/installed. Read-only `/session/status` at ~23:16 still reported benchmark `busy`.

User requested Mac stay awake during ongoing tests. At ~23:50 Moscow started `/usr/bin/caffeinate -d -i -u -t 28800` (PID 84646), verified with `pmset -g assertions` that idle display/system sleep is prevented. It expires automatically after 8 hours; when task completes earlier, stop only this PID if it is still the same caffeinate process. No persistent lock/screen-saver settings were changed.

At ~23:51 Moscow the user additionally requested disabling automatic Mac lock permanently. In macOS System Settings, changed battery inactive display-off from 1 hour to Never (AC was already Never) and screensaver start from 20 minutes to Never. Verified both display-off settings show Never, `pmset -g custom` shows `displaysleep 0` on battery and AC, and `defaults -currentHost read com.apple.screensaver idleTime` returns `0`. Password requirement after explicit/manual lock remains Immediately; it was not disabled. The temporary caffeinate assertion still expires after 8 hours, and may be stopped earlier at completion; **do not restore the permanent Never settings**, which the user requested.

Verification at 22:37 Moscow: 93/93 frontend tests, TypeScript/Vite build, cargo check/fmt, 6/6 Rust tests pass (including stale-write rejection and backup recovery). Browser preview visually checked composer and settings; source stages config key changes and requires an explicit Apply/Cancel before native save. Native write/apply UI still needs testing after OpenCode task completion. The active benchmark session remained busy at ~22:36. Installed app remains 0.2.0; no DMG has been built. Existing heartbeat automation opencode-desktop is ACTIVE every 10 minutes and updated for this scope. After benchmark finish, review report/CSV and acceptance: baseline vs NInfer, Qwen3.8-27B comparable quality, ~262K or ~200K context with strong improvement, long-context/Vision/stability/rollback. Then native test, package/install 0.2.1, docs, commit/push/release under prior authorization. Do not confuse source-ready with installed.

## FINAL — 2026-09-23

- Benchmark campaign finished. Independent raw-data check: llama.cpp 116/116; NInfer 113/116, including reproducible code and fine-detail Vision regressions. NInfer was 1.42–1.95× faster in decode and 1.62× in the 225K cold end-to-end probe with full 262144 context, but the no-regression quality requirement chooses HOLD. `llama-v100.service` is active, NInfer stopped. Full evidence: `/Volumes/Extend/work/ninfer-v100-benchmark/results/2026-09-22/REPORT.md`.
- Added a persistent `dev.vladimir.qwen-v100-tunnel` on localhost 18021 to VM 5100 port 8080. OpenCode global config now serves `local-qwen38/qwen-v100` (Q4_K_M, 262144 context, 229376 input, 32768 output, Medium and Vision) with `qwen-v100-build`; Flash Next and `qwen-build` remain defaults. OpenCode was restarted once after all active sessions finished to reload its provider cache; health and historical sessions recovered. A short OpenCode test request recorded the V100 provider/model. Local config backup: `~/.config/opencode/opencode.jsonc.backup-20260923-v100`.
- Native 0.2.1 test found and fixed project-row restoration leaving a completed session unread after showing its answer. Regression test added. Final full tests 97/97, six Rust tests, production build and `git diff --check` passed. Native source candidate verified V100 model/agent/context, real read-tool chat, busy→unread→read, settings inventories, JSONC backup/comment preservation and stale-write rejection. Rebuilt candidate repeated the unread scenario successfully.
- Final DMG `OpenCode Desktop_0.2.1_aarch64.dmg` passed `hdiutil verify`, SHA256 `387826b644f8d199024b9e6e2716364852f167b3387f8d00eceaddaa977ae4c2`. Installed `/Applications/OpenCode Desktop.app` 0.2.1; `~/Applications` and Desktop aliases intact, old Qwen launcher intact. Old 0.2.0 backed up under `~/.local/share/opencode-desktop/backups/`. Installed app displayed connected OpenCode 1.18.18, open SSE, configured GigaAM ASR and preserved benchmark conversation. Same DMG copied to Downloads.
- Source commit `471e78082072ee152c931e61e8617f16573b18d9` pushed to `main`; GitHub release `v0.2.1` published with matching remote DMG digest. See `docs/VERIFICATION.md` and `docs/LOCAL-MODELS.md`. No required work remains; stop the `opencode-desktop` heartbeat.
