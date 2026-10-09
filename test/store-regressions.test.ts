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
  vi.spyOn(store, "configureSharedTools").mockResolvedValue(undefined);
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
  await flush();
  resolve();
  await pending;
  expect(store.getDraft()).toBe("next task typed during request");
});

it("waits for local browser MCP attachment before delivering the first prompt", async () => {
  const platform = await import("../src/native/platform");
  vi.spyOn(platform, "isNative").mockReturnValue(true);
  store.state = { ...store.state, activeSessionId: "ses_a", sessions: [session("ses_a")],
    connectedProviderIds: ["local-qwen-next"], prefs: { ...store.state.prefs, browser: { enabled: true } } };
  store.setModelChoice("local-qwen-next", "qwen38-flash-next", "medium");
  let resolve!: () => void;
  const setup = vi.spyOn(store, "configureBrowser").mockReturnValue(new Promise<void>(r => { resolve = r; }));
  const prompt = vi.spyOn(store.client, "prompt").mockResolvedValue(undefined);
  const pending = store.sendPrompt("Use the built-in browser");
  await flush(); expect(setup).toHaveBeenCalledOnce(); expect(prompt).not.toHaveBeenCalled();
  resolve(); await pending; expect(prompt).toHaveBeenCalledOnce();
});

it("does not attach local browser tools when delivering to a remote endpoint", async () => {
  const platform = await import("../src/native/platform");
  vi.spyOn(platform, "isNative").mockReturnValue(true);
  store.state = { ...store.state, activeSessionId: "ses_a", sessions: [session("ses_a")],
    connectedProviderIds: ["local-qwen-next"], prefs: { ...store.state.prefs, endpoint: "http://192.168.1.22:4096", browser: { enabled: true } } };
  store.setModelChoice("local-qwen-next", "qwen38-flash-next", "medium");
  const setup = vi.spyOn(store, "configureBrowser").mockResolvedValue(undefined);
  const prompt = vi.spyOn(store.client, "prompt").mockResolvedValue(undefined);
  await store.sendPrompt("Remote task"); expect(setup).not.toHaveBeenCalled(); expect(prompt).toHaveBeenCalledOnce();
});

