import { describe, expect, it } from "vitest";
import {
  dayKeyOf,
  deepseekPriceKey,
  emptyLedger,
  isPeakHour,
  modelMoney,
  moneyTotals,
  settleLedger,
  usdForTokens,
  type MoneySnapshot,
  type PriceBook,
} from "../src/usage/money";
import { emptyCache, type UsageCache } from "../src/usage/cache";

const NOW = Date.parse("2026-10-21T12:00:00Z");

function book(allPeak: boolean): PriceBook {
  const pair = (peak: number) => ({ peak, offPeak: peak / 2 });
  return {
    schema: 1,
    source: "test",
    checkedAt: NOW,
    offPeakFactor: 0.5,
    peakDays: allPeak ? [1, 2, 3, 4, 5, 6, 7] : [],
    peakWindows: allPeak ? [{ startHour: 0, endHour: 24 }] : [],
    models: {
      flash: { input: pair(0.3), inputCacheHit: pair(0.006), output: pair(1.2) },
      pro: { input: pair(1.32), inputCacheHit: pair(0.044), output: pair(3.96) },
    },
  };
}

function snapshot(peak: boolean, rate: number): MoneySnapshot {
  return { book: book(peak), rate: { source: "test", checkedAt: NOW, rate }, notes: [] };
}

function cacheWith(...facts: UsageCache["messages"][string][]): UsageCache {
  const cache = emptyCache();
  facts.forEach((fact, index) => {
    cache.messages[`f${index}`] = fact;
    cache.sessions[fact.sid] = { updated: fact.t };
  });
  return cache;
}

const paid = (t: number, tokens: number[]): UsageCache["messages"][string] => ({
  t,
  sk: "OpenCode\u0000deepseek\u0000deepseek-v4-pro",
  sid: "s1",
  c: tokens,
});
const free = (t: number, tokens: number[]): UsageCache["messages"][string] => ({
  t,
  sk: "OpenCode\u0000local-qwen38\u0000qwen-v100",
  sid: "s1",
  c: tokens,
});

describe("deepseekPriceKey", () => {
  it("maps paid DeepSeek models and treats everything else as free", () => {
    expect(deepseekPriceKey("deepseek", "deepseek-v4-pro")).toBe("pro");
    expect(deepseekPriceKey("deepseek", "deepseek-flash")).toBe("flash");
    expect(deepseekPriceKey("deepseek", "deepseek-v4-flash")).toBe("flash");
    expect(deepseekPriceKey("deepseek", "deepseek-reasoner")).toBe("pro");
    expect(deepseekPriceKey("local-qwen-next", "qwen38-flash-next")).toBeNull();
    expect(deepseekPriceKey("anthropic", "claude")).toBeNull();
  });
});

describe("isPeakHour", () => {
  const atPeak = {
    ...book(false),
    peakDays: [1, 2, 3, 4, 5],
    peakWindows: [{ startHour: 1, endHour: 4 }, { startHour: 6, endHour: 10 }],
  };
  it("applies UTC windows inclusively at start and exclusively at end", () => {
    // 2026-10-21 is a Wednesday.
    expect(isPeakHour(atPeak, Date.parse("2026-10-21T01:00:00Z"))).toBe(true);
    expect(isPeakHour(atPeak, Date.parse("2026-10-21T03:59:00Z"))).toBe(true);
    expect(isPeakHour(atPeak, Date.parse("2026-10-21T04:00:00Z"))).toBe(false);
    expect(isPeakHour(atPeak, Date.parse("2026-10-21T09:59:00Z"))).toBe(true);
    expect(isPeakHour(atPeak, Date.parse("2026-10-21T10:00:00Z"))).toBe(false);
  });
  it("weekends are always off-peak", () => {
    // 2026-10-17 is a Saturday, 2026-10-18 a Sunday.
    expect(isPeakHour(atPeak, Date.parse("2026-10-17T02:00:00Z"))).toBe(false);
    expect(isPeakHour(atPeak, Date.parse("2026-10-18T07:00:00Z"))).toBe(false);
  });
});

describe("usdForTokens", () => {
  it("prices input, cache reads and output per million; cache writes are free", () => {
    const table = book(false).models.flash;
    const usd = usdForTokens({ input: 1_000_000, cacheRead: 1_000_000, output: 1_000_000 }, table, false);
    expect(usd).toBeCloseTo(0.15 + 0.003 + 0.6, 10);
    expect(usdForTokens({ input: 2_000_000, cacheRead: 0, output: 0 }, table, true)).toBeCloseTo(0.6, 10);
  });
});

