# OpenCode Desktop — 0.2.0 delivered implementation

New Chat supports an optional project and full projectless operations. Each projectless chat gets its own working directory. Execution location is independently Local or an app-owned strict-key SSH tunnel to an existing remote OpenCode engine. Remote/local projects, history, drafts, queues, PTYs and model choices are partitioned by stable host identity. OpenCode remains independently installed and managed.

Validation complete: 83 frontend tests, 5 Rust tests, TypeScript/Vite build, cargo check/fmt and final app/DMG build passed. Packaged native real Qwen Medium read-tool and PTY scenarios passed on Mac and a temporary POSIX SSH fixture; archive/restore and installed-app relaunch/history passed. All remote test resources cleaned up. Final 0.2.0 installed in /Applications; existing aliases and original Qwen launcher preserved. DMG verified and copied to Downloads. Evidence and limitations: docs/VERIFICATION.md, docs/WORKSPACES.md.

Remaining delivery step: commit reviewed source/docs, push to existing private origin and publish v0.2.0 with the verified DMG. Do not repeat inference or change external engine/global settings. No unrelated project modifications; private receipts remain under ignored .local/.
