# Windows Cua Driver source review — 2026-10-05

The owner's `OpenCode-Desktop-Windows-admin-2026-10-04.zip` was inspected as
source material. Archive entries were checked for absolute paths, traversal,
backslash paths and symlinks before extraction into a test-owned output directory.
Archive SHA256:
`9ff248fee1be3dae19a8f174f4fad4b5e2f453b1a4dde65dcd0d9e36d22195d7`.
The complete Git bundle passed `git bundle verify`; its Windows branch ends at
`a36afa264ba665329813e34b930550646e297e83`. The initial Windows port was already
integrated in main. This follow-up adapts the computer-control source from
`eaa4a4dd74f06b1b426fd9bd9b60eaf4ae4134c6`, rather than replacing main with
the bundle or applying the original port twice.

## Imported and reviewed behavior

- Windows discovers the official per-user Cua Driver installer location, an
  unversioned binary installation, or the newest numeric version under
  `%LOCALAPPDATA%\Programs\CuaDriver`. Discovery checks at most 256 directory
  entries, requires absolute `LOCALAPPDATA` and never searches the working
  directory or executes a shell.
- Readiness requires the driver's interactive-session, UI Automation and visible
  window probes. Missing or failed probes remain unconfirmed. Each native driver
  command retains the existing 15-second timeout and bounded captured output.
- Disabling Windows computer control closes Desktop's own gate; it does not
  revoke unrelated driver sessions. macOS retains its signed driver path,
  permission onboarding and emergency-revocation behavior.
- Linux returns an explicit unsupported status for native-window control instead
  of reporting a missing macOS permission. Browser automation is a separate
  integration and does not depend on this native-window driver.
- Every window mutation requires an exact positive PID/window ID. Cursor movement
  uses the driver's structured window target. Conflicting or invalid identities,
  desktop scope and foreground delivery are rejected.
- Mutation schemas are checked before rewriting. Incompatible malformed schemas
  are omitted, without panicking. Removed schema properties are also removed
  from `required`, so the advertised schema remains usable.

The archive's Windows-only, InPrivate WebView2 browser and its default-browser
fallback on macOS were not imported into this driver. It provided neither a
persistent browser profile nor DOM/browser-tool integration. The archive's
Windows live reports are historical evidence, not a rerun of this integrated
source. Driver binaries and installation of OS permissions remain separate.

## Verification on Mac

- `npm test -- --maxWorkers=1 test/computer.test.ts`: 6 passed.
- `cargo test --lib computer::tests -- --test-threads=1`: 15 passed, including
  malformed schemas, window identity validation, Windows discovery and doctor
  fixtures, existing MCP result/image preservation and permission gates.
- Read-only installed driver check: `cua-driver 0.28.2`; its permission status
  reported Accessibility and Screen Recording granted. No TCC grants, model
  configuration, sessions or global OpenCode configuration were changed.

Windows native build, doctor, packaged MCP and background input have not been
rerun for this integrated source. Linux packaging and native driver support
are not asserted. Full product checks and browser acceptance are recorded
separately by the coordinating task.
