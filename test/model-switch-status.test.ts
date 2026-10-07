// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ModelSwitchStatus } from "../src/components/ModelSwitchStatus";

it("shows real loading progress, then removes stale duration and progress when ready", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div"), root = createRoot(node);
  const state = { phase: "loading", ready: false, elapsed_seconds: 18.9,
    loader: { unit: "bytes", current: 300, total: 1000 } };
  try {
    act(() => root.render(createElement(ModelSwitchStatus, { state, modelName: "Qwen 27B Pi" })));
    expect(node.textContent).toContain("Загрузка моделиQwen 27B Pi18 с");
    expect(node.querySelector("progress")?.value).toBe(300);
    act(() => root.render(createElement(ModelSwitchStatus, {
      state: { ...state, phase: "ready", ready: true }, modelName: "Qwen 27B Pi",
    })));
    expect(node.textContent).toBe("ГотоваQwen 27B Pi");
    expect(node.querySelector("progress")).toBeNull();
    act(() => root.render(createElement(ModelSwitchStatus, {
      state: { ...state, phase: "failed", error: "Не удалось загрузить модель" }, modelName: "Qwen 27B Pi",
    })));
    expect(node.querySelector('[role="alert"]')?.textContent).toBe("Не удалось загрузить модель");
    expect(node.querySelector("progress")).toBeNull();
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); }
});
