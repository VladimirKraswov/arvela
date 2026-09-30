// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const mock = vi.hoisted(() => ({
  scan: vi.fn(),
  client: { usageSessionsPage: vi.fn(), messages: vi.fn() },
  state: { connection: { phase: "connected" }, prefs: { activeHost: "local", piSessions: {} } },
}));
vi.mock("../src/state/store", () => ({ useAppState: () => mock.state, store: { get state() { return mock.state; }, client: mock.client, piInstalled: false } }));
vi.mock("../src/usage/metrics", () => ({ scanUsage: mock.scan }));
import { UsageSettings } from "../src/components/UsageSettings";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  const node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

it("shows measured model totals and switches periods from the settings page", async () => {
  mock.scan.mockResolvedValue({
    totals: { total: 150, input: 10, output: 20, cacheRead: 120, cacheWrite: 0, other: 0, reasoning: 5, replies: 2 },
    models: [{ key: "OpenCode-local-flash", engine: "OpenCode", provider: "local", model: "flash", sessions: 1, total: 150, input: 10, output: 20, cacheRead: 120, cacheWrite: 0, other: 0, reasoning: 5, replies: 2 }],
    days: [], sessionsScanned: 1, sessionsFound: 1, failures: [], generatedAt: Date.now(),
  });
  await act(async () => root.render(createElement(UsageSettings)));
  expect(document.body.textContent).toContain("flash");
  expect(document.body.textContent).toContain("150");
  expect(document.body.textContent).toContain("80% — повторное чтение кэша");
  const week = [...document.querySelectorAll("button")].find(button => button.textContent === "7 дней")!;
  await act(async () => week.click());
  expect(mock.scan.mock.calls.at(-1)?.[1]).toBe("7d");
});

it("cancels a long history scan without displaying a fabricated total", async () => {
  mock.scan.mockImplementation(() => new Promise(() => {}));
  await act(async () => root.render(createElement(UsageSettings)));
  expect(document.body.textContent).toContain("Загружаю список сессий");
  const signal: AbortSignal = mock.scan.mock.calls[0][2];
  const cancel = [...document.querySelectorAll("button")].find(button => button.textContent === "Отменить")!;
  await act(async () => cancel.click());
  expect(signal.aborted).toBe(true);
  expect(document.body.textContent).toContain("Расчёт отменён");
  expect(document.body.textContent).not.toContain("Всего токенов");
});
