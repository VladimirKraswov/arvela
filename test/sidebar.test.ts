import { beforeEach, expect, it, vi } from "vitest";
const events = vi.hoisted(() => ({ global: null as any }));
vi.mock("../src/api/events", async (original) => ({
  ...(await original<typeof import("../src/api/events")>()),
  runEventStream: vi.fn((opts) => { if (opts.url.endsWith("/global/event")) events.global = opts; return Promise.resolve(); }),
}));
vi.mock("../src/native/sound", () => ({ completionChime: vi.fn() }));
let store: any, api: any;
const session = (id: string, directory = "/work/a", updated = 1) => ({ id, directory, title: id, projectID: "fixture", time: { created: 1, updated } });
const emit = (info: any, type = "session.updated") => events.global.onEvent({ directory: info.directory, payload: { type, properties: { info } } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
beforeEach(async () => {
  vi.restoreAllMocks(); vi.resetModules();
  const saved = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => saved.set(k, v) });
  store = (await import("../src/state/store")).store;
  api = (await import("../src/api/client")).OpenCodeClient.prototype;
  for (const [method, result] of Object.entries({ health: { healthy: true, version: "1.18.18" }, projects: [], providers: { all: [], connected: [] }, agents: [], config: {}, vcs: null, sessionStatuses: {}, pendingPermissions: [], pendingQuestions: [], messages: { messages: [] }, recentSessions: { sessions: [], cursor: null } })) vi.spyOn(api, method as any).mockResolvedValue(result);
  vi.spyOn(api, "listSessions").mockImplementation(async (dir: string) => [session(dir, dir)]);
  await store.connectLocal("http://127.0.0.1:4096");
  await store.setDirectory("/work/a"); await store.selectSession("/work/a");
});

it("expands multiple projects without changing the current conversation, draft, or stream", async () => {
  store.state.prefs.drafts = { "/work/a": "unsent" };
  const { runEventStream } = await import("../src/api/events"); const count = vi.mocked(runEventStream).mock.calls.length;
  store.toggleProject("/work/b"); await vi.waitFor(() => expect(store.state.projectSessionLists["/work/b"]?.loaded).toBe(true));
  expect(store.isProjectExpanded("/work/a")).toBe(true); expect(store.isProjectExpanded("/work/b")).toBe(true);
  expect(store.state.directory).toBe("/work/a"); expect(store.state.activeSessionId).toBe("/work/a");
  expect(store.state.prefs.drafts["/work/a"]).toBe("unsent"); expect(vi.mocked(runEventStream).mock.calls.length).toBe(count);
  store.toggleProject("/work/a");
  await store.connectLocal("http://127.0.0.1:4096");
  expect(store.isProjectExpanded("/work/a")).toBe(false); expect(store.isProjectExpanded("/work/b")).toBe(true);
  const { flushPrefs, loadPrefs } = await import("../src/state/prefs"); flushPrefs();
  expect(loadPrefs().expandedProjects).toMatchObject({ "/work/a": false, "/work/b": true });
});

it("isolates exact directories and excludes subagent sessions", async () => {
  api.listSessions.mockResolvedValue([session("b", "/work/b"), session("a"), { ...session("child", "/work/b"), parentID: "b" }]);
  await store.loadProjectSessions("/work/b");
  expect(store.state.projectSessionLists["/work/b"].sessions.map((s: any) => s.id)).toEqual(["b"]);
});

it("keeps event updates/deletions that arrived during a slower list snapshot", async () => {
  const d = deferred<any[]>(); api.listSessions.mockReturnValue(d.promise);
  const loading = store.loadProjectSessions("/work/b");
  emit({ ...session("b", "/work/b", 3), title: "Renamed" });
  emit(session("deleted", "/work/b"), "session.deleted");
  d.resolve([session("b", "/work/b"), session("deleted", "/work/b")]); await loading;
  expect(store.state.projectSessionLists["/work/b"].sessions.map((s: any) => s.title)).toEqual(["Renamed"]);
});

it("ignores late results from a previous host and scopes expansion preferences", async () => {
  const d = deferred<any[]>(); api.listSessions.mockReturnValueOnce(d.promise);
  store.toggleProject("/work/b");
  await store.connectLocal("http://127.0.0.1:4097");
  d.resolve([session("foreign", "/work/b")]); await Promise.resolve(); await Promise.resolve();
  expect(store.state.projectSessionLists["/work/b"]).toBeUndefined();
  expect(store.isProjectExpanded("/work/b")).toBe(false);
});

it("paginates recent sessions across projects and projectless directories without duplicates", async () => {
  api.recentSessions.mockResolvedValueOnce({ sessions: [session("b", "/work/b", 3), session("chat", "/chats/one", 2)], cursor: 2 })
    .mockResolvedValueOnce({ sessions: [session("chat", "/chats/one", 2), session("a")], cursor: null });
  await store.loadRecentSessions(); await store.loadRecentSessions(false, true);
  expect(api.recentSessions).toHaveBeenLastCalledWith(false, 2);
  expect(store.state.recentSessionList.sessions.map((s: any) => s.id)).toEqual(["b", "chat", "a"]);
  expect(store.state.recentSessionList.hasMore).toBe(false);
});

