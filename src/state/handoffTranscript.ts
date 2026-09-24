// Carrying a conversation from one engine to another.
//
// The two engines do not share a transcript format, a tool vocabulary or a
// session store, so "continuing" an OpenCode chat in Pi cannot be a silent
// swap. Two things would be dishonest and are therefore refused:
//
//   1. Giving Pi an empty context while the UI still shows the old messages.
//   2. Replaying the old messages as if Pi had produced them.
//
// What happens instead: the visible history stays with the chat that produced
// it, and a *new* chat on the other engine is seeded with a clearly labelled
// transcript. The provenance is recorded in metadata and shown in the UI.

import type { ChatRootState } from "./chatReducer";

export interface TranscriptOptions {
  /** Hard cap on characters; older turns are dropped first. */
  maxChars?: number;
  /** Include collapsed reasoning. Off by default: it is engine-specific noise. */
  includeReasoning?: boolean;
  /** Label of the engine the conversation came from. */
  sourceLabel: string;
  sourceTitle: string;
}

export interface Transcript {
  text: string;
  /** Turns actually included, after truncation. */
  included: number;
  /** Turns dropped to fit `maxChars`. */
  omitted: number;
}

// Generous on purpose: the point of a handoff is that the task context travels.
// Dropping turns is a last resort and is always reported to the user.
const DEFAULT_MAX = 48_000;

const TOOL_OUTPUT_CHARS = 400;

/**
 * A tool step carries the outcome, not just the name: "which file was read" and
 * "what the build said" are usually the context the next agent needs most. The
 * output is trimmed, and the trimming is visible rather than silent.
 */
function toolSummary(
  tool: string | undefined,
  state: unknown,
  includeOutput: boolean,
): string {
  const s = (typeof state === "object" && state ? state : {}) as {
    status?: string;
    input?: unknown;
    output?: string;
    error?: string;
  };
  const name = tool ?? "инструмент";
  const target =
    s.input && typeof s.input === "object"
      ? String(
          (s.input as Record<string, unknown>).path ??
            (s.input as Record<string, unknown>).filePath ??
            (s.input as Record<string, unknown>).command ??
            "",
        ).slice(0, 160)
      : "";
  const head = `[${name}${target ? ` ${target}` : ""}${s.status === "error" ? ": ошибка" : ""}]`;
  if (!includeOutput) return head;
  const body = (s.status === "error" ? s.error : s.output) ?? "";
  if (!body.trim()) return head;
  const trimmed = body.trim();
  return trimmed.length > TOOL_OUTPUT_CHARS
    ? `${head}\n${trimmed.slice(0, TOOL_OUTPUT_CHARS)}\n…(вывод сокращён)`
    : `${head}\n${trimmed}`;
}

/**
 * Render one session's visible history as plain text. Roles are preserved and
 * explicitly labelled so the receiving agent cannot mistake the transcript for
 * its own turns.
 */
export function buildHandoffTranscript(
  chat: ChatRootState,
  sessionId: string,
  options: TranscriptOptions,
): Transcript {
  const slot = chat.sessions[sessionId];
  if (!slot) return { text: "", included: 0, omitted: 0 };
  const turns: string[] = [];

  for (const messageId of slot.messageOrder) {
    const message = slot.messages[messageId];
    if (!message) continue;
    const parts = (slot.partsByMessage[messageId] ?? [])
      .map((id) => slot.parts[id])
      .filter(Boolean);
    const body: string[] = [];
    for (const part of parts) {
      if (part.type === "text" && part.text?.trim()) body.push(part.text.trim());
      else if (
        part.type === "reasoning" &&
        options.includeReasoning &&
        part.text?.trim()
      )
        body.push(`(размышление) ${part.text.trim()}`);
      else if (part.type === "tool")
        body.push(toolSummary(part.tool, part.state, true));
      else if (part.type === "file")
        body.push(`[вложение ${part.filename ?? part.mime ?? "файл"}]`);
    }
    if (!body.length) continue;
    const who = message.role === "user" ? "Пользователь" : "Ассистент";
    turns.push(`### ${who}\n${body.join("\n\n")}`);
  }

  /** Same conversation, tool steps reduced to their headline. */
  const compact = (): string[] => {
    const out: string[] = [];
    for (const messageId of slot.messageOrder) {
      const message = slot.messages[messageId];
      if (!message) continue;
      const parts = (slot.partsByMessage[messageId] ?? [])
        .map((id) => slot.parts[id])
        .filter(Boolean);
      const body: string[] = [];
      for (const part of parts) {
        if (part.type === "text" && part.text?.trim()) body.push(part.text.trim());
        else if (part.type === "tool")
          body.push(toolSummary(part.tool, part.state, false));
      }
      if (!body.length) continue;
      const who = message.role === "user" ? "Пользователь" : "Ассистент";
      out.push(`### ${who}\n${body.join("\n\n")}`);
    }
    return out;
  };

  const max = options.maxChars ?? DEFAULT_MAX;
  let omitted = 0;
  let trimmedOutput = false;
  // Shed detail before shedding turns: tool output is the cheapest thing to
  // lose, a whole turn is the most expensive.
  if (turns.join("\n\n").length > max) {
    trimmedOutput = true;
    turns.length = 0;
    for (const turn of compact()) turns.push(turn);
  }
  // Only then drop from the beginning: recent turns matter most for continuation.
  while (turns.length > 1 && turns.join("\n\n").length > max) {
    turns.shift();
    omitted += 1;
  }

  const header = [
    `Ниже — расшифровка предыдущего разговора из ${options.sourceLabel}` +
      (options.sourceTitle ? ` («${options.sourceTitle}»)` : "") +
      ".",
    "Это НЕ твои прошлые сообщения: их писал другой агент в другой сессии.",
    "Используй расшифровку как контекст задачи и продолжай работу с текущего момента.",
    trimmedOutput
      ? "Вывод инструментов сокращён до заголовков, чтобы уместить разговор."
      : "",
    omitted
      ? `Ранние ${omitted} реплик(и) опущены из-за размера; при необходимости спроси о них.`
      : "",
    "",
    "---",
    "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    text: turns.length ? `${header}${turns.join("\n\n")}` : "",
    included: turns.length,
    omitted,
  };
}
