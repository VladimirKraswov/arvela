// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { modelServices } from "../src/models/services";
import { ModelConnectionCheck } from "../src/components/ModelConnectionCheck";

let root: Root | undefined;
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined;
  document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function mount(modelID = "base") {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(modelServices, "manages").mockReturnValue(true);
  if (!root) { const el = document.createElement("div"); document.body.append(el); root = createRoot(el); }
  act(() => root!.render(createElement(ModelConnectionCheck, { providerID: "gpu", modelID, agent: "pi" })));
}
it("checks the failed message's model once, shows recovery and does not offer a prompt replay", async () => {
  let complete: (() => void) | undefined;
  const check = vi.spyOn(modelServices, "check").mockImplementation(() => new Promise<void>(resolve => { complete = resolve; }));
  mount();
  const button = document.querySelector("button")!;
  act(() => button.click());
  expect(button.disabled).toBe(true); expect(button.textContent).toBe("Проверка…");
  expect(check).toHaveBeenCalledExactlyOnceWith("gpu", "base", "pi");
  await act(async () => { complete!(); });
  expect(document.querySelector('[role="status"]')?.textContent).toContain("Модель доступна");
  expect(document.querySelectorAll("button")).toHaveLength(1); expect(button.disabled).toBe(false);
});
it("does not leak a late result into a different model or an unmounted chat", async () => {
  let complete: (() => void) | undefined;
  vi.spyOn(modelServices, "check").mockImplementation(() => new Promise<void>(resolve => { complete = resolve; }));
  mount(); act(() => document.querySelector("button")!.click());
  mount("other"); await act(async () => { complete!(); });
  expect(document.querySelector('[role="status"]')).toBeNull();
  act(() => document.querySelector("button")!.click()); act(() => root!.unmount()); root = undefined;
  await act(async () => { complete!(); });
  expect(document.querySelector('[role="status"]')).toBeNull();
});
