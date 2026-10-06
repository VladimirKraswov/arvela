// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
const fake = vi.hoisted(() => ({
  engine: "pi", vcsDiff: vi.fn(async () => []), sessionDiff: vi.fn(async () => []),
  state: { connection: { phase: "connected", endpoint: "http://127.0.0.1:4096" }, directory: "/workspace", activeSessionId: "chat", chat: { sessions: {}, sessionPatched: {} }, prefs: { layout: { rightTab: "changes", rightWidth: 400 } } },
}));
vi.mock("../src/state/store", () => ({
  useAppState: () => fake.state,
  errText: (e: unknown) => String(e),
  store: { state: fake.state, engineIdFor: () => fake.engine,
    client: { vcsDiff: fake.vcsDiff, sessionDiff: fake.sessionDiff }, setLayout: vi.fn(), setUi: vi.fn() },
}));
import { RightPanel } from "../src/components/RightPanel";
let root: Root;
afterEach(() => { if (root) act(() => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); vi.clearAllMocks(); fake.engine = "pi"; });
it("labels Pi changes as workspace Git and restores native session diff for OpenCode", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div"); document.body.append(node); root = createRoot(node);
  await act(async () => root.render(createElement(RightPanel)));
  expect(fake.vcsDiff).toHaveBeenCalledWith("/workspace");
  expect(fake.sessionDiff).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain("Эта задача");
  const button = [...document.querySelectorAll("button")].find(b => b.textContent === "Рабочая копия")!;
  expect(button.className).toContain(" on");
  fake.engine = "opencode";
  await act(async () => root.render(createElement(RightPanel)));
  expect(fake.sessionDiff).toHaveBeenCalledWith("chat", "/workspace");
  expect(document.body.textContent).toContain("Эта задача");
});
