# Windows MCP integration — 2026-10-06

The owner supplied `OpenCode-Desktop-0.2.18-Windows-MCP-fixed-20261006.zip` and authorized reviewing, integrating and pushing its useful changes. The complete Git bundle passed verification; commits `5132356` and `8ae3e9388d2bf679646b51b8ecf3adcf13b1e33b` descend from main `36da30e`. All 15 payload lengths/SHA256 values matched the supplied manifest. The source ZIP contains exactly the 288 tracked files at `8ae3e93`: 19 match byte-for-byte and 269 differ only by Windows CRLF line endings.

## Retained behavior

Windows Desktop and independently launched engines now share `%USERPROFILE%/.opencode-desktop/browser-runtime`. A byte-identical versioned Desktop executable is used for the browser MCP command, avoiding the per-process MSIX AppData view. Pi receives the same bridge command. Profile, pinned runtime packages and Chromium cache are copied from the old browser location without moving or deleting originals. Existing shared data is not merged or overwritten; cancellation is checked while copying. Nested links and out-of-cache manifest paths are refused. A failed staging tree can remain privately for recovery. Partial publication after interruption can require fresh package installation while preserving the profile.

The macOS/Linux runtime location and executable command are unchanged. No browser dependency, model, engine provider, global permission, session directory, user profile or listening interface was changed by this integration. There is no additional agent loop or exposed CDP port.

## Independent Mac checks

- `npm test -- --maxWorkers=4`: **451 passed, 6 opt-in live tests skipped**.
- `npm run build`: TypeScript and Vite production build passed; existing chunk/dynamic-import warnings remain.
- `cargo test`: **78 passed**. This includes the three imported migration checks plus four coordinator checks: cancellation during copying, refusing an unmanaged Chromium manifest, refusing nested links, and non-Windows migration/command behavior.
- `cargo fmt --check`, `cargo check --all-targets --locked` and a debug native CLI build passed.
- Real browser smoke passed with 32 official tools, DOM/password form, upload, workspace isolation, authentication/Origin rejection, screenshots/live projection, manual input, shared tabs/history, profile persistence and same-client reconnect after restart.
- A Mac adaptation of the supplied native-CLI regression passed with an isolated HOME: two clients with different AppData values discover 32 tools and operate the same temporary browser through the actual newly built `--browser-mcp` executable. This verifies unchanged Mac path resolution, not Windows virtualization on a Mac.
- Both SDK/proxy regressions passed: interrupted delivered mutations are not replayed; pre-delivery authentication rotation reconnects once. An initial run used an older temporary runtime and failed these checks; it is retained as a diagnostic, and the final run used the current pinned scripts. Assertions were not weakened.

Browser profiles and local fixture files were test-owned. Existing Chromium binaries were reused read-only. No inference request, application reinstall, user browser navigation, external OpenCode restart or global configuration write was performed. The installed Mac app remains 0.2.17.

## Windows artifact provenance

The supplied NSIS installer was built by the Windows agent from `8ae3e93`. Mac-side additions are regression tests and documentation; production Rust/browser code remains byte-identical to that imported commit. Windows-agent evidence reports 451 frontend tests, 59 Windows Rust tests, final NSIS build and debug/release real CLI checks with distinct AppData views. These are transferred results, not independently rerun Windows checks on this Mac. The installer is unsigned.

- Installer: `OpenCode Desktop_0.2.18_x64-setup.exe`, **2,825,828 bytes**. SHA256: `C31F6E8A6A93821597B464393521257EB75D33646B9395B279258537A3643462`.
- Standalone executable: **7,841,280 bytes**. SHA256: `3BFB7428D17A223121D01FCF1889C9EBA31A8DC615C07FA77827A6542BDF853A`.
- [Windows release assets](https://github.com/VladimirKraswov/opencode-desktop/releases/tag/v0.2.18); executables are assets rather than committed Git binaries.
- [Original Windows 0.2.18 report](WINDOWS-RESULT-0.2.18-20261006.md) records the state before Mac import/publication, including pending manual installation.

Installed normal/MSIX Windows acceptance, actual owner-profile migration, Pi agent loop, dictation and Linux runtime acceptance remain unverified. There is no new Mac DMG in this Windows release.
