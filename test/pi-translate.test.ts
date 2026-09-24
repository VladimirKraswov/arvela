import { describe, expect, it } from "vitest";
import {
  entriesToHistory,
  PiStreamTranslator,
  toolOutputText,
} from "../src/agent/pi/translate";
import { emptyChatRoot, reduceEvent } from "../src/state/chatReducer";
import type { PiEntry, PiEvent } from "../src/agent/pi/protocol";

const SID = "chat-pi-1";

function entry(id: string, message: unknown, parentId?: string): PiEntry {
  return {
    type: "message",
    id,
    parentId: parentId ?? null,
    timestamp: "2026-09-24T20:07:27.297Z",
    message: message as PiEntry["message"],
  };
}

describe("durable history", () => {
  it("maps a real Pi transcript onto the app's message model", () => {
    const history = entriesToHistory(SID, [
      { type: "model_change", id: "m1", provider: "deepseek", modelId: "x" },
      entry("u1", { role: "user", content: [{ type: "text", text: "привет" }] }),
      entry("a1", {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "подумаю" },
          { type: "text", text: "ответ" },
          { type: "toolCall", id: "call_1", name: "read", arguments: { path: "a.ts" } },
        ],
        provider: "deepseek",
        model: "deepseek-v4-flash",
        stopReason: "toolUse",
        usage: { input: 10, output: 2, totalTokens: 12, cost: { total: 0.5 } },
      }),
      entry("t1", {
        role: "toolResult",
        toolCallId: "call_1",
        toolName: "read",
        content: [{ type: "text", text: "file body" }],
      }),
    ]);

    expect(history.map((m) => m.info.role)).toEqual(["user", "assistant"]);
    expect(history[0].parts[0]).toMatchObject({ type: "text", text: "привет" });

    const assistant = history[1];
    expect(assistant.info).toMatchObject({
      providerID: "deepseek",
      modelID: "deepseek-v4-flash",
      finish: "tool-calls",
      cost: 0.5,
    });
    expect(assistant.parts.map((p) => p.type)).toEqual(["reasoning", "text", "tool"]);
    // A tool result is not a separate bubble: it completes the call that made it.
    expect(assistant.parts[2].state).toMatchObject({
      status: "completed",
      output: "file body",
    });
  });

  it("marks a failed tool result as an error rather than a normal completion", () => {
    const history = entriesToHistory(SID, [
      entry("a1", {
        role: "assistant",
        content: [{ type: "toolCall", id: "c", name: "bash" }],
      }),
      entry("t1", {
        role: "toolResult",
        toolCallId: "c",
        toolName: "bash",
        isError: true,
        content: [{ type: "text", text: "boom" }],
      }),
    ]);
    expect(history[0].parts[0].state).toMatchObject({
      status: "error",
      error: "boom",
    });
  });

  it("ignores entry kinds it does not model instead of failing", () => {
    expect(
      entriesToHistory(SID, [
        { type: "thinking_level_change", id: "x", thinkingLevel: "high" },
        { type: "message", id: "y" },
      ]),
    ).toEqual([]);
  });

  it("summarizes non-text tool output without pretending it was text", () => {
    expect(toolOutputText([{ type: "image", data: "x", mimeType: "image/png" }])).toBe(
      "[изображение]",
    );
    expect(toolOutputText(undefined)).toBe("");
  });
});

describe("streaming", () => {
  const run = (events: PiEvent[]) => {
    const translator = new PiStreamTranslator(SID);
    const root = emptyChatRoot();
    let resync = false;
    const notices: string[] = [];
    for (const event of events) {
      const result = translator.translate(event);
      for (const e of result.events) reduceEvent(root, e);
      resync ||= Boolean(result.needsHistoryResync);
      if (result.notice) notices.push(result.notice.text);
    }
    return { root, resync, notices };
  };

  it("renders streamed text, reasoning and tool steps through the existing reducer", () => {
    const { root } = run([
      { type: "agent_start" },
      { type: "message_start", message: { role: "assistant", content: [], provider: "deepseek", model: "m" } },
      { type: "message_update", assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } },
      { type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "ду" } },
      { type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "маю" } },
      { type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 1 } },
      { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "При" } },
      { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "вет" } },
      { type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 2, id: "c1", toolName: "read" } },
      { type: "tool_execution_start", toolCallId: "c1", toolName: "read", args: { path: "a.ts" } },
      { type: "tool_execution_end", toolCallId: "c1", toolName: "read", result: { content: [{ type: "text", text: "ok" }] } },
    ]);

    const slot = root.sessions[SID];
    expect(slot.status).toEqual({ type: "busy" });
    const messageId = slot.messageOrder[0];
    const parts = slot.partsByMessage[messageId].map((id) => slot.parts[id]);
    expect(parts.find((p) => p.type === "reasoning")?.text).toBe("думаю");
    expect(parts.find((p) => p.type === "text")?.text).toBe("Привет");
    expect(parts.find((p) => p.type === "tool")?.state).toMatchObject({
      status: "completed",
      output: "ok",
    });
  });

  it("asks for a durable history re-read once the run settles", () => {
    // Streaming ids are provisional; only Pi's entry ids survive a restart.
    const { root, resync } = run([
      { type: "agent_start" },
      { type: "message_start", message: { role: "assistant", content: [] } },
      { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "hi" } },
      { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "hi" }], stopReason: "stop" } },
      { type: "agent_settled" },
    ]);
    expect(resync).toBe(true);
    expect(root.sessions[SID].status).toEqual({ type: "idle" });
    expect(root.sessions[SID].messageOrder[0]).toMatch(/^pi-live-assistant-/);
  });

  it("reports a retry as retrying and a final failure as an error", () => {
    const retry = run([
      { type: "agent_start" },
      { type: "auto_retry_start", attempt: 1, maxAttempts: 3, errorMessage: "529 overloaded" },
    ]);
    expect(retry.root.sessions[SID].status).toMatchObject({ type: "retry", attempt: 1 });

    const failed = run([
      { type: "agent_start" },
      { type: "auto_retry_end", success: false, attempt: 3, finalError: "overloaded" },
    ]);
    expect(failed.root.sessions[SID].lastError).toContain("overloaded");
  });

  it("surfaces a dead Pi process instead of a silently stalled conversation", () => {
    const { root, notices } = run([{ type: "agent_start" }, { type: "pi_exited" }]);
    expect(root.sessions[SID].lastError).toContain("Pi");
    expect(notices.join(" ")).toContain("завершился");
  });

  it("keeps an extension fault out of the conversation transcript", () => {
    const { root, notices } = run([
      { type: "extension_error", extensionPath: "/x.ts", error: "bad" },
    ]);
    expect(root.sessions[SID]).toBeUndefined();
    expect(notices[0]).toContain("Расширение Pi");
  });

  it("ignores unknown event and delta types", () => {
    const translator = new PiStreamTranslator(SID);
    expect(translator.translate({ type: "future_event" }).events).toEqual([]);
    expect(
      translator.translate({
        type: "message_update",
        assistantMessageEvent: { type: "future_delta", contentIndex: 0 },
      }).events,
    ).toEqual([]);
  });
});
