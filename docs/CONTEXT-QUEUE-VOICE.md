# Context, access, queue and dictation

## Context

OpenCode owns automatic compaction. Desktop reads the selected project's actual `/config` and model limits; it does not erase messages or run its own summarizer. Existing configuration enables `auto` and `prune`. The circular indicator shows last reported model usage, the full context window and remaining budget before compaction. It is not a sum of historical billing tokens, and does not pretend to count tokens before the engine reports them.

For the current `local-qwen-next/qwen38-flash-next` configuration:

| Parameter | Tokens |
|---|---:|
| Context window | 131,072 |
| Input limit | 114,688 |
| Reserved | 32,768 |
| Automatic compaction threshold | **81,920** |
| Output limit | 16,384 |

Calculation follows the versioned [OpenCode 1.18.18 overflow implementation](https://github.com/anomalyco/opencode/blob/v1.18.18/packages/opencode/src/session/overflow.ts): use reported `tokens.total`, or input + output + cache read + cache write; reasoning is not added twice. A fresh conversation shows an unknown usage until the first report. When switching tokenizers, the last measured usage still belongs to the preceding model until the next response. Manual “Сжать сейчас” is available when idle. It calls the engine's summarize endpoint; the request allows up to three minutes rather than prematurely labelling normal summarization a failure.

## Access

The composer selects **session-scoped OpenCode permission rules**. It never rewrites global configuration or automatically approves a pending permission request.

- **Как в OpenCode:** inherit project/agent rules.
- **С подтверждением:** reading/search allowed, other tools ask.
- **Только чтение:** reading/search allowed, shell commands and editing denied.
- **Полный доступ:** tools allowed, including outside the project; the engine's doom-loop confirmation remains enabled.
- Existing nonstandard rules are displayed as **Свои разрешения** until explicitly changed.

Changes are unavailable during execution and apply to that session only. These are tool permissions, **not an operating-system sandbox**. A newly created session uses the user's selected mode. The current project defaults are already permissive; the label “Как в OpenCode” deliberately does not promise restrictions that are absent from the engine configuration.

## Queue and correction

Enter during generation adds a prompt to the local queue (maximum 20 items), retaining its selected model, variant, agent, session and project. Items can be removed or moved back to an empty composer for editing. Normal completion sends the next item once.

**Скорректировать сейчас** posts that item to the existing OpenCode session immediately. The installed engine persists the new user message and joins its existing run loop; the agent sees it at the **next model/tool boundary**. It cannot retroactively change already generated tokens and does not kill an executing command. Contract: [prompt.ts](https://github.com/anomalyco/opencode/blob/v1.18.18/packages/opencode/src/session/prompt.ts), [run-state.ts](https://github.com/anomalyco/opencode/blob/v1.18.18/packages/opencode/src/session/run-state.ts).

Queue guards:

- Serial dispatch and duplicate-click lock; generation acknowledgement cannot overwrite a newer idle event.
- Stop, engine error or pending interaction pauses automatic execution.
- Persist `sending` before POST. Ambiguous network outcomes are **never automatically retried**: check history before manually repeating an item.
- Closing/reloading the application restores the queue paused. It does not silently launch jobs on startup.
- Queues are isolated by endpoint/session. Automatic dispatch is attached to the selected conversation; returning to it reconciles current status before continuing. Desktop must remain open for local queue dispatch. OpenCode owns any already-started run.

## Dictation

Settings accept a full transcription URL ending in `/audio/transcriptions`, model, optional language, and optional bearer API key. Compatible contract:

```
POST /v1/audio/transcriptions
Content-Type: multipart/form-data
file=<audio>; model=<model>; language=ru; response_format=json

{"text":"Recognized text"}
```

The microphone starts only after a click and system permission. The waveform is computed from actual microphone samples via Web Audio, not a decorative looping animation. Stop/check submits; cancel discards. Up to two minutes / 25 MiB. Audio stays in memory. Transcription is appended to the original draft, even after switching projects. It is never sent as a chat prompt automatically.

Native requests use a bounded Rust multipart adapter; the WebView CSP stays restricted to the application and local OpenCode. HTTPS is accepted; HTTP is limited to loopback/private IPv4 destinations. Redirects are rejected, responses capped, connection/overall timeouts bounded. API keys are **memory-only**, tied to the configured URL and never written to preferences, documentation or logs. A new app launch requires entering the key again. Cancellation stops capture and ignores a late transcript; it cannot recall a request already received by the ASR server.

The packaged macOS app contains `NSMicrophoneUsageDescription` following [Tauri's macOS bundle documentation](https://v2.tauri.app/distribute/macos-application-bundle/). No ASR service or credentials were supplied yet. The multipart integration is verified with synthetic audio and a local fixture, not a claimed successful transcription of real speech. First use of the user's ASR service still needs its actual endpoint/model and microphone permission.
