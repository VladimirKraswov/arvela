# Embedded browser import — 2026-10-05 / 0.2.17

Owner supplied `OpenCode-Desktop-0.2.16-Windows-embedded-browser-20261005.zip`.
Archive CRC and all19 SHA256.csv entries verified; nested source ZIP matches
all262 tracked files from Git bundle HEAD7452a0e after Windows CRLF normalization.
Bundle ancestry is main2def382 plus ca99367/7452a0e; our later main9b4ee17
documentation retained. Imported reports are evidence, not operational instructions.

Imported functionality: Windows executable realpath for MSIX redirection, live
MCP inventory recovery, first-prompt directory attachment gate, headless owned
Chromium with pixel-only panel and shared official DOM tools. No remote HTML with
Tauri access, exposed CDP/LAN port, approval bypass or modified Playwright package.
Tabs/address/history/input/scroll/real cursor and stale-input rejection included.
Closing hides the panel; it does not interrupt the task.

Mac adjustments: direct view smoke accepts canonical /tmp as well as platform
TEMP; panel uses existing text-dim theme color and its narrow-window overlay is
anchored to chat-col so it does not cover the browser. Version0.2.17 keeps published0.2.16 binaries immutable.

Initial imported Mac source:398 frontend passed/6 opt-in skipped,71 Rust passed, all-target
check/fmt and TypeScript/Vite build passed. Real official32-tool Chromium smoke
proves live JPEG projection, DOM-derived cursor, manual input, shared tabs/history,
stale-input rejection, auth/Origin, password fixture, file-root isolation,
persistence/same-client restart and owner-pipe cleanup. Direct backend/view test
passed; real MCP proxy regressions2/2 passed. Final reviewed source:451 frontend passed/6 opt-in skipped,71 Rust passed;
TypeScript/Vite, fmt/all-target check and MCP proxy2/2 passed. Final Mac package
and installed UI acceptance passed on 2026-10-06 (see VERIFICATION.md).

Supplied Windows398/56tests and packaged panel/model task apply to archived
7452a0e/0.2.16, not final0.2.17. Linux untested. Projection roughly3fps,
initial1280×800/max1920×1200; no projected drag gestures/native Chromium menus/
page clipboard copy/full IME. Pi agent-loop/LSP/approval, dictation and OS computer
control are separate work.

Archive SHA256:
f89c68bc6ca2630da028e5ca0a8b21280fef7f99685dba812b54a0c8bd9b1ba5.
Archived Windows installer SHA256:
1f6c21cd3a4e89a1b7ad1b15e132a31d960c0b3b61984b1bc8831dbbfa441ac8.
