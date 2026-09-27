# OpenCode coding-agent helpers

These companion tools run on the same host as OpenCode; they do not call a model.
They are designed for the selected session directory, including a remote
OpenCode instance when installed on that remote host.

- `repo_inspect` gives a bounded read-only map and optional path/line search.
  A file snapshot returns a SHA-256 and likely test filenames, never file text.
- `safe_edit` applies one exact replacement only to the file version previously
  inspected. A changed file or ambiguous text produces a conflict without
  overwriting other edits. It asks OpenCode for edit permission and refuses the
  read-only `qwen-review` agent.

Run `python3 -m unittest -v test_tools.py test_install.py` here before installing.
`python3 install.py` previews changes; `python3 install.py --apply` checks known
preimage hashes, refuses changed user files or active local sessions, and backs
up replaced files. It also installs the revised `qwen-coding` and `qwen-review`
instructions without changing model/provider settings. The running OpenCode
server may cache its tool registry. After the owner's 2026-09-27 restart request,
the working server was relaunched while idle and now exposes both tools to the
local Flash Next model. On another installation, reload only after confirming
that its sessions and terminals are idle.

The [real-incident evals](evals/README.md) replay accepted tests against both
the earlier and fixed Git revisions in disposable directories. They require no
model calls and provide a fixed starting point for later sequential Qwen
experiments. Passing them shows a regression is detectable, not that the model
has improved or reached frontier quality.

The repository map deliberately does not inspect ignored build outputs, `.local`,
`.env*` or migration archives. A file snapshot also lists applicable nested
AGENTS/checkpoint files, package manifests and likely tests found by filename
or source reference. It does not read their contents.
A path/line hit is a navigation hint, not evidence that the content is correct.
Read the selected source and run project checks before accepting an edit.

`safe_edit` is a guarded convenience for one small exact replacement, not a
transaction across processes. It checks the hash again before atomic replace,
but a separate process changing the same file during the final filesystem
operation is outside its guarantee. Use normal project ownership and review for
concurrent edits.
