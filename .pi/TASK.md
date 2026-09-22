# OpenCode Desktop task

## Goal
Build the standalone OpenCode Desktop Tauri shell from the provided specification. Product implementation is delegated to local Qwen3.8 Flash Next through OpenCode (Medium).

## Current state
Official Tauri 2 + React/TypeScript starter created. Product metadata set. Documentation and roadmap supplied. No application features implemented yet. Bootstrap npm install, TypeScript/Vite build and cargo check all passed; see docs/VERIFICATION.md. The starter will be committed before worker dispatch.

## Next action
After bootstrap handoff, inspect AGENTS/ROADMAP and Git, verify live OpenCode contract, create a short task list, then implement M1 and continue towards verified M1–M6. Use working API integrations and preserve engine independence.

## Constraints
Only this repo and test-owned folders. Existing OpenCode daemon on 127.0.0.1:4096 is externally managed. Keep user's real sessions, global configuration and model server untouched. One local inference at a time. No publication requested.
