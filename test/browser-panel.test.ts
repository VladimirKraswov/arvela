// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
const fake = vi.hoisted(() => ({ invoke: vi.fn(), native: true, host: null as object | null,
  state: {} as any, monitorEvent: undefined as undefined | ((event: {payload:any}) => void), setUi: vi.fn(), setBrowserSettings: vi.fn(), setLayout: vi.fn() }));
vi.mock("../src/browser/integration", () => ({ browserNative: fake.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async (_name: string, handler: (event: {payload:any}) => void) => {
  fake.monitorEvent = handler; return () => { fake.monitorEvent = undefined; };
} }));
vi.mock("../src/native/platform", () => ({ isNative: () => fake.native }));
vi.mock("../src/state/store", () => ({ useAppState: () => fake.state, store: {
  get state() { return fake.state; }, engineIdFor: () => "opencode", currentHost: () => fake.host, setUi: fake.setUi, setBrowserSettings: fake.setBrowserSettings, setLayout: fake.setLayout,
} }));
import { BrowserPanel, BrowserPresence } from "../src/components/BrowserPanel";
import { openFileInput } from "../src/attachments/composerBridge";
let root: Root;
const frame = { scope: {directory:"/test",engine:"opencode",sessionID:"ses_test"}, scopeKey: "fixture-key", browserOpen: true, busy: false, tabs: [{ index: 0, title: "Real page", url: "https://example.com", active: true }],
  width: 1280, height: 800, image: "/9j/", url: "https://example.com", cursor: { x: 100, y: 50, owner: "agent", action: "browser_click", at: 1 } };
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fake.native = true; fake.host = null; fake.monitorEvent = undefined;
  fake.state = { activeSessionId: "ses_test", directory: "/test", ui: {browserOpen:false,settingsOpen:false}, prefs: { workspaceKey:crypto.randomUUID(), endpoint: "http://127.0.0.1:4096", browser: { enabled: true } } };
  fake.invoke.mockImplementation(async command => command === "browser_view" ? frame : command === "browser_presence" ? { browserOpen: true, scope: frame.scope } : undefined);
  const node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ""; vi.useRealTimers(); vi.unstubAllGlobals(); });
