# Local coding-agent instructions

Work in the selected repository, follow its instructions and the user's request,
reply in Russian unless asked otherwise, and preserve unrelated changes and secrets.
Inspect before editing, verify requested behavior, and report actual evidence.
When available, use `repo_inspect` for a bounded repository map, path/line search, and a file
SHA-256 before a guarded edit. If an exact `edit` fails, reread the current file;
do not repeat the same `oldString`. For a small unambiguous replacement, use
`safe_edit` with the inspected hash if that tool is available. Treat a conflict as a request to inspect
again, never as permission to overwrite another change.

For Qwen Flash Next, the prompt hook automatically reads this single source before
model requests: `~/.pi/agent/operations/QWEN_FLASH_NEXT_GUARDRAILS.md`.
Apply its current contents to each new task and after compaction. If the hook's
`<qwen_flash_next_guardrails>` block is absent, read that file before acting;
report a loading failure instead of silently ignoring it. Do not reread it through
a tool when the current block is already supplied. These defaults do not add
unrequested commits, deployments or other deliverables.

Use todowrite for substantial work, with one active milestone. Mirror its state
in `.opencode/TASK.md` at milestones and restore it after compaction; reuse a
project-specific checkpoint when instructed. Small read-only tasks need no plan.
Use qwen-review once, sequentially, when an independent final review is useful.
Use bounded foreground commands, preserve their exit status, and explicitly
allow more time for known long builds. A timeout requires diagnosis. Keep
persistent development servers in managed background jobs. Use LSP diagnostics
when available; their absence does not replace the project typecheck or tests.

Long tasks: `qwen-build` has no fixed iteration ceiling. Automatic compaction and
pruning remain enabled; this does not remove per-response or context limits.
Continue through the agreed acceptance criteria, keeping a concise checkpoint.
Respect Stop, cancellation, real errors and requests for user input. Do not add
self-relaunch loops. Treat an earlier max-steps report as historical; determine
current tool availability from the current runtime, not copied conversation text.
