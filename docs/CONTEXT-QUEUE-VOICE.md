# Context, access, queue and dictation

## Context

OpenCode owns automatic compaction. Desktop reads the selected project's actual `/config` and model limits; it does not erase messages or run its own summarizer. Existing configuration enables `auto` and `prune`. The circular indicator shows last reported model usage, the full context window and remaining budget before compaction. It is not a sum of historical billing tokens, and does not pretend to count tokens before the engine reports them.

For the current `local-qwen-next/qwen38-flash-next` configuration:

| Parameter | Tokens |
|---|---:|
| Context window | 262,144 |
| Input limit | 245,760 |
| Reserved | 24,576 |
| Automatic compaction threshold | **221,184** |
| Output limit | 16,384 |

These are the current 2026-09-27 OpenCode values. The V100 model also has a
262,144-token physical window, but its declared input is 229,376 and its
compaction threshold is 204,800. Changing an inference server's window does not
automatically rewrite OpenCode's model limits; see [AI environment](AI-ENVIRONMENT.md).

Calculation follows the versioned [OpenCode 1.18.18 overflow implementation](https://github.com/anomalyco/opencode/blob/v1.18.18/packages/opencode/src/session/overflow.ts): use reported `tokens.total`, or input + output + cache read + cache write; reasoning is not added twice. A fresh conversation shows an unknown usage until the first report. When switching tokenizers, the last measured usage still belongs to the preceding model until the next response. Manual “Сжать сейчас” is available when idle. It calls the engine's summarize endpoint; the request allows up to three minutes rather than prematurely labelling normal summarization a failure.

## Switching to a smaller model (0.2.97)

When the latest successful model usage exceeds the selected target's conservative
input budget, Enki first invokes native OpenCode compaction with that previous
larger model. Only one compaction request is sent, explicitly `auto:false`:
no task continuation, replay or second agent loop. After verified completion it
loads the target and commits selection. The dialog shows both stages. Previous
provider access must still work; paid providers retain their normal billing.

The complete conversation remains in the engine database. Its native summary and
recent tail become the working context; Enki neither deletes history nor rewrites
AGENTS.md with transient chat state. Failed, empty, truncated, missing or oversized
summaries stop the transfer and keep the previous choice/draft. A pinned different
compaction-role model is reported, not silently overridden. Already affected
chats recover via «Сжать сейчас», which uses the history's previous larger model.
A provider outage requires restoring that provider or choosing a model large
enough for the original history; automatic lossy truncation is not a fallback.

Manual/queued/scheduled sends wait through compaction and target readiness.
Cancelling after the native request started cancels the target selection, while
the native summary may finish in the original chat; Enki does not abort the agent.
Native success is checked using a new assistant summary, completion/finish state,
nonempty text and conservative output/tail budget. Polling observes the same
request for at most15 minutes including its HTTP wait; it never reissues it.
Token counts from different tokenizers are estimates for transfer planning; exact
usage is displayed only after the chosen model reports it. Summary INPUT usage
is not presented as the resulting compacted context.

## Access

The composer selects **session-scoped OpenCode permission rules**. It never rewrites global configuration or automatically approves a pending permission request.

- **Как в OpenCode:** inherit project/agent rules.
- **С подтверждением:** reading/search allowed, other tools ask.
- **Только чтение:** reading/search allowed, shell commands and editing denied.
- **Полный доступ:** tools allowed, including outside the project; the engine's doom-loop confirmation remains enabled.
- Existing nonstandard rules are displayed as **Свои разрешения** until explicitly changed.

Changes are unavailable during execution and apply to that session only. These are tool permissions, **not an operating-system sandbox**. A newly created session uses the user's selected mode. The current project defaults are already permissive; the label “Как в OpenCode” deliberately does not promise restrictions that are absent from the engine configuration.

## Queue and correction

Enter during generation adds a prompt to the local queue (maximum 20 items), retaining its selected model, variant, agent, session and project. Each queued item owns separate IndexedDB copies of its attachments; localStorage contains only filenames/IDs and routing metadata. Copying and preference persistence must succeed before the draft files are removed. File-only messages are supported. Items can be removed or moved back to an empty composer for editing, with their files restored. Missing files or conversion errors pause the queue before POST. Normal completion sends the next item once. Late failures are scoped to the original session, never shown in a different chat. Pi receives prepared text/image parts through its own adapter and retains its supported attachment limits.

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

The microphone starts only after a click and system permission. Recording has no total time limit; 30-second thinking pauses are allowed. With live Web Audio level detection it ends after 60 seconds of observed silence. If level detection cannot run, recording still works and the timer tooltip explains that stopping is manual. Sleep/background scheduling gaps do not count as observed silence.

Recognition runs while recording, serially on short independently decodable clips. Natural pauses (650ms, after at least 3 seconds) are preferred; continuous speech is cut into 15-second clips with a 700ms overlap and conservative multiword seam removal. MediaRecorder timeslice blobs are checkpoint parts of one container, not independent ASR inputs. Every clip is saved in the local IndexedDB journal before upload; pending audio and recognized-but-undelivered text stay there after errors. A recovery action resumes in order without re-transcribing text already recognized. Draft text and its receipt are persisted together before removing the corresponding audio. It never automatically sends a chat message.

The original workspace/draft owns audio and text. Navigation stops capture and preserves pending audio for explicit recovery in that draft. Cancellation before microphone permission sends nothing. Once recording has started, stopping retains recognized text and pending audio. Recovery can be retried or explicitly deleted; it is never automatically submitted on startup. Successful audio is removed. Raw audio is not uploaded to Hub or included in preferences. Microphone checkpoint delivery is browser scheduled, so a process/device crash can still lose the most recent unsaved tail; this is recovery protection, not a lossless hardware recorder.

Normal quit and update activation stop capture and await final audio persistence, without waiting for ASR or interrupting agents. Native ASR multipart requests keep the existing 25MiB per-request bound, private HTTP/HTTPS policy, redirect rejection and timeout; this is a per-clip transport limit, not a dictation duration limit. The ASR adapter accepts empty text for silence only when the progressive dictation caller permits it. Ordinary attachment transcription retains its missing-text error. Credentials remain memory-only and bound to the ASR endpoint; the journal contains only endpoint/model/language, never keys. A key may need to be entered again before recovery after restart. A native request already received by ASR cannot be recalled; disposed callers ignore late results and keep recoverable audio.

The packaged macOS app contains `NSMicrophoneUsageDescription` and the audio-input
entitlement required by its Hardened Runtime. On this installation the configured
ASR endpoint is GigaAM v3 in CT201 (`192.168.31.59`), and real M4A transcription
has been checked. Capture and cancellation in the installed app were also checked;
the ASR key, when required, remains memory-only. See [settings](SETTINGS.md) and
the [AI environment](AI-ENVIRONMENT.md).
