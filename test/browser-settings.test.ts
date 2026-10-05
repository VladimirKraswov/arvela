// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { BrowserSetup, BrowserStatus } from "../src/browser/integration";

const fake = vi.hoisted(() => ({
  state: {} as any, setup: {} as BrowserSetup, native: true, host: null as object | null,
  invoke: vi.fn(), configureBrowser: vi.fn(), setBrowserSettings: vi.fn(), setUi: vi.fn(),
}));
vi.mock("../src/state/store", () => ({ useAppState: () => fake.state, store: {
  currentHost: () => fake.host, configureBrowser: fake.configureBrowser,
  setBrowserSettings: fake.setBrowserSettings, setUi: fake.setUi,
} }));
vi.mock("../src/browser/integration", () => ({
  browserNative: fake.invoke, useBrowserSetup: () => fake.setup, browserSetupSnapshot: () => fake.setup,
}));
vi.mock("../src/native/platform", () => ({ isNative: () => fake.native }));
import { BrowserButton, BrowserSettings } from "../src/components/BrowserSettings";

let root: Root;
let status: BrowserStatus;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fake.native = true; fake.host = null;
  fake.state = { prefs: { endpoint: "http://127.0.0.1:4096", browser: { enabled: true }, pi: { nodeProgram: "/opt/homebrew/bin/node" } } };
  status = { supported: true, installed: true, running: true, browserOpen: false,
    command: "/Applications/OpenCode Desktop.app/Contents/MacOS/app", nodeProgram: "/opt/homebrew/bin/node",
    skillPath: "/tmp/browser/skill", runtimePath: "/tmp/browser/current", profilePath: "/tmp/browser/profile", version: "0.0.83" };
  fake.setup = { phase: "ready", openCode: "Подключён", pi: "Готово", status };
  fake.invoke.mockImplementation(async (command: string) => {
    if (command === "browser_status") return status;
    if (command === "browser_open") return { ...status, browserOpen: true };
    if (command === "browser_stop") return { ...status, running: false, browserOpen: false };
    throw new Error(`Unexpected command: ${command}`);
  });
  fake.configureBrowser.mockResolvedValue(undefined);
  const node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const mount = async (Component = BrowserSettings) => { await act(async () => root.render(createElement(Component))); };
