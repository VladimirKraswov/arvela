import { beforeEach, expect, it, vi } from "vitest";
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
const session = (id: string, directory = "/test/A", agent = "qwen-build") => ({
  id,
  directory,
  title: id,
  projectID: "test",
  agent,
  time: { created: 1, updated: 1 },
});
const flush = async () => {
  for (let n = 0; n < 12; n++) await Promise.resolve();
};
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  captured.stream = null;
  store = (await import("../src/state/store")).store;
  store.state = {
    ...store.state,
    connection: { ...store.state.connection, phase: "connected" },
  };
  vi.spyOn(store.client, "vcs").mockResolvedValue(null);
  vi.spyOn(store.client, "listSessions").mockResolvedValue([]);
  vi.spyOn(store.client, "sessionStatuses").mockResolvedValue({});
  vi.spyOn(store.client, "pendingPermissions").mockResolvedValue([]);
  vi.spyOn(store.client, "pendingQuestions").mockResolvedValue([]);
  vi.spyOn(store.client, "messages").mockResolvedValue({ messages: [] });
  // Project switches reload metadata as well. Keep these unit tests independent
  // of an owner's running server and its response time.
  vi.spyOn(store.client, "providers").mockResolvedValue({ all: [], connected: [], default: {} });
  vi.spyOn(store.client, "agents").mockResolvedValue([]);
  vi.spyOn(store.client, "config").mockResolvedValue({});
  await store.setDirectory("/test/A");
});
it("R1: session.created must not invalidate the current project SSE stream", async () => {
  const stream = captured.stream;
  stream.onEvent({
    type: "session.created",
    properties: { info: session("ses_new") },
  });
  await flush();
  stream.onEvent({
    type: "message.updated",
    properties: {
      info: {
        id: "msg_new",
        sessionID: "ses_new",
        role: "user",
        time: { created: 2 },
      },
    },
  });
  expect(store.state.chat.sessions.ses_new?.messages.msg_new).toBeDefined();
});
it("R2: an explicit agent selection must override the old session agent", () => {
  store.state = {
    ...store.state,
    activeSessionId: "ses_a",
    sessions: [session("ses_a")],
  };
  store.setAgentOverride("/test/A", "plan");
  expect(store.getAgentChoice()).toBe("plan");
});
it("R3: a late session creation from project A must not select it inside project B", async () => {
  let resolve!: (s: unknown) => void;
  vi.spyOn(store.client, "createSession").mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const pending = store.createSessionNow("A task");
  await store.setDirectory("/test/B");
  resolve(session("ses_a"));
  await pending;
  expect(store.state.directory).toBe("/test/B");
  expect(store.state.activeSessionId).not.toBe("ses_a");
  expect(store.state.sessions.some((s: any) => s.id === "ses_a")).toBe(false);
});
it("R4: reconnect must replace stale busy status with authoritative idle", async () => {
  captured.stream.onEvent({
    type: "session.status",
    properties: { sessionID: "ses_a", status: { type: "busy" } },
  });
  store.state = {
    ...store.state,
    activeSessionId: "ses_a",
    sessions: [session("ses_a")],
  };
  vi.mocked(store.client.listSessions).mockResolvedValue([session("ses_a")]);
  vi.mocked(store.client.sessionStatuses).mockResolvedValue({
    ses_a: { type: "idle" },
  });
  captured.stream.onState("open");
  await flush();
  expect(store.state.chat.sessions.ses_a.status.type).toBe("idle");
});
it("R5: accepting a prompt must preserve a new draft typed while awaiting acknowledgement", async () => {
  store.state = {
    ...store.state,
    activeSessionId: "ses_a",
    sessions: [session("ses_a")],
    connectedProviderIds: ["local-qwen-next"],
  };
  store.setModelChoice("local-qwen-next", "qwen38-flash-next", "medium");
  let resolve!: () => void;
  vi.spyOn(store.client, "prompt").mockImplementation(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      }),
  );
  const pending = store.sendPrompt("first task");
  store.setDraft("next task typed during request");
  resolve();
  await pending;
  expect(store.getDraft()).toBe("next task typed during request");
});

it("aborts a session with its own project directory, not whichever project is open", async () => {
  // The sidebar shows running work from other projects. Aborting used the open
  // project's directory, so OpenCode answered 404 and the run kept going.
  const abort = vi.spyOn(store.client, "abort").mockResolvedValue(undefined);
  vi.mocked(store.client.listSessions).mockImplementation(async (dir: string) =>
    dir === "/test/B" ? [session("ses_other", "/test/B")] : [],
  );
  await store.setDirectory("/test/B");
  await store.setDirectory("/test/A");
  await store.stopSession("ses_other");
  expect(abort).toHaveBeenCalledWith("ses_other", "/test/B");
});

it("routes a stop to the project the session was created in, not the one now open", async () => {
  // A chat started in project A keeps running while the user moves to project B.
  // Aborting it with B's directory made OpenCode answer 404 and the run continued.
  store.state = {
    ...store.state,
    connectedProviderIds: ["local-qwen-next"],
  };
  store.setModelChoice("local-qwen-next", "qwen38-flash-next", "medium");
  vi.spyOn(store.client, "createSession").mockResolvedValue(
    session("ses_created", "/test/A"),
  );
  vi.spyOn(store.client, "prompt").mockResolvedValue(undefined);
  const abort = vi.spyOn(store.client, "abort").mockResolvedValue(undefined);
  expect(await store.sendPrompt("long task")).toBe(true);
  expect(store.state.activeSessionId).toBe("ses_created");

  await store.setDirectory("/test/B");
  await store.stopSession("ses_created");
  expect(abort).toHaveBeenCalledWith("ses_created", "/test/A");
});
