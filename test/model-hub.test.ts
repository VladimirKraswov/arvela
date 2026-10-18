import { afterEach, expect, it, vi } from "vitest";
import { HubModelServices, type HubRoute, type ModelHubTransport } from "../src/models/hub";
import { ModelServices, type SwitchStatus } from "../src/models/services";

const route: HubRoute = {service: "v100", label: "V100", providerID: "local-artemis", modelID: "artemis", target: "artemis", agent: "opencode"};
const status = (phase = "loading"): SwitchStatus => ({schema: 1, operation_id: "12345678-1234-1234-1234-123456789012",
  phase, ready: phase === "ready", active_model: phase === "ready" ? "artemis" : null, target_model: "artemis",
  elapsed_seconds: 12, active_requests: 0, error: null,
  loader: phase === "loading" ? {phase: "weights", unit: "bytes", current: 20, total: 100} : null});
function transport(handle: (path: string, body: any) => unknown): ModelHubTransport {
  return {identity: vi.fn(async () => "test-hub"), request: vi.fn(async (path, body, scope) => {
    expect(scope).toBe("test-hub");
    return (path === "catalog" ? {schema: 1, routes: [route]} : handle(path, body)) as any;
  })};
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("routes a newly configured provider through Hub, waits for exact readiness and never uses direct model control", async () => {
  vi.useFakeTimers();
  const api = transport(path => path === "prepare" ? status() : status("ready"));
  const hub = new HubModelServices(api), manager = new ModelServices();
  manager.attachHub(hub);
  const direct = vi.fn(); vi.stubGlobal("fetch", direct);
  const pending = manager.ensure("local-artemis", "artemis", "opencode");
  await vi.advanceTimersByTimeAsync(0);
  expect(manager.manages("local-artemis", "artemis")).toBe(true);
  expect(manager.statusFor("local-artemis", "artemis")?.loader?.current).toBe(20);
  let ready = false; void pending.then(() => { ready = true; });
  expect(ready).toBe(false);
  await vi.advanceTimersByTimeAsync(801); await pending;
  expect(ready).toBe(true); expect(direct).not.toHaveBeenCalled();
  expect(api.request).toHaveBeenCalledWith("prepare", expect.objectContaining({mode: "select"}), "test-hub");
});

it("shows the checking phase before a slow control acknowledgement and allows cancelling without inference", async () => {
  let acknowledge!: (s: SwitchStatus) => void;
  const api = transport(path => path === "prepare" ? new Promise(resolve => { acknowledge = resolve; }) : {released: true});
  const hub = new HubModelServices(api); await hub.refresh();
  const abort = new AbortController();
  const pending = hub.ensure("local-artemis", "artemis", "opencode", "session", abort.signal);
  expect(hub.status("local-artemis", "artemis", "session")?.phase).toBe("checking");
  await vi.waitFor(() => expect(acknowledge).toBeTypeOf("function"));
  abort.abort(); acknowledge(status("ready"));
  await expect(pending).rejects.toThrow("отменена");
  expect(api.request).toHaveBeenCalledWith("release", {ticket: status().operation_id}, "test-hub");
});

it("reserves whole native turns, renews during tool execution and releases after the observed terminal status", async () => {
  let running = false;
  const api = transport(() => status("ready"));
  const hub = new HubModelServices(api, () => running); await hub.refresh();
  await hub.ensure("local-artemis", "artemis", "opencode", "session");
  expect(api.request).toHaveBeenCalledWith("prepare", expect.objectContaining({mode: "run"}), "test-hub");
  running = true; hub.observeActivity(); await hub.renew();
  expect(api.request).toHaveBeenCalledWith("status", {ticket: status().operation_id}, "test-hub");
  running = false; await hub.renew();
  expect(api.request).toHaveBeenCalledWith("release", {ticket: status().operation_id}, "test-hub");
});

it("retains a known Hub route on network failure so a prompt cannot bypass the coordinator", async () => {
  const api = transport(() => status("ready"));
  const hub = new HubModelServices(api), manager = new ModelServices(); manager.attachHub(hub);
  await hub.refresh();
  vi.mocked(api.request).mockRejectedValue(new Error("Hub offline"));
  await expect(manager.ensure("local-artemis", "artemis", "opencode")).rejects.toThrow("Hub offline");
  expect(manager.manages("local-artemis", "artemis")).toBe(true);
});

it("a failed loader remains a terminal error and a readiness check never selects a model", async () => {
  const api = transport(path => path === "prepare" ? {...status("failed"), error: "Загрузка не удалась"} : status());
  const hub = new HubModelServices(api); await hub.refresh();
  await expect(hub.check("local-artemis", "artemis", "opencode")).rejects.toThrow("не готова");
  expect(vi.mocked(api.request).mock.calls.some(([path]) => path === "prepare")).toBe(false);
  await expect(hub.ensure("local-artemis", "artemis", "opencode")).rejects.toThrow("Загрузка не удалась");
  expect(vi.mocked(api.request).mock.calls.filter(([path]) => path === "prepare")).toHaveLength(1);
});

it("a reservation heartbeat in another chat cannot overwrite the selected chat's loading status", async () => {
  vi.useFakeTimers();
  const other = {...route, providerID: 'local-qwen', modelID:'qwen',target:'qwen'};
  let loaded = false;
  const api: ModelHubTransport = {identity:async()=> 'hub',request:async(path,body:any)=>{
    if(path==='catalog')return {schema:1,routes:[route,other]} as any;
    if(body?.modelID==='qwen'||path==='status'&&body.ticket==='other-ticket')return {...status('ready'),operation_id:'other-ticket',target_model:'qwen',active_model:'qwen'} as any;
    return status(loaded?'ready':'loading') as any;
  }};
  const hub = new HubModelServices(api,()=>true);await hub.refresh();
  const first=hub.ensure(route.providerID,route.modelID,'opencode',undefined,undefined,'chat-a');
  await vi.advanceTimersByTimeAsync(0);
  await hub.ensure(other.providerID,other.modelID,'opencode','chat-b');await hub.renew();
  expect(hub.status(route.providerID,route.modelID,'chat-a')?.phase).toBe('loading');
  expect(hub.status(route.providerID,route.modelID,'chat-b')).toBeUndefined();
  loaded=true;await vi.advanceTimersByTimeAsync(801);await first;
});

it("explicit retry after a lost acknowledgement reuses its durable idempotency key without an automatic POST replay", async()=>{
  let lost = true;const keys:string[]=[];
  const api=transport((path,body)=>{
    if(path==='prepare'){keys.push(body.requestKey);if(lost)throw Error('connection closed');}
    return status('ready');
  });
  const hub=new HubModelServices(api);await hub.refresh();
  await expect(hub.ensure(route.providerID,route.modelID,'opencode')).rejects.toThrow('connection closed');
  expect(keys).toHaveLength(1);lost=false;
  await hub.ensure(route.providerID,route.modelID,'opencode');expect(keys).toHaveLength(2);expect(keys[1]).toBe(keys[0]);
});