it("shows Pi chats alongside OpenCode chats in projects and recent history", async () => {
  const pi = session("chat-pi", "/work/b", 4);
  store.piInstalled = true;
  store.state.prefs.piSessions = {
    "chat-pi": { id: pi.id, directory: pi.directory, title: "Pi task", created: 1, updated: 4 },
  };
  vi.spyOn(store.pi(), "listSessions").mockResolvedValue([{ ...pi, title: "Pi task", projectID: "pi" }]);
  api.listSessions.mockResolvedValue([session("oc", "/work/b", 3)]);
  await store.loadProjectSessions("/work/b");
  expect(store.state.projectSessionLists["/work/b"].sessions.map((s: any) => s.id))
    .toEqual(["chat-pi", "oc"]);

  api.recentSessions.mockResolvedValue({ sessions: [session("oc", "/work/b", 3)], cursor: null });
  await store.loadRecentSessions();
  expect(store.state.recentSessionList.sessions.map((s: any) => s.id))
    .toEqual(["chat-pi", "oc"]);

  store.state.connection.phase = "disconnected";
  await store.loadRecentSessions();
  expect(store.state.recentSessionList.sessions.map((s: any) => s.id))
    .toEqual(["chat-pi"]);
});

it("updates rename/archive/restore/delete on a non-active project and in recent sessions", async () => {
  const b = session("b", "/work/b"); api.listSessions.mockResolvedValue([b]);
  await store.loadProjectSessions("/work/b"); api.recentSessions.mockResolvedValue({ sessions: [b], cursor: null }); await store.loadRecentSessions();
  const updated = { ...b, title: "New title" }; vi.spyOn(api, "updateSession").mockResolvedValue(updated);
  await store.renameSession(b, updated.title);
  expect(store.state.projectSessionLists["/work/b"].sessions[0].title).toBe(updated.title);
  expect(store.state.recentSessionList.sessions[0].title).toBe(updated.title);
  const archived = { ...updated, time: { ...b.time, archived: 123 } }; api.updateSession.mockResolvedValue(archived);
  await store.archiveSession(updated); expect(store.state.recentSessionList.sessions).toEqual([]);
  expect(store.state.archivedSessions).toEqual([]); expect(store.state.activeSessionId).toBe("/work/a");
  api.updateSession.mockResolvedValue(updated); await store.unarchiveSession(archived);
  expect(store.state.recentSessionList.sessions[0].id).toBe("b");
  vi.spyOn(api, "deleteSession").mockResolvedValue(true); await store.deleteSession(updated);
  expect(store.state.projectSessionLists["/work/b"].sessions).toEqual([]); expect(store.state.recentSessionList.sessions).toEqual([]);
});

it("retries a failed project load and can request sessions beyond the first 50", async () => {
  api.listSessions.mockRejectedValueOnce(new Error("offline")); await store.loadProjectSessions("/work/b");
  expect(store.state.projectSessionLists["/work/b"].error).toContain("offline");
  api.listSessions.mockResolvedValue(Array.from({ length: 50 }, (_, i) => session(`b${i}`, "/work/b")));
  await store.loadProjectSessions("/work/b"); expect(store.state.projectSessionLists["/work/b"].hasMore).toBe(true);
  api.listSessions.mockResolvedValue([session("b", "/work/b")]); await store.loadProjectSessions("/work/b", { more: true });
  expect(api.listSessions).toHaveBeenLastCalledWith("/work/b", { limit: 100 }); expect(store.state.projectSessionLists["/work/b"].hasMore).toBe(false);
});

it("removes a project from the list without changing its current session or touching server data, and restores it", async () => {
  store.state.prefs.pinnedProjects = ["/work/a", "/work/b"];
  store.state.prefs.drafts = { "/work/a": "keep me" };
  const del = vi.spyOn(api, "deleteSession");
  store.removeProject("/work/a");
  expect(store.projectDirectories()).not.toContain("/work/a"); expect(store.isProjectHidden("/work/a")).toBe(true);
  expect(store.state.activeSessionId).toBe("/work/a"); expect(store.state.prefs.drafts["/work/a"]).toBe("keep me");
  await store.refreshProjects(); expect(store.projectDirectories()).not.toContain("/work/a"); expect(del).not.toHaveBeenCalled();
  store.restoreProject("/work/a"); expect(store.projectDirectories()).toContain("/work/a");
});

it("keeps hidden projects host-scoped and adding the folder explicitly restores it", async () => {
  store.removeProject("/work/a");
  await store.connectLocal("http://127.0.0.1:4097"); expect(store.isProjectHidden("/work/a")).toBe(false);
  await store.connectLocal("http://127.0.0.1:4096"); expect(store.isProjectHidden("/work/a")).toBe(true);
  await store.addProjectDirectory("/work/a"); expect(store.isProjectHidden("/work/a")).toBe(false);
});

it("appends handoff drafts only to the recipient host/session, preserving existing text and source draft", () => {
  store.state.prefs.drafts = { source: "source draft", target: "local target" };
  store.state.prefs.endpointState = { remote: { drafts: { target: "remote target" } } };
  store.saveHandoffDraft("remote", session("target", "/other"), "handoff");
  expect(store.state.prefs.drafts.target).toBe("local target"); expect(store.state.prefs.drafts.source).toBe("source draft");
  expect(store.state.prefs.endpointState.remote.drafts.target).toBe("remote target\n\nhandoff");
  store.saveHandoffDraft(store.state.prefs.workspaceKey ?? store.state.prefs.endpoint, session("target"), "local handoff");
  expect(store.state.prefs.drafts.target).toBe("local target\n\nlocal handoff");
});
