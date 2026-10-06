import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  newPiSessionId,
  PI_CAPABILITIES,
  PiBackend,
  supportsAttachment,
  type PiDialogRequest,
  type PiHost,
  type PiSessionMeta,
} from "../src/agent/pi/backend";
import { setPiBridge, type PiBridge } from "../src/agent/pi/native";
import type { PiEnvelope } from "../src/agent/pi/protocol";
import type { ServerEvent } from "../src/api/types";

let handlers: ((envelope: PiEnvelope) => void)[] = [];
let opened: { directory: string; sessionId: string }[] = [];
let posted: { key: string; message: any }[] = [];
let closed: string[] = [];
let respond: (command: any) => any;
let sessionFiles: any[] = [];

const bridge: PiBridge = {
  detect: async () => ({
    installed: true,
    path: "/managed/pi",
    version: "0.85.1",
    source: "managed",
    error: "",
  }),
  open: async (request) => {
    opened.push({ directory: request.directory, sessionId: request.sessionId });
    return {
      key: `${request.directory}\u0000${request.sessionId}`,
      sessionId: request.sessionId,
      sessionDir: "/sessions",
      program: "/managed/pi",
      reused: false,
    };
  },
  request: async (_key, command) => respond(command),
  post: async (key, message) => {
    posted.push({ key, message });
  },
  close: async (key) => {
    closed.push(key);
  },
  sessions: async () => sessionFiles,
  setupLsp: async () => ({
    extensionPath: "/data/pi/lsp-extension.ts",
    configPath: "/data/pi/lsp-config.json",
    servers: [],
    missing: [],
  }),
  probeDirectory: async () => "/tmp/probe",
  prepareChatWorkspace: async () => ({ directory: "/tmp/pi-chat", root: "/tmp" }),
  liveSessions: async () => opened.map((o) => `${o.directory}\u0000${o.sessionId}`),
  subscribe: (handler) => {
    handlers.push(handler);
    return () => {
      handlers = handlers.filter((h) => h !== handler);
    };
  },
};

let meta: Record<string, PiSessionMeta>;
let notices: string[];
let dialogs: PiDialogRequest[];
let stale: string[];

function host(): PiHost {
  return {
    choice: () => ({ provider: "deepseek", model: "deepseek/deepseek-v4-flash" }),
    meta: {
      all: () => meta,
      save: (m) => {
        meta[m.id] = m;
      },
      remove: (id) => {
        delete meta[id];
      },
    },
    onNotice: (_d, _s, n) => notices.push(n.text),
    onDialog: (r) => dialogs.push(r),
    onHistoryStale: (_d, s) => stale.push(s),
  };
}

beforeEach(() => {
  handlers = [];
  opened = [];
  posted = [];
  closed = [];
  sessionFiles = [];
  meta = {};
  notices = [];
  dialogs = [];
  stale = [];
  respond = () => ({ type: "response", success: true, data: {} });
  setPiBridge(bridge);
});
afterEach(() => setPiBridge(null));

const emit = (payload: unknown, sessionId = "chat-a", directory = "/work") =>
  handlers.forEach((h) =>
    h({ key: `${directory}\u0000${sessionId}`, directory, sessionId, payload } as PiEnvelope),
  );

it("declares only the surfaces Pi actually has", () => {
  // Reporting a PTY or a permission queue Pi does not implement would leave
  // dead buttons in the UI.
  expect(PI_CAPABILITIES).toMatchObject({
    pty: false,
    permissions: false,
    questions: false,
    vcsDiff: false,
    fork: true,
    compaction: true,
  });
});

it("generates filename-safe session ids", () => {
  for (let i = 0; i < 20; i++) expect(newPiSessionId()).toMatch(/^chat-[a-zA-Z0-9]{1,24}$/);
});

it("starts one process per session and reuses it for later prompts", async () => {
  const pi = new PiBackend(host());
  await pi.createSession({ directory: "/work", title: "t" });
  const id = Object.keys(meta)[0];
  await pi.prompt(id, "/work", { parts: [{ type: "text", text: "one" }] } as any);
  await pi.prompt(id, "/work", { parts: [{ type: "text", text: "two" }] } as any);
  // A duplicate child would answer the same conversation twice and corrupt
  // the append-only session file.
  expect(opened).toHaveLength(1);
});

