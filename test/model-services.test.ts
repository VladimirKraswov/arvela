import { afterEach, expect, it, vi } from "vitest";
import {
  ModelServices,
  validateServices,
  type SwitchStatus,
} from "../src/models/services";
const services = [
  {
    id: "gpu",
    endpoint: "http://127.0.0.1:18008",
    providerID: "volta",
    bindings: { base: "base", tuned: "fine" },
  },
];
const catalog = {
  schema: 1,
  models: [
    { id: "base", label: "Base", agents: ["opencode", "pi"] },
    { id: "fine", label: "Tuned", agents: ["pi"] },
  ],
};
const ready = (model = "base"): SwitchStatus => ({
  schema: 1,
  operation_id: "o",
  phase: "ready",
  ready: true,
  active_model: model,
  target_model: model,
  elapsed_seconds: 4,
  active_requests: 0,
  error: null,
  loader: null,
});
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("uses registry agent policy, fails closed before discovery, leaves unmanaged models alone", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response(catalog)),
  );
  const manager = new ModelServices();
  manager.configure(services);
  expect(manager.allowed("volta", "tuned", "pi")).toBe(false);
  expect(manager.allowed("other", "unmanaged", "opencode")).toBe(true);
  await manager.refresh("gpu");
  expect(manager.allowed("volta", "tuned", "opencode")).toBe(false);
  expect(manager.allowed("volta", "tuned", "pi")).toBe(true);
  expect(manager.allowed("volta", "fine", "opencode")).toBe(false);
  await expect(manager.ensure("volta", "fine", "opencode")).rejects.toThrow("привязка");
  await expect(manager.ensure("volta", "tuned", "opencode")).rejects.toThrow(
    "недоступна",
  );
});
it("waits for real readiness, exposes byte progress, shares one select and rejects another target", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith("catalog")) return response(catalog);
    if (options?.method === "POST")
      return response(
        {
          ...ready("fine"),
          phase: "loading",
          active_model: null,
          ready: false,
          loader: { phase: "weights", unit: "bytes", current: 5, total: 10 },
        },
        202,
      );
    return response(ready("fine"));
  });
  vi.stubGlobal("fetch", fetch);
  const manager = new ModelServices();
  manager.configure(services);
  await manager.refresh("gpu");
  const first = manager.ensure("volta", "tuned", "pi");
  const second = manager.ensure("volta", "tuned", "pi");
  await expect(manager.ensure("volta", "base", "pi")).rejects.toThrow(
    "Дождитесь",
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(manager.snapshot().states.gpu.loader?.current).toBe(5);
  await vi.advanceTimersByTimeAsync(900);
  await Promise.all([first, second]);
  expect(
    fetch.mock.calls.filter(([, options]) => options?.method === "POST"),
  ).toHaveLength(1);
  expect(manager.snapshot().states.gpu.ready).toBe(true);
});
it("rejects changed services or another client's operation instead of submitting on the wrong model", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) =>
      url.endsWith("catalog")
        ? response(catalog)
        : options?.method === "POST"
          ? response({ ...ready(), ready: false, phase: "draining" }, 202)
          : response({ ...ready("fine"), operation_id: "someone-else" }),
    ),
  );
  const manager = new ModelServices();
  manager.configure(services);
  await manager.refresh("gpu");
  const failed = expect(
    manager.ensure("volta", "base", "opencode"),
  ).rejects.toThrow("другим клиентом");
  await vi.advanceTimersByTimeAsync(900);
  await failed;
});
it("rejects LAN/credential URLs and duplicate model ownership", () => {
  expect(
    validateServices([{ ...services[0], endpoint: "http://192.168.1.1:8080" }]),
  ).toContain("локальный");
  expect(
    validateServices([
      { ...services[0], endpoint: "http://user:secret@localhost:8080" },
    ]),
  ).toContain("локальный");
  expect(
    validateServices([...services, { ...services[0], id: "gpu2" }]),
  ).toContain("одному сервису");
});

it("shares policy and one switch across provider aliases of the same endpoint", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(async (url: string, options?: RequestInit) =>
    url.endsWith("catalog")
      ? response(catalog)
      : options?.method === "POST"
        ? response({ ...ready("fine"), ready: false, phase: "loading" }, 202)
        : response(ready("fine")),
  );
  vi.stubGlobal("fetch", fetch);
  const manager = new ModelServices();
  manager.configure([
    ...services,
    { ...services[0], id: "pi-alias", providerID: "pi-local" },
  ]);
  manager.setKey("gpu", "test-control");
  await manager.refresh("gpu");
  expect(manager.allowed("pi-local", "tuned", "pi")).toBe(true);
  const first = manager.ensure("volta", "tuned", "pi"),
    second = manager.ensure("pi-local", "tuned", "pi");
  await vi.advanceTimersByTimeAsync(900);
  await Promise.all([first, second]);
  expect(
    fetch.mock.calls.filter(([, options]) => options?.method === "POST"),
  ).toHaveLength(1);
  expect(manager.snapshot().states["pi-alias"].active_model).toBe("fine");
});

it("rejects malformed progress and keeps configuration errors recoverable", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      response(
        url.endsWith("catalog")
          ? catalog
          : {
              ...ready(),
              loader: {
                phase: "weights",
                current: "unknown",
                total: 100,
                unit: "bytes",
              },
            },
      ),
    ),
  );
  const manager = new ModelServices();
  manager.configure(services);
  await manager.refresh("gpu");
  await expect(manager.ensure("volta", "base", "opencode")).rejects.toThrow(
    "состояние",
  );
  expect(manager.snapshot().errors.gpu).toBeTruthy();
  expect(validateServices(null)).toContain("повреждён");
  expect(
    validateServices([{ ...services[0], bindings: { base: 123 } }]),
  ).toContain("Идентификаторы");
});
it("restores a vault credential before catalog discovery, never puts it in routing preferences", async () => {
  const vault = { get: vi.fn(async () => "private-control-key"), set: vi.fn(), delete: vi.fn() };
  const fetch = vi.fn(async (_url: string, options?: RequestInit) => {
    expect(new Headers(options?.headers).get("Authorization")).toBe("Bearer private-control-key");
    return response(catalog);
  });
  vi.stubGlobal("fetch", fetch);
  const manager = new ModelServices(vault);
  manager.configure(services);
  await manager.refresh("gpu");
  expect(vault.get).toHaveBeenCalledTimes(1);
  expect(manager.allowed("volta", "tuned", "pi")).toBe(true);
  expect(JSON.stringify(services)).not.toContain("private-control-key");
  await manager.forgetKey("gpu");
  expect(vault.delete).toHaveBeenCalledWith(services[0].endpoint);
  expect(manager.allowed("volta", "tuned", "pi")).toBe(false);
});
it("a failed vault write does not activate an unsaved credential", async () => {
  const vault = { get: vi.fn(async () => null), set: vi.fn(async () => { throw new Error("locked vault"); }), delete: vi.fn() };
  vi.stubGlobal("fetch", vi.fn(async () => response(catalog)));
  const manager = new ModelServices(vault);
  manager.configure(services);
  await expect(manager.saveKey("gpu", "secret")).rejects.toThrow("locked vault");
});
