# Session-guided tool reliability review — 0.2.76

Reviewed all 2,127 messages available at the audit snapshot from a long-running
Rust game-port session. The active agent, project files, model and shared engine
were not modified or restarted. Full history, exact commands and per-call audit
remain private under ignored `.local/review/quake-tools`; no owner history is
included in the release.

## Findings and changes

The snapshot contains 60 tool calls with error status:

| Group | Calls | Response |
| --- | ---: | --- |
| Ended Cua session | 38 | Explicit `session` required in discovery and runtime validation; no implicit last-session fallback or automatic revival. |
| Exact-edit mismatch / ambiguous match | 10 | Shared OpenCode/Pi guidance: reread current region and use unique context; preserve the strict edit guard. |
| Stale window identity | 5 | Preserve refusal; advise fresh discovery and snapshot without replaying input. Four observation errors plus one coordinate click. |
| Screenshot output path | 2 | Prefer returned inline image; explain real directory versus macOS `/tmp` symlink. Never weaken path checks. |
| Background input unavailable | 2 | Preserve refusal; ask the user to expose the intended window on the current desktop. No foreground fallback. |
| Missing / unsupported binary read | 2 | Verify file creation first and use an image viewer/parser instead of text reads. |
| Search providers / relevance | 1 | HTTP403 remains an access failure with cooldown. Irrelevant/unverifiable results are query failures and no longer disable the provider for a subsequent improved query. Repository search must be explicitly scoped. |

103 shell calls returned a nonzero exit code. This does not mean 103 broken
tools: probes with no matches legitimately return 1, and combined commands/pipes
can mask an earlier failure. Compiler diagnostics, speculative binary-parser
scripts, missing files/dependencies and macOS/zsh invocation mistakes were also
present. Shared dispatch guidance now distinguishes these outcomes, preserves
build/test exit codes, asks for actual format/offset evidence before binary
parsing, and changes hypothesis after repeated failure. It does not add an agent
loop, execute shell recovery, patch the game, grant permissions or replay prompts.

## Contract

Each Cua call except read-only permission inspection requires its explicitly
named task-owned session, including `start_session`, listing and `end_session`.
Starting a named session does **not** change the driver's implicit MCP session.
No process-global “last selected session” is introduced: concurrent chats retain
the names they supplied. A closed session stays closed until an intentional start;
disabled control and authorization revocation remain terminal gates.

Known driver errors receive concise recovery guidance while keeping original
`isError`, IDs, structured diagnostics and images. No mutation is retried.
Driver schemas and input/window guards remain authoritative. Background-only and
exact-window requirements remain in place.

The workflow reminder is a synthetic, session-scoped part at the existing common
manual/queue/scheduled dispatch boundary for both engines. Pi hides only the exact
app-owned block in user history, preserving assistant output, quoted/attached
content and other sessions. Existing histories are not rewritten. Instructions
improve decision-making; they cannot guarantee a model never makes a coding error.

## Verification and rollout

Real installed Cua Driver 0.28.2, isolated named test session: reproduced the
ended-implicit versus explicit-session distinction without input or screenshots.
A separately built **source proxy** is tested through actual MCP initialization,
discovery and own-session listing/end/start: missing-session rejection, explicit
read success, closed-session refusal and deliberate recovery; no implicit revival.
Regression tests cover discovery/guards/concurrent names, failure identity,
query recovery versus genuine403/429 cooldown, dispatch and Pi display boundaries.

Source/native update is required for the proxy change. Publishing does not replace
an already running MCP connection or interrupt the owner's active task. After
installing, reconnect Desktop tools normally when that task is idle; the existing
connection continues with its previous binary until then. No Windows/Linux live
runtime qualification is claimed by macOS checks.
