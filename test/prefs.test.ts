import { expect, it, vi } from "vitest";
import {
  DEFAULT_PREFS,
  savePrefs,
  flushPrefs,
  loadPrefs,
} from "../src/state/prefs";
it("flushes the last draft at page close without waiting for the debounce", () => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
  });
  savePrefs({ ...DEFAULT_PREFS, drafts: { "new::/test": "last keystroke" } });
  flushPrefs();
  expect(loadPrefs().drafts["new::/test"]).toBe("last keystroke");
  vi.unstubAllGlobals();
});
