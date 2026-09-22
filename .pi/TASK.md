# OpenCode Desktop — 0.1.1 DONE

Window dragging hotfix implemented and natively verified. Missing core:window:allow-start-dragging capability added; both titlebar regions use the installed Tauri2.11.6 native deep hit-testing mode, preserving interactive controls. App version0.1.1, settings version from package.json.

68 frontend tests, production build, cargo check and release app/DMG build passed. Installed canonical /Applications/OpenCode Desktop.app; ~/Applications/Desktop aliases unchanged. Native free-titlebar and title-text dragging worked; review toggle worked; settings0.1.1 verified. DMG checksum verified; binary installed/build hash match. See docs/VERIFICATION.md.

DONE: source/docs pushed and DMG published at https://github.com/VladimirKraswov/opencode-desktop/releases/tag/v0.1.1. GitHub asset SHA256 matches the verified local DMG. Background worker heartbeat remains PAUSED. No global model/server changes or user project writes. Previous0.1.0 full acceptance remains documented; no new inference required for this native-window fix.
