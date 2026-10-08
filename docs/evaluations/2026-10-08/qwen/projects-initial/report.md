# Arvela synthetic evaluation 2.1.0

Model: qwen38-flash-next; requested effort: medium; effective provider effort: medium. Memory: off. Navigation: compare.

12/19 independently verified trials. Owner interventions: 0 (unattended runner; not a statement about production).

| Agent | Verified outcomes | Median elapsed seconds (all trials) | Provider tokens |
|---|---:|---:|---:|
| opencode / memory:off / map:off | 3/4 | 154.82 | 99342 |
| opencode / memory:off / map:tools | 3/5 | 125.04 | partial 132599 |
| pi / memory:off / map:off | 3/5 | 225.22 | partial 136727 |
| pi / memory:off / map:tools | 3/5 | 284.95 | partial 180219 |

| Fixture | Agent | Repeat | Result | Elapsed seconds through grading | Provider tokens | Stale refusals |
|---|---|---:|---|---:|---:|---:|
| project-checkout | opencode / memory:off / map:off | 1 | PASS | 133.0 | 27763 | 0 |
| project-checkout | opencode / memory:off / map:tools | 1 | PASS | 98.3 | 23583 | 0 |
| project-checkout | pi / memory:off / map:off | 1 | PASS | 225.2 | 33336 | 0 |
| project-checkout | pi / memory:off / map:tools | 1 | PASS | 123.8 | 19630 | 0 |
| project-outbox | opencode / memory:off / map:off | 1 | PASS | 176.6 | 30908 | 0 |
| project-outbox | opencode / memory:off / map:tools | 1 | timeout | 300.1 | partial 49925 | 0 |
| project-outbox | pi / memory:off / map:off | 1 | timeout | 300.2 | partial 34011 | 0 |
| project-outbox | pi / memory:off / map:tools | 1 | timeout | 300.1 | partial 41487 | 0 |
| project-session-router | opencode / memory:off / map:off | 1 | PASS | 80.9 | 21441 | 0 |
| project-session-router | opencode / memory:off / map:tools | 1 | PASS | 73.4 | 18601 | 0 |
| project-session-router | pi / memory:off / map:off | 1 | PASS | 119.7 | 14925 | 0 |
| project-session-router | pi / memory:off / map:tools | 1 | PASS | 202.3 | 37310 | 0 |
| project-checkout | pi / memory:off / map:tools | 2 | PASS | 285.0 | 54775 | 0 |
| project-checkout | pi / memory:off / map:off | 2 | PASS | 122.4 | 13879 | 0 |
| project-checkout | opencode / memory:off / map:tools | 2 | PASS | 125.0 | 26203 | 0 |
| project-checkout | opencode / memory:off / map:off | 2 | outcome-failed | 188.4 | 19230 | 0 |
| project-outbox | pi / memory:off / map:tools | 2 | timeout | 300.1 | partial 27017 | 0 |
| project-outbox | pi / memory:off / map:off | 2 | timeout | 300.1 | partial 40576 | 0 |
| project-outbox | opencode / memory:off / map:tools | 2 | cancelled | 141.7 | partial 14287 | 0 |

Limits: {"requests":18,"outputTokens":4096,"tokens":60000,"requestBytes":100000,"totalTokens":1600000,"totalRequests":450,"perTrialSeconds":300,"totalSeconds":3600}. Provider token usage is authoritative where present; missing usage is unknown, never zero. Admission checks apply between responses; one in-flight response can exceed the token ceiling.

These small synthetic trials do not measure local Qwen throughput, general model intelligence, production browser emulation, UI behavior or long-project quality. No history, skills or private code was sent. Tool/fixture revisions are in the JSON report. Sequential AB/BA order alternates between repeats; no automatic retries or result deletion.
