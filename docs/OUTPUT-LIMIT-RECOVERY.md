# Output-limit recovery — 0.2.77

A live OpenCode coding session stopped twice with `finish:length` after exactly
16,384 output tokens. Both final reasoning parts ended with tens of thousands
of repeated punctuation characters. There was no connection error or tool
failure in those messages. A plain continuation generated a useful tool call
and then fell into the same pattern again. That is not a reason to enlarge the
output cap or replay a failed turn automatically.

The session's selected variant was xhigh; previous working input had grown to
about193K tokens including cached input. These are observed conditions, not
proof that xhigh or context size alone causes repetition. The serving template
retains thinking; numeric reasoning effort is not necessarily a graded thinking
budget in this service. No shared model, sampling, GPU, server or tool-permission
configuration was changed for this repair.

## Recovery

Saved private session history, rechecked authoritative idle, and requested the
engine's normal directory-scoped manual compaction (`auto:false`). It completed
successfully, without deleting history. Then sent one explicit corrective task
through Arvela's normal control/send pipeline (readiness and durable dispatch),
same session/engine/Qwen model, Medium, zero automatic continuations. It directs
the agent to reread its checkpoint, test one concrete hypothesis, and avoid
reusing degenerate reasoning. This is continuation of the owner's task, not a
replay of a previous tool call. Owner game files were not edited by the repair.
Private receipts and exact task/history remain outside the repository.

## Product changes

- Russian output-limit notices distinguish ordinary length stops from a likely
  repetitive-generation failure. A bounded768-character tail detector operates
  only on terminal text/reasoning at a length stop; it never scans tool/file
  output or labels ordinary active reasoning as a failure. This is a heuristic,
  not a claim that every repeated output is an unintended model loop.
- The latest stopped turn offers explicit **Сжать контекст**. No hidden prompt,
  tool retry, model change or continuation is sent. Other sessions, older turns,
  busy sessions and pending prompt submissions do not expose that action.
- Compaction captures its backend/model/workspace and rechecks session, host,
  engine, model and activity after asynchronous readiness. Navigation or a new
  turn cannot cause a stale summary request against another chat. Normal model
  readiness initialization is awaited even if routes are still loading.
- Local compaction's client deadline is15minutes instead of3: real engine work
  took over4minutes in the incident. There is still a bound and no retry after
  an ambiguous timeout. Existing engine Stop remains the cancellation path once
  compaction is running. The UI says a request was sent, not that a timeout or
  acceptance alone proves success.
- The notice is lazy-loaded; the existing main-bundle budget is unchanged.

## Checks

Tests cover the observed punctuation tail, normal long output, short repeats,
ongoing reasoning, explicit-only compaction, no prompt dispatch, older/foreign
session guards, navigation/busy races, and a summary response beyond the former
three-minute deadline without a duplicated HTTP request. A real isolated Chromium
fixture at380px and1000px verifies keyboard access, one compaction, zero agent
dispatches, no overflow and no page errors. It uses only its own fake session;
the owner's application and active browser are not restarted for verification.
