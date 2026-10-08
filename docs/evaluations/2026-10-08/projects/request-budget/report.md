# Arvela synthetic evaluation 2.0.1

Model: deepseek-flash; requested effort: medium; effective provider effort: high. Memory: off.

2/4 independently verified trials. Owner interventions: 0 (unattended runner; not a statement about production).

| Agent | Verified outcomes | Median elapsed seconds (all trials) | Provider tokens |
|---|---:|---:|---:|
| opencode / off | 0/2 | 20.85 | 120758 |
| pi / off | 2/2 | 21.31 | 78472 |

| Fixture | Agent | Repeat | Result | Elapsed seconds through grading | Provider tokens | Stale refusals |
|---|---|---:|---|---:|---:|---:|
| browser-workflow | opencode / off | 1 | budget-exhausted | 21.1 | 60426 | 1 |
| browser-workflow | pi / off | 1 | PASS | 21.8 | 39456 | 1 |
| browser-workflow | pi / off | 2 | PASS | 20.8 | 39016 | 1 |
| browser-workflow | opencode / off | 2 | budget-exhausted | 20.6 | 60332 | 1 |

Limits: {"requests":18,"outputTokens":4096,"tokens":60000,"requestBytes":100000,"totalTokens":500000,"totalRequests":150,"perTrialSeconds":180,"totalSeconds":900}. Provider token usage is authoritative where present; missing usage is unknown, never zero. Admission checks apply between responses; one in-flight response can exceed the token ceiling.

These small synthetic trials do not measure local Qwen throughput, general model intelligence, production browser emulation, UI behavior or long-project quality. No history, skills or private code was sent. Tool/fixture revisions are in the JSON report. Sequential AB/BA order alternates between repeats; no automatic retries or result deletion.
