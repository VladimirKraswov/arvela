# API contract reference

Baseline observed on 2026-09-22: server `/global/health` reports **OpenCode 1.18.18**, while the OpenAPI info version is `1.0.0` (schema metadata, not binary version). A snapshot is in `docs/api/openapi-1.18.18.json`. Search/extract only relevant paths and referenced schemas; do not load the whole large file into model context.

Official reference: https://opencode.ai/docs/server/ . The running `/doc` is authoritative when generic/current docs differ. Fetching this read-only schema is safe; never persist provider auth/config responses in the repository.

Useful verified paths (schemas must be checked before use):

| Area | Endpoints |
| --- | --- |
| Health and events | `GET /global/health`, `/global/event`, `/event` |
| Projects | `GET /project`, `/project/current`, `/path`, `/vcs`, `/vcs/status` |
| Sessions | `GET/POST /session`, `GET /session/status`, `GET/PATCH /session/{sessionID}` |
| History | `GET /session/{sessionID}/message` with optional `limit`/`before` |
| Execution | `POST /session/{sessionID}/prompt_async`, `/abort`, `/summarize` |
| Model and agent choices | `GET /provider`, `/agent` |
| User interaction | `GET /permission`, `/question`; request-specific reply/reject routes |
| Changes/files | `GET /session/{sessionID}/diff`, `/file`, `/file/content`, `/file/status`, `/vcs/diff` |
| PTY | `GET/POST /pty`, `GET/PUT/DELETE /pty/{ptyID}`, connect-token and connect routes |
| Tools/skills | `GET /skill`, `/lsp`, `/formatter`, `/mcp` |

Project-specific routes support the `directory` query parameter in this version; use it consistently and URL-encode paths. Check event envelope shapes and PTY authentication against the schema and actual observed responses. Do not assume ordinary HTTP fetch can stand in for SSE/WebSocket behavior.

A tested async prompt shape is:

```json
{
  "agent": "qwen-build",
  "model": {"providerID": "local-qwen-next", "modelID": "qwen38-flash-next"},
  "variant": "medium",
  "parts": [{"type": "text", "text": "A task in the selected project"}]
}
```

The API returns 204 for acceptance. Follow events/history/status to determine completion. Session creation uses a different model field (`model.id` instead of `modelID`); keep that distinction in typed adapters. Runtime selection should be discovered, not fixed to this example.

Session archival is a patch to `time.archived` where supported. Deleting a session is a separate destructive operation and must not be the default way to hide it. Permission options and question answer array shapes must come from the contract.
