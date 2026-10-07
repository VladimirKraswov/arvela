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
