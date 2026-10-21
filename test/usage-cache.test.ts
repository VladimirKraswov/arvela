import { describe, expect, it } from "vitest";
import {
  emptyCache,
  factOf,
  refreshUsageCache,
  reportFromCache,
  type UsageCache,
} from "../src/usage/cache";
import { scanUsage, type UsageSource } from "../src/usage/metrics";

const HOUR = 3600_000;

function message(id: string, secondsAgo: number, tokens: number, extra: Record<string, unknown> = {}) {
  const now = Date.parse("2026-10-21T12:00:00Z");
  return {
    info: {
      id,
      role: "assistant",
      providerID: extra.providerID ?? "local-x",
      modelID: extra.modelID ?? "model-a",
      time: { created: now - secondsAgo * 1000, completed: now - secondsAgo * 1000 },
      tokens: {
        total: tokens,
        input: Math.round(tokens * 0.1),
        output: Math.round(tokens * 0.1),
        cache: { read: Math.round(tokens * 0.8), write: 0 },
        ...(extra.tokens as object | undefined),
      },
    },
    parts: [],
  };
}

function source(
  engine: "OpenCode" | "Pi",
  sessions: Record<string, { updated: number; messages: ReturnType<typeof message>[] }>,
  calls: string[],
): UsageSource {
  return {
    engine,
    sessions: async () =>
      Object.entries(sessions).map(([id, session]) => ({
        id,
        title: id,
        directory: "/tmp",
        time: { created: 0, updated: session.updated, archived: null },
      })) as never,
    messages: async session => {
      calls.push(`${engine}|${session.id}`);
      return { messages: sessions[session.id]?.messages ?? ([] as never) };
    },
  };
}

const NOW = Date.parse("2026-10-21T12:00:00Z");

describe("refreshUsageCache", () => {
  it("collects facts once and reads only new or updated sessions afterwards", async () => {
    const calls: string[] = [];
    const sessions = {
      s1: { updated: 100, messages: [message("m1", 2 * 24 * 3600, 1000), message("m2", 60, 500)] },
    };
    const first = await refreshUsageCache([source("OpenCode", sessions, calls)], emptyCache(), new AbortController().signal);
    expect(first.changed).toBe(true);
    expect(Object.keys(first.cache.messages)).toHaveLength(2);
    expect(calls).toEqual(["OpenCode|s1"]);

    const second = await refreshUsageCache([source("OpenCode", sessions, calls)], first.cache, new AbortController().signal);
    expect(second.changed).toBe(false);
    expect(calls).toEqual(["OpenCode|s1"]); // no new fetch

    sessions.s1 = { updated: 101, messages: [...sessions.s1.messages, message("m3", 10, 200)] };
    const third = await refreshUsageCache([source("OpenCode", sessions, calls)], second.cache, new AbortController().signal);
    expect(calls).toEqual(["OpenCode|s1", "OpenCode|s1"]);
    expect(Object.keys(third.cache.messages)).toHaveLength(3);
  });

  it("replaces regenerated facts and prunes deleted sessions", async () => {
    const calls: string[] = [];
    const sessions: Record<string, { updated: number; messages: ReturnType<typeof message>[] }> = {
      s1: { updated: 1, messages: [message("m1", 4000, 1000)] },
      s2: { updated: 1, messages: [message("m2", 3000, 2000)] },
    };
    const first = await refreshUsageCache([source("OpenCode", sessions, calls)], emptyCache(), new AbortController().signal);
    expect(Object.keys(first.cache.messages).sort()).toEqual(["OpenCode|s1|m1", "OpenCode|s2|m2"]);

    sessions.s1 = { updated: 2, messages: [message("m1", 4000, 800)] };
    const second = await refreshUsageCache([source("OpenCode", sessions, calls)], first.cache, new AbortController().signal);
    expect(second.cache.messages["OpenCode|s1|m1"]!.c[0]).toBe(800);

    delete sessions.s2;
    const third = await refreshUsageCache([source("OpenCode", sessions, calls)], second.cache, new AbortController().signal);
    expect(third.cache.messages["OpenCode|s2|m2"]).toBeUndefined();
    expect(third.cache.sessions["OpenCode|s2"]).toBeUndefined();
  });

  it("matches the full scan for every period window", async () => {
    const calls: string[] = [];
    const sessions = {
      s1: {
        updated: NOW,
        messages: [
          message("a", 60 * 24 * 3600, 5000), // far in the past
          message("b", 10 * 24 * 3600, 3000), // inside 30d only
          message("c", 3 * 3600, 1234), // inside 7d too
        ],
      },
      s2: {
        updated: NOW,
        messages: [message("d", 8 * 24 * 3600, 4000, { providerID: "deepseek", modelID: "deepseek-v4-pro" })],
      },
    };
    const sources = [source("OpenCode", sessions, calls), source("Pi", { p1: { updated: NOW, messages: [message("e", 2 * 24 * 3600, 800)] } }, calls)];
    const refreshed = await refreshUsageCache(sources, emptyCache(), new AbortController().signal);
    for (const period of ["7d", "30d", "all"] as const) {
      const cached = reportFromCache(refreshed.cache, period, NOW);
      const scanned = await scanUsage(sources, period, new AbortController().signal, undefined, NOW);
      expect(cached.totals, period).toEqual(scanned.totals);
      expect(cached.days, period).toEqual(scanned.days);
      expect(cached.models.map(row => [row.key, row.total]).sort(), period).toEqual(
        scanned.models.map(row => [row.key, row.total]).sort(),
      );
    }
  });

  it("ignores non-assistant replies and token-less messages", () => {
    expect(factOf({ info: { id: "x", role: "user", time: { created: 1 } } } as never, "s1", "OpenCode")).toBeNull();
    expect(
      factOf({ info: { id: "y", role: "assistant", time: { created: 1 }, tokens: { total: 0, input: 0, output: 0, cache: {} } } } as never, "s1", "OpenCode"),
    ).toBeNull();
  });
});

describe("reportFromCache", () => {
  it("counts sessions per model from stored facts", () => {
    const cache: UsageCache = {
      schema: 1,
      sessions: { "OpenCode|a": { updated: 1 }, "OpenCode|b": { updated: 1 } },
      messages: {
        "OpenCode|a|m1": { t: NOW - HOUR, sk: "OpenCode\u0000prov\u0000model", sid: "a", c: [100, 10, 20, 70, 0, 0, 5] },
        "OpenCode|b|m2": { t: NOW - HOUR, sk: "OpenCode\u0000prov\u0000model", sid: "b", c: [100, 10, 20, 70, 0, 0, 5] },
      },
    };
    const report = reportFromCache(cache, "7d", NOW);
    expect(report.models).toHaveLength(1);
    expect(report.models[0]!.sessions).toBe(2);
    expect(report.sessionsScanned).toBe(2);
    expect(report.totals.total).toBe(200);
  });
});
