import { expect, it } from "vitest";
import { browserPoint, parseFrame } from "../src/browser/view";
const valid = () => ({ browserOpen: true, busy: false, tabs: [{ index: 0, title: "<script>untrusted</script>", url: "https://example.com", active: true }], image: "/9j/", width: 1280, height: 800 });
it("accepts inert text and pixels, never HTML rendering instructions", () => {
  expect(parseFrame(valid()).tabs[0].title).toContain("<script>");
  expect(parseFrame({ browserOpen: false, busy: false, tabs: [] }).image).toBeUndefined();
});
it.each([null, {}, { ...valid(), tabs: [null] }, { ...valid(), tabs: [...valid().tabs, ...valid().tabs] },
  { ...valid(), image: 'https://evil.example/frame' }, { ...valid(), width: NaN }, { ...valid(), height: 1201 },
  { ...valid(), title: {} }, { ...valid(), cursor: { x: 1, y: 2, owner: "site" } }])("rejects malformed native frame %j", value => {
  expect(() => parseFrame(value)).toThrow();
});
it("maps the scaled viewport without accepting letterbox or out-of-image clicks", () => {
  const rect = { left: 10, top: 20, width: 640, height: 400 };
  expect(browserPoint(330, 220, rect, valid())).toEqual({ x: 640, y: 400 });
  expect(browserPoint(9, 100, rect, valid())).toBeNull();
  expect(browserPoint(650, 420, rect, valid())).toBeNull();
  expect(browserPoint(20, 30, { ...rect, width: 0 }, valid())).toBeNull();
});
