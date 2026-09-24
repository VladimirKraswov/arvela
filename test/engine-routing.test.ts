// Store-level routing: the right engine must receive each prompt, and choosing
// an engine must never disturb another chat or the global defaults.

import { beforeEach, expect, it, vi } from "vitest";
import type { PiBridge } from "../src/agent/pi/native";
import type { PiEnvelope } from "../src/agent/pi/protocol";

const captured = vi.hoisted(() => ({ stream: null as any }));
vi.mock("../src/api/events", () => ({
  globalEventStreamUrl: () => "http://localhost/global/event",
  eventStreamUrl: () => "http://127.0.0.1:4096/event",
  runEventStream: vi.fn((opts) => {
    captured.stream = opts;
    return Promise.resolve();
  }),
}));

let store: any;
let piPrompts: any[] = [];
let piOpened: string[] = [];

const piBridge: PiBridge = {
  detect: async () => ({
    installed: true,
    path: "/managed/pi",
    version: "0.85.1",
    source: "managed",
    error: "",
  }),
  open: async (request) => {
    piOpened.push(request.sessionId);
    return {
      key: `${request.directory}\u0000${request.sessionId}`,
      sessionId: request.sessionId,
      sessionDir: "/sessions",
      program: "/managed/pi",
      reused: false,
    };
  },
  request: async (_key, command: any) => {
    if (command.type === "prompt") piPrompts.push(command);
    if (command.type === "get_entries")
      return { type: "response", success: true, data: { entries: [] } };
    return { type: "response", success: true, data: {} };
  },
  post: async () => {},
  close: async () => {},
  sessions: async () => [],
  setupLsp: async () => ({
    extensionPath: "/data/pi/lsp-extension.ts",
    configPath: "/data/pi/lsp-config.json",
    servers: [],
    missing: [],
  }),
  probeDirectory: async () => "/tmp/probe",
  liveSessions: async () => [],
  subscribe: (_handler: (e: PiEnvelope) => void) => () => {},
};

const session = (id: string, directory = "/test/A") => ({
  id,
  directory,
  title: id,
  projectID: "test",
  time: { created: 1, updated: 1 },
});

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  captured.stream = null;
  piPrompts = [];
  piOpened = [];
  // `vi.resetModules()` gives the store a fresh copy of the native bridge
  // module, so the fake has to be installed on *that* copy.
  const native = await import("../src/agent/pi/native");
  native.setPiBridge(piBridge);
  store = (await import("../src/state/store")).store;
  store.state = {
    ...store.state,
    connection: { ...store.state.connection, phase: "connected" },
    connectedProviderIds: ["local"],
    piHealth: {
      install: { installed: true, path: "/managed/pi", version: "0.85.1", source: "managed", error: "" },
      models: [
        { id: "deepseek-v4-flash", provider: "deepseek", name: "DeepSeek V4 Flash", input: ["text"] },
      ],
      commands: [],
      state: null,
      error: "",
    },
  };
  store.piInstalled = true;
  vi.spyOn(store.client, "vcs").mockResolvedValue(null);
  vi.spyOn(store.client, "listSessions").mockResolvedValue([]);
  vi.spyOn(store.client, "sessionStatuses").mockResolvedValue({});
  vi.spyOn(store.client, "pendingPermissions").mockResolvedValue([]);
  vi.spyOn(store.client, "pendingQuestions").mockResolvedValue([]);
  vi.spyOn(store.client, "messages").mockResolvedValue({ messages: [] });
  await store.setDirectory("/test/A");
});

it("keeps OpenCode as the engine for a folder that never chose one", async () => {
  expect(store.engineIdForDirectory("/test/A")).toBe("opencode");
  const create = vi
    .spyOn(store.client, "createSession")
    .mockResolvedValue(session("ses_oc"));
  const prompt = vi.spyOn(store.client, "prompt").mockResolvedValue(undefined);
  store.setModelChoice("local", "m", null);
  expect(await store.sendPrompt("привет")).toBe(true);
  expect(create).toHaveBeenCalled();
  expect(prompt).toHaveBeenCalled();
  expect(piPrompts).toEqual([]);
});

it("routes a folder set to Pi through the Pi engine only", async () => {
  store.setProjectEngine("/test/A", "pi");
  const openCodePrompt = vi.spyOn(store.client, "prompt").mockResolvedValue(undefined);
  const openCodeCreate = vi.spyOn(store.client, "createSession");
  expect(await store.sendPrompt("посчитай")).toBe(true);
  expect(piPrompts).toHaveLength(1);
  expect(piPrompts[0].message).toBe("посчитай");
  // OpenCode must not see the prompt at all.
  expect(openCodePrompt).not.toHaveBeenCalled();
  expect(openCodeCreate).not.toHaveBeenCalled();
  // One agent per chat.
  expect(piOpened).toHaveLength(1);
});

it("pins the engine to the new chat so a restart still routes it correctly", async () => {
  store.setProjectEngine("/test/A", "pi");
  await store.sendPrompt("задача");
  const id = store.state.activeSessionId;
  expect(store.state.prefs.sessionEngine[id]).toBe("pi");
  // Even if the folder preference is changed back afterwards.
  store.setProjectEngine("/test/A", "opencode");
  expect(store.engineIdFor(id, "/test/A")).toBe("pi");
});

it("takes the user into the handoff instead of refusing the engine change", async () => {
  // A finished transcript cannot change engines in place, but the composer must
  // not dead-end either: picking the other engine opens the handoff.
  store.state = {
    ...store.state,
    activeSessionId: "ses_oc",
    sessions: [session("ses_oc")],
  };
  store.setSessionEngine("ses_oc", "pi");
  expect(store.state.prefs.sessionEngine?.ses_oc).toBeUndefined();
  expect(store.state.ui.engineSwitch).toMatchObject({
    from: "opencode",
    to: "pi",
    session: { id: "ses_oc" },
  });
});

