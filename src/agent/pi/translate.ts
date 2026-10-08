// Pure translation from Pi's RPC vocabulary into the application's own event and
// message model, so the existing stream reducer, renderer and scroll logic work
// for Pi exactly as they do for OpenCode — without a second agent loop.
//
// Two different id spaces meet here:
//  - While streaming, Pi has not persisted the assistant message yet and its
//    events carry no id. The translator mints *provisional* ids so the UI can
//    render live text.
//  - Once the run settles, `get_entries` returns the durable entry ids. The
//    backend then replaces the session's history with that authoritative
//    snapshot, exactly like the reconnect resync path.
//
// `needsHistoryResync` is how the translator asks for that swap.

import type {
  Message,
  MessagePart,
  MessageResponse,
  ServerEvent,
  ToolState,
} from "../../api/types";
import type {
  PiAssistantMessage,
  PiContent,
  PiEntry,
  PiEvent,
  PiMessage,
  PiToolResultMessage,
  PiUsage,
} from "./protocol";

function contentBlocks(message: PiMessage): PiContent[] {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? (content as PiContent[]) : [];
}

function textOf(blocks: PiContent[]): string {
  return blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => String((b as { text: string }).text))
    .join("\n");
}

function tokensOf(usage: PiUsage | undefined) {
  if (!usage) return undefined;
  return {
    input: usage.input,
    output: usage.output,
    reasoning: usage.reasoning,
    total: usage.totalTokens,
    cache: { read: usage.cacheRead, write: usage.cacheWrite },
  };
}

/** Pi reports stop reasons; the renderer only distinguishes "not a clean stop". */
function finishOf(message: PiAssistantMessage): string | null {
  const reason = message.stopReason;
  if (!reason || reason === "stop") return reason ?? null;
  return reason === "toolUse" ? "tool-calls" : reason;
}

function partId(messageID: string, index: number): string {
  return `${messageID}#${index}`;
}

function toolState(
  status: ToolState["status"],
  extra: Partial<ToolState> = {},
): ToolState {
  return { status, ...extra };
}

/** Tool output blocks are text; images and unknown blocks are summarized. */
export function toolOutputText(blocks: PiContent[] | undefined): string {
  if (!blocks?.length) return "";
  return blocks
    .map((b) =>
      b.type === "text" && typeof b.text === "string"
        ? String(b.text)
        : b.type === "image"
          ? "[изображение]"
          : "",
    )
    .filter(Boolean)
    .join("\n");
}

// ------------------------------------------------------------------- history

/**
 * Turn the durable session entries into the application's history shape.
 *
 * `toolResult` entries are not separate messages in this UI: they complete the
 * tool part of the assistant message that called them, matching how OpenCode
 * reports tool state.
 */
