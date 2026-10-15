// Text selection must stay visible in every theme. The old rule painted the
// selection with `--accent-soft`, which is only a few shades away from the
// panel background (#eaeaea on #fff in light, #303030 on #202020 in dark), so
// selected text was practically invisible. The rule must use the OS highlight
// system colors; the store already sets `color-scheme` per effective theme, so
// Highlight/HighlightText adapt to light and dark on their own.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const css = readFileSync(
  fileURLToPath(new URL("../src/styles.css", import.meta.url)),
  "utf8",
);

function selectionRules(): string {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = stripped.match(/::selection\s*\{[^}]*\}/g) ?? [];
  expect(rules.length).toBeGreaterThan(0);
  return rules.join("\n");
}

it("paints selected text with the system highlight colors", () => {
  const rules = selectionRules();
  expect(rules).toMatch(/background:\s*Highlight\b(?!Text)/);
  expect(rules).toMatch(/color:\s*HighlightText\b/);
});

it("does not fall back to the low-contrast accent tint", () => {
  expect(selectionRules()).not.toMatch(/accent-soft/);
});
