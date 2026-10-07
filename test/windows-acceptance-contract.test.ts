import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps the installed panel acceptance on the 0.2.21 keyboard-capable tool contract", () => {
  const panel = readFileSync(
    new URL("../src-tauri/resources/browser/test/installed-panel.mjs", import.meta.url),
    "utf8",
  );
  expect(panel).toContain("assert.equal(tools.tools.length, 33)");
  expect(panel).toContain("tool.name === 'browser_keyboard_type'");
});
