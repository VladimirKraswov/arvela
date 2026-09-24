import { beforeEach, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
const native = vi.hoisted(() => ({
  prepareChat: vi.fn(),
  connectSsh: vi.fn(),
}));
vi.mock("../src/native/hosts", async (original) => ({
  ...(await original<typeof import("../src/native/hosts")>()),
  ...native,
}));
vi.mock("../src/api/events", () => ({
  globalEventStreamUrl: () => "http://localhost/global/event",
  eventStreamUrl: () => "http://localhost/event",
  runEventStream: vi.fn(() => Promise.resolve()),
}));
let store: any;
const session = (id: string, directory: string) => ({
  id,
  directory,
  title: id,
  projectID: "global",
  time: { created: 1, updated: 1 },
});
const defer = () => {
  let resolve!: (x: any) => void;
  const promise = new Promise<any>((r) => (resolve = r));
  return { promise, resolve };
};
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  native.prepareChat.mockReset();
  native.connectSsh.mockReset();
  store = (await import("../src/state/store")).store;
  const { OpenCodeClient } = await import("../src/api/client");
  for (const [name, value] of Object.entries({
    health: { healthy: true, version: "1.18.18" },
    projects: [],
    providers: { all: [], connected: [] },
    agents: [],
    config: {},
    vcs: null,
    listSessions: [],
    sessionStatuses: {},
    pendingPermissions: [],
    pendingQuestions: [],
    messages: { messages: [] },
    paths: { home: "/home/test", directory: "/home/test", worktree: "/" },
    prompt: undefined,
  }))
    vi.spyOn(OpenCodeClient.prototype as any, name).mockResolvedValue(value);
  store.state = {
    ...store.state,
    connection: { ...store.state.connection, phase: "connected" },
    connectedProviderIds: ["p"],
  };
  store.setModelChoice("p", "m", "medium");
  native.prepareChat.mockResolvedValue({
    root: "/home/test/chats",
    directory: "/home/test/chats/one",
  });
});
it("New Chat leaves the old session and project, preserves their draft, and creates no server session", async () => {
  await store.setDirectory("/project");
  store.state.prefs.lastSessionByDir["/project"] = "ses_old";
  store.state.activeSessionId = "ses_old";
  store.setDraft("unfinished old draft");
  const create = vi.spyOn(store.client, "createSession");
  await store.newSession();
  expect(store.state.directory).toBeNull();
  expect(store.state.activeSessionId).toBeNull();
  expect(store.isProjectless()).toBe(true);
  expect(store.state.prefs.drafts.ses_old).toBe("unfinished old draft");
  expect(create).not.toHaveBeenCalled();
  expect(native.prepareChat).not.toHaveBeenCalled();
});
it("choosing a project for a new chat does not resume that project's previous session", async () => {
  store.state.prefs.lastSessionByDir["/project"] = "ses_old";
  await store.setDirectory("/project");
  expect(store.state.activeSessionId).toBeNull();
  await store.setDirectory("/project", { restoreSession: true });
  expect(store.state.activeSessionId).toBe("ses_old");
});
it("the first projectless send creates an isolated workspace and routes the real prompt there", async () => {
  store.setDraft("hello");
  // Runtime metadata is independently loaded for the new workspace.
  vi.mocked(store.client.providers).mockResolvedValue({
    connected: ["p"],
    all: [],
  });
  const create = vi
    .spyOn(store.client, "createSession")
    .mockImplementation(async ({ directory }: any) =>
      session("ses_chat", directory),
    );
  expect(await store.sendPrompt("hello")).toBe(true);
  expect(native.prepareChat).toHaveBeenCalledOnce();
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      directory: "/home/test/chats/one",
      model: { id: "m", providerID: "p", variant: "medium" },
    }),
  );
  expect(store.client.prompt).toHaveBeenCalledWith(
    "ses_chat",
    "/home/test/chats/one",
    expect.objectContaining({ parts: [{ type: "text", text: "hello" }] }),
  );
  expect(store.chatSessions().map((s: any) => s.id)).toEqual(["ses_chat"]);
  expect(store.projectDirectories()).not.toContain("/home/test/chats/one");
  expect(store.state.prefs.drafts["new::"]).toBeUndefined();
});
it("sends a file part with the prompt and removes only accepted attachments", async () => {
  const { attachmentDrafts, attachmentScope } = await import("../src/attachments/drafts");
  store.state.directory = "/project";
  store.state.activeSessionId = "ses_file";
  store.state.sessions = [session("ses_file", "/project")];
  store.state.providers = [{ id: "p", models: { m: { id: "m", providerID: "p", capabilities: { input: { text: true, image: true } } } } }];
  store.setModelChoice("p", "m", "medium");
  store.setDraft("review this");
  const scope = attachmentScope(store.state.prefs.workspaceKey ?? store.state.prefs.endpoint, "/project", "ses_file");
  const [file] = await attachmentDrafts.add(scope, [new File(["hello"], "notes.txt", { type: "text/plain" })]);
  expect(await store.sendPrompt("review this", [file])).toBe(true);
  expect(store.client.prompt).toHaveBeenCalledWith("ses_file", "/project", expect.objectContaining({ parts: [
    { type: "text", text: "review this" }, expect.objectContaining({ type: "file", mime: "text/plain", filename: "notes.txt" }),
  ] }));
  expect(attachmentDrafts.snapshot(scope)).toEqual([]);
  expect(store.getDraft()).toBe("");
});
it("keeps an attachment and text draft after a failed send", async () => {
  const { attachmentDrafts, attachmentScope } = await import("../src/attachments/drafts");
  store.state.directory = "/project";
  store.state.activeSessionId = "ses_failure";
  store.state.sessions = [session("ses_failure", "/project")];
  store.state.providers = [{ id: "p", models: { m: { id: "m", providerID: "p", capabilities: { input: { text: true } } } } }];
  store.setModelChoice("p", "m", "medium");
  store.setDraft("keep this");
  const scope = attachmentScope(store.state.prefs.workspaceKey ?? store.state.prefs.endpoint, "/project", "ses_failure");
  const [file] = await attachmentDrafts.add(scope, [new File(["hello"], "notes.txt", { type: "text/plain" })]);
  vi.mocked(store.client.prompt).mockRejectedValueOnce(new Error("server unavailable"));
  expect(await store.sendPrompt("keep this", [file])).toBe(false);
  expect(attachmentDrafts.snapshot(scope).map(x => x.name)).toEqual(["notes.txt"]);
  expect(store.getDraft()).toBe("keep this");
  expect(store.state.ui.sendError).toContain("server unavailable");
});
it("workspace preparation guards double Enter and cannot send after a project switch", async () => {
  const pending = defer();
  native.prepareChat.mockReturnValue(pending.promise);
  const first = store.sendPrompt("first");
  await Promise.resolve();
  await Promise.resolve();
  expect(await store.sendPrompt("duplicate")).toBe(false);
  await store.setDirectory("/different-project");
  pending.resolve({
    root: "/home/test/chats",
    directory: "/home/test/chats/stale",
  });
  expect(await first).toBe(false);
  expect(store.state.directory).toBe("/different-project");
  expect(store.client.prompt).not.toHaveBeenCalled();
  expect(store.state.prefs.projectlessDirectories).toBeUndefined();
});
it("a workspace failure preserves the unassigned draft and never falls back to HOME", async () => {
  store.setDraft("keep me");
  native.prepareChat.mockRejectedValue(new Error("disk unavailable"));
  expect(await store.sendPrompt("keep me")).toBe(false);
  expect(store.getDraft()).toBe("keep me");
  expect(store.state.directory).toBeNull();
  expect(store.state.ui.sendError).toContain("disk unavailable");
  expect(store.client.prompt).not.toHaveBeenCalled();
});
it("each new projectless chat gets a new workspace; cached chats reopen in their own directory", async () => {
  await store.ensureChatWorkspace();
  const one = session("ses_one", store.state.directory);
  store.state.prefs.projectlessSessions = [one];
  await store.newSession();
  native.prepareChat.mockResolvedValue({
    root: "/home/test/chats",
    directory: "/home/test/chats/two",
  });
  await store.ensureChatWorkspace();
  expect(store.state.directory).toBe("/home/test/chats/two");
  vi.mocked(store.client.listSessions).mockResolvedValue([one]);
  await store.openChat(one);
  expect(store.state.directory).toBe(one.directory);
  expect(store.state.activeSessionId).toBe("ses_one");
  expect(store.client.messages).toHaveBeenCalledWith(
    "ses_one",
    expect.objectContaining({ directory: one.directory }),
  );
});
it("SSH reconnect with a new forwarding port keeps its history and never inherits local projects", async () => {
  store.setDraft("local draft");
  store.setPtyId("/same", "pty_local");
  store.saveRemoteHost({
    id: "remote",
    name: "Remote",
    target: "host",
    port: 4096,
  });
  native.connectSsh
    .mockResolvedValueOnce("http://127.0.0.1:49101")
    .mockResolvedValueOnce("http://127.0.0.1:49199");
  expect(await store.connectHost("remote")).toBe(true);
  expect(store.getDraft()).toBe("");
  expect(store.state.prefs.ptyIds).toEqual({});
  store.setDraft("remote draft");
  store.setPtyId("/same", "pty_remote");
  expect(await store.connectHost("remote")).toBe(true);
  expect(store.state.prefs.workspaceKey).toBe("ssh:host:4096");
  expect(store.getDraft()).toBe("remote draft");
  expect(store.state.prefs.ptyIds["/same"]).toBe("pty_remote");
  await store.connectHost("local");
  expect(store.getDraft()).toBe("local draft");
  expect(store.state.prefs.ptyIds["/same"]).toBe("pty_local");
});
it("a failed remote connection disables sending and does not silently execute on the Mac", async () => {
  store.saveRemoteHost({
    id: "remote",
    name: "Remote",
    target: "host",
    port: 4096,
  });
  native.connectSsh.mockRejectedValue(new Error("SSH unavailable"));
  expect(await store.connectHost("remote")).toBe(false);
  expect(store.state.connection.phase).toBe("disconnected");
  expect(await store.sendPrompt("reboot this machine")).toBe(false);
  expect(store.client.prompt).not.toHaveBeenCalled();
});
it("a late remote handshake cannot replace a newer Local selection", async () => {
  const pending = defer();
  native.connectSsh.mockReturnValue(pending.promise);
  store.saveRemoteHost({
    id: "remote",
    name: "Remote",
    target: "host",
    port: 4096,
  });
  const first = store.connectHost("remote");
  await store.connectHost("local");
  pending.resolve("http://127.0.0.1:49102");
  expect(await first).toBe(false);
  expect(store.client.baseUrl).toBe("http://127.0.0.1:4096");
  expect(store.state.prefs.activeHost).toBe("local");
});
it("remote API authentication is forwarded on HTTP but never serialized in prefs", async () => {
  const { setHostPassword } = await import("../src/native/hosts");
  store.saveRemoteHost({
    id: "remote",
    name: "Remote",
    target: "host",
    port: 4096,
  });
  setHostPassword("ssh:host:4096", "test-only-password");
  native.connectSsh.mockResolvedValue("http://127.0.0.1:49101");
  await store.connectHost("remote");
  expect(store.client.headers.Authorization).toMatch(/^Basic /);
  expect(JSON.stringify(store.state.prefs)).not.toContain("test-only-password");
  expect(JSON.stringify(store.state.prefs)).not.toContain(
    store.client.headers.Authorization,
  );
});
it("remote workspace creation uses the selected SSH host and the remote API home", async () => {
  store.saveRemoteHost({
    id: "remote",
    name: "Remote",
    target: "host",
    port: 4096,
  });
  native.connectSsh.mockResolvedValue("http://127.0.0.1:49101");
  await store.connectHost("remote");
  await store.ensureChatWorkspace();
  expect(native.prepareChat).toHaveBeenCalledWith(
    expect.objectContaining({ target: "host" }),
    "/home/test",
  );
});
it("refresh removes externally deleted chats from the local index without deleting any engine session", async () => {
  await store.ensureChatWorkspace();
  store.state.prefs.projectlessSessions = [
    session("ses_deleted", store.state.directory),
  ];
  vi.mocked(store.client.listSessions).mockResolvedValue([]);
  const del = vi.spyOn(store.client, "deleteSession");
  await store.refreshSessions();
  expect(store.chatSessions()).toEqual([]);
  expect(del).not.toHaveBeenCalled();
});

