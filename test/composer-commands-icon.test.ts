// The composer's "Открыть команды" button used a large plus, which users read
// as "add a file" — especially with a real file-attach control right next to
// it. It must render the ⌘ command glyph instead; plain plus stays reserved
// for genuinely additive buttons (new chat, add project, new browser tab).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const composer = readFileSync(fileURLToPath(new URL("../src/components/Composer.tsx", import.meta.url)), "utf8");
const icons = readFileSync(fileURLToPath(new URL("../src/components/Icon.tsx", import.meta.url)), "utf8");

it("opens the command palette with the command glyph, not a plus", () => {
  const button = composer.match(/className="composer-plus"[\s\S]{0,200}?<\/button>/)?.[0] ?? "";
  expect(button).toContain('aria-label="Открыть команды"');
  expect(button).toContain('<Icon name="command"');
  expect(button).not.toContain('<Icon name="plus"');
});

it("defines the command glyph as the looped ⌘ outline", () => {
  expect(icons).toMatch(/command:\s*"M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/);
});