describe("settleLedger", () => {
  const yesterday = NOW - 30 * 3600_000; // same local day rules as the app

  it("settles a completed day once and never reprices it afterwards", () => {
    const cache = cacheWith(paid(yesterday, [1_000_000, 100_000, 100_000, 800_000, 0, 0, 0]));
    const first = settleLedger(cache, snapshot(false, 80), emptyLedger(), NOW);
    const day = dayKeyOf(yesterday);
    expect(first.changed).toBe(true);
    const settled = first.ledger.days[day];
    expect(settled).toBeDefined();

    // Same facts, doubled rate, new settlement: closed day must not move.
    const second = settleLedger(cache, snapshot(false, 160), first.ledger, NOW + 3600_000);
    expect(second.ledger.days[day]).toEqual(settled);

    // The stored numbers must equal an independent computation at the settle-time prices.
    const usd = 100_000 * 0.66 / 1e6 + 800_000 * 0.022 / 1e6 + 100_000 * 1.98 / 1e6;
    expect(settled!.spentRub).toBeCloseTo(usd * 80, 2);
    expect(settled!.savedRub).toBe(0);
  });

  it("keeps today unsettled and closes it later at the settlement-time price", () => {
    const cache = cacheWith(paid(NOW - 60_000, [1_000_000, 0, 100, 900_000, 0, 0, 0]));
    const open = settleLedger(cache, snapshot(false, 80), emptyLedger(), NOW);
    expect(Object.keys(open.ledger.days)).toHaveLength(0);
    const live = moneyTotals(cache, snapshot(false, 80), open.ledger, NOW);
    expect(live.today.spentRub).toBeGreaterThan(0);

    // A day later the same facts settle with the then-current rate.
    const closed = settleLedger(cache, snapshot(false, 100), open.ledger, NOW + 26 * 3600_000);
    expect(Object.keys(closed.ledger.days)).toHaveLength(1);
    expect(closed.ledger.days[dayKeyOf(NOW - 60_000)]!.rate).toBe(100);
  });

  it("splits money by model: paid in red, free savings valued at flash rates", () => {
    const cache = cacheWith(
      paid(NOW - 60_000, [1_000_000, 0, 100, 900_000, 0, 0, 0]),
      free(NOW - 30_000, [1_500_500, 500_000, 500, 1_000_000, 0, 0, 0]),
    );
    const perModel = modelMoney(cache, snapshot(false, 80), 0, NOW + 3600_000);
    const paidRow = perModel[paid(0, [0, 0, 0, 0, 0, 0, 0]).sk]!;
    const freeRow = perModel[free(0, [0, 0, 0, 0, 0, 0, 0]).sk]!;
    expect(paidRow.spentRub).toBeGreaterThan(0);
    expect(paidRow.savedRub).toBe(0);
    expect(freeRow.savedRub).toBeGreaterThan(0);
    expect(freeRow.spentRub).toBe(0);
    // Independent flash-price computation for the free row (off-peak snapshot).
    expect(freeRow.savedRub).toBeCloseTo((500_000 * 0.15 + 1_000_000 * 0.003 + 500 * 0.6) / 1e6 * 80, 2);
  });

  it("peak vs off-peak changes the settled amount by the schedule factor", () => {
    const cache = cacheWith(paid(yesterday, [1_000_000, 0, 0, 1_000_000, 0, 0, 0]));
    const off = settleLedger(cache, snapshot(false, 80), emptyLedger(), NOW);
    const on = settleLedger(cache, snapshot(true, 80), emptyLedger(), NOW);
    const day = dayKeyOf(yesterday);
    expect(off.ledger.days[day]!.spentRub).toBeCloseTo(on.ledger.days[day]!.spentRub / 2, 2);
  });

  it("day totals plus the live current day match the display totals", () => {
    const cache = cacheWith(
      paid(NOW - 30 * 3600_000, [1_000_000, 0, 0, 1_000_000, 0, 0, 0]),
      paid(NOW - 60_000, [1_000_000, 0, 0, 1_000_000, 0, 0, 0]),
    );
    const snap = snapshot(false, 80);
    const settled = settleLedger(cache, snap, emptyLedger(), NOW);
    const totals = moneyTotals(cache, snap, settled.ledger, NOW);
    const closed = Object.values(settled.ledger.days).reduce((sum, day) => sum + day.spentRub, 0);
    expect(totals.spentRub).toBeCloseTo(closed + totals.today.spentRub, 2);
  });
});
