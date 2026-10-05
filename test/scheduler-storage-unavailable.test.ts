import { expect, it, vi } from "vitest";
it("keeps the app usable and disables scheduling when access to localStorage itself is denied", async () => {
 vi.resetModules();
 const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
 Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => { throw new Error("storage denied"); } });
 try {
  const { taskScheduler, STORAGE_FAILED } = await import("../src/schedules/tasks");
  const scheduler = taskScheduler();
  expect(scheduler.status().storage).toBe("unavailable");
  const dispatch = vi.fn(); await scheduler.tick("local", dispatch, Date.now());
  expect(dispatch).not.toHaveBeenCalled();
  expect(() => scheduler.add({ server: "local", directory: "/p", sessionID: "s", engine: "opencode", title: "CI", prompt: "check", minutes: 15, model: { providerID: "p", modelID: "m" } })).toThrow(STORAGE_FAILED);
 } finally {
  if (previous) Object.defineProperty(globalThis, "localStorage", previous); else Reflect.deleteProperty(globalThis, "localStorage");
 }
});