const mount = async (component = BrowserPanel) => { await act(async () => root.render(createElement(component))); };
it("projects only pixels and labels; close hides the panel without stopping the browser", async () => {
  await mount(); expect(document.querySelector("img")?.src).toBe("data:image/jpeg;base64,/9j/");
  expect(document.querySelector('[aria-label="Курсор агента"]')).not.toBeNull();
  expect(document.querySelector("iframe,webview")).toBeNull();
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Закрыть панель браузера"]')!.click());
  expect(fake.setUi).toHaveBeenCalledWith({ browserOpen: false });
  expect(fake.invoke.mock.calls.some(([name]) => name === "browser_stop")).toBe(false);
});
it("manual tab selection goes through the native validated gateway", async () => {
  await mount(); await act(async () => document.querySelector<HTMLButtonElement>('[role="tab"]')!.click());
  expect(fake.invoke).toHaveBeenCalledWith("browser_input", { action: "select", args: { index: 0, scopeKey: "fixture-key" } });
});
it("does not compete with an active agent tool", async () => {
  fake.invoke.mockResolvedValue({ ...frame, busy: true }); await mount();
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Новая вкладка браузера"]')!.click());
  expect(fake.invoke.mock.calls.some(([name]) => name === "browser_input")).toBe(false);
});
it.each(["remote", "web", "disabled"])("does not leak local frames or inputs on %s", async reason => {
  if (reason === "remote") fake.host = {};
  if (reason === "web") fake.native = false;
  if (reason === "disabled") fake.state.prefs.browser.enabled = false;
  await mount(); expect(fake.invoke).not.toHaveBeenCalled(); expect(document.querySelector("img")).toBeNull();
});
it("coalesces slow polling and cancels the next poll after unmount", async () => {
  let resolve!: (value: unknown) => void;
  fake.invoke.mockReturnValue(new Promise(r => { resolve = r; })); await mount();
  await act(async () => vi.advanceTimersByTimeAsync(5000)); expect(fake.invoke).toHaveBeenCalledOnce();
  await act(async () => resolve(frame));
  act(() => root.unmount()); root = createRoot(document.createElement("div"));
  await act(async () => vi.advanceTimersByTimeAsync(5000)); expect(fake.invoke).toHaveBeenCalledOnce();
});
// jsdom's visibility depends on its options; pin it so polling assertions mean something.
const visible = () => Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
const views = () => fake.invoke.mock.calls.filter(([name]) => name === "browser_view").length;
it("pauses frame capture while a native file chooser is open and resumes after it closes", async () => {
  visible();
  try {
    await mount(); await act(async () => vi.advanceTimersByTimeAsync(600)); expect(views()).toBeGreaterThan(1);
    const input = document.createElement("input"); input.type = "file"; vi.spyOn(input, "click").mockImplementation(() => {});
    openFileInput(input);
    await act(async () => vi.advanceTimersByTimeAsync(800)); // a poll already in flight may still finish
    const during = views(); await act(async () => vi.advanceTimersByTimeAsync(3000)); expect(views()).toBe(during);
    input.dispatchEvent(new Event("cancel"));
    await act(async () => vi.advanceTimersByTimeAsync(1000)); expect(views()).toBeGreaterThan(during);
  } finally { delete (document as { hidden?: boolean }).hidden; }
});
it("does not overwrite an address the user is typing when the page URL changes", async () => {
  visible();
  try {
    await mount();
    const field = document.querySelector<HTMLInputElement>('[aria-label="Адрес браузера"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "https://typed.example");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    fake.invoke.mockImplementation(async command => command === "browser_view" ? { ...frame, url: "https://moved.example" } : undefined);
    await act(async () => vi.advanceTimersByTimeAsync(600));
    expect(views()).toBeGreaterThan(1); expect(field.value).toBe("https://typed.example");
  } finally { delete (document as { hidden?: boolean }).hidden; }
});
it("Shift+Tab leaves the page projection instead of being sent to the page", async () => {
  await mount();
  const screen = document.querySelector<HTMLElement>('[role="application"]')!;
  await act(async () => { screen.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true })); });
  await act(async () => { screen.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })); });
  const keys = fake.invoke.mock.calls.filter(([name]) => name === "browser_input").map(([, payload]) => payload.args.key);
  expect(keys).toEqual(["Tab"]);
});
it("reveals once when the agent starts Chromium, not on every health tick", async () => {
  await mount(BrowserPresence); expect(fake.setUi).toHaveBeenCalledExactlyOnceWith({ browserOpen: true });
  await act(async () => vi.advanceTimersByTimeAsync(4500)); expect(fake.setUi).toHaveBeenCalledOnce();
});
it("drops queued old inputs and ignores their late error after a connection change",async()=>{
 let reject!:(reason:Error)=>void;
 fake.invoke.mockImplementation(async command=>command==="browser_view"?frame:command==="browser_input"?new Promise((_resolve,r)=>{reject=r;}):undefined);
 await mount();
 await act(async()=>document.querySelector<HTMLButtonElement>('[aria-label="Новая вкладка браузера"]')!.click());
 await act(async()=>document.querySelector<HTMLButtonElement>('[aria-label="Новая вкладка браузера"]')!.click());
 fake.state={...fake.state,prefs:{...fake.state.prefs,endpoint:"http://127.0.0.1:4097"}};await mount();
 await act(async()=>reject(new Error("OLD_CONNECTION_ERROR")));
 expect(document.body.textContent).not.toContain("OLD_CONNECTION_ERROR");
 expect(fake.invoke.mock.calls.filter(([name])=>name==="browser_input")).toHaveLength(1);
});

