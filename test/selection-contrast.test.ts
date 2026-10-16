// Text selection must carry the primary accent color and stay clearly
// visible on every surface. The historical regressions: `--accent-soft`
// (12% accent) washed into the panel background (#eaeaea on #fff, #303030
// on #202020), and a later system-Highlight rule ignored the user's chosen
// primary color. The rule now tints the accent (or the text color for the
// neutral theme) at 45% over whatever background it lands on.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { ACCENTS, accentColors } from "../src/state/appearance";

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

const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const channelL = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminance = (hex: string) => rgb(hex).map(channelL).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
const rgbDistance = (a: string, b: string) => rgb(a).reduce((s, c, i) => s + Math.abs(c - rgb(b)[i]), 0);
function over(tint: string, bg: string, alpha: number): string {
  return `#${rgb(tint).map((c, i) => Math.round(c * alpha + rgb(bg)[i] * (1 - alpha)).toString(16).padStart(2, "0")).join("")}`;
}

it("tints the selection with the accent, falling back to the text color", () => {
  const rules = selectionRules();
  expect(rules).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--accent,\s*var\(--text\)\)\s+45%,\s*transparent\)/);
  expect(rules).toMatch(/color:\s*inherit\b/); // the selected text keeps its own readable color
  expect(rules).toMatch(/background:\s*Highlight;/); // declared first: fallback for engines without color-mix
});

it("does not fall back to the invisible low-alpha accent soft tint", () => {
  expect(selectionRules()).not.toMatch(/accent-soft/);
});

// The guard that makes the 45% figure meaningful: the 12% regression failed
// it, every current accent/theme/surface combination passes it. A tint may
// be either darker/lighter than the surface (contrast) or a clearly different
// hue (large per-channel separation) — pale gold on white is invisible only
// as luminance, and visible exactly as hue.
function assertVisible(tint: string, bg: string, alpha: number, label: string) {
  const blend = over(tint, bg, alpha);
  const c = contrast(blend, bg);
  const d = rgbDistance(blend, bg);
  const maxd = Math.max(...rgb(blend).map((channel, i) => Math.abs(channel - rgb(bg)[i])));
  expect(c >= 1.25 || (d >= 90 && maxd >= 45), `${label}: contrast ${c.toFixed(2)}, rgb distance ${d}`).toBe(true);
}

it("lands clearly apart from every themed background for every accent", () => {
  const surfaces = { dark: ["#191817", "#202020", "#2a2a2a"], light: ["#f6f5f2", "#ffffff", "#eae7e1"] };
  const text = { dark: "#e8e5df", light: "#26241f" };
  for (const theme of ["dark", "light"] as const) {
    for (const bg of surfaces[theme]) {
      for (const [accent] of ACCENTS) {
        const tint = accent === "neutral" ? text[theme] : accentColors(accent, theme === "dark").ink;
        assertVisible(tint, bg, 0.45, `${accent} on ${bg} (${theme})`);
      }
    }
  }
});

it("proves the guard rejects the historical washed-out tints", () => {
  // The actual observed --accent-soft results from the original bug report.
  expect(() => assertVisible("#eaeaea", "#ffffff", 1, "old accent-soft light")).toThrow();
  expect(() => assertVisible("#303030", "#202020", 1, "old accent-soft dark")).toThrow();
});
