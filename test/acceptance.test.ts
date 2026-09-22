import { beforeEach, expect, it, vi } from "vitest";
const captured = vi.hoisted(() => ({ stream: null as any }));
vi.mock("../src/api/events", () => ({
  eventStreamUrl: () => "http://localhost/event",
  runEventStream: vi.fn((o) => {
    captured.stream = o;
    return Promise.resolve();
  }),
}));
let store: any;
const deferred = () => {
  let resolve!: (v: any) => void;
  const promise = new Promise((r) => (resolve = r));
  return { resolve, promise };
};
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  store = (await import("../src/state/store")).store;
  store.state = {
    ...store.state,
    connection: { ...store.state.connection, phase: "connected" },
  };
  for (const [name, value] of Object.entries({
    vcs: null,
    listSessions: [],
    sessionStatuses: {},
    pendingPermissions: [],
    pendingQuestions: [],
    messages: { messages: [] },
  }))
    vi.spyOn(store.client, name).mockResolvedValue(value);
  await store.setDirectory("/test/A");
});
it("resolves the selected agent model and Medium before provider catalog defaults", () => {
  store.state = {
    ...store.state,
    connectedProviderIds: ["deepseek", "local-qwen-next"],
    providerDefaults: { deepseek: "v4" },
    configDefaultAgent: "qwen-build",
    agents: [
      {
        name: "qwen-build",
        model: { providerID: "local-qwen-next", modelID: "qwen38-flash-next" },
        variant: "medium",
      },
    ],
    providers: [
      {
        id: "local-qwen-next",
        models: {
          "qwen38-flash-next": {
            id: "qwen38-flash-next",
            variants: { medium: {} },
          },
        },
      },
    ],
  };
  expect(store.getModelChoice()).toEqual({
    providerID: "local-qwen-next",
    modelID: "qwen38-flash-next",
    variant: "medium",
  });
});
it("does not submit a second prompt to a busy session", async () => {
  store.state = {
    ...store.state,
    activeSessionId: "ses_a",
    statuses: { ses_a: { type: "busy" } },
    connectedProviderIds: ["p"],
  };
  store.setModelChoice("p", "m");
  const spy = vi.spyOn(store.client, "prompt").mockResolvedValue(undefined);
  expect(await store.sendPrompt("duplicate")).toBe(false);
  expect(spy).not.toHaveBeenCalled();
});
it("late project-list responses cannot cross a changed endpoint", async () => {
  const d = deferred();
  vi.spyOn(store.client, "projects").mockReturnValue(d.promise);
  const pending = store.refreshProjects();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
  await store.connect("http://127.0.0.1:4097");
  d.resolve([{ id: "old", worktree: "/old" }]);
  await pending;
  expect(store.state.projects).toEqual([]);
  vi.unstubAllGlobals();
});
it("a delayed archive response cannot insert an A session into B", async () => {
  const d = deferred();
  vi.spyOn(store.client, "updateSession").mockReturnValue(d.promise);
  const sess = { id: "ses_a", title: "A", time: { created: 1, updated: 1 } };
  const pending = store.archiveSession(sess);
  await store.setDirectory("/test/B");
  d.resolve({ ...sess, time: { ...sess.time, archived: 2 } });
  await pending;
  expect(store.state.archivedSessions).toEqual([]);
});
it("history snapshot cannot erase a token delta received while it loads", async () => {
  store.state = { ...store.state, activeSessionId: "ses_a" };
  const d = deferred();
  vi.spyOn(store.client, "messages").mockReturnValue(d.promise);
  const pending = store.loadHistory("ses_a", "/test/A");
  const part = {
    id: "prt_a",
    sessionID: "ses_a",
    messageID: "msg_a",
    type: "text",
    text: "hello world",
  };
  captured.stream.onEvent({
    type: "message.part.updated",
    properties: { part },
  });
  d.resolve({
    messages: [
      {
        info: {
          id: "msg_a",
          sessionID: "ses_a",
          role: "assistant",
          time: { created: 1 },
        },
        parts: [{ ...part, text: "hello" }],
      },
    ],
  });
  await pending;
  expect(store.state.chat.sessions.ses_a.parts.prt_a.text).toBe("hello world");
});
it("keeps drafts and shell IDs partitioned by endpoint", async () => {
  const { switchEndpointPrefs } = await import("../src/state/prefs");
  store.setDraft("draft A");
  store.setPtyId("/test/A", "pty_A");
  const b = switchEndpointPrefs(store.state.prefs, "http://127.0.0.1:4097");
  expect(b.drafts).toEqual({});
  expect(b.ptyIds).toEqual({});
  expect(b.selectedDirectory).toBeNull();
  const a = switchEndpointPrefs(b, "http://127.0.0.1:4096");
  expect(a.drafts["new::/test/A"]).toBe("draft A");
  expect(a.ptyIds["/test/A"]).toBe("pty_A");
});
it("preserves completion received before prompt acknowledgement", async () => {
  store.state = {
    ...store.state,
    activeSessionId: "ses_a",
    connectedProviderIds: ["p"],
  };
  store.setModelChoice("p", "m");
  const d = deferred();
  vi.spyOn(store.client, "prompt").mockReturnValue(d.promise);
  const pending = store.sendPrompt("task");
  captured.stream.onEvent({
    type: "session.status",
    properties: { sessionID: "ses_a", status: { type: "idle" } },
  });
  d.resolve(undefined);
  await pending;
  expect(store.state.chat.sessions.ses_a.status.type).toBe("idle");
});
it("paginates beyond 200 messages without losing live output or duplicating records", async () => {
  store.state = { ...store.state, activeSessionId: "ses_a" };
  const messages = Array.from({ length: 205 }, (_, i) => ({
    info: {
      id: `msg_${String(i).padStart(5, "0")}`,
      sessionID: "ses_a",
      role: "user",
      time: { created: i },
    },
    parts: [],
  }));
  vi.mocked(store.client.messages)
    .mockResolvedValueOnce({
      messages: messages.slice(5),
      before: "opaque-next",
    })
    .mockResolvedValueOnce({ messages: messages.slice(0, 5) });
  await store.loadHistory("ses_a", "/test/A");
  captured.stream.onEvent({
    type: "message.updated",
    properties: {
      info: {
        id: "msg_99999",
        sessionID: "ses_a",
        role: "assistant",
        time: { created: 1000 },
      },
    },
  });
  await store.loadOlderMessages("ses_a");
  expect(store.state.chat.sessions.ses_a.messageOrder).toHaveLength(206);
  expect(store.state.chat.sessions.ses_a.messageOrder[0]).toBe("msg_00000");
  expect(store.state.olderExhausted.ses_a).toBe(true);
});

it("does not double a delta already included in the HTTP history snapshot", async () => {
  store.state = { ...store.state, activeSessionId: "ses_a" };
  const d = deferred();
  vi.spyOn(store.client, "messages").mockReturnValue(d.promise);
  const part = {
    id: "prt_a",
    sessionID: "ses_a",
    messageID: "msg_a",
    type: "text",
    text: "hello",
  };
  captured.stream.onEvent({
    type: "message.part.updated",
    properties: { part },
  });
  const pending = store.loadHistory("ses_a", "/test/A");
  captured.stream.onEvent({
    type: "message.part.delta",
    properties: {
      sessionID: "ses_a",
      messageID: "msg_a",
      partID: "prt_a",
      field: "text",
      delta: " world",
    },
  });
  d.resolve({
    messages: [
      {
        info: {
          id: "msg_a",
          sessionID: "ses_a",
          role: "assistant",
          time: { created: 1 },
        },
        parts: [{ ...part, text: "hello world" }],
      },
    ],
  });
  await pending;
  expect(store.state.chat.sessions.ses_a.parts.prt_a.text).toBe("hello world");
});
