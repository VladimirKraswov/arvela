# Arvela 0.2.57

Installed on macOS Apple Silicon and published to Hub stable. Browser environment
profiles are shared by OpenCode/Pi: Chromium/installed Chrome, normal-window mode,
temporary/persistent storage, locale/timezone/media, bounded pacing and privacy /
automation-marker options. Existing browser contexts are preserved when settings
are saved; their changed profile requires a later browser-management restart.

The canonical release command now verifies the served client channel and both
signed downloadable packets, producing a private receipt tied to the source Git
commit. No release is complete without that receipt. Lost POST acknowledgement is
reconciled against the served release without replaying publication. HTTPS requests
use independent connections. Metadata checks run at startup and every five minutes,
with throttled checks on focus/online/visibility and successful Hub connection
changes. Clients offer updates; downloading/building/installing stays explicit.
Cargo now watches bundled browser resources to refresh the native fingerprint.

Runtime source: `42f3e81`; operator lost-acknowledgement repair: `6ffa8d1`.
The source packet matches all 1084 reviewed Git files, and the UI packet matches
all 12 built frontend files. Both packets were downloaded through a regular device
key and passed the actual native pinned signature/version verifier. The original
POST succeeded while its acknowledgement connection failed; the exact served
release was audited and its verified receipt recovered without another POST.

Acceptance: 843 frontend tests, 123 native tests, seven publisher contracts passed;
six existing frontend and three opt-in native skips remain. Production build,
strict Clippy, architecture and bundle budgets passed. Signed macOS app, DMG CRC,
archive extraction, signed version binding and freshly downloaded GitHub archive /
signature equality passed. The compiled native fingerprint matches Hub. Installed
CLI reports connected=true and nativeVersion/releaseVersion=0.2.57; the visible
native control connection is healthy and managed browser resources match source.

An isolated Chromium UI using the actual Hub head and previous-client native
compatibility data shows the yellow 0.2.57 badge and download button without an
automatic install. A separate old 0.2.56 CLI copy remains subject to macOS network
privacy; that is not claimed as a successful live old-native test. Windows/Linux
installation and tray/active-agent hot-update acceptance remain separate. Existing
external agent servers, models, GPU and other chats were not restarted or prompted.

[Bootstrap installer](https://github.com/VladimirKraswov/arvela/releases/tag/v0.2.57)
for clients predating Hub updates; subsequent releases use their configured Hub.
