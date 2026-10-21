// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const HOUR = 3600_000;
const NOW = Date.parse("2026-10-21T12:00:00Z");

const mock = vi.hoisted(() => ({
  state: { connection: { phase: "connected" }, prefs: { activeHost: "local", piSessions: {} } },
  sources: [] as unknown[],
  sessionCalls: 0,
  pending: null as null | (() => void),
}));
vi.mock("../src/state/store", () => ({
  useAppState: () => mock.state,
  store: { get state() { return mock.state; }, piInstalled: false },
}));
vi.mock("../src/usage/sources", () => ({
  usageSources: () => mock.sources,
}));
import { UsageSettings } from "../src/components/UsageSettings";

const message = (id: string, time: number, tokens: Record<string, unknown>) => ({
  info: { id, role: "assistant", providerID: "local", modelID: "flash", time: { created: time, completed: time }, tokens },
  parts: [],
});

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mock.sessionCalls = 0;
  mock.pending = null;
  mock.sources = [
    {
      engine: "OpenCode",
      sessions: async () => {
        mock.sessionCalls++;
        if (mock.pending) await new Promise<void>(resolve => { mock.pending = resolve; });
        return [{ id: "s1", title: "s1", directory: "/p", time: { created: 0, updated: NOW, archived: null } }];
      },
      messages: async () => ({
        messages: [
          message("m1", NOW - 2 * HOUR, { total: 60, input: 5, output: 15, cache: { read: 40, write: 0 } }),
          message("m2", NOW - 20 * 24 * HOUR, { total: 90, input: 5, output: 5, cache: { read: 80, write: 0 } }),
        ],
      }),
    },
  ];
  const node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const norm = () => (document.body.textContent ?? "").replace(/[\u00a0\u202f]/g, " ");
const press = (label: string) =>
  act(async () => {
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === label)!.click();
  });

it("shows measured model totals and filters periods without re-reading history", async () => {
  await act(async () => root.render(createElement(UsageSettings)));
  expect(norm()).toContain("flash");
  expect(norm()).toContain("150");
  expect(norm()).toContain("80% — повторное чтение кэша");
  expect(mock.sessionCalls).toBe(1);
  await press("7 дней");
  // The new window shows only the recent replies…
  expect(norm()).toContain("60");
  expect(norm()).not.toContain("150");
  // …and the switch never re-reads a single session.
  expect(mock.sessionCalls).toBe(1);
  await press("Всё время");
  expect(norm()).toContain("150");
  expect(mock.sessionCalls).toBe(1);
});

it("cancels a long history scan without displaying a fabricated total", async () => {
  mock.pending = () => {};
  await act(async () => root.render(createElement(UsageSettings)));
  expect(norm()).toContain("Загружаю список сессий");
  await press("Отменить");
  expect(norm()).toContain("Расчёт отменён");
  expect(norm()).not.toContain("Всего токенов");
});
