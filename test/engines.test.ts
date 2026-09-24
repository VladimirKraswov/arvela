import { expect, it } from "vitest";
import {
  DEFAULT_ENGINE,
  engineForDirectory,
  engineForSession,
  engineOptions,
  modelScope,
  piAvailability,
} from "../src/state/engines";
import { buildHandoffTranscript } from "../src/state/handoffTranscript";
import { emptyChatRoot, reduceEvent } from "../src/state/chatReducer";

it("defaults every folder and chat to OpenCode", () => {
  // This *is* the migration: projects and chats created before engine selection
  // simply have no entry, and must resolve to OpenCode rather than to nothing.
  expect(DEFAULT_ENGINE).toBe("opencode");
  expect(engineForDirectory({}, "/legacy/project")).toBe("opencode");
  expect(engineForDirectory({}, null)).toBe("opencode");
  expect(engineForSession({}, "ses_old", "/legacy/project")).toBe("opencode");
});

it("prefers the per-chat override over the folder preference", () => {
  const prefs = {
    projectEngine: { "/work": "pi" },
    sessionEngine: { ses_a: "opencode" },
  };
  expect(engineForDirectory(prefs, "/work")).toBe("pi");
  // A chat keeps the engine that produced its transcript.
  expect(engineForSession(prefs, "ses_a", "/work")).toBe("opencode");
  // A folder preference governs the *composer* for a new chat.
  expect(engineForSession(prefs, null, "/work")).toBe("pi");
});

it("uses the chosen engine for a new chat without a project, but keeps old chats on OpenCode", () => {
  const prefs = { newChatEngine: "pi" };
  expect(engineForSession(prefs, null, null)).toBe("pi");
  expect(engineForSession(prefs, "ses_existing", null)).toBe("opencode");
});

it("never reinterprets existing OpenCode chats when the folder later switches to Pi", () => {
  // The dangerous case: a project full of OpenCode history, then the user sets
  // the folder default to Pi. Those chats have no sessionEngine entry, and if
  // the folder preference were the fallback their ids would be handed to an
  // engine that has never seen them.
  const before = { projectEngine: {} as Record<string, string> };
  expect(engineForSession(before, "ses_legacy", "/work")).toBe("opencode");

  const after = { projectEngine: { "/work": "pi" } };
  expect(engineForSession(after, "ses_legacy", "/work")).toBe("opencode");
  expect(engineForSession(after, "ses_another", "/work")).toBe("opencode");
  // Only a *new* chat follows the folder.
  expect(engineForSession(after, null, "/work")).toBe("pi");
});

it("treats Pi session metadata as durable proof of origin", () => {
  // A Pi chat must survive losing its sessionEngine entry (older preferences,
  // a partial restore): the transcript metadata is the durable evidence.
  const prefs = {
    projectEngine: { "/work": "opencode" },
    piSessions: {
      "chat-x": { id: "chat-x", directory: "/work", title: "t", created: 1, updated: 1 },
    },
  };
  expect(engineForSession(prefs, "chat-x", "/work")).toBe("pi");
  expect(engineForSession(prefs, "ses_other", "/work")).toBe("opencode");
});

it("does not let one folder's engine leak into another", () => {
  const prefs = { projectEngine: { "/a": "pi" } };
  expect(engineForDirectory(prefs, "/a")).toBe("pi");
  expect(engineForDirectory(prefs, "/b")).toBe("opencode");
});

it("keeps model preferences in separate namespaces per engine", () => {
  // OpenCode keeps the historic unprefixed keys so existing preferences resolve
  // exactly as before; Pi gets its own space.
  expect(modelScope("opencode", "session:x")).toBe("session:x");
  expect(modelScope("pi", "session:x")).toBe("pi::session:x");
  expect(modelScope("pi", "/work")).not.toBe(modelScope("opencode", "/work"));
});

it("explains why Pi is unavailable instead of silently hiding it", () => {
  expect(piAvailability({ activeHost: "local" }).available).toBe(true);
  const remote = piAvailability({ activeHost: "vm-1" });
  expect(remote.available).toBe(false);
  expect(remote.reason).toContain("этом компьютере");

  const offered = engineOptions({ activeHost: "local" }, false);
  expect(offered.find((e) => e.id === "pi")).toMatchObject({
    available: false,
    reason: expect.stringContaining("не найден"),
  });
  expect(offered.find((e) => e.id === "opencode")?.available).toBe(true);
});