it("terminal shortcut creates a workspace without sending a model request", async () => {
  await store.toggleTerminal();
  expect(store.state.prefs.layout.bottomOpen).toBe(true);
  expect(store.state.directory).toBe("/home/test/chats/one");
  expect(store.client.prompt).not.toHaveBeenCalled();
  await store.toggleTerminal();
  expect(store.state.prefs.layout.bottomOpen).toBe(false);
  expect(native.prepareChat).toHaveBeenCalledOnce();
});
it("manual non-Git projects survive a server project-list refresh without showing chat directories", async () => {
  await store.addProjectDirectory("/project-without-git");
  await store.newSession();
  await store.ensureChatWorkspace();
  await store.refreshProjects();
  expect(store.projectDirectories()).toContain("/project-without-git");
  expect(store.projectDirectories()).not.toContain("/home/test/chats/one");
  expect(store.state.prefs.pinnedProjects).toContain("/project-without-git");
});

it("configured models default to Medium when supported, without inventing unsupported variants", () => {
  store.state.prefs.modelChoice = {};
  store.state.configModel = "p/m";
  store.state.providers = [
    { id: "p", models: { m: { id: "m", variants: { medium: {} } } } },
  ];
  expect(store.getModelChoice().variant).toBe("medium");
  store.state.providers[0].models.m.variants = {};
  expect(store.getModelChoice().variant).toBeNull();
});