it("does not launch an agent for a chat that was only created", async () => {
  const pi = new PiBackend(host());
  await pi.createSession({ directory: "/work", title: "t" });
  expect(opened).toEqual([]);
});

it("queues instead of dropping a prompt sent while Pi is still running", async () => {
  const sent: any[] = [];
  respond = (command) => {
    sent.push(command);
    return { type: "response", success: true };
  };
  const pi = new PiBackend(host());
  const session = await pi.createSession({ directory: "/work", title: "t" });
  const ctrl = new AbortController();
  pi.subscribeDirectory("/work", {
    signal: ctrl.signal,
    onEvent: () => {},
    onState: () => {},
  });
  await pi.prompt(session.id, "/work", { parts: [{ type: "text", text: "one" }] } as any);
  await pi.prompt(session.id, "/work", { parts: [{ type: "text", text: "two" }] } as any);
  expect(sent[0].streamingBehavior).toBeUndefined();
  expect(sent[1].streamingBehavior).toBe("followUp");
  ctrl.abort();
});

it("refuses attachments Pi cannot accept instead of silently dropping them", async () => {
  expect(supportsAttachment("image/png")).toBe(true);
  expect(supportsAttachment("application/pdf")).toBe(false);
  const pi = new PiBackend(host());
  const session = await pi.createSession({ directory: "/work", title: "t" });
  await expect(
    pi.prompt(session.id, "/work", {
      parts: [
        { type: "text", text: "look" },
        { type: "file", mime: "application/pdf", url: "data:application/pdf;base64,AA" },
      ],
    } as any),
  ).rejects.toThrow(/не подготовлен/);
});

it("forwards an image attachment in Pi's own format", async () => {
  const sent: any[] = [];
  respond = (command) => {
    sent.push(command);
    return { type: "response", success: true };
  };
  const pi = new PiBackend(host());
  const session = await pi.createSession({ directory: "/work", title: "t" });
  await pi.prompt(session.id, "/work", {
    parts: [
      { type: "text", text: "что тут" },
      { type: "file", mime: "image/png", url: "data:image/png;base64,QUJD" },
    ],
  } as any);
  expect(sent[0].images).toEqual([
    { type: "image", mimeType: "image/png", data: "QUJD" },
  ]);
});

it("reports a rejected prompt as an error rather than a sent message", async () => {
  respond = () => ({ type: "response", success: false, error: "no model configured" });
  const pi = new PiBackend(host());
  const session = await pi.createSession({ directory: "/work", title: "t" });
  await expect(
    pi.prompt(session.id, "/work", { parts: [{ type: "text", text: "x" }] } as any),
  ).rejects.toThrow(/no model configured/);
});

it("routes translated events only to subscribers of that directory", () => {
  const pi = new PiBackend(host());
  meta["chat-a"] = {
    id: "chat-a",
    directory: "/work",
    title: "t",
    created: 1,
    updated: 1,
  };
  const mine: ServerEvent[] = [];
  const other: ServerEvent[] = [];
  const a = new AbortController();
  const b = new AbortController();
  pi.subscribeDirectory("/work", { signal: a.signal, onEvent: (e) => mine.push(e), onState: () => {} });
  pi.subscribeDirectory("/elsewhere", { signal: b.signal, onEvent: (e) => other.push(e), onState: () => {} });
  emit({ type: "agent_start" });
  expect(mine.map((e) => e.type)).toEqual(["session.status"]);
  expect(other).toEqual([]);
  a.abort();
  b.abort();
});

it("asks the host to re-read history when the run settles", () => {
  const pi = new PiBackend(host());
  const ctrl = new AbortController();
  pi.subscribeDirectory("/work", { signal: ctrl.signal, onEvent: () => {}, onState: () => {} });
  emit({ type: "agent_settled" });
  expect(stale).toEqual(["chat-a"]);
  ctrl.abort();
});