function conversation() {
  const root = emptyChatRoot();
  const add = (id: string, role: "user" | "assistant", text: string) => {
    reduceEvent(root, {
      type: "message.updated",
      id: `e-${id}`,
      properties: {
        info: { id, sessionID: "ses_a", role, time: { created: 1 } },
      },
    });
    reduceEvent(root, {
      type: "message.part.updated",
      id: `p-${id}`,
      properties: {
        part: { id: `${id}-0`, sessionID: "ses_a", messageID: id, type: "text", text },
      },
    });
  };
  add("m1", "user", "почини сборку");
  add("m2", "assistant", "нашёл ошибку в vite.config");
  reduceEvent(root, {
    type: "message.part.updated",
    id: "p-tool",
    properties: {
      part: {
        id: "m2-1",
        sessionID: "ses_a",
        messageID: "m2",
        type: "tool",
        tool: "edit",
        state: {
          status: "completed",
          input: { path: "vite.config.ts" },
          output: "сборка починена",
        },
      },
    },
  });
  return root;
}

it("hands a transcript over with explicit provenance, never as the new agent's own turns", () => {
  const transcript = buildHandoffTranscript(conversation(), "ses_a", {
    sourceLabel: "OpenCode",
    sourceTitle: "Сборка",
  });
  expect(transcript.included).toBe(2);
  expect(transcript.text).toContain("расшифровка предыдущего разговора из OpenCode");
  expect(transcript.text).toContain("Это НЕ твои прошлые сообщения");
  expect(transcript.text).toContain("### Пользователь\nпочини сборку");
  expect(transcript.text).toContain("### Ассистент");
  // Tool steps are summarized with their outcome, not replayed as if they
  // could be re-run: the next agent needs what happened, not an instruction.
  expect(transcript.text).toContain("[edit vite.config.ts]");
  expect(transcript.text).toContain("сборка починена");
});

it("sheds tool output before it sheds whole turns", () => {
  const root = conversation();
  const big = buildHandoffTranscript(root, "ses_a", {
    sourceLabel: "OpenCode",
    sourceTitle: "Сборка",
    // Enough for both turns, not enough for the tool output.
    maxChars: 100,
  });
  expect(big.omitted).toBe(0);
  expect(big.included).toBe(2);
  expect(big.text).toContain("Вывод инструментов сокращён");
  expect(big.text).not.toContain("сборка починена");
  expect(big.text).toContain("почини сборку");
});

it("says how much was dropped rather than silently truncating", () => {
  const transcript = buildHandoffTranscript(conversation(), "ses_a", {
    sourceLabel: "OpenCode",
    sourceTitle: "Сборка",
    maxChars: 40,
  });
  expect(transcript.omitted).toBeGreaterThan(0);
  expect(transcript.text).toContain("опущены из-за размера");
});

it("produces nothing for a chat with no visible content", () => {
  expect(
    buildHandoffTranscript(emptyChatRoot(), "missing", {
      sourceLabel: "OpenCode",
      sourceTitle: "x",
    }),
  ).toEqual({ text: "", included: 0, omitted: 0 });
});

it("keeps engine-specific reasoning out of the transcript by default", () => {
  const root = conversation();
  reduceEvent(root, {
    type: "message.part.updated",
    id: "p-think",
    properties: {
      part: {
        id: "m2-2",
        sessionID: "ses_a",
        messageID: "m2",
        type: "reasoning",
        text: "внутренние рассуждения",
      },
    },
  });
  const plain = buildHandoffTranscript(root, "ses_a", {
    sourceLabel: "OpenCode",
    sourceTitle: "x",
  });
  expect(plain.text).not.toContain("внутренние рассуждения");
  const withReasoning = buildHandoffTranscript(root, "ses_a", {
    sourceLabel: "OpenCode",
    sourceTitle: "x",
    includeReasoning: true,
  });
  expect(withReasoning.text).toContain("внутренние рассуждения");
});
