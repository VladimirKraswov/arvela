import {toolWorkflowReminder} from "../src/agent/toolWorkflow";
import {languageReminder} from "../src/agent/promptPolicy";
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
let livePiModel = { provider: "deepseek", id: "deepseek-v4-flash" };

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
    if (command.type === "get_state") return { type: "response", success: true, data: { model: livePiModel, isStreaming: false } };
    if (command.type === "set_model") livePiModel = { provider: command.provider, id: command.modelId };
    if (command.type === "prompt") piPrompts.push(command);
    if (command.type === "get_available_models")
      return { type: "response", success: true, data: { models: [
        { id: "deepseek-v4-flash", provider: "deepseek", name: "DeepSeek V4 Flash", input: ["text"] },
      ] } };
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
  prepareChatWorkspace: async () => ({ directory: "/tmp/pi-chat-test", root: "/tmp" }),
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
  livePiModel = { provider: "deepseek", id: "deepseek-v4-flash" };
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
    prefs: {
      ...store.state.prefs,
      pi: { ...store.state.prefs.pi, verifiedModels: { "deepseek/deepseek-v4-flash": 1 } },
    },
  };
  store.piInstalled = true;
  vi.spyOn(store.client, "vcs").mockResolvedValue(null);
  vi.spyOn(store.client, "listSessions").mockResolvedValue([]);
  vi.spyOn(store.client, "sessionStatuses").mockResolvedValue({});
  vi.spyOn(store.client, "pendingPermissions").mockResolvedValue([]);
  vi.spyOn(store.client, "pendingQuestions").mockResolvedValue([]);
  vi.spyOn(store.client, "messages").mockResolvedValue({ messages: [] });
  // Runtime metadata reads are part of a directory switch; never query a user's
  // live server from a unit-test setup (it can time out or change these fixtures).
  vi.spyOn(store.client, "providers").mockResolvedValue({ all: [], connected: [], default: {} });
  vi.spyOn(store.client, "agents").mockResolvedValue([]);
  vi.spyOn(store.client, "config").mockResolvedValue({});
  await store.setDirectory("/test/A");
  // Directory restore can replace the provider snapshot; keep this fixture
  // independent of whichever real provider the host has configured.
  store.state.connectedProviderIds = ["local"];
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

it("keeps configured Pi models visible while recording and revoking real access evidence", async () => {
  store.state.prefs.pi.verifiedModels = {};
  store.state.prefs.pi.verifiedModel = undefined;
  store.state.piHealth.models.push({
    id: "qwen-v100", provider: "local-qwen-v100", name: "Qwen V100", input: ["text", "image"],
  });
  expect(store.piModelOptions().map((m: any) => m.verified)).toEqual([false, false]);
  expect(store.getModelChoice("pi")).toBeNull();
  const check = vi.spyOn(store.pi(), "checkAccess").mockResolvedValue("Модель ответила.");
  expect((await store.checkPiModelAccess("local-qwen-v100/qwen-v100")).ok).toBe(true);
  expect(check).toHaveBeenCalled();
  expect(store.piModelOptions().map((m: any) => `${m.providerID}/${m.modelID}`))
    .toEqual(["deepseek/deepseek-v4-flash", "local-qwen-v100/qwen-v100"]);
  expect(store.piModelOptions().filter((m: any) => m.verified).map((m: any) => m.modelID)).toEqual(["qwen-v100"]);
  expect(store.getModelChoice("pi")?.modelID).toBe("qwen-v100");
  check.mockRejectedValueOnce(new Error("provider unavailable"));
  expect((await store.checkPiModelAccess("local-qwen-v100/qwen-v100")).ok).toBe(false);
  expect(store.piModelOptions()).toHaveLength(2);
  expect(store.piModelOptions().every((m: any) => !m.verified)).toBe(true);
});

it("creates a projectless Pi chat without needing a live OpenCode server", async () => {
  await store.setDirectory(null);
  store.setSessionEngine(null, "pi");
  store.state.connection.phase = "disconnected";
  expect(store.engineIdFor()).toBe("pi");
  expect(await store.sendPrompt("PI_PROJECTLESS_OK")).toBe(true);
  expect(store.state.directory).toBe("/tmp/pi-chat-test");
  expect(store.engineIdFor()).toBe("pi");
  expect(piPrompts.at(-1)?.message).toBe("PI_PROJECTLESS_OK\n\n"+languageReminder(store.state.activeSessionId!)+"\n\n"+toolWorkflowReminder(store.state.activeSessionId!));
  expect(store.state.ui.sending).toBe(false);
});

