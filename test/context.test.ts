import { expect, it } from "vitest";
import { contextUsage } from "../src/state/context";
import { emptySessionChat } from "../src/state/chatReducer";
const model = {
  id: "qwen",
  providerID: "local",
  limit: { context: 131072, input: 114688, output: 16384 },
};
it("matches Qwen engine threshold and cache-aware last-turn usage without summing history", () => {
  const chat = emptySessionChat();
  chat.messageOrder = ["a", "b"];
  chat.messages = {
    a: {
      id: "a",
      sessionID: "s",
      role: "assistant",
      time: { created: 1 },
      tokens: { total: 90000 },
    },
    b: {
      id: "b",
      sessionID: "s",
      role: "assistant",
      time: { created: 2 },
      tokens: {
        input: 50000,
        output: 2000,
        reasoning: 1800,
        cache: { read: 10000, write: 1000 },
      },
    },
  };
  expect(contextUsage(chat, model, { reserved: 32768 })).toMatchObject({
    used: 63000,
    threshold: 81920,
    remaining: 18920,
    limit: 131072,
    auto: true,
  });
  chat.messages.b = {
    ...chat.messages.b,
    role: "assistant",
    tokens: { total: 81920, input: 60000, output: 5000 },
  };
  expect(contextUsage(chat, model, { reserved: 32768 })).toMatchObject({
    used: 81920,
    remaining: 0,
  });
});
it("has an honest unknown count before first usage and reflects disabled compaction", () => {
  expect(contextUsage(undefined, model, { auto: false })).toMatchObject({
    used: null,
    remaining: null,
    auto: false,
  });
});
it("uses completed compacted-turn usage and detects in-flight compaction", () => {
  const chat = emptySessionChat();
  chat.messageOrder = ["a"];
  chat.messages.a = {
    id: "a",
    sessionID: "s",
    role: "assistant",
    summary: true,
    time: { created: 1 },
    tokens: { total: 1000 },
  };
  expect(contextUsage(chat, model).compacting).toBe(true);
  chat.messages.a.time.completed = 2;
  expect(contextUsage(chat, model).compacting).toBe(false);
});
