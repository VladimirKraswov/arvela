import type { MessagePart } from "../api/types";
import type { SessionChatState } from "./chatReducer";
import { normalizeLocalPath, isAbsoluteLocalPath, pathIsWithin } from "../util/paths";

export interface ContextFile { key: string; name: string; messageID: string; path?: string; mime?: string }
export interface ContextSnapshot { sources: ContextFile[]; results: ContextFile[] }
/** Derive actual inputs/outputs from the loaded transcript, without following links or reading files. */
export function sessionContext(chat?: SessionChatState): ContextSnapshot {
  const sources: ContextFile[] = [], results = new Map<string, ContextFile>();
  if (!chat) return { sources, results: [] };
  const output = (value: unknown, part: MessagePart) => {
    if (typeof value !== "string" || !value.trim() || value.length > 4096 || /[\0\r\n]/.test(value)) return;
    const path = normalizeLocalPath(value);
    results.set(path, { key: path, path, name: path.split(/[\\/]/).slice(-1)[0] || path, messageID: part.messageID });
  };
  for (const id of chat.messageOrder) {
    const message = chat.messages[id];
    for (const pid of chat.partsByMessage[id] || []) {
      const p = chat.parts[pid]; if (!p || p.ignored) continue;
      if (p.type === "file" && message?.role === "user") sources.push({ key: p.id, name: p.filename || "Вложение", mime: p.mime, messageID: id });
      if (message?.role !== "assistant") continue;
      if (p.type === "patch" && Array.isArray((p as MessagePart & { files?: unknown[] }).files))
        for (const file of (p as MessagePart & { files: unknown[] }).files) output(file, p);
      if (p.type === "tool" && p.state?.status === "completed" && ["write", "edit", "apply_patch"].includes(p.tool || "")) {
        const input = p.state.input as Record<string, unknown> | undefined;
        output(input?.filePath ?? input?.path, p);
      }
      if (p.type === "text" && p.text) {
        // Explicit local-file links in answers are outputs. Remote links and arbitrary prose are not files.
        for (const match of p.text.matchAll(/\[[^\]\n]*\]\(<?([^\n)]+?)>?\)/g)) {
          const path = match[1].replace(/:\d+$/, "");
          if (isAbsoluteLocalPath(path)) output(path, p);
        }
      }
    }
  }
  return { sources, results: [...results.values()] };
}
export function projectFile(path: string, directory: string): string | null {
  const root = normalizeLocalPath(directory), clean = normalizeLocalPath(path);
  if (clean.split("/").some(segment => segment === ".." || segment === ".")) return null;
  const absolute = isAbsoluteLocalPath(clean) ? clean : normalizeLocalPath(`${root}/${clean}`);
  if (!pathIsWithin(absolute, root) || absolute === root) return null;
  return absolute.slice(root.length + (root.endsWith("/") ? 0 : 1));
}
