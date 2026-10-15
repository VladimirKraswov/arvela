# Hub updates — 0.2.56 acceptance

Runtime commit: `9ac6e15a0c687dc6795d23c466f9498ceee8f8d7`.
Source and UI published through the canonical `npm run release:hub -- stable`.
The configured CT206 Hub was backed up before deployment; a copy of its real
SQLite database passed migration, unchanged row counts and integrity checks.
Production TLS/auth/catalog worked after restart. Service RSS about70MiB; release
storage77MiB at verification. No owner prompts, model inference or GPU changes.

- Frontend:818PASS,6existing skips. Native:122PASS,3opt-in skips.
- Hub:45PASS both locally and on Debian CT; publisher:3PASS.
- Strict Clippy, TS/Vite, architecture155modules, bundle budgets and diff gates PASS.
- Actual Chromium:green/hot and yellow/source UI, busy defer/cancel, shared Web Lock hold/release PASS.
- Signed source/UI fetched afresh from production HTTPS; native pinned-key verification and exact source fingerprint PASS.
- Isolated native harness compiled the actual asset provider/packet/verifier:
  signed activation, served bytes, health ack, cache restart and tamper fallback PASS.
  Its private fixture was never published and did not access owner app data.
- Clean npm-ci rebuild from the signed snapshot produced the macOS app and DMG.
  Dependency compiler caches were reused; source/node_modules were separate.
- App strict signature/microphone capability, DMG checksum, updater archive
  extraction/binary equality and native version-bound updater signature PASS.
- Public legacy feed0.2.56 and freshly downloaded GitHub updater archive matched
  the local SHA and passed the native pinned-key/version verifier. Own Vite fixture stopped.

Native fingerprint:`03dbdbccb64f830440f65328f96e9de9ec5fafc0ce172ae153bb495c33c6929c`.
Hub UI payload SHA256:`eee00936adea81db4c9342a29a1430e05f1dd95eda43caf25069163aafcbd636`.
Hub source payload SHA256:`4cdb5b0e75edeea3896e1d66dc81ecf66d61e37b60e688e92264ef6f8159e386`.
Executable SHA256:`1d3d2f11f569500ea1e3b1762d67ad8f764a3998db9cb8642f78177d39067e66`.
DMG SHA256:`3bb968c66483ffe6bac297161a8d1a9ca9b73071f46b1c68450167abf616b5f2`.
Updater archive SHA256:`4fa8bdf3834c53dcc2cc6f792b43b58988bdee2b29aa32a142ca68147e42c697`.

## Explicit remaining acceptance

The owner app remains0.2.53, PID27578 was preserved. No active work was stopped.
New packaged/standalone binaries launched from Codex fail LAN TCP with errno65;
the old app and Python succeed with the same origin/certificate. This is consistent
with macOS local-network privacy/identity attribution; a first normal GUI launch
and permission confirmation is still needed. Do not claim the new app's live LAN
connection or tray clicks/active-agent update have been proven on this OS.
Windows/Linux installer execution and live agent continuity are unrun.
See HUB-UPDATES.md for prerequisites, first transition and recovery boundaries.
