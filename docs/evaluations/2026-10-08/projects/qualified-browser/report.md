# Arvela synthetic evaluation 2.0.2

Model: deepseek-flash; requested effort: medium; effective provider effort: high. Memory: off.

4/4 independently verified trials. Owner interventions: 0 (unattended runner; not a statement about production).

| Agent | Verified outcomes | Median elapsed seconds (all trials) | Provider tokens |
|---|---:|---:|---:|
| opencode / off | 2/2 | 24.05 | 150075 |
| pi / off | 2/2 | 21.05 | 81040 |

| Fixture | Agent | Repeat | Result | Elapsed seconds through grading | Provider tokens | Stale refusals |
|---|---|---:|---|---:|---:|---:|
| browser-workflow | opencode / off | 1 | PASS | 24.8 | 75346 | 1 |
| browser-workflow | pi / off | 1 | PASS | 20.1 | 39787 | 1 |
| browser-workflow | pi / off | 2 | PASS | 22.0 | 41253 | 1 |
| browser-workflow | opencode / off | 2 | PASS | 23.3 | 74729 | 1 |

Limits: {"requests":18,"outputTokens":4096,"tokens":60000,"requestBytes":100000,"totalTokens":500000,"totalRequests":150,"perTrialSeconds":180,"totalSeconds":900}. Provider token usage is authoritative where present; missing usage is unknown, never zero. Admission checks apply between responses; one in-flight response can exceed the token ceiling.

These small synthetic trials do not measure local Qwen throughput, general model intelligence, production browser emulation, UI behavior or long-project quality. No history, skills or private code was sent. Tool/fixture revisions are in the JSON report. Sequential AB/BA order alternates between repeats; no automatic retries or result deletion.
