import { expect, it } from "vitest";
import { browserEnabled, browserNodeProgram } from "../src/browser/preferences";

it("uses one Node.js rule everywhere: browser path, then Pi path, then native discovery", () => {
  expect(browserNodeProgram({})).toBeNull();
  expect(browserNodeProgram({ pi: { nodeProgram: "/opt/homebrew/bin/node" } })).toBe("/opt/homebrew/bin/node");
  expect(browserNodeProgram({ browser: { nodeProgram: " /Users/example/Node Runtime/node " }, pi: { nodeProgram: "/opt/homebrew/bin/node" } }))
    .toBe("/Users/example/Node Runtime/node");
  // A blank browser value must not hide the Pi fallback (it previously could).
  expect(browserNodeProgram({ browser: { nodeProgram: "   " }, pi: { nodeProgram: "/usr/bin/node" } })).toBe("/usr/bin/node");
  expect(browserNodeProgram({ browser: { nodeProgram: "" }, pi: { nodeProgram: "  " } })).toBeNull();
});

it("treats an absent preference as enabled and only an explicit false as disabled", () => {
  expect(browserEnabled({})).toBe(true);
  expect(browserEnabled({ browser: {} })).toBe(true);
  expect(browserEnabled({ browser: { enabled: true } })).toBe(true);
  expect(browserEnabled({ browser: { enabled: false } })).toBe(false);
});
