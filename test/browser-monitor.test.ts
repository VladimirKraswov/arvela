// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../src/browser/integration", () => ({ browserNative: native.invoke }));
import { BrowserMonitor } from "../src/components/BrowserMonitor";
let root: Root;
const frame = { browserOpen: true, busy: true, tabs: [], title: "Agent page", image: "/9j/", width: 1280, height: 800, cursor: {x:100,y:40,owner:"agent",action:"click",at:1} };
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  native.invoke.mockResolvedValue(frame);
  const element=document.createElement("div"); document.body.append(element); root=createRoot(element);
});
afterEach(() => {act(()=>root.unmount());document.body.innerHTML="";vi.useRealTimers();vi.unstubAllGlobals();});
const mount=async()=>{await act(async()=>root.render(createElement(BrowserMonitor)));};
it("projects live pixels and agent status without interactive browser controls",async()=>{
  await mount(); expect(document.querySelector("img")?.src).toContain("data:image/jpeg;base64,/9j/");
  expect(document.body.textContent).toContain("Агент работает");
  expect(document.querySelector("iframe,webview,input,select,[role=application]")).toBeNull();
  expect(document.querySelector('[aria-label="Курсор агента"]')).not.toBeNull();
});
it("click, wheel, paste and keys cannot send input or change the browser viewport",async()=>{
  await mount(); const screen=document.querySelector('[aria-label="Страница только для наблюдения"]')!;
  await act(async()=>{screen.dispatchEvent(new MouseEvent("click",{bubbles:true})); screen.dispatchEvent(new WheelEvent("wheel",{deltaY:120,bubbles:true}));screen.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));screen.dispatchEvent(new Event("paste",{bubbles:true}));window.dispatchEvent(new Event("resize"));});
  expect(native.invoke.mock.calls.every(([name])=>name==="browser_monitor_frame")).toBe(true);
});
it.each([["Вернуть браузер в приложение","restore"],["Скрыть окно наблюдения","hide"]])("%s changes presentation without stopping Chromium",async(label,action)=>{
  await mount(); await act(async()=>document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
  expect(native.invoke).toHaveBeenCalledWith("browser_monitor",{action});
  expect(native.invoke.mock.calls.some(([name])=>name==="browser_stop"||name==="browser_input")).toBe(false);
});
it("marks failed observations stale instead of displaying them as current",async()=>{
  await mount();native.invoke.mockRejectedValue(new Error("fixture"));await act(async()=>vi.advanceTimersByTimeAsync(300));
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
  expect(document.querySelector("img")?.closest(".browser-monitor-frame")?.classList.contains("stale")).toBe(true);
});
it("does not create overlapping capture requests and stops on unmount",async()=>{
  let finish!:(value:unknown)=>void;native.invoke.mockReturnValue(new Promise(r=>{finish=r;}));
  await mount();await act(async()=>vi.advanceTimersByTimeAsync(10000));expect(native.invoke).toHaveBeenCalledOnce();
  act(()=>root.unmount());root=createRoot(document.createElement("div"));await act(async()=>finish(frame));await act(async()=>vi.advanceTimersByTimeAsync(10000));expect(native.invoke).toHaveBeenCalledOnce();
});
it("hides an old image when the browser reports it closed",async()=>{
  await mount();native.invoke.mockResolvedValue({browserOpen:false,busy:false,tabs:[]});await act(async()=>vi.advanceTimersByTimeAsync(300));
  expect(document.querySelector("img")).toBeNull();expect(document.body.textContent).toContain("Браузер закрыт");
});
