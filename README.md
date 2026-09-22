# OpenCode Desktop

Independent desktop client for OpenCode, built with **Tauri 2, React and TypeScript**.
The intended experience is a polished coding workspace inspired by Codex: project/session sidebar, streaming conversation, inspectable tool activity, changes and terminal panels.

**Status:** official Tauri starter initialized; the application features described below are a development brief, not completed features. Implementation is delegated to the local Qwen3.8 Flash Next through OpenCode. Update this status as milestones actually pass.

## Non-negotiable product requirement

Install OpenCode Desktop **on top of an independently installed OpenCode**. Never embed a fork of the OpenCode engine, replace its CLI, copy its database, or make users reinstall this app for every OpenCode update. OpenCode remains the owner of conversations, providers, models, agent tools, permissions and execution. The desktop owns presentation and its own UI preferences.

## Development

Requirements: Node/npm, Rust/Cargo, platform Tauri prerequisites; OpenCode installed separately.

```sh
npm ci
npm run dev          # frontend only; native APIs require Tauri or explicit development mocks
npm run tauri dev    # native application
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri build -- --bundles app
```

On this particular Mac run Node commands with `env -u NODE_PATH` if global modules interfere. Do not bake machine-specific paths into the app.

The existing OpenCode service is normally `http://127.0.0.1:4096`. The app must discover/check it, make connection errors understandable, and support selecting a different local port. It may start an installed `opencode serve` when requested, but must not kill or restart an externally managed server on exit.

## Start here

- [Product brief and UI behavior](docs/PRODUCT.md)
- [Architecture and compatibility boundary](docs/ARCHITECTURE.md)
- [Detailed roadmap and acceptance criteria](ROADMAP.md)
- [Development and verification](docs/DEVELOPMENT.md)
- [OpenCode API contract](docs/API.md)
- [Agent instructions](AGENTS.md)
- [Implementation handoff](docs/WORKER_PROMPT.md)
- [Current task checkpoint](.pi/TASK.md)

Local run receipts and environment notes belong in `.local/` (Git-ignored). No credentials or conversation transcripts belong in this repository.

## References

Scaffolded using the official [create-tauri-app](https://v2.tauri.app/start/create-project/) React/TypeScript template. The integration contract is the running [OpenCode server API](https://opencode.ai/docs/server/), exposed as `/doc`.