const button = (text: string) => [...document.querySelectorAll("button")].find(el => el.textContent === text)!;
const opens = () => fake.invoke.mock.calls.filter(([command]) => command === "browser_open");
function input(id: string, value: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const enter = async () => { await act(async () => document.getElementById("browser-address")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

it.each(["remote host", "remote endpoint", "web preview", "disabled", "checking", "installing", "configuring", "not installed"])("cannot bypass browser controls with Enter while %s", async reason => {
  if (reason === "remote host") fake.host = {};
  if (reason === "remote endpoint") fake.state.prefs.endpoint = "http://192.168.31.22:4096";
  if (reason === "web preview") fake.native = false;
  if (reason === "disabled") fake.state.prefs.browser.enabled = false;
  if (["checking", "installing", "configuring"].includes(reason)) fake.setup.phase = reason as BrowserSetup["phase"];
  if (reason === "not installed") status.installed = false;
  await mount(); input("browser-address", "https://example.com/private"); await enter();
  expect(button("Открыть браузер").disabled).toBe(true);
  expect(opens()).toHaveLength(0);
  expect(fake.configureBrowser).not.toHaveBeenCalled();
  if (reason.startsWith("remote")) {
    expect(document.body.textContent).toContain("Для настройки выберите «Этот компьютер»");
    expect(button("Сохранить и проверить путь").disabled).toBe(true);
  }
  if (reason === "web preview") {
    expect(document.body.textContent).toContain("Откройте установленное приложение");
    expect(fake.invoke).not.toHaveBeenCalled();
  }
});

it("opens the entered URL locally with the explicit browser Node path", async () => {
  fake.state.prefs.browser.nodeProgram = "/Applications/Node Runtime/node";
  await mount(); input("browser-address", "  https://example.com/project?q=code  "); await enter();
  expect(opens()).toEqual([["browser_open", { url: "https://example.com/project?q=code", nodeProgram: "/Applications/Node Runtime/node" }]]);
  expect(document.body.textContent).toContain("Окно открыто");
  expect(fake.setBrowserSettings).not.toHaveBeenCalled();
});

it("ignores a second Enter while the first browser open is pending", async () => {
  const pending = deferred<BrowserStatus>();
  fake.invoke.mockImplementation((command: string) => command === "browser_open" ? pending.promise : Promise.resolve(status));
  await mount(); await enter(); await enter();
  expect(opens()).toHaveLength(1);
  expect(button("Открыть браузер").disabled).toBe(true);
  await act(async () => pending.resolve({ ...status, browserOpen: true }));
  expect(button("Открыть браузер").disabled).toBe(false);
});

it("shows a failed open honestly and clears its alert after a successful refresh", async () => {
  fake.invoke.mockImplementation(async (command: string) => {
    if (command === "browser_open") throw new Error("Chromium could not start");
    return status;
  });
  await mount(); await enter();
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Chromium could not start");
  expect(document.body.textContent).not.toContain("Окно открыто");
  await act(async () => button("Обновить состояние").click());
  expect(document.querySelector('[role="alert"]')).toBeNull();
});

it("saves an optional Node path without changing agent permissions or opening a browser", async () => {
  await mount(); input("browser-node", "  /Users/example/Node Runtime/node  ");
  await act(async () => button("Сохранить и проверить путь").click());
  expect(fake.setBrowserSettings).toHaveBeenCalledExactlyOnceWith({ nodeProgram: "/Users/example/Node Runtime/node" });
  expect(opens()).toHaveLength(0);
  expect(fake.configureBrowser).not.toHaveBeenCalled();
});

it("offers an emergency stop for the owned local service even when a remote host is selected", async () => {
  fake.host = {}; await mount();
  expect(button("Открыть браузер").disabled).toBe(true);
  expect(button("Остановить управление").disabled).toBe(false);
  await act(async () => button("Остановить управление").click());
  expect(fake.invoke).toHaveBeenCalledWith("browser_stop", undefined);
  expect(fake.setBrowserSettings).toHaveBeenCalledWith({ enabled: false });
  expect(document.body.textContent).toContain("Остановлен");
});

it("does not open from the toolbar after configuration reports an MCP error", async () => {
  fake.configureBrowser.mockImplementation(async () => { fake.setup = { ...fake.setup, phase: "error", error: "MCP не подключён" }; });
  await mount(BrowserButton);
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Открыть браузер агента"]')!.click());
  expect(fake.configureBrowser).toHaveBeenCalledOnce();
  expect(opens()).toHaveLength(0);
  expect(fake.setUi).toHaveBeenCalledExactlyOnceWith({ toast: "Браузер: MCP не подключён" });
  expect(document.querySelector<HTMLButtonElement>("button")!.disabled).toBe(false);
});

it("waits for toolbar configuration, prevents duplicate clicks, and opens a blank tab on success", async () => {
  const pending = deferred<void>(); fake.configureBrowser.mockReturnValue(pending.promise);
  await mount(BrowserButton);
  const control = document.querySelector<HTMLButtonElement>('[aria-label="Открыть браузер агента"]')!;
  await act(async () => control.click());
  expect(control.disabled).toBe(true); expect(control.textContent).toContain("Открываю"); expect(opens()).toHaveLength(0);
  await act(async () => control.click()); expect(fake.configureBrowser).toHaveBeenCalledOnce();
  await act(async () => pending.resolve());
  expect(opens()).toEqual([["browser_open", { url: null, nodeProgram: "/opt/homebrew/bin/node" }]]);
  expect(control.disabled).toBe(false); expect(fake.setUi).not.toHaveBeenCalled();
});