it("denies a blocking extension dialog when nothing can display it", () => {
  const bare: PiHost = { ...host(), onDialog: undefined };
  const pi = new PiBackend(bare);
  const ctrl = new AbortController();
  pi.subscribeDirectory("/work", { signal: ctrl.signal, onEvent: () => {}, onState: () => {} });
  emit({
    type: "extension_ui_request",
    id: "d1",
    method: "confirm",
    title: "Allow dangerous command?",
  });
  // Silence must never read as approval.
  expect(posted[0].message).toEqual({
    type: "extension_ui_response",
    id: "d1",
    cancelled: true,
  });
  ctrl.abort();
});

it("surfaces a blocking dialog to the UI and never auto-approves it", () => {
  const pi = new PiBackend(host());
  const ctrl = new AbortController();
  pi.subscribeDirectory("/work", { signal: ctrl.signal, onEvent: () => {}, onState: () => {} });
  emit({ type: "extension_ui_request", id: "d2", method: "select", options: ["Allow", "Block"] });
  expect(dialogs).toHaveLength(1);
  expect(dialogs[0].request.method).toBe("select");
  expect(posted).toEqual([]);
  ctrl.abort();
});

it("treats fire-and-forget notifications as notices, not dialogs", () => {
  const pi = new PiBackend(host());
  const ctrl = new AbortController();
  pi.subscribeDirectory("/work", { signal: ctrl.signal, onEvent: () => {}, onState: () => {} });
  emit({ type: "extension_ui_request", id: "n1", method: "notify", message: "заблокировано", notifyType: "warning" });
  expect(dialogs).toEqual([]);
  expect(notices).toEqual(["заблокировано"]);
  ctrl.abort();
});

it("pages history from the end using Pi's durable entry ids", async () => {
  const entries = Array.from({ length: 5 }, (_, i) => ({
    type: "message",
    id: `e${i}`,
    timestamp: "2026-09-24T20:07:27.297Z",
    message: { role: "user", content: [{ type: "text", text: `m${i}` }] },
  }));
  respond = (command) =>
    command.type === "get_entries"
      ? { type: "response", success: true, data: { entries } }
      : { type: "response", success: true, data: {} };
  const pi = new PiBackend(host());
  meta["chat-a"] = { id: "chat-a", directory: "/work", title: "t", created: 1, updated: 1 };
  const page = await pi.messages("chat-a", { directory: "/work", limit: 2 });
  expect(page.messages.map((m) => m.info.id)).toEqual(["e3", "e4"]);
  expect(page.before).toBe("e3");
  const older = await pi.messages("chat-a", { directory: "/work", limit: 2, before: "e3" });
  expect(older.messages.map((m) => m.info.id)).toEqual(["e1", "e2"]);
});

it("lists sessions of the requested directory with app-owned titles", async () => {
  sessionFiles = [
    { id: "chat-a", file: "/s/a.jsonl", cwd: "/work", created: "2026-09-24T20:00:00.000Z", updated: 2 },
    { id: "chat-b", file: "/s/b.jsonl", cwd: "/work", created: "2026-09-24T20:01:00.000Z", updated: 5 },
  ];
  meta["chat-a"] = { id: "chat-a", directory: "/work", title: "Моя задача", created: 1, updated: 1 };
  const pi = new PiBackend(host());
  const list = await pi.listSessions("/work");
  expect(list.map((s) => s.title)).toEqual(["Моя задача", expect.stringContaining("Чат Pi")]);
  expect(list.every((s) => s.directory === "/work")).toBe(true);
});

it("closes the child and forgets metadata when a chat is deleted", async () => {
  const pi = new PiBackend(host());
  const session = await pi.createSession({ directory: "/work", title: "t" });
  await pi.prompt(session.id, "/work", { parts: [{ type: "text", text: "x" }] } as any);
  await pi.deleteSession(session.id, "/work");
  expect(closed).toHaveLength(1);
  expect(meta[session.id]).toBeUndefined();
});

it("never reports itself healthy when the CLI is missing", async () => {
  setPiBridge({
    ...bridge,
    detect: async () => ({
      installed: false,
      path: "",
      version: "",
      source: "",
      error: "Pi CLI не найден.",
    }),
  });
  await expect(new PiBackend(host()).health()).rejects.toThrow(/не найден/);
});

