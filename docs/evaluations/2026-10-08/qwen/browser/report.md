# Arvela synthetic evaluation 2.1.0

Model: qwen38-flash-next; requested effort: medium; effective provider effort: medium. Memory: off. Navigation: off.

4/4 independently verified trials. Owner interventions: 0 (unattended runner; not a statement about production).

| Agent | Verified outcomes | Median elapsed seconds (all trials) | Provider tokens |
|---|---:|---:|---:|
| opencode / memory:off / map:off | 2/2 | 202.02 | 149403 |
| pi / memory:off / map:off | 2/2 | 194.03 | 71947 |

| Fixture | Agent | Repeat | Result | Elapsed seconds through grading | Provider tokens | Stale refusals |
|---|---|---:|---|---:|---:|---:|
| browser-workflow | opencode / memory:off / map:off | 1 | PASS | 188.7 | 73747 | 1 |
| browser-workflow | pi / memory:off / map:off | 1 | PASS | 194.7 | 36153 | 1 |
| browser-workflow | pi / memory:off / map:off | 2 | PASS | 193.3 | 35794 | 1 |
| browser-workflow | opencode / memory:off / map:off | 2 | PASS | 215.4 | 75656 | 1 |

Limits: {"requests":18,"outputTokens":4096,"tokens":60000,"requestBytes":100000,"totalTokens":600000,"totalRequests":140,"perTrialSeconds":300,"totalSeconds":1800}. Provider token usage is authoritative where present; missing usage is unknown, never zero. Admission checks apply between responses; one in-flight response can exceed the token ceiling.

These small synthetic trials do not measure local Qwen throughput, general model intelligence, production browser emulation, UI behavior or long-project quality. No history, skills or private code was sent. Tool/fixture revisions are in the JSON report. Sequential AB/BA order alternates between repeats; no automatic retries or result deletion.
