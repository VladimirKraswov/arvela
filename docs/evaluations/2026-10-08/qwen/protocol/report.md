# Arvela synthetic evaluation 2.1.0

Model: qwen38-flash-next; requested effort: medium; effective provider effort: medium. Memory: off. Navigation: off.

2/2 independently verified trials. Owner interventions: 0 (unattended runner; not a statement about production).

| Agent | Verified outcomes | Median elapsed seconds (all trials) | Provider tokens |
|---|---:|---:|---:|
| opencode / memory:off / map:off | 1/1 | 40.41 | 11126 |
| pi / memory:off / map:off | 1/1 | 35.51 | 3695 |

| Fixture | Agent | Repeat | Result | Elapsed seconds through grading | Provider tokens | Stale refusals |
|---|---|---:|---|---:|---:|---:|
| zero-value | opencode / memory:off / map:off | 1 | PASS | 40.4 | 11126 | 0 |
| zero-value | pi / memory:off / map:off | 1 | PASS | 35.5 | 3695 | 0 |

Limits: {"requests":18,"outputTokens":4096,"tokens":60000,"requestBytes":100000,"totalTokens":1000000,"totalRequests":400,"perTrialSeconds":300,"totalSeconds":900}. Provider token usage is authoritative where present; missing usage is unknown, never zero. Admission checks apply between responses; one in-flight response can exceed the token ceiling.

These small synthetic trials do not measure local Qwen throughput, general model intelligence, production browser emulation, UI behavior or long-project quality. No history, skills or private code was sent. Tool/fixture revisions are in the JSON report. Sequential AB/BA order alternates between repeats; no automatic retries or result deletion.
