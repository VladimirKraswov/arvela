# Windows in-app browser panel — 2026-10-05

Base: upstream main `2def38234eb4e06a6cf1f39d2e30edb4aed01703` plus
`ca99367` Windows browser launch/MCP recovery repair. Desktop version 0.2.16.
User requested a browser inside Desktop, not a separate external Chrome window.
No remote push. Administrator handoff includes both changes since upstream.

## Implementation

- Headless app-owned Chromium with existing persistent profile, official
  unmodified Playwright MCP 0.0.83 / SDK 1.32.0 / 32 tools. Windows native
  executable realpath fix retained. No external Chrome UI or extension needed.
- React Browser panel displays the actual Chromium viewport as JPEG frames,
  approximately 3 Hz, bounded to 1920×1200. It is a live pixel projection,
  not remote HTML inside Tauri. The agent still reads real DOM/accessibility
  layout and can evaluate page content through official tools.
- Tabs, address, back/forward/reload, click, plain text/paste, scrolling and
  basic keys. Agent/user cursor coordinates come from actual element bounds
  or official coordinate-tool arguments. DOM-only operations do not fake
  pointer motion. Hiding the panel does not interrupt the task.
- One tool queue and per-workspace official backends. Backend lazy context
  initialization is handled with a read-only snapshot before tab selection.
  Manual tab selection is synchronized before the next agent action, including
  across project connections. Filesystem roots remain separate.
- Authenticated loopback frame endpoint, coalesced captures independent of
  long agent calls, bounded native input allowlist and main-window guards.
  Page identity/URL/agent revision reject stale queued manual input. No CDP
  listener, LAN binding, browser sandbox disablement, CSP/capability expansion,
  tokens in React/URLs/logs, remote HTML, fake success or custom agent loop.
- Panel auto-reveals once when Chromium opens. Hidden-panel presence checks
  do not capture pixels or launch Node probes. Async polling does not overlap
  and stops on unmount/remote switch. Input is not automatically retried.
- First native local prompt awaits directory-scoped MCP configuration; remote
  requests never attach local browser tools. No inference/model/global
  permission settings changed.

## Verification

- 398 frontend tests passed, 6 opt-in skipped. Frame validation/scaled
  coordinates, panel actions/polling/lifecycle/remote gating, toolbar reveal,
  first-prompt readiness and remote non-attachment regressions added.
- 56 Windows Rust tests passed; cargo check and formatting passed. Bounded
  input validation rejects privileged URLs, arbitrary tools, invalid
  coordinates/keys/tabs and oversized text.
- Official Chromium smoke passed: real JPEGs, DOM-derived agent cursor, manual
  text observed by agent snapshot, shared tabs, history, stale-input rejection,
  auth/Origin rejection, passwords in disposable fixture, uploads/root isolation,
  screenshots, persistence/restart/client reuse and owner-pipe cleanup.
- Direct official-backend/view initialization passed (`DIRECT_VIEW_OK`).
- Proxy transport regressions: 2 passed; delivered mutations never replay.
- TypeScript/Vite and final NSIS build passed; silent install exit 0. Installed
  binary SHA256 `6986CCC4035DAA367D718B1135886F77A23C378D1368746A9DAB6F435DFF633D`
  matches the binary extracted from NSIS (the post-bundling release-path
  executable hash differs due to Tauri bundle metadata patching).
- Installed daemon/view scripts hash-match source and upgraded without npm
  reinstall or profile replacement. Native Browser button shows a live panel
  inside Desktop. Main Chromium process reports `--headless`; no managed
  Chromium top-level window appears. External engine remained healthy.
- Through native UI, entered a public URL in the panel, then clicked a local
  fixture input, pasted PANEL_UI_OK, clicked its button and scrolled. Actual
  installed CLI MCP snapshot/evaluation confirmed both input and result DOM
  equal PANEL_UI_OK, with 32 tools and the same live projection. Screenshot
  observation confirmed scroll movement and real user cursor.
- Single first-prompt live task passed on local Qwen3.8 Flash Next, Medium:
  navigate → snapshot → evaluate document.title/document.links → click actual
  Learn more snapshot target → snapshot → evaluate final URL/title. Six real
  completed official browser calls, no tool errors/fallbacks, one user prompt.
  EMBEDDED_BROWSER_OK, final URL `https://www.iana.org/help/example-domains`,
  title Example Domains, one link on the source page. This also verifies the
  new-chat first-prompt MCP readiness gate without asking the model to retry.
  Desktop remains open on the answer with IANA visible in the Browser panel.
- Original user session still has 151 messages. Private browser/WebView/config
  backups were retained locally, never included in the handoff. No other
  inference jobs were dispatched for this feature.

Existing Vite chunk/dynamic-import and Windows unsupported Agent Control
dead-code warnings remain. No private sessions, credentials, live ready.json,
browser profiles or logs with page content are distributed.

## Limits

This is a first in-app projection, not an Electron/native remote-HTML webview.
No projected drag gestures, native Chromium menus, page clipboard copy or full
IME composition. Agent DOM tools remain available for richer interaction.
Shared browser tasks must coordinate and inspect the current page. The fixed
initial viewport is 1280×800; screenshots can reflect official-tool resizes up
to projection bounds. macOS/Linux panel acceptance was not rerun on Windows.
Pi agent-loop/approval, dictation, OS CUA and Agent Control/Factory remain
separate work, not newly claimed as completed by this browser feature.

## Offline integration

The handoff contains a full-history Git bundle, source ZIP, email patches and
combined diff from the base above, Windows installer and verification logs.
Verify SHA256.csv before use. On a Mac, inspect the patches/source, then fetch
the bundle into a review branch or apply the email patches in order. Do not
force-reset an existing main or drop local changes. Run target-platform tests
before merging/pushing. The source contains no machine-specific account paths.

Installer SHA256:
`1F6C21CD3A4E89A1B7AD1B15E132A31D960C0B3B61984B1BC8831DBBFA441AC8`.
