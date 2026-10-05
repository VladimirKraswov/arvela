import { afterEach, expect, it, vi } from "vitest";
import { probeSessionId } from "../src/agent/pi/backend";

afterEach(() => { vi.useRealTimers(); });

it("probe ids started in the same millisecond never share a native Pi process", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
  const ids = new Set(Array.from({ length: 50 }, () => probeSessionId()));
  expect(ids.size).toBe(50);
  for (const id of ids) {
    // Same shape native validation accepts, and hidden from chat listings.
    expect(id).toMatch(/^probe-[a-z0-9]+-[a-z0-9]+$/);
    expect(id.length).toBeLessThanOrEqual(64);
  }
});
