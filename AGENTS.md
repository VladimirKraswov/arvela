# OpenCode Desktop — agent instructions

## Mission and scope

Implement the user's OpenCode Desktop: a Codex-inspired native Tauri application over independently installed OpenCode. The user initially delegated implementation to Qwen3.8 Flash Next via OpenCode. On 2026-09-22 the user explicitly reassigned fixes and the Codex-style UI/UX rebuild to the coordinating Codex agent; direct implementation is now authorized. This is a new standalone project. Work only in this repository and test-owned temporary directories. Preserve other projects, existing OpenCode sessions, global model settings, the inference server and the installed OpenCode CLI.

At each new task or resumed/compacted operation, read `.pi/TASK.md`, this file, and the relevant roadmap section. Also read the canonical local model guidance, when present: `~/.pi/agent/operations/QWEN_FLASH_NEXT_GUARDRAILS.md`. Do not copy private credentials into the checkpoint. Missing optional local guidance is not a blocker for other contributors.

## How to work

- Inspect Git state and relevant files; call a useful tool within the first 300 words. Make a short actionable plan, then implement. Do not spend a whole response designing without code or inspection.
- Use the configured local Qwen model, Medium. Do not switch to cloud providers or run concurrent inference jobs. Do not repeatedly prompt the same GPU in tests.
- Deliver verified vertical slices in roadmap order. Tests, type checks and real UI/API evidence determine completion. No fake conversations, success indicators or dead buttons in production mode.
- Read targeted files instead of the entire API snapshot, generated output, `node_modules`, or Cargo target. Search with `rg`. Use bounded tool timeouts; allow a suitable longer timeout for the initial Cargo compile. Preserve command exit codes.
- After two failed attempts, gather new evidence and revise the hypothesis. Keep checkpoint notes concise: completed work, exact commands/results, unresolved issues and next action. Do not silently call an incomplete milestone done.
- Handle recoverable failures yourself. If a required user decision truly blocks work, write `NEEDS_INPUT` with the exact reason. Write `DONE` only after the selected deliverable passes its acceptance criteria. Never create recursive/self-triggered agent runs or unbounded retries.

## Architecture constraints

- Tauri 2 + React/TypeScript. No OpenCode source vendoring or pinned engine bundled inside this app. Read `/global/health` and actual `/doc`; API compatibility must be handled in one adapter.
- Prefer OpenCode's own execution, PTY, permission, session and model APIs. Do not invent another agent loop. Do not bypass permission prompts or auto-approve them in the UI.
- Existing sessions remain owned by OpenCode. Scope every directory-sensitive call and event subscription to the selected directory. A projectless chat has its own managed working directory; it must support the same tools, PTY and permission/context workflows without requiring a Git project. Prevent stale events from leaking between projects/sessions.
- No remote web content with privileged Tauri access; keep capabilities and CSP explicit/minimal before release. Treat tool output, model Markdown and file content as untrusted. Do not log secrets or place auth tokens in URLs. Prefer native proxy/streaming over disabling CORS globally. Remote OpenCode is supported through app-owned strict-key SSH tunnels, keeping the WebView on loopback. Never route a failed remote request to the local engine.
- Never kill an externally managed OpenCode server. No shell interpolation of user-supplied paths. No broad filesystem grants or new exposed LAN listeners as a shortcut.
- Do not delete user sessions, alter global permissions, commit credentials or change other applications. Publish/push only under explicit user authorization. Local commits in this new repository are allowed once checks pass; no destructive Git operations. The user explicitly authorized creating a GitHub repository and pushing this project on 2026-09-22; publish the reviewed source/docs/tests and release DMG, excluding private receipts and credentials.

## Quality bar

Strong types at API boundaries, testable stream reducer, request cancellation, bounded reconnect/backoff, accessible keyboard operation, useful empty/loading/error states, real light/dark themes. Keep components and state boundaries understandable. Tests must cover behavior rather than merely repeat implementation.

Before each milestone handoff: relevant tests, `npm run build`, Rust check when native code changes, diff review, and a short evidence entry in `.pi/TASK.md`. Update README/ROADMAP to reflect implemented reality. Source implementation is your job; the bootstrapper provided only starter files and documentation.