it("loads a capability probe without a session so it leaves no chat behind", async () => {
  const opens: any[] = [];
  setPiBridge({
    ...bridge,
    open: async (request) => {
      opens.push(request);
      return {
        key: "k",
        sessionId: request.sessionId,
        sessionDir: "/s",
        program: "/managed/pi",
        reused: false,
      };
    },
  });
  await new PiBackend(host()).describe("/work");
  expect(opens[0].ephemeral).toBe(true);
  // An empty persistent transcript would otherwise surface as a user chat.
  expect(opens[0].sessionId).toMatch(/^probe-/);
});

it("passes Pi's own model id form so a custom model is not matched against the catalog", async () => {
  const sent: any[] = [];
  const opens: any[] = [];
  setPiBridge({
    ...bridge,
    open: async (request) => {
      opens.push(request);
      return { key: "k", sessionId: request.sessionId, sessionDir: "/s", program: "/p", reused: false };
    },
    request: async (_key, command) => {
      sent.push(command);
      if ((command as any).type === "get_state") return { type: "response", success: true, data: { model: { provider: "deepseek", id: "deepseek-flash" }, isStreaming: false } };
      return { type: "response", success: true };
    },
  });
  const pi = new PiBackend(host());
  const session = await pi.createSession({ directory: "/work", title: "t" });
  await pi.prompt(session.id, "/work", {
    model: { providerID: "deepseek", modelID: "deepseek-flash" },
    parts: [{ type: "text", text: "hi" }],
  } as any);
  // A bare id would be looked up in Pi's bundled catalog and rejected.
  expect(opens[0].model).toBe("deepseek/deepseek-flash");
  expect(sent.find(command => command.type === "prompt")?.message).toBe("hi");
});

it("carries the tool-approval policy into every real session", async () => {
  const opens: any[] = [];
  setPiBridge({
    ...bridge,
    open: async (request) => {
      opens.push(request);
      return { key: "k", sessionId: request.sessionId, sessionDir: "/s", program: "/p", reused: false };
    },
  });
  const asking: PiHost = {
    ...host(),
    choice: () => ({ provider: "deepseek", toolPolicy: "ask" }),
  };
  const pi = new PiBackend(asking);
  const session = await pi.createSession({ directory: "/work", title: "t" });
  await pi.prompt(session.id, "/work", { parts: [{ type: "text", text: "x" }] } as any);
  expect(opens[0].toolPolicy).toBe("ask");
});

it("switches a live Pi model explicitly and refuses an unconfirmed or busy change", async () => {
  let actual = { provider: "local", id: "old" }, busy = false, confirm = true;
  const sent: any[] = [];
  respond = (command) => {
    sent.push(command);
    if (command.type === "get_state") return { type: "response", success: true, data: { model: actual, isStreaming: busy } };
    if (command.type === "set_model" && confirm) actual = { provider: command.provider, id: command.modelId };
    return { type: "response", success: true, data: {} };
  };
  const pi = new PiBackend(host()), chat = await pi.createSession({ directory: "/work", title: "t" });
  const request = (id: string) => pi.prompt(chat.id, "/work", { model: { providerID: "local", modelID: id }, parts: [{ type: "text", text: "run" }] } as any);
  await request("new");
  expect(sent.find(command => command.type === "set_model")).toMatchObject({ provider: "local", modelId: "new" });
  expect(sent.filter(command => command.type === "prompt")).toHaveLength(1);
  busy = true;
  await expect(request("other")).rejects.toThrow("остановите");
  busy = false; await pi.abort(chat.id); confirm = false;
  await expect(request("other")).rejects.toThrow("не подтвердил");
  expect(sent.filter(command => command.type === "prompt")).toHaveLength(1);
});