it("keeps model and effort choices within a session, without changing another session or new chats", () => {
  store.state = {
    ...store.state,
    directory: "/project",
    connectedProviderIds: ["local-qwen-next", "local-qwen38"],
    prefs: {
      ...store.state.prefs,
      modelChoice: {
        "/project": { providerID: "local-qwen-next", modelID: "flash", variant: "medium" },
      },
    },
    sessions: [
      { ...session("ses_flash", "/project"), model: { id: "flash", providerID: "local-qwen-next", variant: "medium" } },
      { ...session("ses_v100", "/project"), model: { id: "qwen27", providerID: "local-qwen38", variant: "low" } },
    ],
    activeSessionId: "ses_v100",
  };
  expect(store.getModelChoice()).toEqual({ providerID: "local-qwen38", modelID: "qwen27", variant: "low" });
  store.setModelChoice("local-qwen38", "qwen27", "xhigh");
  expect(store.getModelChoice().variant).toBe("xhigh");
  expect(store.state.prefs.modelChoice["/project"].modelID).toBe("flash");
  store.state = { ...store.state, activeSessionId: "ses_flash" };
  expect(store.getModelChoice()).toEqual({ providerID: "local-qwen-next", modelID: "flash", variant: "medium" });
  store.state = { ...store.state, activeSessionId: null };
  expect(store.getModelChoice()).toEqual({ providerID: "local-qwen-next", modelID: "flash", variant: "medium" });
});

it("keeps agent selection per session while preserving the new-chat default", () => {
  store.state = {
    ...store.state,
    directory: "/project",
    configDefaultAgent: "qwen-build",
    prefs: { ...store.state.prefs, agentChoice: { "/project": "qwen-build" } },
    sessions: [
      { ...session("ses_a", "/project"), agent: "qwen-build" },
      { ...session("ses_b", "/project"), agent: "qwen-v100-build" },
    ],
    activeSessionId: "ses_b",
  };
  expect(store.getAgentChoice()).toBe("qwen-v100-build");
  store.setAgentOverride("/project", "plan");
  expect(store.getAgentChoice()).toBe("plan");
  expect(store.state.prefs.agentChoice["/project"]).toBe("qwen-build");
  store.state = { ...store.state, activeSessionId: "ses_a" };
  expect(store.getAgentChoice()).toBe("qwen-build");
  store.state = { ...store.state, activeSessionId: null };
  expect(store.getAgentChoice()).toBe("qwen-build");
});
