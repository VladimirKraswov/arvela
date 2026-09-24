/**
 * OpenCode Desktop — approval gate for Pi's built-in tools.
 *
 * Why this exists: Pi's own `write`, `edit`, `bash` and friends run without
 * asking anyone. OpenCode chats are governed by the server's permission queue;
 * a Pi chat had no equivalent, so relaying *extension* dialogs alone covered
 * only extensions that happen to ask — not the tools that actually change the
 * user's files. This extension closes that gap.
 *
 * How the safe default works end to end:
 *   - a mutating tool call raises `ctx.ui.confirm()`;
 *   - in RPC mode that becomes an `extension_ui_request` on stdout;
 *   - the desktop app shows a modal and sends back the answer;
 *   - if no window can answer, or nobody answers before the native deadline,
 *     the app answers `cancelled: true`, which arrives here as `false`.
 *
 * So a closed window, a stalled WebView or a crashed UI all deny. Silence is
 * never approval. There is no "remember this" shortcut: the only way to stop
 * being asked is the explicit, user-set policy below.
 *
 * Policy comes from the app via `OCDESKTOP_PI_TOOL_POLICY`:
 *   "ask"  (default) — confirm every mutating tool call
 *   "full"           — no prompts; only when the user chose it in settings
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Tools that can change files, run commands or reach the network. */
const MUTATING = new Set([
  "write",
  "edit",
  "multiedit",
  "multi_edit",
  "apply_patch",
  "patch",
  "bash",
  "shell",
  "run",
  "fetch",
  "web_fetch",
  "download",
]);

/** Read-only built-ins; asking about these would train the user to click "yes". */
const READ_ONLY = new Set([
  "read",
  "list",
  "ls",
  "glob",
  "grep",
  "search",
  "tree",
  "lsp_diagnostics",
  "lsp_hover",
  "lsp_definition",
]);

type Policy = "ask" | "full";

function policy(): Policy {
  return process.env.OCDESKTOP_PI_TOOL_POLICY === "full" ? "full" : "ask";
}

/**
 * Everything that is not a known read-only tool needs approval. Unknown tools —
 * a new built-in, an extension's tool — fail closed rather than slipping
 * through an allowlist that was written before they existed.
 */
export function needsApproval(toolName: string): boolean {
  return !READ_ONLY.has(toolName);
}

/** Known-dangerous tools get a blunter prompt than merely unfamiliar ones. */
export function isMutating(toolName: string): boolean {
  return MUTATING.has(toolName);
}

function describe(toolName: string, input: Record<string, unknown>): string {
  const first = (...keys: string[]) => {
    for (const key of keys) {
      const value = input?.[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  };
  const target = first("command", "path", "file_path", "filePath", "url", "pattern");
  const shown = target.length > 400 ? `${target.slice(0, 400)}…` : target;
  return shown ? `${toolName}: ${shown}` : toolName;
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (policy() === "full") return;
    const toolName = String(event.toolName ?? "");
    if (!needsApproval(toolName)) return;

    let approved = false;
    try {
      approved = Boolean(
        await ctx.ui.confirm(
          isMutating(toolName)
            ? "Pi хочет изменить файлы или выполнить команду"
            : "Pi запрашивает действие",
          `${describe(toolName, (event.input ?? {}) as Record<string, unknown>)}\n\nРазрешить?`,
        ),
      );
    } catch {
      // A failed dialog is a denial, not an approval.
      approved = false;
    }
    if (!approved)
      return {
        block: true,
        reason:
          "Пользователь не разрешил это действие в OpenCode Desktop. Предложи более безопасный шаг или спроси, что делать.",
      };
  });
}
