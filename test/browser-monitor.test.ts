// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ invoke: vi.fn(), scopeChanged: undefined as undefined | (()=>void) }));
vi.mock("../src/browser/integration", () => ({ browserNative: native.invoke }));
vi.mock("@tauri-apps/api/event",()=>({listen:async (_name:string,handler:()=>void)=>{native.scopeChanged=handler;return()=>{native.scopeChanged=undefined;};}}));
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

it("clears the previous chat immediately and discards its pending capture",async()=>{
 await mount();expect(document.querySelector('img')).not.toBeNull();
 let finish!:(v:unknown)=>void;native.invoke.mockReturnValue(new Promise(r=>{finish=r;}));
 await act(async()=>vi.advanceTimersByTimeAsync(300));
 await act(async()=>native.scopeChanged!());expect(document.querySelector('img')).toBeNull();
 await act(async()=>finish(frame));expect(document.querySelector('img')).toBeNull();
 native.invoke.mockResolvedValue({...frame,title:'Other chat'});await act(async()=>vi.advanceTimersByTimeAsync(110));
 expect(document.querySelector('img')?.getAttribute('alt')).toBe('Other chat');
});
it('groups pages and observes another card without tab selection or input commands',async()=>{
 native.invoke.mockResolvedValue({...frame,pageId:'2',revision:1,tabs:[{id:'1',index:0,title:'First page',url:'https://example.test/a',active:false},{id:'2',index:1,title:'Agent page',url:'https://example.test/b',active:true}]});
 await mount();expect(document.querySelectorAll('[role="tab"]')).toHaveLength(2);
 await act(async()=>{(document.querySelector('[role="tab"]') as HTMLButtonElement).click();});
 expect(document.querySelector('img')).toBeNull();
 native.invoke.mockResolvedValue({...frame,pageId:'1',revision:1,title:'First page',tabs:[{id:'1',index:0,title:'First page',url:'https://example.test/a',active:false},{id:'2',index:1,title:'Agent page',url:'https://example.test/b',active:true}]});
 await act(async()=>vi.advanceTimersByTimeAsync(300));
 expect(native.invoke).toHaveBeenLastCalledWith('browser_monitor_frame',{pageId:'1'});
 expect(document.querySelector('img')?.getAttribute('alt')).toBe('First page');
 expect(native.invoke.mock.calls.every(([name])=>name==='browser_monitor_frame')).toBe(true);
 await act(async()=>native.scopeChanged!());expect(document.querySelectorAll('[role="tab"]')).toHaveLength(0);
});
it('reorders cards with the keyboard without changing browser state',async()=>{
 native.invoke.mockResolvedValue({...frame,pageId:'2',revision:1,tabs:[{id:'1',index:0,title:'First page',url:'https://example.test/a',active:false},{id:'2',index:1,title:'Agent page',url:'https://example.test/b',active:true}]});
 await mount();
 await act(async()=>document.querySelector('[role="tab"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',altKey:true,bubbles:true})));
 expect(Array.from(document.querySelectorAll('[role="tab"]')).map(el=>el.textContent)).toEqual(['Agent page','First page']);
 expect(native.invoke).toHaveBeenCalledTimes(1);
});