it("keeps model choices of the two engines apart", async () => {
  store.state = { ...store.state, activeSessionId: null };
  store.setModelChoice("local", "opencode-model", null);
  store.setProjectEngine("/test/A", "pi");
  store.setModelChoice("deepseek", "deepseek-v4-flash", null);
  expect(store.getModelChoice("pi")).toMatchObject({ modelID: "deepseek-v4-flash" });
  // Switching engines must not rewrite the other engine's stored preference.
  expect(store.state.prefs.modelChoice["/test/A"]).toMatchObject({
    modelID: "opencode-model",
  });
  store.setProjectEngine("/test/A", "opencode");
  expect(store.getModelChoice("opencode")).toMatchObject({
    modelID: "opencode-model",
  });
});

it("carries an OpenCode chat into a new Pi chat with visible provenance", async () => {
  store.state = {
    ...store.state,
    activeSessionId: "ses_oc",
    sessions: [session("ses_oc")],
  };
  const { reduceEvent } = await import("../src/state/chatReducer");
  reduceEvent(store.state.chat, {
    type: "message.updated",
    id: "e1",
    properties: {
      info: { id: "m1", sessionID: "ses_oc", role: "user", time: { created: 1 } },
    },
  } as any);
  reduceEvent(store.state.chat, {
    type: "message.part.updated",
    id: "e2",
    properties: {
      part: { id: "p1", sessionID: "ses_oc", messageID: "m1", type: "text", text: "почини сборку" },
    },
  } as any);

  const ok = await store.continueOnEngine(session("ses_oc"), "pi");
  expect(ok).toBe(true);
  const created = store.state.activeSessionId;
  expect(created).not.toBe("ses_oc");
  expect(store.state.prefs.piSessions[created].handoffFrom).toBe("ses_oc");
  // The transcript lands in the draft, so nothing is sent without the user.
  expect(store.state.prefs.drafts[created]).toContain("почини сборку");
  expect(store.state.prefs.drafts[created]).toContain("Это НЕ твои прошлые сообщения");
  expect(piPrompts).toEqual([]);
});

it("lets a Pi chat run while the OpenCode server is unreachable", async () => {
  // Pi is a local process. Gating it behind another engine's health would make
  // the second engine useless exactly when the first one is down.
  store.state = {
    ...store.state,
    connection: { ...store.state.connection, phase: "disconnected" },
  };
  store.setProjectEngine("/test/A", "pi");
  expect(store.engineReady("pi")).toBe(true);
  expect(store.engineReady("opencode")).toBe(false);
  expect(await store.sendPrompt("работай")).toBe(true);
  expect(piPrompts).toHaveLength(1);
});

it("still refuses to send to OpenCode while it is unreachable", async () => {
  store.state = {
    ...store.state,
    connection: { ...store.state.connection, phase: "disconnected" },
  };
  const prompt = vi.spyOn(store.client, "prompt").mockResolvedValue(undefined);
  expect(await store.sendPrompt("привет")).toBe(false);
  expect(prompt).not.toHaveBeenCalled();
});

it("hands a Pi chat back to OpenCode with the same guarantees", async () => {
  // The owner asked for the agent to be replaceable in each chat, both ways.
  store.setProjectEngine("/test/A", "pi");
  await store.sendPrompt("начни работу");
  const piChat = store.state.activeSessionId;
  expect(store.engineIdFor(piChat, "/test/A")).toBe("pi");

  const { reduceEvent } = await import("../src/state/chatReducer");
  reduceEvent(store.state.chat, {
    type: "message.updated",
    id: "e1",
    properties: {
      info: { id: "m1", sessionID: piChat, role: "user", time: { created: 1 } },
    },
  } as any);
  reduceEvent(store.state.chat, {
    type: "message.part.updated",
    id: "e2",
    properties: {
      part: { id: "p1", sessionID: piChat, messageID: "m1", type: "text", text: "контекст задачи" },
    },
  } as any);

  vi.spyOn(store.client, "createSession").mockResolvedValue(session("ses_back"));
  const piSession = { ...session(piChat), title: "Работа" };
  expect(await store.continueOnEngine(piSession as any, "opencode")).toBe(true);

  const created = store.state.activeSessionId;
  expect(created).toBe("ses_back");
  expect(store.engineIdFor(created, "/test/A")).toBe("opencode");
  const origin = store.handoffOrigin(created);
  expect(origin).toMatchObject({ id: piChat, engine: "pi" });
  expect(store.state.prefs.drafts[created]).toContain("контекст задачи");
  expect(store.state.prefs.drafts[created]).toContain("Pi");
  // The Pi chat is untouched: its metadata and engine stay exactly as they were.
  expect(store.state.prefs.piSessions[piChat]).toBeTruthy();
  expect(store.engineIdFor(piChat, "/test/A")).toBe("pi");
});

it("keeps a handed-over chat on its own engine after the folder default changes", async () => {
  store.setProjectEngine("/test/A", "pi");
  await store.sendPrompt("задача");
  const piChat = store.state.activeSessionId;
  // Existing OpenCode chats in the same folder must not become Pi chats.
  expect(store.engineIdFor("ses_legacy", "/test/A")).toBe("opencode");
  expect(store.engineIdFor(piChat, "/test/A")).toBe("pi");
  store.setProjectEngine("/test/A", "opencode");
  expect(store.engineIdFor(piChat, "/test/A")).toBe("pi");
});
