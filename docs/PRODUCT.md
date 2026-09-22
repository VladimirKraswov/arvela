# Product brief

## User intent

The user wants **OpenCode Desktop**, installed over OpenCode and updated independently. They prefer the workspace and capabilities of the Codex desktop app, but want their local Qwen3.8 Flash Next to power the coding agent. They specifically asked OpenCode/Qwen to implement the shell; this repository contains a starter and specifications for that work.

## Workspace layout

Use a restrained desktop design: thin native title area; roughly 240px left sidebar; readable center conversation; optional resizable right review/files panel and bottom terminal. Warm/neutral dark surfaces, subtle separators, compact readable typography, quiet status colors. Match the workflow and density of a serious coding tool, not a generic dashboard. Use original assets and the OpenCode Desktop identity.

The sidebar contains New conversation, project selector/add folder, search, grouped recent sessions, and settings/connection status. The center header shows session title, directory, branch/status and panel toggles. Message history has a comfortable reading width; tool and thinking entries collapse without hiding errors or requests needing action. Composer stays near the bottom and includes model, agent, supported reasoning effort, attachments, send and stop.

Review/file/terminal panes should be usable alongside chat and maintain their dimensions. The app must work in an ordinary laptop window and on a large display. Keyboard navigation and focus restoration are first-class, including accessible names for icon controls.

## Primary flows

1. Launch → connect to installed local OpenCode → select project → resume/new conversation → choose model/agent/Medium → send task.
2. Observe reasoning/tools → approve a concrete permission or answer a question → inspect changes → run tests in terminal → read the final result.
3. Switch projects while a task runs → maintain correct task state → return without losing drafts, history, pending questions or changes.
4. Lose server connection → keep draft/history → show disconnected/reconnecting state → resync when healthy, never silently resend a prompt.
5. Update OpenCode separately → app detects reported version → compatible core features keep working; unavailable features explain the limitation.

## Truthful status

Do not equate quiet output with a crash. Display engine session status, active tools, pending permission/questions, stream connectivity and last event time separately. For `length`, explain output-budget exhaustion; for `error` or `aborted`, preserve the distinction. Existing model/runtime safeguards remain in OpenCode and FreeToken; the desktop must not add an uncontrolled automatic follow-up loop.

## Ownership and settings

OpenCode owns histories, execution, credentials/providers, agents, skills, compaction and model routing. Desktop owns theme, layout, selected directories, drafts and endpoint preference. Changing the UI must not silently reset sessions or rewrite global agent behavior. Show detected configuration, don't recreate a second conflicting configuration system.

## Definition of useful

Real tool execution and real reviewable code changes, including errors and interruption, matter more than decorative feature count. A feature without a working API should be absent or visibly unavailable with an explanation. The long-term scope is extensive, but the first release must pass M1–M6 before adding M7 features.
