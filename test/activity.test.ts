import { beforeEach, expect, it, vi } from "vitest";

const events = vi.hoisted(() => ({ global: null as any }));
const chime = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../src/api/events", async (original) => ({
  ...(await original<typeof import("../src/api/events")>()),
  runEventStream: vi.fn((opts) => {
    if (opts.url.endsWith("/global/event")) events.global = opts;
    return Promise.resolve();
  }),
}));
vi.mock("../src/native/sound", () => ({ completionChime: chime }));

let store: any;
const session = (id: string, directory: string) => ({
  id, directory, title: id, projectID: "fixture",
  time: { created: 1, updated: 1 },
});
function status(id: string, directory: string, type: "busy" | "idle" | "retry") {
  events.global.onEvent({
    directory,
    payload: { type: "session.status", properties: { sessionID: id, status: { type } } },
  });
}
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  const saved = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  });
  vi.stubGlobal("document", { hidden: false, hasFocus: vi.fn(() => true) });
  events.global = null;
  chime.mockClear();
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  store = (await import("../src/state/store")).store;
  const { OpenCodeClient } = await import("../src/api/client");
  for (const [method, result] of Object.entries({
    health: { healthy: true, version: "1.18.18" },
    projects: [], providers: { all: [], connected: [] }, agents: [], config: {},
    vcs: null, sessionStatuses: {}, pendingPermissions: [], pendingQuestions: [],
    messages: { messages: [] },
  })) vi.spyOn(OpenCodeClient.prototype as any, method).mockResolvedValue(result);
  vi.spyOn(OpenCodeClient.prototype, "listSessions").mockImplementation(async (directory: string) =>
    directory === "/work/a" ? [session("ses_a", directory)] : [],
  );
  vi.spyOn(OpenCodeClient.prototype, "getSession").mockImplementation(async (id, directory) => session(id, directory!));
  expect(await store.connectLocal("http://127.0.0.1:4096")).toBe(true);
  expect(events.global).toBeTruthy();
});

it("shows work in progress, then unread completion only after leaving and clears it when opened", async () => {
  await store.setDirectory("/work/a");
  await store.selectSession("ses_a");
  status("ses_a", "/work/a", "busy");
  expect(store.activityStatus("ses_a").type).toBe("busy");
  expect(store.isRunning("ses_a")).toBe(true);
  expect(store.hasRunningInDirectory("/work/a")).toBe(true);
  expect(store.isUnread("ses_a")).toBe(false);
  await store.setDirectory("/work/b");
  status("ses_a", "/work/a", "idle");
  expect(store.activityStatus("ses_a").type).toBe("idle");
  expect(store.isRunning("ses_a")).toBe(false);
  expect(store.hasRunningInDirectory("/work/a")).toBe(false);
  expect(store.isUnread("ses_a")).toBe(true);
  expect(store.hasUnreadInDirectory("/work/a")).toBe(true);
  const { flushPrefs, loadPrefs } = await import("../src/state/prefs");
  await Promise.resolve();
  flushPrefs();
  expect(loadPrefs().unreadSessions?.ses_a?.directory).toBe("/work/a");
  expect(chime).toHaveBeenCalledTimes(1);
  status("ses_a", "/work/a", "idle");
  expect(chime).toHaveBeenCalledTimes(1);
  await store.setDirectory("/work/a");
  await store.selectSession("ses_a");
  expect(store.isUnread("ses_a")).toBe(false);
  expect(store.hasUnreadInDirectory("/work/a")).toBe(false);
  expect(store.state.prefs.unreadSessions?.ses_a).toBeUndefined();
});

it("clears unread when a project row restores an already visible completed session", async () => {
  await store.setDirectory("/work/a");
  await store.selectSession("ses_a");
  status("ses_a", "/work/a", "busy");
  await store.setDirectory("/work/b");
  status("ses_a", "/work/a", "idle");
  expect(store.isUnread("ses_a")).toBe(true);
  await store.setDirectory("/work/a", { restoreSession: true });
  expect(store.state.activeSessionId).toBe("ses_a");
  expect(store.isUnread("ses_a")).toBe(false);
});

it("does not flag a completion being watched, but preserves one finished while window is unfocused", async () => {
  await store.setDirectory("/work/a");
  await store.selectSession("ses_a");
  status("ses_a", "/work/a", "busy");
  status("ses_a", "/work/a", "idle");
  expect(store.isUnread("ses_a")).toBe(false);
  expect(chime).not.toHaveBeenCalled();
  status("ses_a", "/work/a", "retry");
  vi.mocked(document.hasFocus).mockReturnValue(false);
  status("ses_a", "/work/a", "idle");
  expect(store.isUnread("ses_a")).toBe(true);
  expect(chime).toHaveBeenCalledTimes(1);
  vi.mocked(document.hasFocus).mockReturnValue(true);
  store.markReadIfViewing();
  expect(store.isUnread("ses_a")).toBe(false);
});

