import { describe, expect, it } from "vitest";
import { deepseekPeakStatus, formatUntilCheap } from "../src/usage/peak";

describe("deepseekPeakStatus", () => {
  it("is off-peak outside the UTC windows and on weekends", () => {
    // 2026-10-21 is a Wednesday.
    expect(deepseekPeakStatus(Date.parse("2026-10-21T00:00:00Z")).peak).toBe(false);
    expect(deepseekPeakStatus(Date.parse("2026-10-21T04:30:00Z")).peak).toBe(false);
    expect(deepseekPeakStatus(Date.parse("2026-10-21T10:00:00Z")).peak).toBe(false);
    expect(deepseekPeakStatus(Date.parse("2026-10-17T02:00:00Z")).peak).toBe(false); // Saturday
    expect(deepseekPeakStatus(Date.parse("2026-10-18T07:00:00Z")).peak).toBe(false); // Sunday
  });

  it("reports peak and the time until the current window ends", () => {
    const morning = deepseekPeakStatus(Date.parse("2026-10-21T02:00:00Z"));
    expect(morning.peak).toBe(true);
    expect(morning.untilMs).toBe(Date.parse("2026-10-21T04:00:00Z") - Date.parse("2026-10-21T02:00:00Z"));

    const evening = deepseekPeakStatus(Date.parse("2026-10-21T07:30:00Z"));
    expect(evening.peak).toBe(true);
    expect(evening.untilMs).toBe(Date.parse("2026-10-21T10:00:00Z") - Date.parse("2026-10-21T07:30:00Z"));

    // Boundary: the window is inclusive at start and exclusive at end.
    expect(deepseekPeakStatus(Date.parse("2026-10-21T01:00:00Z")).peak).toBe(true);
    expect(deepseekPeakStatus(Date.parse("2026-10-21T04:00:00Z")).peak).toBe(false);
  });
});

describe("formatUntilCheap", () => {
  it("renders minutes, hours, or hours+minutes, floored to at least a minute", () => {
    expect(formatUntilCheap(45 * 60_000)).toBe("45 мин");
    expect(formatUntilCheap(59 * 60_000)).toBe("59 мин");
    expect(formatUntilCheap(60 * 60_000)).toBe("1 ч");
    expect(formatUntilCheap(90 * 60_000)).toBe("1 ч 30 мин");
    expect(formatUntilCheap(120 * 60_000)).toBe("2 ч");
    expect(formatUntilCheap(0)).toBe("1 мин");
    expect(formatUntilCheap(30_000)).toBe("1 мин");
  });
});
