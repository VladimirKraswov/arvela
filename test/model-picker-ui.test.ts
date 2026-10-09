// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SelectMenu } from "../src/components/SelectMenu";
import { ModelSelectionDialog } from "../src/components/ModelSelectionDialog";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ""; });

it("keeps offline rows selectable and refresh accessible, including an empty catalog", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const node = document.createElement("div"); document.body.append(node);
  const root = createRoot(node), refresh = vi.fn(), select = vi.fn();
  const props = { label: "Модель", value: "gpu/base", options: [{ value: "gpu/base", label: "Base", detail: "сервис недоступен" }], onChange: select, onRefresh: refresh };
  try {
    act(() => root.render(createElement(SelectMenu, props)));
    act(() => node.querySelector("button")!.click());
    expect(document.querySelector('[role="option"]')?.textContent).toContain("сервис недоступен");
    const refreshButton = [...document.querySelectorAll("button")].find(b => b.textContent === "Обновить список")!;
    act(() => refreshButton.click());
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
    act(() => root.render(createElement(SelectMenu, { ...props, refreshing: true, refreshError: "offline" })));
    expect([...document.querySelectorAll("button")].find(b => b.textContent === "Обновление…")?.disabled).toBe(true);
    act(() => root.render(createElement(SelectMenu, { ...props, options: [], refreshError: "offline" })));
    expect(document.body.textContent).toContain("Настроенных моделей пока нет.");
    expect(document.querySelector('[role="status"]')?.textContent).toBe("offline");
    act(() => root.render(createElement(SelectMenu, props)));
    act(() => (document.querySelector('[role="option"]') as HTMLButtonElement).click());
    expect(select).toHaveBeenCalledWith("gpu/base");
  } finally { act(() => root.unmount()); }
});

it("uses a modal warning with retry, then blocks dismissal during the actual readiness check", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLDialogElement.prototype.showModal = vi.fn(function(this: HTMLDialogElement) { this.open = true; });
  HTMLDialogElement.prototype.close = vi.fn(function(this: HTMLDialogElement) { this.open = false; });
  const node = document.createElement("div"); document.body.append(node);
  const root = createRoot(node), retry = vi.fn(), close = vi.fn();
  const props = { label: "Base", pending: false, error: "Connection refused", onRetry: retry, onClose: close };
  try {
    act(() => root.render(createElement(ModelSelectionDialog, props)));
    expect(node.querySelector("dialog")?.open).toBe(true);
    expect(node.textContent).toContain("Модель остаётся в списке");
    expect(node.querySelector('[role="alert"]')?.textContent).toBe("Connection refused");
    act(() => [...node.querySelectorAll("button")].find(b => b.textContent === "Проверить снова")!.click());
    expect(retry).toHaveBeenCalledTimes(1);
    act(() => root.render(createElement(ModelSelectionDialog, { ...props, pending: true, error: "" })));
    expect(node.textContent).toContain("Подготовка модели");
    expect(node.querySelector("button")?.disabled).toBe(true);
    const cancel = new Event("cancel", { cancelable: true });
    act(() => node.querySelector("dialog")!.dispatchEvent(cancel));
    expect(cancel.defaultPrevented).toBe(true);
    expect(close).not.toHaveBeenCalled();
    act(() => root.render(createElement(ModelSelectionDialog, props)));
    act(() => node.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true })));
    expect(close).toHaveBeenCalledTimes(1);
  } finally { act(() => root.unmount()); }
});