it("sends prepared UTF-8 text alongside images without inventing an image from the text", async () => {
  const sent: any[] = [];
  respond = command => { sent.push(command); return { type: "response", success: true }; };
  const pi = new PiBackend(host()), chat = await pi.createSession({ directory: "/work", title: "t" });
  const contents = "Русский текст\\nconst value = 42;";
  const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(contents)));
  await pi.prompt(chat.id, "/work", { parts: [{ type: "text", text: "read" }, { type: "file", filename: "данные.txt", mime: "text/plain", url: `data:text/plain;base64,${encoded}` }, { type: "file", mime: "image/png", url: "data:image/png;base64,AAAA" }] } as any);
  const prompt = sent.find(command => command.type === "prompt");
  expect(prompt.message).toContain(contents);
  expect(prompt.message).toContain("данные.txt");
  expect(prompt.images).toEqual([{ type: "image", mimeType: "image/png", data: "AAAA" }]);
});

it("forks a durable user entry through Pi and keeps the original metadata and transcript identity", async () => {
  let forked = false;
  const sent: any[] = [];
  respond = command => {
    sent.push(command);
    const data = command.type === "get_state" ? { sessionId: forked ? "new-pi-id" : "original-id", isStreaming: false }
      : command.type === "get_entries" ? { entries: [{ type: "message", id: "user-entry", message: { role: "user", content: "old prompt" } }] }
      : command.type === "fork" ? (forked = true, { cancelled: false }) : {};
    return { type: "response", success: true, data };
  };
  const pi = new PiBackend(host()), original = await pi.createSession({ directory: "/work", title: "source" });
  const branch = await pi.forkSession(original.id, "/work", "user-entry");
  expect(branch.id).toBe("new-pi-id");
  expect(meta[original.id].title).toBe("source");
  expect(meta[branch.id].directory).toBe("/work");
  expect(closed).toEqual([`/work\u0000${original.id}`]);
  expect(sent.some(command => command.type === "prompt")).toBe(false);
});

it("does not register a fork cancelled by an extension", async () => {
  respond = command => ({ type: "response", success: true, data: command.type === "get_entries" ? { entries: [{ type: "message", id: "u", message: { role: "user", content: "x" } }] } : command.type === "fork" ? { cancelled: true } : { isStreaming: false } });
  const pi = new PiBackend(host()), original = await pi.createSession({ directory: "/work", title: "source" });
  await expect(pi.forkSession(original.id, "/work", "u")).rejects.toThrow("отменило");
  expect(Object.keys(meta)).toEqual([original.id]);
  expect(closed).toEqual([]);
});

it("confirms the chosen model before compacting an unopened or existing Pi session", async () => {
  let actual = { provider: "local", id: "old" }, streaming = false;
  const sent: any[] = [];
  respond = command => {
    sent.push(command);
    if (command.type === "set_model") actual = { provider: command.provider, id: command.modelId };
    return { type: "response", success: true, data: command.type === "get_state" ? { model: actual, isStreaming: streaming } : {} };
  };
  const pi = new PiBackend(host()), chat = await pi.createSession({ directory: "/work", title: "compact" });
  await pi.summarize(chat.id, "/work", "local", "new");
  expect(actual.id).toBe("new");
  expect(sent.findIndex(c => c.type === "set_model")).toBeLessThan(sent.findIndex(c => c.type === "compact"));
  streaming = true;
  await expect(pi.summarize(chat.id, "/work", "local", "new")).rejects.toThrow("остановите");
  expect(sent.filter(c => c.type === "compact")).toHaveLength(1);
});

it("does not report intentional close or late closed-session events as an agent failure", async () => {
  const pi = new PiBackend(host());
  const chat = await pi.createSession({ directory: "/work", title: "close" });
  await pi.prompt(chat.id, "/work", { parts: [{ type: "text", text: "fixture" }] } as any);
  const events: ServerEvent[] = [], ctrl = new AbortController();
  pi.subscribeDirectory("/work", { signal: ctrl.signal, onEvent: e => events.push(e), onState: () => {} });
  await pi.closeSession(chat.id);
  emit({ type: "pi_exited" }, chat.id);
  emit({ type: "agent_start" }, chat.id);
  expect(notices).toEqual([]);
  expect(events).toEqual([]);
  expect(meta[chat.id]).toBeDefined();
  ctrl.abort();
});
