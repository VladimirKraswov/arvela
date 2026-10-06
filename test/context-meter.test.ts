// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
const fake = vi.hoisted(() => ({ compact: vi.fn(), running: false }));
vi.mock("../src/state/store", () => ({
  useAppState: () => ({ activeSessionId: "pi-chat" }),
  store: {
    engineIdFor: () => "pi", isRunning: () => fake.running,
    conversation: () => ({ capabilities: { compaction: true } }),
    compactSession: fake.compact,
    contextInfo: () => ({ limit: 262144, threshold: 229376, used: 1000, percent: 0, auto: false, compacting: false }),
  },
}));
import { ContextMeter } from "../src/components/ContextMeter";
let root: Root;
afterEach(() => { if (root) act(() => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); fake.running = false; vi.clearAllMocks(); });
it("offers native compaction for an idle Pi chat and keeps it disabled while running", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const node = document.createElement("div"); document.body.append(node); root = createRoot(node);
  act(() => root.render(createElement(ContextMeter)));
  act(() => document.querySelector<HTMLButtonElement>(".context-trigger")!.click());
  const button = [...document.querySelectorAll("button")].find(b => b.textContent === "Сжать сейчас")!;
  expect(button.disabled).toBe(false); act(() => button.click());
  expect(fake.compact).toHaveBeenCalledWith("pi-chat");
  fake.running = true; act(() => root.render(createElement(ContextMeter)));
  expect(button.disabled).toBe(true);
  expect(document.body.textContent).not.toContain("Автосжатие отключено в OpenCode");
});
