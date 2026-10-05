# Browser runtime acceptance

The shipped dependencies are pinned by `../package-lock.json`: Microsoft's
`@playwright/mcp` 0.0.83, its matching Playwright Chromium build, and MCP SDK
1.32.0. The native installer runs `npm ci --ignore-scripts` in a private staging
release, explicitly installs Chromium into the app-owned browser cache, verifies
versions/executable, and publishes the release after success. It preserves the
profile and previous release on failure. No global npm package is installed.

Official API provenance:
- https://github.com/microsoft/playwright-mcp
- https://www.npmjs.com/package/@playwright/mcp/v/0.0.83
- The package's `index.d.ts` exports `createConnection(config, contextGetter)`.
- The official backend captures its workspace on first tool call. The bridge
  therefore uses a separate backend per workspace, one shared persistent Chromium
  context, and a single tool queue. Each workspace has a private output directory.

## Real headless Chromium and in-app projection

Use an already installed **test-owned** runtime under `/tmp/oc-browser-*` or the
platform temporary directory. Its `current` directory must contain the runtime
scripts, pinned `node_modules`, and the downloaded browser must be under
`browsers`. Stop any previous test daemon first. Never pass the user's app profile.

```sh
node src-tauri/resources/browser/test/smoke.mjs /tmp/oc-browser-runtime-20261005
```

An optional second argument supplies a read-only Chromium binary directory.
On Windows use the virtual AppData alias (not its resolved package path) to
regress MSIX `spawn UNKNOWN`. All profiles/files remain in the test-owned temp
runtime. The 2026-10-05 Windows run passed both with a junction to the relocated
cache and with a fresh cache under virtualized AppData; the latter failed with
the old launcher and passed with native executable path resolution.

This script launches only its own daemon and local HTTP fixture. It checks lazy
startup, bearer authentication and Origin rejection, official DOM navigation and
fresh snapshot references, form entry including a test password, clicks, file
upload, isolation between two project workspaces, image screenshot content,
profile persistence after a daemon restart, and reuse of the same SDK client
across that restart. Revealing the panel preserves its URL and form. The current
smoke checks JPEG frames, agent/user cursor ownership, panel text input, the
agent following manually selected tabs, and back/forward/reload. `view.mjs`
directly tests official-backend initialization and first-tab synchronization.
`installed-panel.mjs <installed-app-exe> <managed-current-runtime>` opens a
test-owned local fixture in the installed panel and waits for manual/UI input.
Type PANEL_UI_OK, click its verification button, then send `verify` to the
runner. It confirms real DOM input/result through the installed MCP CLI,
without inference or global configuration writes. Coordinate this live
shared-browser navigation with the user.
It closes its children, clients and fixture in `finally`. Password values,
snapshots, auth tokens and image bytes are never written to test output.

## Installed macOS app and real Pi loader

Wait until the installed Desktop has completed browser setup and its daemon is
running. This acceptance uses Pi 0.85.1's actual extension loader and the app's
real `--browser-mcp` CLI. It navigates the shared browser to a local fixture;
coordinate this with the user rather than replacing an unrelated active form.

```sh
node src-tauri/resources/browser/test/pi-packaged.mjs \
  '/Applications/OpenCode Desktop.app/Contents/MacOS/opencode-desktop' \
  "$HOME/.local/share/opencode-desktop/browser-runtime/current"
```

The test checks 32 official tools register, a real navigation succeeds and the
snapshot observes the fixture. It creates no prompt, model request, Pi session
history or global configuration. It closes only its SDK proxy and fixture,
leaving the user's app-owned daemon running. This validates the loader/transport;
Pi tool approval and agent-loop behavior are covered by their separate tests.

Windows and Linux paths/process handling are implemented, including a Windows
kill-on-close Job Object. The headed smoke has also passed on Windows (see
`docs/WINDOWS-BROWSER-FIX-20261005.md`). Linux remains unverified.
