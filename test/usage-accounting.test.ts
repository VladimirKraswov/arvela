import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeUsage } from "../src/usage/accounting";
import { CACHE_FILE, LEDGER_FILE } from "../src/usage/cache";
import type { UsageSource } from "../src/usage/metrics";

const NOW = Date.parse("2026-10-21T12:00:00Z");
const HOUR = 3600_000;

const mock = vi.hoisted(() => {
  const files = new Map<string, { content: string; sha: string }>();
  const invocations: Array<{ cmd: string; args: Record<string, unknown> }> = [];
  const shaOf = (content: string) => {
    let h = 0;
    for (let i = 0; i < content.length; i++) h = (h * 31 + content.charCodeAt(i)) | 0;
    return `sha-${(h >>> 0).toString(16)}-${content.length}`;
  };
  const invoke = vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    invocations.push({ cmd, args });
    if (cmd === "read_usage_file") {
      const entry = files.get(args.name as string);
      return entry ? { content: entry.content, sha: entry.sha } : null;
    }
    if (cmd === "write_usage_file") {
      const entry = files.get(args.name as string);
      const expected = (args.expectedSha as string | null) ?? "";
      if (entry && entry.sha !== expected) throw new Error("CAS mismatch");
      const sha = shaOf(args.content as string);
      files.set(args.name as string, { content: args.content as string, sha });
      return { content: args.content, sha };
    }
    if (cmd === "fetch_price_book") {
      return {
        schema: 1,
        source: "test",
        checkedAt: NOW,
        offPeakFactor: 0.5,
        peakDays: [1, 2, 3, 4, 5],
        peakWindows: [{ startHour: 1, endHour: 4 }, { startHour: 6, endHour: 10 }],
        models: {
          flash: { input: { peak: 0.3, offPeak: 0.15 }, inputCacheHit: { peak: 0.006, offPeak: 0.003 }, output: { peak: 1.2, offPeak: 0.6 } },
          pro: { input: { peak: 1.32, offPeak: 0.66 }, inputCacheHit: { peak: 0.044, offPeak: 0.022 }, output: { peak: 3.96, offPeak: 1.98 } },
        },
      };
    }
    if (cmd === "fetch_usd_rate") return { source: "test", checkedAt: NOW, rate: 80 };
    throw new Error(`unexpected command ${cmd}`);
  });
  return { files, invocations, invoke };
});

vi.mock("../src/native/platform", () => ({ isNative: () => true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));

function message(id: string, secondsAgo: number, total: number) {
  const completed = NOW - secondsAgo * 1000;
  return {
    info: {
      id,
      role: "assistant",
      providerID: "deepseek",
      modelID: "deepseek-flash",
      time: { created: completed, completed },
      tokens: { total, input: Math.round(total * 0.1), output: Math.round(total * 0.1), cache: { read: Math.round(total * 0.8), write: 0 } },
    },
    parts: [],
  };
}

function source(engine: "OpenCode" | "Pi", updated: number, messages: ReturnType<typeof message>[]): UsageSource {
  return {
    engine,
    sessions: async () => [{ id: "s1", title: "s1", directory: "/tmp", time: { created: 0, updated, archived: null } }],
    messages: async () => ({ messages: messages as never }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mock.files.clear();
  mock.invocations.length = 0;
  mock.invoke.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("computeUsage native path", () => {
  it("replaces a corrupt cache file instead of being blocked by the CAS guard", async () => {
    mock.files.set(CACHE_FILE, { content: "{corrupt", sha: "corrupt-sha" });
    const result = await computeUsage(
      [source("OpenCode", NOW, [message("m1", 2 * 24 * 3600, 1000)])],
      "30d",
      new AbortController().signal,
    );
    const cacheWrite = mock.invocations.find(i => i.cmd === "write_usage_file" && i.args.name === CACHE_FILE);
    expect(cacheWrite).toBeDefined();
    // The repair must pass the corrupt file's sha, not a blank guard that
    // would let the CAS check reject the overwrite forever.
    expect(cacheWrite!.args.expectedSha).toBe("corrupt-sha");
    expect(result.report.totals.total).toBe(1000);
  });

  it("leaves an unchanged cache alone and settles a completed day once", async () => {
    const fact = {
      t: NOW - 2 * 24 * 3600,
      sk: "OpenCode\u0000deepseek\u0000deepseek-flash",
      sid: "s1",
      c: [1000, 100, 100, 800, 0, 0, 0],
    };
    const cacheJson = JSON.stringify({
      schema: 1,
      sessions: { "OpenCode|s1": { updated: NOW } },
      messages: { "OpenCode|s1|m1": fact },
    });
    mock.files.set(CACHE_FILE, { content: cacheJson, sha: "existing-cache" });
    const result = await computeUsage(
      [source("OpenCode", NOW, [message("m1", 2 * 24 * 3600, 1000)])],
      "30d",
      new AbortController().signal,
    );
    const cacheWrites = mock.invocations.filter(i => i.cmd === "write_usage_file" && i.args.name === CACHE_FILE);
    expect(cacheWrites).toHaveLength(0);
    const ledgerWrites = mock.invocations.filter(i => i.cmd === "write_usage_file" && i.args.name === LEDGER_FILE);
    expect(ledgerWrites).toHaveLength(1);
    expect(result.money).not.toBeNull();
    expect(result.money!.spentRub).toBeGreaterThan(0);
  });
});
