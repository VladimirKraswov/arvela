# Windows managed browser repair — 2026-10-05

Base: upstream main `2def38234eb4e06a6cf1f39d2e30edb4aed01703`, Desktop 0.2.16.
Requested scope: read the latest Desktop session, fix its managed browser,
verify and produce an offline administrator handoff. No remote push.

## Session findings

Reviewed the latest session's 151 messages, user/assistant text, tool inputs,
results and failures. Initially the agent used webfetch then CUA/Cent Browser,
which was not the managed browser and could not reliably scroll in background.
Official desktop_browser navigation then failed with `spawn UNKNOWN`.
Windows reported a SideBySide assembly-resolution error, not a missing exe.
The files existed, and the same Chromium binaries launched outside the virtual
AppData alias. Changing ACLs and adding manifests did not resolve it.

The agent moved the cache, created a junction, set a global Playwright variable,
patched Playwright's coreBundle.js and killed proxies. Direct private HTTP RPC
subsequently worked, but this bypassed the OpenCode integration. The final
official calls remained unavailable; the response was aborted. OpenCode's live
directory-scoped inventory confirmed `failed / Connection closed` while Desktop
had cached an earlier successful attachment. Session/site data is not included
in this report or the archive; no tokens, credentials or full transcripts.

## Source repair

1. Before launching Chromium on Windows, resolve its executable with
   `promisify(realpath.native)`. Unlike JS realpath, this handle-based API
   resolves MSIX AppData redirection. Pass the resulting executablePath to the
   official launcher. Non-Windows launches are unchanged. No hardcoded account
   or package paths, no extra download, no sandbox/permission weakening.
2. Recheck `/mcp` for a cached directory attachment. Leave connected proxies
   alone; reconnect only a confirmed missing/failed proxy. Inventory errors
   surface honestly without restarting a potentially healthy proxy. Calls stay
   scoped to the selected local directory and stale callers cannot publish.
3. Managed browser skill explicitly prohibits the failed workarounds: editing
   dependencies, killing proxies, global env changes, separate runtimes and
   falling back to shell RPC/CUA for this workflow.
4. Headed smoke accepts a read-only binary directory to reproduce Windows
   virtualized paths while all profiles/files remain test-owned.
5. Installed Pi acceptance closes its own fixture's HTTP connections before
   awaiting server shutdown: the shared browser stays alive and could otherwise
   leave this standalone test runner waiting indefinitely. No forced success exit.

The session's Playwright package modification was removed locally; its SHA256
matches the unmodified pinned dependency in the acceptance runtime. The exact
session-created global PLAYWRIGHT_BROWSERS_PATH override was removed. Existing
browser cache junction and profile were retained, not deleted or migrated.
Fresh virtualized-cache smoke proves the repair does not depend on that junction.

## Verification

- Frontend: 377 passed, 6 opt-in skipped. Two recovery regressions added; existing
  no-restart assertions now distinguish GET inventory from POST attachment.
- TypeScript/Vite build passed; existing chunk-size/dynamic-import warnings.
- Rust: 55 passed; Windows unsupported Agent Control dead-code warnings remain.
- Cargo format and Git whitespace checks passed.
- Reproduction: old launcher fails via nominal AppData alias; native resolved
  package path launches the identical binaries with chromiumSandbox enabled.
- Official headed MCP smoke passed twice: relocated-cache junction and a fresh
  non-junction AppData cache. 32 tools, lazy startup, reveal preserves page,
  bearer/Origin protection, DOM clicks, password fixture, uploads, workspace
  isolation, screenshots, persistent profile, same client after restart, and
  owner-pipe cleanup. No inference or user credentials were used.

- NSIS build and silent reinstall succeeded. The installed binary contains the
  new launcher and refreshed the managed scripts without replacing the profile.
- Native toolbar opens the managed Chromium. Live `/mcp` changed from
  failed/Connection closed before repair to connected in the same latest chat.
  A controlled directory-scoped MCP disconnect followed by the toolbar button
  changed disabled back to connected, with no server restart or model request.
  Original session still contains 151 messages; no messages were submitted.
- Installed app `--browser-mcp`: 32 tools, real public Litmarket navigation and
  snapshot passed. Real Pi 0.85.1 loader/argument validation registered 32 tools
  and navigated/snapshotted a local fixture; cleanup and process exit passed.
- Proxy transport: 2 passed, including never replaying a delivered mutation.

Installer hash is recorded in the handoff REPORT.md. This release uses a separate app-owned
Chromium window, not an embedded WebView panel. Browser tools operate without
desktop mouse input; arbitrary OS/CUA control still has background limitations.
Pi agent-loop, dictation, Agent Control/Factory and Linux acceptance are outside
this browser repair and are not presented as newly verified.
