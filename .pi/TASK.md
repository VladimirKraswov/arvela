# OpenCode Desktop — DONE

User explicitly authorized direct implementation, final DMG/reinstallation and GitHub creation/push. This supersedes the initial Qwen-only worker and no-push plan. Worker remains idle; its heartbeat is PAUSED. Do not resume it or alter global OpenCode/FreeToken/TinyCAD/user projects.

Implementation and native acceptance complete. See docs/VERIFICATION.md, ACCEPTANCE-2026-09-22.md and CONTEXT-QUEUE-VOICE.md for evidence and limits. Frontend68 tests + original5 unchanged regressions + Rust2 tests passed; production build/cargo check and final app+DMG build passed. Real Qwen Medium chat/read tool, native PTY, steering, automatic queue dispatch, manual compaction and restart/draft restoration passed in the disposable project. ASR transport tested with synthetic audio; actual speech API remains user-configurable and unverified.

Canonical installation /Applications/OpenCode Desktop.app; ~/Applications and Desktop aliases preserved, old Qwen OpenCode.app untouched. Final DMG verified in ~/Downloads/OpenCode Desktop_0.1.0_aarch64.dmg. Local receipts/backups are ignored under .local; never publish them.

Private GitHub repository created with gh: https://github.com/VladimirKraswov/opencode-desktop. Popup clipping reported at final handoff fixed with a shared viewport-aware portal for selects, context and task menus. Five placement regressions plus live browser 900×620 and native installed-app checks passed. Final DMG rebuilt, verified and reinstalled after this correction. Own Vite1425 and test PTY stopped; OpenCode server untouched.

DONE: reviewed source/docs/tests committed and pushed to main with gh-created private repository. Release v0.1.0 published at https://github.com/VladimirKraswov/opencode-desktop/releases/tag/v0.1.0 with final DMG; GitHub asset SHA256 matches the verified installed delivery. App is running from /Applications/OpenCode Desktop.app. Original background worker heartbeat stays PAUSED. No further work is scheduled; actual ASR API setup awaits the user's endpoint/credentials as planned.
