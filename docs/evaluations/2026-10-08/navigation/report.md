# M45 project-map comparison — 2026-10-08

All 24 paired trials completed: three unchanged synthetic miniature projects, two repetitions with reversed agent/mode ordering, OpenCode/Pi, map off/tools. Same DeepSeek Flash and requested Medium (gateway effective High), 18 requests/60K known tokens per trial, independent hidden assertions, no automatic retries. No private projects or local GPU calls.

| Agent | Map | Verified outcomes | Median elapsed seconds, all trials | Known provider tokens | Map calls |
|---|---|---:|---:|---:|---:|
| opencode | off | 2/6 | 30.29 | 255120 | 0 |
| opencode | tools | 2/6 | 27.35 | 182070 | 7 |
| pi | off | 3/6 | 24.42 | 126334 | 0 |
| pi | tools | 0/6 | 23.75 | 72314 | 13 |

The map did **not** demonstrate a reliable improvement. Pi's tools group passed fewer tasks in this small sample; OpenCode's pass count stayed unchanged. Do not infer general rankings, model degradation or large-project utility. The M44 and M45 baseline differences show sampling variance; they are separate series, not one merged benchmark. Faster failed runs are not faster verified results. Budget exhaustion is kept distinct from outcome failures.

The read-only map remains explicitly optional for navigation, off by default; no automatic context injection or production promotion. It cannot substitute for reading files, understanding contracts and checking outputs. The failed candidate files are retained for analysis, never silently rerun until green.

[Full numerical results](report.md) and [machine report](report.json) include every status, setup/tool/grade time, usage coverage, limits and candidate SHA256. All 120 project candidate files and 24 wrapper receipts are preserved. `sources/` contains exact SHA-bound evaluation sources and dependencies. The loaded core was captured by reconstructing the exact startup version and verifying its recorded SHA256; final production adds no-follow/canonical checks and a bounded streaming directory walk. These later safety changes were covered by core/native tests; the performance series used the archived version. The live native transport was qualified separately against final production and was not timed as the evaluation transport.

This five-file sample is too small to establish an advantage on large projects. No skill training, full-history analysis, local-Qwen speed claim, external fallback or automatic tool activation follows from it.
