import { expect, it, vi } from "vitest";
import { createView } from "../src-tauri/resources/browser/view.mjs";

function fixture() {
  let size = { width: 1280, height: 800 };
  const context: any = { on: vi.fn(), pages: () => [page] };
  const page: any = { isClosed: () => false, context: () => context, url: () => "http://fixture/", title: async () => "Fixture", on: vi.fn(),
    viewportSize: () => size, setViewportSize: async (next: typeof size) => { size = next; }, screenshot: vi.fn(async () => Buffer.from("fixture")),
  };
  const client = { callTool: vi.fn(async () => ({ content: [] })) };
  const view = createView(async () => context);
  const observe = async (args: object = { scale: "css" }) => {
    const params = { name: "browser_take_screenshot", arguments: args };
    await view.before(client, params); await view.after(client, params, { content: [] });
  };
  return { context, page, view, client, observe };
}
const click = { name: "browser_mouse_click_xy", arguments: { x: 100, y: 50 } };
it("refuses stale geometry before sending the click to the official backend", async () => {
  const f = fixture(); await f.observe(); await f.view.resize(640, 480);
  f.client.callTool.mockClear();
  await expect(f.view.before(f.client, click)).rejects.toMatchObject({ recovery: "geometry" });
  expect(f.client.callTool).not.toHaveBeenCalled();
  await f.observe(); await expect(f.view.before(f.client, click)).resolves.toBeUndefined();
});
it("a different client and shared manual input each require a new observation", async () => {
  const f = fixture(); await f.observe();
  const other = { callTool: vi.fn() };
  await expect(f.view.before(other, click)).rejects.toMatchObject({ recovery: "geometry" });
  f.view.changed();
  await expect(f.view.before(f.client, click)).rejects.toMatchObject({ recovery: "geometry" });
});
it("full-page/device screenshots and out-of-viewport points cannot authorize XY input", async () => {
  const f = fixture();
  for (const args of [{ scale: "css", fullPage: true }, { scale: "device" }]) {
    await f.observe(args); await expect(f.view.before(f.client, click)).rejects.toMatchObject({ recovery: "geometry" });
  }
  await f.observe();
  await expect(f.view.before(f.client, { ...click, arguments: { x: 1280, y: 50 } })).rejects.toMatchObject({ recovery: "geometry" });
});
it("human mode enforces mouse and keyboard while fast mode retains semantic operations", async () => {
  const f = fixture(); f.view.setMode("human");
  for (const name of ["browser_click", "browser_fill_form", "browser_type", "browser_select_option", "browser_evaluate", "browser_run_code"])
    await expect(f.view.before(f.client, { name, arguments: {} })).rejects.toMatchObject({ recovery: "mode" });
  await expect(f.view.before(f.client, { name: "browser_keyboard_type", arguments: { text: "test" } })).resolves.toBeUndefined(); f.view.failed();
  f.view.setMode("fast");
  await expect(f.view.before(f.client, { name: "browser_click", arguments: {} })).resolves.toBeUndefined();
});
it("never publishes pre-resize pixels as a post-resize frame", async () => {
  const f = fixture(); await f.view.page();
  let release!: (buffer: Buffer) => void;
  f.page.screenshot.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = f.view.frame(f.context);
  await f.view.resize(640, 480); release(Buffer.from("old pixels"));
  await expect(pending).rejects.toMatchObject({ frameChanged: true });
  const current = await f.view.frame(f.context); expect(current.width).toBe(640); expect(current.height).toBe(480);
});

it("manual scroll invalidates both old panel pixels and agent coordinates without replay", async () => {
  const f=fixture();await f.observe();
  const old=await f.view.frame(f.context);
  await f.view.before(f.client,{name:"browser_mouse_wheel",arguments:{deltaY:200}},"user");
  await f.view.after(f.client,{name:"browser_mouse_wheel"},{content:[]});
  const fresh=await f.view.frame(f.context);expect(fresh.revision).toBeGreaterThan(old.revision);
  expect(()=>f.view.assertCurrent(old)).toThrow("Page changed");
  await expect(f.view.before(f.client,click)).rejects.toMatchObject({recovery:"geometry"});
  await f.observe();await expect(f.view.before(f.client,click)).resolves.toBeUndefined();
});
it("a scroll during capture cannot publish old pixels as fresh", async () => {
  const f=fixture();await f.observe();
  let release!: (buffer:Buffer)=>void;
  f.page.screenshot.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
  const pending=f.view.frame(f.context);
  await f.view.before(f.client,{name:"browser_mouse_wheel",arguments:{deltaY:200}},"user");
  f.view.failed();release(Buffer.from("old pixels"));
  await expect(pending).rejects.toMatchObject({frameChanged:true});
});
it("continuous manual keyboard entry retains the panel revision", async () => {
  const f=fixture();await f.observe();const old=await f.view.frame(f.context);
  await f.view.before(f.client,{name:"browser_keyboard_type",arguments:{text:"a"}},"user");f.view.failed();
  expect(()=>f.view.assertCurrent(old)).not.toThrow();
});

it("propagates cancellation into initial context/tab attachment and does not synchronize after abort", async () => {
  const f=fixture(), stop=new AbortController();
  f.client.callTool.mockImplementationOnce(async()=>{stop.abort();return {content:[]};});
  await expect(f.view.before(f.client,{name:"browser_snapshot",arguments:{}},"agent",stop.signal)).rejects.toBeDefined();
  expect(f.client.callTool).toHaveBeenCalledOnce();
  expect(f.client.callTool.mock.calls[0][2]).toMatchObject({signal:stop.signal,timeout:10000});
});