export function entriesToHistory(
  sessionID: string,
  entries: PiEntry[],
): MessageResponse[] {
  const out: MessageResponse[] = [];
  const toolPart = new Map<string, MessagePart>();

  for (const entry of entries) {
    if (entry.type !== "message" || !entry.message) continue;
    const message = entry.message;
    const created = Date.parse(entry.timestamp ?? "") || Date.now();
    const id = entry.id;

    if (message.role === "toolResult") {
      const result = message as PiToolResultMessage;
      const part = toolPart.get(result.toolCallId);
      if (part) {
        // Spread the previous state first: the result's status is the new
        // truth, and must not be overwritten by the "running" it replaces.
        part.state = {
          ...part.state,
          status: result.isError ? "error" : "completed",
          output: toolOutputText(result.content),
          ...(result.isError
            ? { error: toolOutputText(result.content) || "Ошибка инструмента" }
            : {}),
          time: { ...(part.state?.time ?? {}), end: created },
        };
      }
      continue;
    }

    if (message.role === "user") {
      const blocks = contentBlocks(message);
      const info: Message = {
        id,
        sessionID,
        role: "user",
        timingSource: 'entry',
        ...(typeof message.timestamp === 'number' ? {timingKey: `pi:user:${message.timestamp}`} : {}),
        time: { created },
      };
      const parts: MessagePart[] = [];
      blocks.forEach((block, index) => {
        if (block.type === "text" && typeof block.text === "string") {
          parts.push({
            id: partId(id, index),
            sessionID,
            messageID: id,
            type: "text",
            text: String(block.text),
          });
        } else if (block.type === "image") {
          parts.push({
            id: partId(id, index),
            sessionID,
            messageID: id,
            type: "file",
            mime: String((block as { mimeType?: string }).mimeType ?? "image/png"),
            filename: "изображение",
          });
        }
      });
      out.push({ info, parts });
      continue;
    }

    if (message.role === "assistant") {
      const assistant = message as PiAssistantMessage;
      const info: Message = {
        id,
        sessionID,
        role: "assistant",
        timingSource: 'entry',
        time: { created, completed: created },
        providerID: assistant.provider,
        modelID: assistant.model,
        tokens: tokensOf(assistant.usage),
        cost: assistant.usage?.cost?.total,
        finish: finishOf(assistant),
      };
      const parts: MessagePart[] = [];
      contentBlocks(assistant).forEach((block, index) => {
        const base = { id: partId(id, index), sessionID, messageID: id };
        if (block.type === "text") {
          parts.push({ ...base, type: "text", text: String(block.text ?? "") });
        } else if (block.type === "thinking") {
          parts.push({
            ...base,
            type: "reasoning",
            text: String((block as { thinking?: string }).thinking ?? ""),
          });
        } else if (block.type === "toolCall") {
          const call = block as { id: string; name: string; arguments?: unknown };
          const part: MessagePart = {
            ...base,
            type: "tool",
            tool: call.name,
            callID: call.id,
            state: toolState("running", {
              input: call.arguments,
              time: { start: created },
            }),
          };
          toolPart.set(call.id, part);
          parts.push(part);
        }
      });
      out.push({ info, parts });
      continue;
    }

    if (message.role === "bashExecution") {
      const bash = message as { command?: string; output?: string };
      out.push({
        info: { id, sessionID, role: "assistant", time: { created } },
        parts: [
          {
            id: partId(id, 0),
            sessionID,
            messageID: id,
            type: "tool",
            tool: "bash",
            callID: id,
            synthetic: true,
            state: toolState("completed", {
              input: { command: bash.command },
              output: String(bash.output ?? ""),
            }),
          },
        ],
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------ streaming

export interface TranslationResult {
  events: ServerEvent[];
  /** The durable history must be re-read: provisional ids are now stale. */
  needsHistoryResync?: boolean;
  /** Surfaced outside the conversation (extension faults, transport errors). */
  notice?: { level: "warning" | "error"; text: string };
}

const EMPTY: TranslationResult = { events: [] };

/**
 * Stateful only in the way streaming requires: it remembers the provisional
 * message id and the per-index accumulation of the message currently streaming.
 * One instance per Pi session.
 */
export class PiStreamTranslator {
  private messageSeq = 0;
  private current: string | null = null;
  private thinking = new Map<number, string>();
  private toolCallPart = new Map<string, { messageID: string; index: number }>();

  constructor(private readonly sessionID: string) {}

  /** Provisional ids are clearly marked so they can never be mistaken for Pi ids. */
  private nextMessageId(role: "user" | "assistant"): string {
    this.messageSeq += 1;
    return `pi-live-${role}-${this.messageSeq}`;
  }

  private status(status: ServerEvent["properties"]): ServerEvent {
    return {
      type: "session.status",
      properties: { sessionID: this.sessionID, ...status },
    };
  }

  private partUpdated(part: MessagePart): ServerEvent {
    return { type: "message.part.updated", properties: { part } };
  }

  translate(event: PiEvent): TranslationResult {
    switch (event.type) {
      case "agent_start":
        return { events: [this.status({ status: { type: "busy" } })] };

      case "agent_settled":
        this.current = null;
        this.thinking.clear();
        this.toolCallPart.clear();
        return {
          events: [
            { type: "session.idle", properties: { sessionID: this.sessionID } },
          ],
          needsHistoryResync: true,
        };

      case "message_start":
        return this.onMessageStart(event);

      case "message_update":
        return this.onDelta(event);

      case "message_end":
        return this.onMessageEnd(event);

      case "tool_execution_start":
      case "tool_execution_update":
      case "tool_execution_end":
        return this.onToolExecution(event);

      case "auto_retry_start":
        return {
          events: [
            this.status({
              status: {
                type: "retry",
                attempt: event.attempt,
                message: event.errorMessage?.slice(0, 300),
              },
            }),
          ],
        };

      case "auto_retry_end":
        return event.success
          ? { events: [this.status({ status: { type: "busy" } })] }
          : {
              events: [
                {
                  type: "session.error",
                  properties: {
                    sessionID: this.sessionID,
                    error: {
                      message:
                        event.finalError ?? "Pi прекратил повторные попытки.",
                    },
                  },
                },
              ],
            };

      case "compaction_start":
        return {
          events: [
            this.status({ status: { type: "waiting", message: "Сжатие контекста" } }),
          ],
        };

      case "compaction_end":
        return { events: [], needsHistoryResync: true };

      case "extension_error":
        return {
          events: [],
          notice: {
            level: "warning",
            text: `Расширение Pi сообщило об ошибке: ${String(event.error ?? "").slice(0, 300)}`,
          },
        };

      case "pi_exited":
        this.current = null;
        return {
          events: [
            {
              type: "session.error",
              properties: {
                sessionID: this.sessionID,
                error: { message: "Процесс Pi завершился." },
              },
            },
          ],
          notice: { level: "error", text: "Процесс Pi завершился." },
        };

      default:
        return EMPTY;
    }
  }

  private onMessageStart(event: PiEvent): TranslationResult {
    const message = event.message;
    if (!message) return EMPTY;
    if (message.role === "user") {
      // Pi echoes the accepted user message; render it immediately so the
      // composer can clear without waiting for the run to settle.
      const id = this.nextMessageId("user");
      const blocks = contentBlocks(message);
      const info: Message = {
        id,
        sessionID: this.sessionID,
        role: "user",
        timingSource: 'live',
        ...(typeof message.timestamp === 'number' ? {timingKey: `pi:user:${message.timestamp}`} : {}),
        time: { created: Date.now() },
      };
      return {
        events: [
          { type: "message.updated", properties: { info } },
          ...(textOf(blocks)
            ? [
                this.partUpdated({
                  id: partId(id, 0),
                  sessionID: this.sessionID,
                  messageID: id,
                  type: "text",
                  text: textOf(blocks),
                }),
              ]
            : []),
        ],
      };
    }
    if (message.role !== "assistant") return EMPTY;
    const id = this.nextMessageId("assistant");
    this.current = id;
    this.thinking.clear();
    const assistant = message as PiAssistantMessage;
    const info: Message = {
      id,
      sessionID: this.sessionID,
      role: "assistant",
      time: { created: Date.now() },
      providerID: assistant.provider,
      modelID: assistant.model,
    };
    return { events: [{ type: "message.updated", properties: { info } }] };
  }

  private onDelta(event: PiEvent): TranslationResult {
    const delta = event.assistantMessageEvent;
    const messageID = this.current;
    if (!delta || !messageID) return EMPTY;
    const index = typeof delta.contentIndex === "number" ? delta.contentIndex : 0;

    switch (delta.type) {
      case "text_delta":
        return {
          events: [
            {
              type: "message.part.delta",
              properties: {
                sessionID: this.sessionID,
                messageID,
                partID: partId(messageID, index),
                field: "text",
                delta: String((delta as { delta?: string }).delta ?? ""),
              },
            },
          ],
        };

      case "thinking_delta": {
        // The reducer's delta path creates a *text* part, so reasoning is sent
        // as a cumulative part update instead of a delta.
        const text =
          (this.thinking.get(index) ?? "") +
          String((delta as { delta?: string }).delta ?? "");
        this.thinking.set(index, text);
        return {
          events: [
            this.partUpdated({
              id: partId(messageID, index),
              sessionID: this.sessionID,
              messageID,
              type: "reasoning",
              text,
            }),
          ],
        };
      }

      case "toolcall_start": {
        const start = delta as { id: string; toolName: string };
        this.toolCallPart.set(start.id, { messageID, index });
        return {
          events: [
            this.partUpdated({
              id: partId(messageID, index),
              sessionID: this.sessionID,
              messageID,
              type: "tool",
              tool: start.toolName,
              callID: start.id,
              state: toolState("pending"),
            }),
          ],
        };
      }

      case "toolcall_end": {
        const end = delta as { toolCall?: { id: string; name: string; arguments?: unknown } };
        if (!end.toolCall) return EMPTY;
        this.toolCallPart.set(end.toolCall.id, { messageID, index });
        return {
          events: [
            this.partUpdated({
              id: partId(messageID, index),
              sessionID: this.sessionID,
              messageID,
              type: "tool",
              tool: end.toolCall.name,
              callID: end.toolCall.id,
              state: toolState("running", { input: end.toolCall.arguments }),
            }),
          ],
        };
      }

      default:
        return EMPTY;
    }
  }

  private onToolExecution(event: PiEvent): TranslationResult {
    const callId = event.toolCallId;
    if (!callId) return EMPTY;
    const located = this.toolCallPart.get(callId);
    const messageID = located?.messageID ?? this.current;
    if (!messageID) return EMPTY;
    const index = located?.index ?? 0;
    const status: ToolState["status"] =
      event.type === "tool_execution_end"
        ? event.isError
          ? "error"
          : "completed"
        : "running";
    const output =
      event.type === "tool_execution_end"
        ? toolOutputText(event.result?.content)
        : toolOutputText(event.partialResult?.content);
    return {
      events: [
        this.partUpdated({
          id: partId(messageID, index),
          sessionID: this.sessionID,
          messageID,
          type: "tool",
          tool: event.toolName,
          callID: callId,
          state: toolState(status, {
            input: event.args,
            output,
            ...(status === "error"
              ? { error: output || "Ошибка инструмента" }
              : {}),
            time:
              event.type === "tool_execution_start"
                ? { start: Date.now() }
                : event.type === "tool_execution_end"
                  ? { end: Date.now() }
                  : undefined,
          }),
        }),
      ],
    };
  }

  private onMessageEnd(event: PiEvent): TranslationResult {
    const message = event.message;
    if (!message || message.role !== "assistant") return EMPTY;
    const messageID = this.current;
    if (!messageID) return EMPTY;
    const assistant = message as PiAssistantMessage;
    const info: Message = {
      id: messageID,
      sessionID: this.sessionID,
      role: "assistant",
      time: { created: Date.now(), completed: Date.now() },
      providerID: assistant.provider,
      modelID: assistant.model,
      tokens: tokensOf(assistant.usage),
      cost: assistant.usage?.cost?.total,
      finish: finishOf(assistant),
      ...(assistant.stopReason === "error"
        ? { error: { message: "Pi завершил ответ ошибкой." } }
        : {}),
    };
    const events: ServerEvent[] = [
      { type: "message.updated", properties: { info } },
    ];
    // message_end is authoritative for this message's content.
    contentBlocks(assistant).forEach((block, index) => {
      const base = {
        id: partId(messageID, index),
        sessionID: this.sessionID,
        messageID,
      };
      if (block.type === "text") {
        events.push(
          this.partUpdated({ ...base, type: "text", text: String(block.text ?? "") }),
        );
      } else if (block.type === "thinking") {
        events.push(
          this.partUpdated({
            ...base,
            type: "reasoning",
            text: String((block as { thinking?: string }).thinking ?? ""),
          }),
        );
      }
    });
    return { events };
  }
}