it("keeps a result unread while the selected conversation is scrolled up", async () => {
  await store.setDirectory("/work/a");
  await store.selectSession("ses_a");
  store.setConversationAtBottom(false);
  status("ses_a", "/work/a", "busy");
  status("ses_a", "/work/a", "idle");
  expect(store.isUnread("ses_a")).toBe(true);
  store.setConversationAtBottom(true);
  expect(store.isUnread("ses_a")).toBe(false);
  expect(chime).toHaveBeenCalledTimes(1);
});

it("background projectless chat keeps its spinner and unread result across new-chat screen", async () => {
  const chat = session("ses_chat", "/home/test/chats/one");
  store.state.prefs.projectlessDirectories = [chat.directory];
  store.state.prefs.projectlessSessions = [chat];
  status(chat.id, chat.directory, "busy");
  expect(store.chatSessions()).toHaveLength(1);
  expect(store.activityStatus(chat.id).type).toBe("busy");
  await store.newSession();
  status(chat.id, chat.directory, "idle");
  expect(store.isUnread(chat.id)).toBe(true);
  expect(store.state.directory).toBeNull();
  expect(store.chatSessions()[0].id).toBe(chat.id);
});

it("a delayed event from the previous host cannot mark the new host unread", async () => {
  const stale = events.global;
  status("ses_a", "/work/a", "busy");
  await store.connectLocal("http://127.0.0.1:4097");
  stale.onEvent({ directory: "/work/a", payload: {
    type: "session.status", properties: { sessionID: "ses_a", status: { type: "idle" } },
  } });
  expect(store.isUnread("ses_a")).toBe(false);
});

it("removes attention when a session is deleted elsewhere", async () => {
  await store.setDirectory("/work/a");
  await store.setDirectory("/work/b");
  status("ses_a", "/work/a", "busy");
  status("ses_a", "/work/a", "idle");
  expect(store.hasUnreadInDirectory("/work/a")).toBe(true);
  events.global.onEvent({ directory: "/work/a", payload: {
    type: "session.deleted", properties: { sessionID: "ses_a" },
  } });
  expect(store.hasUnreadInDirectory("/work/a")).toBe(false);
  expect(store.activityStatus("ses_a")).toBeUndefined();
});


it("does not show project attention or chime for a hidden subagent", async () => {
  const child = { ...session("child", "/work/b"), parentID: "root" };
  vi.mocked(store.client.getSession).mockResolvedValue(child);
  status("child", "/work/b", "busy"); status("child", "/work/b", "idle");
  await new Promise(r => setTimeout(r, 0));
  expect(store.hasUnreadInDirectory("/work/b")).toBe(false);
  expect(store.isUnread("child")).toBe(false);
  expect(chime).not.toHaveBeenCalled();
});

it("reconciles persisted child, archived and deleted marks while keeping a root outside the first page", async () => {
  const { ApiError } = await import("../src/api/client");
  store.state.prefs.unreadSessions = Object.fromEntries(["child","archived","deleted","old-root"].map(id=>[id,{time:1,directory:"/work/b"}]));
  store.state.prefs.projectlessSessions=[session("deleted","/work/b")];
  vi.mocked(store.client.getSession).mockImplementation(async (id: string) => {
    if(id==="deleted") throw new ApiError(404,"gone");
    const s=session(id,"/work/b");
    return id==="child"?{...s,parentID:"root"}:id==="archived"?{...s,time:{...s.time,archived:2}}:s;
  });
  await store.loadProjectSessions("/work/b");
  expect(Object.keys(store.state.prefs.unreadSessions)).toEqual(["old-root"]);
  expect(store.state.projectSessionLists["/work/b"].sessions.map((s:any)=>s.id)).toContain("old-root");
  expect(store.hasUnreadInDirectory("/work/b")).toBe(true);
  expect(chime).not.toHaveBeenCalled();
});

it("keeps unread on network errors and ignores a late metadata response after deletion", async () => {
  store.state.prefs.unreadSessions={offline:{time:1,directory:"/work/b"}};
  vi.mocked(store.client.getSession).mockRejectedValue(new Error("offline"));
  await store.loadProjectSessions("/work/b");
  expect(store.isUnread("offline")).toBe(true);
  let resolve!: (s:any)=>void;
  vi.mocked(store.client.getSession).mockReturnValue(new Promise(r=>resolve=r));
  status("late","/work/b","busy");status("late","/work/b","idle");
  events.global.onEvent({directory:"/work/b",payload:{type:"session.deleted",properties:{sessionID:"late"}}});
  resolve(session("late","/work/b"));await new Promise(r=>setTimeout(r,0));
  expect(store.isUnread("late")).toBe(false);expect(chime).not.toHaveBeenCalled();
});

it("does not mark a hidden conversation read while the full-page settings are open", async () => {
  await store.setDirectory("/work/a"); await store.selectSession("ses_a");
  store.setUi({ settingsOpen: true });
  status("ses_a", "/work/a", "busy"); status("ses_a", "/work/a", "idle");
  store.markReadIfViewing(); expect(store.isUnread("ses_a")).toBe(true);
  store.setUi({ settingsOpen: false }); expect(store.isUnread("ses_a")).toBe(false);
});
