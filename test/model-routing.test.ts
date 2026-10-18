import { expect, it, vi } from "vitest";
import { publicSources, resolveService } from "../src/models/routing";
import { ModelServices } from "../src/models/services";

const service = {id: "V100", providerID: "qwen", endpoint: "http://127.0.0.1:18008", bindings: {qwen: "qwen-v100"}};
const sources = publicSources([
  {providerID: "qwen", modelID: "qwen", baseURL: "http://127.0.0.1:18021/v1"},
  {providerID: "artemis", modelID: "artemis-v100", baseURL: "http://127.0.0.1:18021/v1/"},
]);
it("inherits the control gate through an explicitly bound API root, not labels or model-name guesses", () => {
  const routes = new Map([["opencode", sources]]);
  expect(resolveService([service], routes, "artemis", "artemis-v100", "opencode").service)
    .toMatchObject({id: "V100", endpoint: service.endpoint, bindings: {"artemis-v100": "artemis-v100"}});
  expect(resolveService([service], routes, "artemis", "artemis-v100", "pi").service).toBeUndefined();
  routes.set("opencode", publicSources([{...sources[0]}, {...sources[1], baseURL: "http://127.0.0.1:18019/v1"}]));
  expect(resolveService([service], routes, "artemis", "artemis-v100").service).toBeUndefined();
});
it("never routes credentials, other API paths, ambiguous controllers or remote origins", () => {
  for (const baseURL of ["http://127.0.0.1:18021/other", "http://user:key@127.0.0.1:18021/v1", "http://127.0.0.1:18021/v1?token=key", "http://192.168.0.3:8080/v1"]) {
    const routes = new Map([["opencode", publicSources([sources[0], {...sources[1], baseURL}])]]);
    expect(resolveService([service], routes, "artemis", "artemis-v100").service).toBeUndefined();
  }
  const ambiguous = resolveService([service, {...service, id: "other", endpoint: "http://127.0.0.1:9999"}], new Map([["opencode", sources]]), "artemis", "artemis-v100");
  expect(ambiguous.error).toContain("разные сервисы");
});
it("new same-server models require fresh registry authorization before select", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({schema: 1, models: [{id: "qwen-v100", label: "Qwen", agents: ["opencode"]}]}), {headers: {"Content-Type": "application/json"}}));
  vi.stubGlobal("fetch", fetch);
  try {
    const manager = new ModelServices(); manager.configure([service]); manager.setSources("opencode", sources);
    expect(manager.manages("artemis", "artemis-v100")).toBe(true);
    await expect(manager.ensure("artemis", "artemis-v100", "opencode")).rejects.toThrow("недоступна");
    expect(fetch.mock.calls.every(args => (args as any)[1]?.method !== "POST")).toBe(true);
  } finally { vi.unstubAllGlobals(); }
});
