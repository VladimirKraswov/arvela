import { beforeEach, expect, it, vi } from "vitest";

const autostart = vi.hoisted(() => vi.fn<(_: string) => Promise<boolean>>());
vi.mock("../src/native/localServer", () => ({
  startLocalServerIfNative: autostart,
}));

beforeEach(() => {
  vi.resetModules();
  autostart.mockReset();
  autostart.mockResolvedValue(true);
  vi.unstubAllGlobals();
});

it("starts a missing local server once and retries its health before loading data", async () => {
  const { ConnectionError } = await import("../src/api/client");
  const { store } = await import("../src/state/store");
  const health = vi.spyOn(store.client, "health")
    .mockRejectedValueOnce(new ConnectionError())
    .mockResolvedValueOnce({ healthy: true, version: "1.18.18" });
  vi.spyOn(store.client, "projects").mockResolvedValue([]);
  vi.spyOn(store.client, "providers").mockResolvedValue({ all: [], connected: [], default: {} });
  vi.spyOn(store.client, "agents").mockResolvedValue([]);
  vi.spyOn(store.client, "config").mockResolvedValue({});
  vi.spyOn(store.client, "recentSessions").mockResolvedValue([]);
  vi.spyOn(store.client, "sessionStatuses").mockResolvedValue({});
  vi.spyOn(store.client, "pendingPermissions").mockResolvedValue([]);
  vi.spyOn(store.client, "pendingQuestions").mockResolvedValue([]);

  expect(await store.connect()).toBe(true);
  expect(health).toHaveBeenCalledTimes(2);
  expect(autostart).toHaveBeenCalledOnce();
  expect(autostart).toHaveBeenCalledWith("http://127.0.0.1:4096", undefined);
  expect(store.state.connection.phase).toBe("connected");
  store.dispose();
});

it("does not launch a local server for an SSH workspace after a failed tunnel health check", async () => {
  const { store } = await import("../src/state/store");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
  expect(await (store as any).doConnect("http://127.0.0.1:4196", "ssh:igor:4096")).toBe(false);
  expect(autostart).not.toHaveBeenCalled();
  store.dispose();
});

it("does not launch another server when an HTTP endpoint responds with an error", async () => {
  const { ApiError } = await import("../src/api/client");
  const { store } = await import("../src/state/store");
  vi.spyOn(store.client, "health").mockRejectedValue(new ApiError(401, "Authentication required"));
  expect(await store.connect()).toBe(false);
  expect(autostart).not.toHaveBeenCalled();
  store.dispose();
});