it("rehydrates Pi models on app startup instead of requiring Settings first", async () => {
  store.state.piHealth = null;
  store.piInstalled = false;
  await store.refreshPiInstall();
  expect(store.piInstalled).toBe(true);
  expect(store.piModelOptions().map((m: any) => m.modelID)).toEqual(["deepseek-v4-flash"]);
});

it("uses the selected Pi model's own context window", () => {
  store.state.piHealth.models[0].contextWindow = 131072;
  store.setProjectEngine("/test/A", "pi");
  store.setModelChoice("deepseek", "deepseek-v4-flash", null);
  expect(store.contextInfo()).toMatchObject({ limit: 131072, auto: false });
});

it("routes a folder set to Pi through the Pi engine only", async () => {
  store.setProjectEngine("/test/A", "pi");
  const openCodePrompt = vi.spyOn(store.client, "prompt").mockResolvedValue(undefined);
  const openCodeCreate = vi.spyOn(store.client, "createSession");
  expect(await store.sendPrompt("посчитай")).toBe(true);
  expect(piPrompts).toHaveLength(1);
  expect(piPrompts[0].message).toBe("посчитай\n\n"+languageReminder(store.state.activeSessionId!)+"\n\n"+toolWorkflowReminder(store.state.activeSessionId!));
  expect(store.state.ui.sending).toBe(false);
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

it("does not route Pi onto a remote OpenCode workspace", () => {
  store.state.prefs.activeHost = "igor";
  expect(store.engineReady("pi")).toBe(false);
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

it("keeps a failed Pi selection in the picker without changing the previous selection", async () => {
  store.setProjectEngine("/test/A", "pi");
  store.state.piHealth.models.push({ id: "offline", provider: "local", name: "Offline", input: ["text"] });
  const before = store.getModelChoice("pi");
  vi.spyOn(store.pi(), "checkAccess").mockRejectedValue(new Error("offline provider"));
  await expect(store.selectModel("local", "offline")).rejects.toThrow("offline provider");
  expect(store.getModelChoice("pi")).toEqual(before);
  expect(store.piModelOptions().some((m: any) => m.modelID === "offline")).toBe(true);
});

it("does not commit a late model check to a different chat", async () => {
  store.setProjectEngine("/test/A", "pi");
  let resolve!: (value: string) => void;
  vi.spyOn(store.pi(), "checkAccess").mockImplementation(() => new Promise<string>(r => { resolve = r; }));
  const selection = store.selectModel("deepseek", "deepseek-v4-flash");
  await vi.waitFor(() => expect(resolve).toBeDefined());
  store.state.activeSessionId = "other-chat";
  resolve("ok");
  expect(await selection).toBe(false);
  expect(store.state.prefs.modelChoice["pi:session:other-chat"]).toBeUndefined();
});

it("keeps an explicitly selected configured provider offline instead of choosing another model", () => {
  store.state.providers = [{ id: "local", source: "config", models: { m: { id: "m", name: "M" } } }];
  store.setModelChoice("local", "m", null);
  store.state.connectedProviderIds = ["unrelated"];
  expect(store.getModelChoice()?.modelID).toBe("m");
  expect(store.configuredProvidersWithModels().map((p: any) => p.id)).toEqual(["local"]);
});

it("checks OpenCode health before committing a selection and preserves the old model on failure", async () => {
  store.state.providers = [{ id: "local", source: "config", models: { m: { id: "m" }, newer: { id: "newer" } } }];
  store.setModelChoice("local", "m");
  const health = vi.spyOn(store.client, "health").mockRejectedValueOnce(new Error("engine offline"));
  await expect(store.selectModel("local", "newer")).rejects.toThrow("engine offline");
  expect(store.getModelChoice()?.modelID).toBe("m");
  health.mockResolvedValue({ healthy: true, version: "test" });
  expect(await store.selectModel("local", "newer")).toBe(true);
  expect(store.getModelChoice()?.modelID).toBe("newer");
});

it("retains the previous Pi catalog when a rescan fails", async () => {
  store.setProjectEngine("/test/A", "pi");
  const before = store.piModelOptions();
  vi.spyOn(store.pi(), "describe").mockResolvedValue({ ...store.state.piHealth, models: [], error: "Pi RPC offline" });
  await expect(store.refreshModelCatalog()).rejects.toThrow("Pi RPC offline");
  expect(store.piModelOptions()).toEqual(before);
});

async function contextTransitionFixture() {
 const {modelServices}=await import('../src/models/services');
 const ensure=vi.spyOn(modelServices,'ensure').mockResolvedValue(undefined);
 const big={id:'large',providerID:'big',name:'Large',limit:{context:1048576,input:1000000,output:32768}};
 const small={id:'small',providerID:'small',name:'Small',limit:{context:262144,input:229376,output:32768}};
 const previous={id:'previous',sessionID:'ses_transfer',role:'assistant',providerID:'big',modelID:'large',tokens:{total:415589},time:{created:1,completed:2}};
 const success={info:{id:'summary-new',sessionID:'ses_transfer',role:'assistant',providerID:'big',modelID:'large',summary:true,finish:'stop',tokens:{input:415589,output:1000},time:{created:3,completed:4}},parts:[{type:'text',text:'Задача, изменения, проверки, незавершённые шаги и ограничения.'}]};
 store.state={...store.state,activeSessionId:'ses_transfer',directory:'/test/A',statuses:{},sessions:[{id:'ses_transfer',directory:'/test/A',title:'Fixture',time:{created:1,updated:1}}],providers:[{id:'big',source:'config',models:{large:big}},{id:'small',source:'config',models:{small}}],connectedProviderIds:['big','small'],chat:{...store.state.chat,sessions:{ses_transfer:{messageOrder:['previous'],messages:{previous},parts:{},status:{type:'idle'}}}}};
 store.setModelChoice('big','large');ensure.mockClear();
 vi.spyOn(store.client,'health').mockResolvedValue({healthy:true,version:'fixture'});
 vi.spyOn(store.client,'agents').mockResolvedValue([]);
 vi.spyOn(store.client,'config').mockResolvedValue({compaction:{preserve_recent_tokens:16000}});
 vi.spyOn(store.client,'sessionStatuses').mockResolvedValue({ses_transfer:{type:'idle'}});
 vi.spyOn(store.client,'pendingPermissions').mockResolvedValue([]);
 vi.spyOn(store.client,'pendingQuestions').mockResolvedValue([]);
 const messages=vi.spyOn(store.client,'messages').mockResolvedValueOnce({messages:[{info:previous,parts:[]}]}).mockResolvedValue({messages:[success]});
 const summarize=vi.spyOn(store.client,'summarize').mockResolvedValue(undefined);
 const prompt=vi.spyOn(store.client,'prompt').mockResolvedValue(undefined);
 const abort=vi.spyOn(store.client,'abort').mockResolvedValue(undefined);
 return{ensure,messages,summarize,prompt,abort,success,previous};
}
it('compacts 415k history with its previous large model before loading a 262k target',async()=>{
 const f=await contextTransitionFixture(),progress=vi.fn();
 expect(await store.selectModel('small','small',null,undefined,progress)).toBe(true);
 expect(f.summarize).toHaveBeenCalledExactlyOnceWith('ses_transfer','/test/A','big','large');
 expect(f.ensure.mock.calls.map(c=>[c[0],c[1]])).toEqual([['big','large'],['small','small']]);
 expect(f.ensure.mock.invocationCallOrder[1]).toBeGreaterThan(f.summarize.mock.invocationCallOrder[0]);
 expect(store.getModelChoice()?.modelID).toBe('small');expect(progress).toHaveBeenCalledWith(expect.stringContaining('Large'));
 expect(f.prompt).not.toHaveBeenCalled();expect(f.abort).not.toHaveBeenCalled();
 expect(store.state.chat.sessions.ses_transfer.messages.previous).toEqual(f.previous);
});
it('does not accept HTTP success with a failed compaction and keeps the old model and draft',async()=>{
 const f=await contextTransitionFixture();store.setDraft('keep my task');
 f.messages.mockReset().mockResolvedValueOnce({messages:[{info:f.previous,parts:[]}]}).mockResolvedValue({messages:[{...f.success,info:{...f.success.info,error:{name:'ContextOverflowError'}}}]});
 await expect(store.selectModel('small','small')).rejects.toThrow('не завершилось');
 expect(store.getModelChoice()?.modelID).toBe('large');expect(store.getDraft()).toBe('keep my task');
 expect(f.ensure).toHaveBeenCalledTimes(1);expect(f.prompt).not.toHaveBeenCalled();
});
it('blocks a racing prompt until transfer and destination readiness finish',async()=>{
 const f=await contextTransitionFixture();let complete!:()=>void;
 f.summarize.mockImplementation(()=>new Promise<void>(r=>complete=r));
 store.setDraft('keep my task');const selection=store.selectModel('small','small');
 await vi.waitFor(()=>expect(complete).toBeTypeOf('function'));
 expect(await store.sendPrompt('keep my task')).toBe(false);expect(store.getDraft()).toBe('keep my task');
 expect(f.ensure).toHaveBeenCalledTimes(1);complete();expect(await selection).toBe(true);
 expect(f.prompt).not.toHaveBeenCalled();
});
it('cancellation during compaction preserves its result without committing a late target',async()=>{
 const f=await contextTransitionFixture();let complete!:()=>void;
 f.summarize.mockImplementation(()=>new Promise<void>(r=>complete=r));const cancel=new AbortController();
 const pending=store.selectModel('small','small',null,cancel.signal);const rejected=expect(pending).rejects.toThrow('переход отменён');
 await vi.waitFor(()=>expect(complete).toBeTypeOf('function'));cancel.abort();complete();await rejected;
 expect(store.getModelChoice()?.modelID).toBe('large');expect(f.ensure).toHaveBeenCalledTimes(1);expect(f.abort).not.toHaveBeenCalled();
});
it('does not compact fitting history',async()=>{
 const f=await contextTransitionFixture();f.messages.mockReset().mockResolvedValue({messages:[{info:{...f.previous,tokens:{total:10000}},parts:[]}]});
 expect(await store.selectModel('small','small')).toBe(true);expect(f.summarize).not.toHaveBeenCalled();
});
it('does not start a transfer while the authoritative engine is busy',async()=>{
 const f=await contextTransitionFixture();vi.mocked(store.client.sessionStatuses).mockResolvedValue({ses_transfer:{type:'busy'}});
 await expect(store.selectModel('small','small')).rejects.toThrow('Агент занят');
 expect(f.summarize).not.toHaveBeenCalled();expect(store.getModelChoice()?.modelID).toBe('large');
});

it('recovers a session already switched to a smaller model through manual compaction',async()=>{
 const f=await contextTransitionFixture();store.setModelChoice('small','small');f.ensure.mockClear();
 await store.compactSession('ses_transfer');
 expect(f.summarize).toHaveBeenCalledExactlyOnceWith('ses_transfer','/test/A','big','large');
 expect(f.prompt).not.toHaveBeenCalled();expect(store.getModelChoice()?.modelID).toBe('small');
});
it('retains source model selection when its provider is unavailable',async()=>{
 const f=await contextTransitionFixture();store.state.connectedProviderIds=['small'];
 await expect(store.selectModel('small','small')).rejects.toThrow('Предыдущая модель недоступна');
 expect(f.ensure).not.toHaveBeenCalled();expect(f.summarize).not.toHaveBeenCalled();
});
it('keeps racing prompts blocked while the destination is loading after a successful summary',async()=>{
 const f=await contextTransitionFixture();let ready!:()=>void;
 f.ensure.mockImplementation((p:string)=>p==='small'?new Promise<void>(r=>ready=r):Promise.resolve());
 const pending=store.selectModel('small','small');await vi.waitFor(()=>expect(ready).toBeTypeOf('function'));
 expect(store.getModelChoice()?.modelID).toBe('large');expect(await store.sendPrompt('do not race')).toBe(false);
 ready();expect(await pending).toBe(true);expect(f.prompt).not.toHaveBeenCalled();
});
