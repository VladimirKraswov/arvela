// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const fake = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  piInstalled: false,
  sessionCalls: 0,
  money: null as null | Record<string, unknown>,
  notes: [] as string[],
}));

vi.mock("../src/state/store", () => ({
  useAppState: () => fake.state,
  store: {
    get piInstalled() {
      return fake.piInstalled;
    },
  },
}));

const sources = vi.hoisted(() => [{ engine: "OpenCode", sessions: vi.fn(), messages: vi.fn() }]);
vi.mock("../src/usage/sources", () => ({ usageSources: () => sources as never }));

const HOUR = 3600_000;
const NOW = Date.parse("2026-10-21T12:00:00Z");
const message = (id: string, time: number, total: number, provider: string, model: string) => ({
  info: {
    id,
    role: "assistant",
    providerID: provider,
    modelID: model,
    time: { created: time, completed: time },
    tokens: { total, input: total / 2, output: total / 2, cache: { read: 0, write: 0 } },
  },
  parts: [],
});

vi.mock("../src/native/platform", async original => ({
  ...(await original<object>()),
  isNative: () => fake.money !== null,
}));

vi.mock("../src/usage/accounting", async original => {
  const real = await original<object>();
  return {
    ...real,
    computeUsage: async (srcs: unknown[], period: string, signal: AbortSignal, options?: { onProgress?: (done: number, found: number) => void }) => {
      if (fake.money) {
        options?.onProgress?.(1, 1);
        return fake.money;
      }
      const { emptyCache, refreshUsageCache, reportFromCache } = await import("../src/usage/cache");
      const refreshed = await refreshUsageCache(srcs as never[], emptyCache(), signal, options?.onProgress);
      const report = reportFromCache(refreshed.cache, period, NOW);
      return { report, money: null, notes: ["Денежная оценка доступна в установленном приложении."], cache: refreshed.cache, ledger: { schema: 1, updatedAt: 0, days: {} }, snapshot: null };
    },
  };
});

import { UsageSettings } from "../src/components/UsageSettings";

let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  fake.sessionCalls = 0;
  fake.money = null;
  fake.notes = [];
  sources[0]!.sessions = vi.fn(async () => {
    fake.sessionCalls++;
    return [{ id: "s1", title: "s1", directory: "/tmp", time: { created: NOW - 40 * 24 * HOUR, updated: NOW, archived: null } }] as never;
  });
  sources[0]!.messages = vi.fn(async () => ({
    messages: [
      message("recent", NOW - HOUR, 1000, "local-x", "model-a"),
      message("old", NOW - 20 * 24 * HOUR, 4000, "deepseek", "deepseek-v4-pro"),
    ] as never,
  }));
  fake.state = { connection: { phase: "connected" }, prefs: { activeHost: null, piSessions: {} } };
  const node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.resetAllMocks();
});

const norm = () => (document.body.textContent ?? "").replace(/[\u00a0\u202f]/g, " ");
const mount = () => act(async () => root.render(createElement(UsageSettings)));
const click = (label: string) =>
  act(async () => {
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(b => b.textContent === label)!.click();
  });

it("reports tokens and keeps the money note off in the browser", async () => {
  await mount();
  expect(norm()).toContain("5 000");
  expect(norm()).toContain("Денежная оценка доступна в установленном приложении");
  expect(document.querySelector(".usage-money")).toBeNull();
});

it("switching periods filters the loaded data without re-reading sessions", async () => {
  await mount();
  expect(norm()).toContain("5 000");
  const readsAfterFirst = fake.sessionCalls;
  await click("Всё время");
  expect(fake.sessionCalls).toBe(readsAfterFirst);
  expect(norm()).toContain("5 000");
  await click("7 дней");
  expect(fake.sessionCalls).toBe(readsAfterFirst);
  expect(norm()).toContain("1 000");
});

it("renders the money panel with spent in red and savings in green", async () => {
  const book = {
    schema: 1,
    source: "docs",
    checkedAt: NOW - HOUR,
    offPeakFactor: 0.5,
    peakDays: [],
    peakWindows: [],
    models: {
      flash: { input: { peak: 0.3, offPeak: 0.15 }, inputCacheHit: { peak: 0.006, offPeak: 0.003 }, output: { peak: 1.2, offPeak: 0.6 } },
      pro: { input: { peak: 1.32, offPeak: 0.66 }, inputCacheHit: { peak: 0.044, offPeak: 0.022 }, output: { peak: 3.96, offPeak: 1.98 } },
    },
  };
  const snapshot = { book, rate: { source: "cbr", checkedAt: NOW - HOUR, rate: 80 }, notes: [] };
  fake.money = {
    report: {},
    notes: [],
    cache: {
      schema: 1,
      sessions: { "OpenCode|s1": { updated: NOW } },
      messages: {
        m1: { t: NOW - HOUR, sk: "OpenCode\u0000local-x\u0000model-a", sid: "s1", c: [300_000_000, 200_000_000, 100_000_000, 0, 0, 0, 0] },
        m2: { t: NOW - 20 * 24 * HOUR, sk: "OpenCode\u0000deepseek\u0000deepseek-v4-pro", sid: "s1", c: [3_000_000, 1_000_000, 2_000_000, 0, 0, 0, 0] },
      },
    },
    ledger: { schema: 1, updatedAt: NOW, days: {} },
    snapshot,
    money: {
      snapshot,
      spentRub: 1234.56,
      savedRub: 98765.4,
      today: { spentRub: 10.1, savedRub: 20.2 },
      perModel: {},
    },
  };
  await mount();
  const panel = document.querySelector<HTMLElement>(".usage-money");
  expect(panel).not.toBeNull();
  expect(panel!.querySelectorAll(".money-spent").length).toBeGreaterThan(0);
  expect(panel!.querySelectorAll(".money-saved").length).toBeGreaterThan(0);
  const panelText = () => (panel!.textContent ?? "").replace(/[\u00a0\u202f]/g, " ");
  expect(panelText()).toContain("1 234,56");
  expect(panelText()).toContain("98 765,40");
  expect(panelText()).toContain("вне пика");
  expect(panelText()).toContain("80,00 ₽");
  // Independent price computations at the snapshot rates (off-peak schedule).
  const models = (document.querySelector(".usage-models")?.textContent ?? "").replace(/[\u00a0\u202f]/g, " ");
  expect(models).toContain("потрачено 369,60 ₽");
  expect(models).toContain("сэкономлено 7 200,00 ₽");
});
