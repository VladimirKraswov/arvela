# M44: multi-module tasks and browser workflow

Real installed OpenCode 1.18.18 and Pi 0.85.1, isolated synthetic projects and
real isolated Chromium. DeepSeek Flash; requested Medium, effective High.
Two paired AB/BA repetitions. No owner tasks, local GPUs, private sources or
persistent agent settings were used. Zero owner interventions in this harness.

| Qualified task group | Agent | Independent successes | Median elapsed, all trials |
|---|---|---:|---:|
| Three miniature five-file projects | OpenCode | 2/6 | 24.65 s |
| Three miniature five-file projects | Pi | 1/6 | 22.20 s |
| Two-product browser workflow | OpenCode | 2/2 | 24.05 s |
| Two-product browser workflow | Pi | 2/2 | 21.05 s |

Elapsed includes setup, CLI execution, outcome grading and candidate receipt
creation, excludes cleanup. Failed elapsed time is not time to a correct result.
Project failures remain failures: zero-quantity/calculation validation,
in-place queue mutation/skipped deliveries and cross-scope/stale state mutation
were observed by held-out assertions. Several candidates retained the broken
starting modules; ending the agent run did not establish a fix. Protected files,
public smoke checks and held-out outcomes remain independent requirements.

Qualified browser known provider tokens: OpenCode 150075, Pi 81040 across two
runs each. Same 32-request /120K-token per-trial admission. OpenCode used 21
requests, Pi20; counts include internal title calls. Those differences do not
establish a general agent ranking or local-model cost/speed.

## Kept budget-limited evidence

- `initial/report.json`: all16 original trials retained; three project successes
  out of12; all four new browser trials hit the old18-request budget. These
  browser runs cannot establish task capability. The reference workflow needs
  19 tool calls, plus the final model response/internal requests.
- `request-budget/report.json`:32 requests allowed; two Pi passes, two OpenCode
  runs exhausted the unchanged60K-token budget after18requests (known input and
  output exceeded60K), not a demonstrated inability to complete the workflow.
- `qualified-browser/report.json`:32requests/120Ktokens, four passes; one expected
  stale-reference refusal per run, invalid input refused and exactly two saves.

No outcomes were erased or retried until a desired answer appeared. The two
browser budget revisions followed measured admission limits; each distinct run
and suite version is retained. Project failures were not rerun. All twelve
code/project/recovery baselines fail offline and references pass. A separate
scripted real-browser reference satisfied the same unchanged acceptance oracle.

Exact evaluation sources in each run's `sources/` match every corresponding
SHA256 in the report. Unchanged Hub/memory Python dependencies are in source commit
`8118196`, also archived under `sources/dependencies/hub/`; their report hashes match. Each multi-file candidate and entrypoint
is retained with its receipt, including failures. They are model-generated code;
inspect them, do not execute them as trusted scripts outside the bounded grader.

This is a harder baseline than M39, but still three miniature projects, not a
large-repository test. Small samples, network/cache effects, scoped fixture tools
and cloud model limit interpretation. No production browser emulation, packaged
GUI, actual Windows/Linux or local Qwen quality/throughput claim follows.