it("aborts a session with its own project directory, not whichever project is open", async () => {
  // The sidebar shows running work from other projects. Aborting used the open
  // project's directory, so OpenCode answered 404 and the run kept going.
  const abort = vi.spyOn(store.client, "abort").mockResolvedValue(undefined);
  vi.mocked(store.client.listSessions).mockImplementation(async (dir: string) =>
    dir === "/test/B" ? [session("ses_other", "/test/B")] : [],
  );
  await store.setDirectory("/test/B");
  vi.spyOn(store, "configureSharedTools").mockResolvedValue(undefined);
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

const scheduled = () => ({ id: "job", server: store.state.prefs.workspaceKey ?? store.state.prefs.endpoint, directory: "/test/A", sessionID: "ses_a", engine: "opencode", title: "CI", prompt: "check", minutes: 15, model: { providerID: "local-qwen-next", modelID: "qwen38-flash-next", variant: "medium" }, enabled: true, nextAt: 0, state: "ready" as const });
const scheduledSetup = () => {
 store.state = { ...store.state, activeSessionId: "ses_a", sessions: [session("ses_a")], connection: { ...store.state.connection, streamState: "open" } };
 vi.spyOn(store.client, "getSession").mockResolvedValue(session("ses_a"));
};
it("scheduled prompts preserve drafts, attachments and the saved reasoning model", async()=>{
 scheduledSetup();store.setDraft("user typing");const prompt=vi.spyOn(store.client,"prompt").mockResolvedValue(undefined);
 expect(await store.runScheduledTask(scheduled())).toEqual({kind:"sent"});expect(store.getDraft()).toBe("user typing");
 expect(prompt).toHaveBeenCalledWith("ses_a","/test/A",expect.objectContaining({model:{providerID:"local-qwen-next",modelID:"qwen38-flash-next"},variant:"medium",parts:[{type:"text",text:"check"}]}));
});
it("scheduled prompts never route to another server or bypass a pending permission",async()=>{
 scheduledSetup();const prompt=vi.spyOn(store.client,"prompt").mockResolvedValue(undefined);
 expect((await store.runScheduledTask({...scheduled(),server:"other"})).kind).toBe("waiting");
 vi.mocked(store.client.pendingPermissions).mockResolvedValue([{id:"approval",sessionID:"ses_a"}] as any);
 expect((await store.runScheduledTask(scheduled())).kind).toBe("waiting");expect(prompt).not.toHaveBeenCalled();
});
it("scheduled preflight is cancelled by a connection switch and locks manual sends",async()=>{
 scheduledSetup();let resolve!:(s:unknown)=>void;vi.mocked(store.client.getSession).mockImplementation(()=>new Promise(r=>{resolve=r;}));
 const prompt=vi.spyOn(store.client,"prompt").mockResolvedValue(undefined),pending=store.runScheduledTask(scheduled());
 expect(await store.sendPrompt("manual")).toBe(false);store.connectionGeneration++;resolve(session("ses_a"));
 expect((await pending).kind).toBe("waiting");expect(prompt).not.toHaveBeenCalled();
});
it("rechecks busy state after asynchronous setup, rejects archived and changed-engine chats",async()=>{
 scheduledSetup();const prompt=vi.spyOn(store.client,"prompt").mockResolvedValue(undefined);
 vi.mocked(store.client.sessionStatuses).mockResolvedValueOnce({}).mockResolvedValueOnce({ses_a:{type:"busy"}});
 expect((await store.runScheduledTask(scheduled())).kind).toBe("waiting");expect(prompt).not.toHaveBeenCalled();
 vi.mocked(store.client.getSession).mockResolvedValue({...session("ses_a"),time:{created:1,updated:1,archived:2}});
 await expect(store.runScheduledTask(scheduled())).rejects.toThrow();
 await expect(store.runScheduledTask({...scheduled(),engine:"pi"})).rejects.toThrow();
});
it("a deleted chat, a vanished model and a server refusal are definite non-deliveries, not uncertain ones",async()=>{
 const { ApiError } = await import("../src/api/client"), { ScheduleBlocked } = await import("../src/schedules/tasks");
 scheduledSetup();const prompt=vi.spyOn(store.client,"prompt").mockResolvedValue(undefined);
 vi.mocked(store.client.getSession).mockRejectedValueOnce(new ApiError(404,"secret body"));
 await expect(store.runScheduledTask(scheduled())).rejects.toBeInstanceOf(ScheduleBlocked);
 vi.mocked(store.client.providers).mockResolvedValueOnce({all:[{id:"local-qwen-next",models:{other:{id:"other",providerID:"local-qwen-next"}}}],connected:["local-qwen-next"],default:{}});
 await expect(store.runScheduledTask(scheduled())).rejects.toThrow(/qwen38-flash-next/);
 expect(prompt).not.toHaveBeenCalled();
 prompt.mockRejectedValueOnce(new ApiError(400,"secret body"));
 const refused=store.runScheduledTask(scheduled());
 await expect(refused).rejects.toBeInstanceOf(ScheduleBlocked);await expect(refused).rejects.not.toThrow(/secret/);
});
it("a withdrawn or failed read-only check sends nothing and is simply retried later",async()=>{
 scheduledSetup();const prompt=vi.spyOn(store.client,"prompt").mockResolvedValue(undefined);
 vi.mocked(store.client.getSession).mockImplementationOnce(()=>new Promise(()=>{}));
 const abort=new AbortController(),pending=store.runScheduledTask(scheduled(),abort.signal);abort.abort();
 expect(await pending).toEqual({kind:"cancelled"});
 vi.mocked(store.client.sessionStatuses).mockRejectedValueOnce(new Error("network"));
 expect((await store.runScheduledTask(scheduled())).kind).toBe("waiting");expect(prompt).not.toHaveBeenCalled();
 // Every lock was released: the next check proceeds and sends exactly once.
 expect(await store.runScheduledTask(scheduled())).toEqual({kind:"sent"});expect(prompt).toHaveBeenCalledOnce();
});
it("a manual send blocked by a scheduled check explains itself and keeps the draft",async()=>{
 scheduledSetup();store.setDraft("mine");let resolve!:(s:unknown)=>void;
 vi.mocked(store.client.getSession).mockImplementation(()=>new Promise(r=>{resolve=r;}));
 vi.spyOn(store.client,"prompt").mockResolvedValue(undefined);const pending=store.runScheduledTask(scheduled());
 expect(await store.sendPrompt("mine")).toBe(false);expect(store.state.ui.sendError).toMatch(/запланированное/);expect(store.getDraft()).toBe("mine");
 resolve(session("ses_a"));await pending;
});

it("browser profile selects real Low only in the explicit chat and preserves manual Medium", async () => {
  store.state = { ...store.state, activeSessionId: "ses_a", sessions: [session("ses_a")], connectedProviderIds:["local-qwen-next"],
    providers:[{id:"local-qwen-next",models:{"qwen38-flash-next":{id:"qwen38-flash-next",providerID:"local-qwen-next",capabilities:{reasoning:true},variants:{low:{},medium:{}}}}}] };
  store.setModelChoice("local-qwen-next","qwen38-flash-next","medium");
  const beforeGlobal = store.state.prefs.modelChoice["*"];
  store.setBrowserTask(true); expect(store.getModelChoice().variant).toBe("low");
  const prompt = vi.spyOn(store.client,"prompt").mockResolvedValue(undefined);
  await store.sendPrompt("Navigate the fixture");
  expect(prompt.mock.calls[0][2].variant).toBe("low");
  expect(store.state.prefs.modelChoice["*"]).toEqual(beforeGlobal);
  store.state.chat.sessions.ses_a.status={type:"idle"};
  store.setModelChoice("local-qwen-next","qwen38-flash-next","medium");
  store.setBrowserTask(false); expect(store.getModelChoice().variant).toBe("medium");
  store.state.activeSessionId="ses_b"; expect(store.browserTaskActive()).toBe(false);
});
it("does not silently substitute unsupported Low or change a running browser chat", () => {
  store.state = { ...store.state, activeSessionId:"ses_a", sessions:[session("ses_a")], connectedProviderIds:["local-qwen-next"],
    providers:[{id:"local-qwen-next",models:{"qwen38-flash-next":{id:"qwen38-flash-next",providerID:"local-qwen-next",variants:{medium:{}}}}}] };
  store.setModelChoice("local-qwen-next","qwen38-flash-next","medium"); store.setBrowserTask(true);
  expect(store.getModelChoice().variant).toBe("medium");
  store.state.chat.sessions.ses_a={...store.state.chat.sessions.ses_a,status:{type:"busy"}};
  store.setBrowserTask(false); expect(store.browserTaskActive()).toBe(true);
});

it("retains an explicit manual Low when the browser profile is disabled", () => {
  store.state={...store.state,activeSessionId:"ses_a",sessions:[session("ses_a")],connectedProviderIds:["local-qwen-next"],providers:[{id:"local-qwen-next",models:{"qwen38-flash-next":{id:"qwen38-flash-next",providerID:"local-qwen-next",variants:{low:{},medium:{}}}}}]};
  store.setModelChoice("local-qwen-next","qwen38-flash-next","medium"); store.setBrowserTask(true);
  store.setModelChoice("local-qwen-next","qwen38-flash-next","low"); store.setBrowserTask(false);
  expect(store.getModelChoice().variant).toBe("low");
});

it("starts the browser before exposing a newly created browser task panel", async () => {
  const integration=await import("../src/browser/integration");
  vi.spyOn(store,"ensureChatWorkspace").mockImplementation(async () => { await store.setDirectory("/test/browser-owned"); return true; });
  vi.spyOn(store,"createSessionNow").mockImplementation(async () => {store.state.activeSessionId="browser-test"; return session("browser-test","/test/browser-owned");});
  vi.spyOn(store,"configureBrowser").mockResolvedValue(undefined);
  let resolve!: (value: unknown) => void;
  const started=vi.spyOn(integration,"openSessionBrowser").mockReturnValue(new Promise(r => {resolve=r;}));
  const pending=store.newBrowserTask(); await vi.waitFor(() => expect(started).toHaveBeenCalled());
  expect(started).toHaveBeenCalledWith({directory:"/test/browser-owned",engine:"opencode",sessionId:"browser-test"},expect.any(Function),null,null);
  expect(store.state.ui.browserOpen).toBe(false); resolve({browserOpen:true}); await pending;
  expect(store.state.ui.browserOpen).toBe(true);
});

it("waits for common tool preparation and preserves draft if preparation fails",async()=>{
 store.state={...store.state,activeSessionId:"ses_a",sessions:[session("ses_a")],connectedProviderIds:["local-qwen-next"]};
 store.setModelChoice("local-qwen-next","qwen38-flash-next","medium");
 store.setDraft("own draft");
 vi.spyOn(store,"configureSharedTools").mockRejectedValue(new Error("Shared MCP missing dependency"));
 const prompt=vi.spyOn(store.client,"prompt").mockResolvedValue(undefined);
 expect(await store.sendPrompt("own draft")).toBe(false);
 expect(prompt).not.toHaveBeenCalled();expect(store.getDraft()).toBe("own draft");
});

it("healthy transport with failed project reads preserves state and blocks dispatch until read-only recovery", async () => {
  const { ApiError } = await import("../src/api/client");
  store.state.activeSessionId = "ses_a";
  store.state.sessions = [session("ses_a")];
  store.state.chat.sessions.ses_a = { messages: {}, messageOrder: [], status: { type: "busy" } };
  store.state.prefs.queues = { ses_a: [{ id: "q", directory: "/test/A", text: "queued", state: "ready", model: {providerID:"p",modelID:"m"} }] };
  store.queueArmed.add("ses_a");
  const prompt = vi.spyOn(store.client, "prompt");
  vi.mocked(store.client.sessionStatuses).mockRejectedValue(new ApiError(500, "EPERM: lstat project"));
  await store.refreshSessions();
  expect(store.state.connection.phase).toBe("connected");
  expect(store.state.connection.statusError).toContain("отказ доступа");
  expect(store.state.activeSessionId).toBe("ses_a");
  expect(store.state.chat.sessions.ses_a).toBeDefined();
  expect(await store.sendPrompt("new prompt")).toBe(false);
  expect(store.queueArmed.has("ses_a")).toBe(false);
  vi.mocked(store.client.sessionStatuses).mockResolvedValue({});
  vi.mocked(store.client.listSessions).mockResolvedValue([session("ses_a")]);
  await store.retryProjectAccess();
  expect(store.state.connection.statusError).toBeNull();
  expect(store.state.activeSessionId).toBe("ses_a");
  expect(prompt).not.toHaveBeenCalled();
});
it("a late failure of project recovery does not contaminate the newly selected project", async () => {
  let reject!: (error: Error) => void;
  vi.mocked(store.client.sessionStatuses).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  const recovery = store.retryProjectAccess();
  await store.setDirectory("/test/B");
  reject(new Error("old A failure"));
  await recovery;
  expect(store.state.connection.statusError).toBeNull();
  expect(store.state.directory).toBe("/test/B");
});

it("a Pi listing failure does not mark the healthy OpenCode project inaccessible", async () => {
  vi.spyOn(store, "piListFor").mockRejectedValue(new Error("Pi listing failed"));
  await store.refreshSessions();
  expect(store.state.ui.sessionListError).toContain("Pi listing failed");
  expect(store.state.connection.statusError).toBeNull();
});
