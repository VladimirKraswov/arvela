# Arvela synthetic evaluation 2.1.0

Model: qwen38-flash-next; requested effort: medium; effective provider effort: medium. Memory: off. Navigation: compare.

4/6 independently verified trials. Owner interventions: 0 (unattended runner; not a statement about production).

| Agent | Verified outcomes | Median elapsed seconds (all trials) | Provider tokens |
|---|---:|---:|---:|
| opencode / memory:off / map:tools | 1/2 | 184.81 | partial 76183 |
| opencode / memory:off / map:off | 2/2 | 143.89 | 69286 |
| pi / memory:off / map:tools | 1/1 | 126.24 | 20808 |
| pi / memory:off / map:off | 0/1 | 104.38 | 12257 |

| Fixture | Agent | Repeat | Result | Elapsed seconds through grading | Provider tokens | Stale refusals |
|---|---|---:|---|---:|---:|---:|
| project-outbox | opencode / memory:off / map:tools | 2 | timeout | 300.1 | partial 55885 | 0 |
| project-outbox | opencode / memory:off / map:off | 2 | PASS | 192.2 | 44818 | 0 |
| project-session-router | pi / memory:off / map:tools | 2 | PASS | 126.2 | 20808 | 0 |
| project-session-router | pi / memory:off / map:off | 2 | outcome-failed | 104.4 | 12257 | 0 |
| project-session-router | opencode / memory:off / map:tools | 2 | PASS | 69.5 | 20298 | 0 |
| project-session-router | opencode / memory:off / map:off | 2 | PASS | 95.6 | 24468 | 0 |

Limits: {"requests":18,"outputTokens":4096,"tokens":60000,"requestBytes":100000,"totalTokens":700000,"totalRequests":160,"perTrialSeconds":300,"totalSeconds":1800}. Provider token usage is authoritative where present; missing usage is unknown, never zero. Admission checks apply between responses; one in-flight response can exceed the token ceiling.

These small synthetic trials do not measure local Qwen throughput, general model intelligence, production browser emulation, UI behavior or long-project quality. No history, skills or private code was sent. Tool/fixture revisions are in the JSON report. Sequential AB/BA order alternates between repeats; no automatic retries or result deletion.