it("changes mode through the live gateway before persisting it", async () => {
  await mount();
  const field = document.querySelector<HTMLSelectElement>('[aria-label="Режим работы браузера"]')!;
  await act(async () => { field.value = "human"; field.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(fake.invoke).toHaveBeenCalledWith("browser_input", { action: "mode", args: { mode: "human", scopeKey: "fixture-key" } });
  expect(fake.setBrowserSettings).toHaveBeenCalledWith({ mode: "human" });
});
it("keeps the old preference when mode change fails", async () => {
  fake.invoke.mockImplementation(async command => { if (command === "browser_input") throw new Error("Mode unavailable"); return frame; });
  await mount();
  await act(async () => { const field = document.querySelector<HTMLSelectElement>('[aria-label="Режим работы браузера"]')!; field.value = "human"; field.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(fake.setBrowserSettings).not.toHaveBeenCalled(); expect(document.body.textContent).toContain("Mode unavailable");
});
it("debounces resize bursts, blocks stale input and waits for the matching viewport", async () => {
  let resize!: ResizeObserverCallback;
  vi.stubGlobal("ResizeObserver", class { constructor(fn: ResizeObserverCallback) { resize = fn; } observe() {} disconnect() {} });
  visible();
  try {
    await mount();
    await act(async () => { resize([{ contentRect: { width: 720, height: 500 } } as ResizeObserverEntry], {} as ResizeObserver); resize([{ contentRect: { width: 640, height: 480 } } as ResizeObserverEntry], {} as ResizeObserver); });
    expect(document.body.textContent).toContain("Подстраиваю");
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Новая вкладка браузера"]')!.click());
    expect(fake.invoke.mock.calls.some(([name]) => name === "browser_input")).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(210));
    expect(fake.invoke).toHaveBeenCalledWith("browser_input", { action: "resize", args: { width: 640, height: 480, scopeKey: "fixture-key" } });
    expect(document.body.textContent).toContain("Подстраиваю");
    fake.invoke.mockImplementation(async command => command === "browser_view" ? { ...frame, width: 640, height: 480 } : undefined);
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(document.body.textContent).not.toContain("Подстраиваю");
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Новая вкладка браузера"]')!.disabled).toBe(false);
  } finally { delete (document as { hidden?: boolean }).hidden; }
});

it("binds a click to decoded pixels rather than a newer frame still loading", async () => {
  const original = { ...frame, pageId: "page", revision: 1 };
  fake.invoke.mockImplementation(async command => command === "browser_view" ? original : undefined);
  visible();
  try {
    await mount();
    const img = document.querySelector<HTMLImageElement>("img")!;
    vi.spyOn(img, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 640, height: 400 } as DOMRect);
    const screen = document.querySelector<HTMLElement>('[role="application"]')!;
    await act(async () => screen.dispatchEvent(new MouseEvent("click", { clientX: 100, clientY: 50, bubbles: true })));
    expect(fake.invoke.mock.calls.some(([name]) => name === "browser_input")).toBe(false);
    await act(async () => img.dispatchEvent(new Event("load")));
    fake.invoke.mockImplementation(async command => command === "browser_view" ? { ...original, revision: 2, width: 640, height: 480, image: "/9k/" } : undefined);
    await act(async () => vi.advanceTimersByTimeAsync(300));
    await act(async () => screen.dispatchEvent(new MouseEvent("click", { clientX: 100, clientY: 50, bubbles: true })));
    expect(fake.invoke).toHaveBeenCalledWith("browser_input", { action: "click", args: { x: 200, y: 100, scopeKey: "fixture-key", expected: { pageId: "page", revision: 1, url: original.url, width: 1280, height: 800 } } });
  } finally { delete (document as { hidden?: boolean }).hidden; }
});

it.each([false,true])("uses two idle or four active visible captures per second (busy=%s)", async busy => {
  visible(); fake.invoke.mockImplementation(async command => command === "browser_view" ? {...frame,busy} : undefined);
  try { await mount(); await act(async () => vi.advanceTimersByTimeAsync(1000)); expect(views()).toBe(busy ? 5 : 3); }
  finally { delete (document as {hidden?:boolean}).hidden; }
});

it("a visible native monitor does not auto-reveal a competing browser panel",async()=>{
  fake.invoke.mockResolvedValue({browserOpen:true,monitorOpen:true,scope:frame.scope});
  await mount(BrowserPresence);expect(fake.setUi).not.toHaveBeenCalledWith({browserOpen:true});
});
it("restoring the monitor respects unsaved settings rather than forcibly closing them",async()=>{
  fake.state.ui.settingsOpen=true;fake.invoke.mockResolvedValue({browserOpen:true,monitorOpen:true});
  await mount(BrowserPresence);expect(fake.monitorEvent).toBeTypeOf("function");
  await act(async()=>fake.monitorEvent!({payload:{mode:"panel",scope:frame.scope}}));
  expect(fake.setUi).toHaveBeenCalledWith({browserOpen:true});
  expect(fake.setUi).not.toHaveBeenCalledWith(expect.objectContaining({settingsOpen:false}));
});
it("remote scope hides the observer and cannot be reopened by its stale restore event",async()=>{
  fake.host={};await mount(BrowserPresence);
  expect(fake.invoke).toHaveBeenCalledWith("browser_session",{directory:null,engine:null,sessionId:null});
  await act(async()=>fake.monitorEvent!({payload:{mode:"panel",scope:frame.scope}}));
  expect(fake.setUi).not.toHaveBeenCalledWith({browserOpen:true});
  expect(fake.invoke.mock.calls.some(([name])=>name==="browser_presence"||name==="browser_view")).toBe(false);
});
it("detaching keeps the panel on failure and never issues browser_stop",async()=>{
  await mount();fake.invoke.mockRejectedValueOnce(new Error("fixture"));
  await act(async()=>document.querySelector<HTMLButtonElement>('[aria-label="Вынести браузер в окно наблюдения"]')!.click());
  expect(fake.invoke).toHaveBeenCalledWith("browser_monitor",{action:"detach",scopeKey:"fixture-key"});
  expect(fake.setUi).not.toHaveBeenCalledWith({browserOpen:false});
  expect(document.querySelector('[role=alert]')?.textContent).toContain("остаётся в панели");
  expect(fake.invoke.mock.calls.some(([name])=>name==="browser_stop")).toBe(false);
});
it("allows passive detaching during agent work without attempting page input",async()=>{
  fake.invoke.mockImplementation(async name=>name==="browser_view"?{...frame,busy:true}:undefined);
  await mount();await act(async()=>document.querySelector<HTMLButtonElement>('[aria-label="Вынести браузер в окно наблюдения"]')!.click());
  expect(fake.invoke).toHaveBeenCalledWith("browser_monitor",{action:"detach",scopeKey:"fixture-key"});
  expect(fake.setUi).toHaveBeenCalledWith({browserOpen:false});
  expect(fake.invoke.mock.calls.some(([name])=>name==="browser_input")).toBe(false);
});

it("blocks stale manual clicks immediately after wheel until a newer frame is decoded", async () => {
  visible();
  try {
    let revision=10;
    fake.invoke.mockImplementation(async command => command === "browser_view" ? {...frame,pageId:"p",revision} : undefined);
    await mount();
    const screen=document.querySelector<HTMLElement>('[role="application"]')!;
    const img=document.querySelector<HTMLImageElement>('img')!;
    img.getBoundingClientRect=()=>({left:0,top:0,width:640,height:400} as DOMRect);
    await act(async()=>img.dispatchEvent(new Event("load")));
    await act(async()=>screen.dispatchEvent(new WheelEvent("wheel",{deltaY:200,bubbles:true,cancelable:true})));
    expect(document.body.textContent).toContain("Обновляю после прокрутки");
    await act(async()=>screen.dispatchEvent(new MouseEvent("click",{clientX:100,clientY:100,bubbles:true})));
    expect(fake.invoke.mock.calls.filter(c=>c[0]==="browser_input").map(c=>c[1].action)).toEqual(["wheel"]);
    revision=11;
    await act(async()=>vi.advanceTimersByTimeAsync(600));
    // New pixels must be decoded, not merely received.
    await act(async()=>screen.dispatchEvent(new MouseEvent("click",{clientX:100,clientY:100,bubbles:true})));
    expect(fake.invoke.mock.calls.filter(c=>c[0]==="browser_input")).toHaveLength(1);
    await act(async()=>img.dispatchEvent(new Event("load")));
    await act(async()=>screen.dispatchEvent(new MouseEvent("click",{clientX:100,clientY:100,bubbles:true})));
    expect(fake.invoke.mock.calls.filter(c=>c[0]==="browser_input").map(c=>c[1].action)).toEqual(["wheel","click"]);
  } finally { delete (document as {hidden?:boolean}).hidden; }
});
it("unlocks after scroll at a page edge even when fresh JPEG bytes are unchanged", async () => {
  visible();
  try {
    let revision=20;
    fake.invoke.mockImplementation(async command=>command==="browser_view"?{...frame,pageId:"p",revision}:undefined);
    await mount();const img=document.querySelector<HTMLImageElement>('img')!;
    Object.defineProperty(img,"complete",{value:true});Object.defineProperty(img,"naturalWidth",{value:1280});
    img.decode=vi.fn(async()=>undefined);
    await act(async()=>img.dispatchEvent(new Event("load")));
    const screen=document.querySelector<HTMLElement>('[role="application"]')!;
    await act(async()=>screen.dispatchEvent(new WheelEvent("wheel",{deltaY:200,bubbles:true,cancelable:true})));
    expect(document.body.textContent).toContain("Обновляю после прокрутки");revision=21;
    await act(async()=>vi.advanceTimersByTimeAsync(600));
    expect(img.decode).toHaveBeenCalled();expect(document.body.textContent).not.toContain("Обновляю после прокрутки");
  }finally{delete(document as {hidden?:boolean}).hidden;}
});

it("foreign and legacy browser frames are never shown in the selected chat",async()=>{
 fake.invoke.mockResolvedValue({...frame,scope:{...frame.scope,sessionID:"other"}});await mount();expect(document.querySelector("img")).toBeNull();
 fake.state={...fake.state,activeSessionId:"other"};await mount();expect(document.querySelector("img")).not.toBeNull();
 fake.state={...fake.state,activeSessionId:"empty"};await mount();expect(document.querySelector("img")).toBeNull();
 fake.invoke.mockResolvedValue({...frame,scope:undefined});await act(async()=>vi.advanceTimersByTimeAsync(600));expect(document.querySelector("img")).toBeNull();
});

it("allows narrowing with pointer capture and persists once, restoring width on remount", async () => {
  fake.state.prefs.layout = { browserWidth: 600 };
  fake.setLayout.mockImplementation(patch => Object.assign(fake.state.prefs.layout, patch));
  await mount();
  const pane = document.querySelector<HTMLElement>(".browser-panel")!;
  vi.spyOn(pane, "getBoundingClientRect").mockReturnValue({ width: 600 } as DOMRect);
  const handle = document.querySelector<HTMLElement>('[aria-label="Ширина браузерной панели"]')!;
  handle.setPointerCapture = vi.fn(); handle.hasPointerCapture = () => true; handle.releasePointerCapture = vi.fn();
  const pointer = (name: string, x: number) => handle.dispatchEvent(new MouseEvent(name, {bubbles:true,clientX:x,button:0}));
  act(() => { pointer("pointerdown", 400); pointer("pointermove", 700); });
  expect(pane.style.getPropertyValue("--browser-panel-width")).toBe("300px");
  expect(fake.setLayout).not.toHaveBeenCalled();
  act(() => pointer("pointerup", 700));
  expect(fake.setLayout).toHaveBeenCalledExactlyOnceWith({browserWidth:300});
  act(() => root.unmount()); root = createRoot(document.querySelector("#test-root") || document.body.appendChild(document.createElement("div")));
  await act(async () => root.render(createElement(BrowserPanel)));
  expect(document.querySelector<HTMLElement>(".browser-panel")!.style.getPropertyValue("--browser-panel-width")).toBe("300px");
});
it("cancels width drag without changing saved preference and supports keyboard narrowing", async () => {
  fake.state.prefs.layout = { browserWidth: 420 };
  await mount();
  const pane = document.querySelector<HTMLElement>(".browser-panel")!;
  const handle = document.querySelector<HTMLElement>('[aria-label="Ширина браузерной панели"]')!;
  handle.setPointerCapture = vi.fn();
  act(() => {
    handle.dispatchEvent(new MouseEvent("pointerdown", {bubbles:true,clientX:400,button:0}));
    handle.dispatchEvent(new MouseEvent("pointermove", {bubbles:true,clientX:900}));
    handle.dispatchEvent(new Event("pointercancel", {bubbles:true}));
  });
  expect(fake.setLayout).not.toHaveBeenCalled();
  expect(pane.style.getPropertyValue("--browser-panel-width")).toBe("420px");
  act(() => handle.dispatchEvent(new KeyboardEvent("keydown", {bubbles:true,key:"Home"})));
  expect(fake.setLayout).toHaveBeenCalledWith({browserWidth:280});
});

it("defers page reflow until pointer release and ignores callbacks from the disconnected observer", async () => {
  const callbacks: ResizeObserverCallback[] = [];
  vi.stubGlobal("ResizeObserver", class { constructor(fn: ResizeObserverCallback) { callbacks.push(fn); } observe() {} disconnect() {} });
  await mount();
  const handle = document.querySelector<HTMLElement>('[aria-label="Ширина браузерной панели"]')!;
  handle.setPointerCapture = vi.fn(); handle.hasPointerCapture = () => false;
  const notify = (callback: ResizeObserverCallback, width: number) => callback([{contentRect:{width,height:500}} as ResizeObserverEntry], {} as ResizeObserver);
  act(() => handle.dispatchEvent(new MouseEvent("pointerdown", {bubbles:true,clientX:400,button:0})));
  await act(async () => { notify(callbacks[0], 700); await vi.advanceTimersByTimeAsync(500); });
  expect(fake.invoke.mock.calls.filter(([name,payload]) => name === "browser_input" && payload.action === "resize")).toHaveLength(0);
  act(() => handle.dispatchEvent(new MouseEvent("pointerup", {bubbles:true,clientX:400,button:0})));
  await act(async () => { notify(callbacks.at(-1)!, 320); await vi.advanceTimersByTimeAsync(200); });
  expect(fake.invoke).toHaveBeenCalledWith("browser_input", {action:"resize",args:{width:320,height:500,scopeKey:"fixture-key"}});
});
