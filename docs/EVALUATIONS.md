# Reproducible task evaluation (M39)

This is a test harness, not another production agent loop. It submits one task
to an independently installed OpenCode or Pi, waits under a deadline, checks
the actual outcome, records the result and removes its own temporary project.
It does not resume owner chats, change installed agents/settings or call local
GPU services. No history, screenshots, secrets or private project code is sent.

## Offline contract checks

Node 24+ and the repository dependencies are required:

```sh
npm ci
npm run eval:check
npx vitest run test/evaluations.test.ts
```

Nine code/recovery tasks have broken starting implementations and independent
assertions outside the agent-visible filesystem. The offline replay checks that
each baseline fails and its reference implementation passes. Three browser tasks
use a synthetic discount form: normal save, rejected input followed by correction,
and a viewport/scroll change requiring fresh observation. CI tests the form's
contract using jsdom; live browser trials require real Playwright Chromium.
The CI workflow has no live provider credentials or model calls.

## Live paired trials (explicit opt-in)

Install OpenCode and Pi separately. Supply `DEEPSEEK_API_KEY` in the parent
environment, or explicitly pass `--key-file /private/path/to/opencode/auth.json`.
Never commit the key file. The harness reads only its DeepSeek credential; it
does not import global agent configuration. Start with a smoke test:

Live execution was verified on macOS. Windows/Linux live CLI/browser execution
remains unverified; the Linux CI job runs only the engine-independent contracts.

```sh
npm run eval:live -- --cases zero-value --repeats 1 --output .local/evaluations/smoke
```

Full comparison, two repeats, alternating agent order (AB then BA):

```sh
npm run eval:live -- --repeats 2 --timeout 120 --total-timeout 1800 \
  --playwright-module /absolute/path/to/playwright/index.mjs \
  --browser-executable /absolute/path/to/chromium \
  --output .local/evaluations/paired
```

Playwright can be a separate existing installation. Only the executable is
reused: a new temporary browser profile is created and removed for each trial.
There is no connection to Arvela's live browser. The fixture has no network origin
and all page requests are blocked. These trials use reference-based fast actions;
they do not establish mouse-emulation or packaged UI acceptance.

The default model is the official `deepseek-flash`. Only `medium` and `off` are
accepted by this first cloud adapter. A loopback gateway normalizes both agents'
requests to identical model/effort/output settings. DeepSeek maps requested
Medium to High; the report records both rather than inventing a distinct Medium
setting. See [DeepSeek thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/).

Both agents have only scoped fixture tools: list/read/write for code tasks or
snapshot/action for browser tasks. OpenCode receives them through stdio MCP; Pi
uses an explicit extension against the same backend. Built-in shell/network/file
tools, skill discovery, owner instructions and global extensions are disabled.
The real provider key remains in the parent gateway, not agent config/argv.
Disposable HOME/XDG/Pi paths isolate engine storage. This is a bounded synthetic
evaluation environment, not a security sandbox for executing hostile code:
grading adds Node filesystem/process permissions and a deadline, but arbitrary
untrusted repositories require a separate OS/container sandbox.

## Limits, evidence and interpretation

Defaults: 18 requests / 60K reported tokens per trial, 4096 output tokens per
request, 400 requests / 1M tokens per run, 120 seconds per agent and 30 minutes
per run. `--total-tokens`, `--total-requests`, `--timeout`, `--total-timeout` accept
bounded overrides. Resource admission is checked between responses; one admitted
response can overshoot a token budget. Provider retries also go through the
gateway limits. SIGINT/SIGTERM stop owned processes and clean up temporary files
and the browser. Never kill a separately managed server.

Internal concurrent CLI requests (such as title and answer) are serialized at
the gateway so admission observes the previous response's usage. An exhausted
evaluation budget returns permanent HTTP 403 rather than a retryable rate limit.

`report.json` and `report.md` are written after every trial; choose a new output
directory for each run. They contain fixture/tool SHA256 revisions, CLI versions,
model/requested/effective effort, skill revisions (empty when disabled), verified
completion time, provider usage/cache counts, agent-reported usage, tool errors,
stale-action refusals and owner interventions (zero for this unattended runner).
Raw reasoning, prompts, tool outputs, endpoints, temporary absolute paths and
credentials are not retained. Synthetic candidate modules are saved separately
with SHA256 for later inspection; they must never be executed as trusted scripts.
Schema 2 records elapsed time for every trial and time to verified result only
for passes (null for failures), plus Node/platform/browser versions and the model
identifier returned by the provider when available. Historical schema 1's
`verifiedSeconds` field represents elapsed time even for a failed outcome.
Unknown/partial usage remains explicit. Provider totals
include all requests admitted for that CLI, including internal title requests;
they can differ from the agent's visible step totals.

PASS requires independent outcome assertions and a successful completed agent
run without model/budget errors. A timeout, missing dependency, refused budget,
provider error or wrong result remains a failure. Nonzero runner exit means
failed/incomplete evidence, not permission to erase/retry it until green.
The initial suite covers deliberately small tasks; it cannot establish local
Qwen throughput, complex-project quality or skill effectiveness. Add harder
versioned tasks and repeat the same checks before promoting M40/M41 retrieval.

Historical accepted-fix replay remains in
`integrations/opencode-agent/evals/`; it is separate from cloud-safe synthetic
fixtures and must never send owner project sources to a cloud model implicitly.
