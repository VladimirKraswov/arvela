// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
const fake = vi.hoisted(() => ({ invoke: vi.fn(), native: true, host: null as object | null,
  state: {} as any, setUi: vi.fn() }));
vi.mock("../src/browser/integration", () => ({ browserNative: fake.invoke }));
vi.mock("../src/native/platform", () => ({ isNative: () => fake.native }));
vi.mock("../src/state/store", () => ({ useAppState: () => fake.state, store: {
  get state() { return fake.state; }, currentHost: () => fake.host, setUi: fake.setUi,
} }));
import { BrowserPanel, BrowserPresence } from "../src/components/BrowserPanel";
let root: Root;
const frame = { browserOpen: true, busy: false, tabs: [{ index: 0, title: "Real page", url: "https://example.com", active: true }],
  width: 1280, height: 800, image: "/9j/", url: "https://example.com", cursor: { x: 100, y: 50, owner: "agent", action: "browser_click", at: 1 } };
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fake.native = true; fake.host = null;
  fake.state = { prefs: { endpoint: "http://127.0.0.1:4096", browser: { enabled: true } } };
  fake.invoke.mockImplementation(async command => command === "browser_view" ? frame : command === "browser_presence" ? { browserOpen: true } : undefined);
  const node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ""; vi.useRealTimers(); vi.unstubAllGlobals(); });
const mount = async (component = BrowserPanel) => { await act(async () => root.render(createElement(component))); };
it("projects only pixels and labels; close hides the panel without stopping the browser", async () => {
  await mount(); expect(document.querySelector("img")?.src).toBe("data:image/jpeg;base64,/9j/");
  expect(document.querySelector('[aria-label="Курсор агента"]')).not.toBeNull();
  expect(document.querySelector("iframe,webview")).toBeNull();
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Закрыть панель браузера"]')!.click());
  expect(fake.setUi).toHaveBeenCalledWith({ browserOpen: false });
  expect(fake.invoke.mock.calls.some(([name]) => name === "browser_stop")).toBe(false);
});
it("manual tab selection goes through the native validated gateway", async () => {
  await mount(); await act(async () => document.querySelector<HTMLButtonElement>('[role="tab"]')!.click());
  expect(fake.invoke).toHaveBeenCalledWith("browser_input", { action: "select", args: { index: 0 } });
});
it("does not compete with an active agent tool", async () => {
  fake.invoke.mockResolvedValue({ ...frame, busy: true }); await mount();
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Новая вкладка браузера"]')!.click());
  expect(fake.invoke.mock.calls.some(([name]) => name === "browser_input")).toBe(false);
});
it.each(["remote", "web", "disabled"])("does not leak local frames or inputs on %s", async reason => {
  if (reason === "remote") fake.host = {};
  if (reason === "web") fake.native = false;
  if (reason === "disabled") fake.state.prefs.browser.enabled = false;
  await mount(); expect(fake.invoke).not.toHaveBeenCalled(); expect(document.querySelector("img")).toBeNull();
});
it("coalesces slow polling and cancels the next poll after unmount", async () => {
  let resolve!: (value: unknown) => void;
  fake.invoke.mockReturnValue(new Promise(r => { resolve = r; })); await mount();
  await act(async () => vi.advanceTimersByTimeAsync(5000)); expect(fake.invoke).toHaveBeenCalledOnce();
  await act(async () => resolve(frame));
  act(() => root.unmount()); root = createRoot(document.createElement("div"));
  await act(async () => vi.advanceTimersByTimeAsync(5000)); expect(fake.invoke).toHaveBeenCalledOnce();
});
it("reveals once when the agent starts Chromium, not on every health tick", async () => {
  await mount(BrowserPresence); expect(fake.setUi).toHaveBeenCalledExactlyOnceWith({ browserOpen: true });
  await act(async () => vi.advanceTimersByTimeAsync(4500)); expect(fake.setUi).toHaveBeenCalledOnce();
});
