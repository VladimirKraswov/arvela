# Platform acceptance — current source, not inherited release checkboxes

A CI package proves compilation, unit/contract tests and artifact checks. It does
not prove installation, live agents, OS vault permission or interaction. Record
commit, artifact SHA256, OS/architecture, CLI versions, scenario and result in a
new verification receipt. `not-run` stays not-run; an older report is historical.
Use disposable folders, independent test sessions/profiles and an unused loopback
port. Never abort an owner session, change provider defaults or run a local model
without explicit availability. A cloud test must use synthetic data and existing
owner authorization. No credentials in receipts or screenshots.

## Common checklist (macOS / Windows / Linux)

- [ ] Install/upgrade the exact artifact; preferences, prior chats and app identity survive.
- [ ] About shows current app version and separately detected OpenCode/Pi versions.
- [ ] Existing external OpenCode is reused; app exit does not kill it. On an unused test port, absent server is started once; absent CLI offers installation.
- [ ] Local OpenCode and Pi each complete an isolated text/tool task, stop correctly and show their real permission/error states. Changing engine does not reinterpret another engine's transcript.
- [ ] Missing Pi/Node and absolute paths with spaces/non-ASCII have actionable errors. App-owned subprocesses exit without touching unrelated processes.
- [ ] Attach/paste/drop image and text; cancel file dialog; dictate start/stop with attachments and narrow composer. No claim about unsupported modality without conversion evidence.
- [ ] Shared skill/MCP discovery is scoped; permissions are respected. Project memory is off by default, searches only approved current records after opt-in, and revocation blocks already-open MCP. Offline Hub does not prevent revocation.
- [ ] Hub catalog/history and OS credential access work after restart; transmission off stays off and errors do not silently drop queued data. Use only synthetic records for test writes.
- [ ] Browser fast/emulation modes, stale resize/scroll refusal, detached observer, restore, manual input and close work without owner/profile changes.
- [ ] Existing SSH strict-key connection uses its own endpoint; failure does not fall back locally. Use a designated test host, not invented credentials.
- [ ] Queued prompt runs once after idle; cancel/error/uncertain POST do not automatically retry. Scheduled task pause and restart stay paused.

## macOS additions

- [ ] `verify-macos.py` validates the actual bundle signature, audio entitlement and microphone usage description; DMG `hdiutil verify` passes.
- [ ] Finder launch resolves installed Node/Pi/OpenCode without shell PATH; user handles keychain/microphone dialogs.
- [ ] Overlay titlebar/keyboard shortcuts fit at minimum size and light/dark themes.
- [ ] Agent Control (Unix socket) works on an isolated app instance; Cua Driver is tested only when separately installed and authorized.

## Windows additions

- [ ] NSIS per-user install selects the current product; no administrator requirement accidentally added. WebView2/microphone access verified in packaged UI.
- [ ] Hidden subprocesses do not flash consoles; Pi/browser/SSH child trees close through Job Objects. Test a child/grandchild tree owned only by the fixture.
- [ ] Paths with spaces/non-ASCII, case and drive separators work; OS vault does not fall back to cleartext credentials.
- [ ] Agent Control/Factory and Cua Driver honestly report unavailable; this does not disable ordinary agents/browser/MCP.

## Linux additions

- [ ] `.deb` version and payload checked; install/launch on an actual supported desktop, not just CI or Xvfb. System WebKit/GTK and XDG paths resolve correctly.
- [ ] Pi/Node GUI PATH, Secret Service (unlocked login keyring), microphone/PulseAudio/portal and available completion player work.
- [ ] SSH and Unix Agent Control work on test-owned endpoints; absent Cua Driver is reported honestly.

See [verification receipts](VERIFICATION.md) for actually run scenarios. Neither
this checklist nor a successful build marks unrun live scenarios as completed.
