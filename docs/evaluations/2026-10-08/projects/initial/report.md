# Arvela synthetic evaluation 2.0.0

Model: deepseek-flash; requested effort: medium; effective provider effort: high. Memory: off.

3/16 independently verified trials. Owner interventions: 0 (unattended runner; not a statement about production).

| Agent | Verified outcomes | Median elapsed seconds (all trials) | Provider tokens |
|---|---:|---:|---:|
| opencode / off | 2/8 | 24.09 | 305633 |
| pi / off | 1/8 | 21.99 | 130701 |

| Fixture | Agent | Repeat | Result | Elapsed seconds through grading | Provider tokens | Stale refusals |
|---|---|---:|---|---:|---:|---:|
| project-checkout | opencode / off | 1 | outcome-failed | 25.0 | 16657 | 0 |
| project-checkout | pi / off | 1 | PASS | 19.8 | 17333 | 0 |
| project-outbox | opencode / off | 1 | outcome-failed | 45.0 | 32598 | 0 |
| project-outbox | pi / off | 1 | outcome-failed | 36.5 | 14640 | 0 |
| project-session-router | opencode / off | 1 | PASS | 24.3 | 29907 | 0 |
| project-session-router | pi / off | 1 | outcome-failed | 22.2 | 8263 | 0 |
| browser-workflow | opencode / off | 1 | budget-exhausted | 21.6 | 60737 | 1 |
| browser-workflow | pi / off | 1 | budget-exhausted | 18.5 | 32348 | 1 |
| project-checkout | pi / off | 2 | outcome-failed | 23.1 | 9173 | 0 |
| project-checkout | opencode / off | 2 | outcome-failed | 23.9 | 16286 | 0 |
| project-outbox | pi / off | 2 | outcome-failed | 22.2 | 7901 | 0 |
| project-outbox | opencode / off | 2 | PASS | 54.9 | 63358 | 0 |
| project-session-router | pi / off | 2 | outcome-failed | 21.8 | 7786 | 0 |
| project-session-router | opencode / off | 2 | outcome-failed | 22.2 | 24966 | 0 |
| browser-workflow | pi / off | 2 | budget-exhausted | 19.7 | 33257 | 1 |
| browser-workflow | opencode / off | 2 | budget-exhausted | 21.7 | 61124 | 1 |

Limits: {"requests":18,"outputTokens":4096,"tokens":60000,"requestBytes":100000,"totalTokens":1000000,"totalRequests":300,"perTrialSeconds":180,"totalSeconds":1800}. Provider token usage is authoritative where present; missing usage is unknown, never zero. Admission checks apply between responses; one in-flight response can exceed the token ceiling.

These small synthetic trials do not measure local Qwen throughput, general model intelligence, production browser emulation, UI behavior or long-project quality. No history, skills or private code was sent. Tool/fixture revisions are in the JSON report. Sequential AB/BA order alternates between repeats; no automatic retries or result deletion.
