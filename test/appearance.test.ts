// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { DEFAULT_APPEARANCE, normalizeAppearance, applyAppearance, accentColors, contrast } from "../src/state/appearance";
import { DEFAULT_PREFS, loadPrefs, savePrefs, flushPrefs, switchEndpointPrefs } from "../src/state/prefs";
afterEach(() => { document.documentElement.removeAttribute("style"); localStorage.clear(); });
it("migrates existing preferences without losing drafts, model, ASR or layout", () => {
  const old = { ...DEFAULT_PREFS, appearance: undefined, drafts: { s: "unfinished" }, modelChoice: { s: { providerID: "local", modelID: "qwen" } } };
  localStorage.setItem("ocdesktop.prefs.v1", JSON.stringify(old));
  const migrated = loadPrefs();
  expect(migrated.appearance).toEqual(DEFAULT_APPEARANCE);
  expect(migrated.drafts).toEqual(old.drafts); expect(migrated.modelChoice).toEqual(old.modelChoice); expect(migrated.asr).toEqual(old.asr);
  savePrefs({ ...migrated, appearance: { ...migrated.appearance, chatFontSize: 20, accent: "#5599ee" } }); flushPrefs();
  expect(loadPrefs().appearance.chatFontSize).toBe(20); expect(loadPrefs().drafts.s).toBe("unfinished");
});
it("validates persisted values and clamps fonts without accepting CSS injection", () => {
  expect(normalizeAppearance({ uiFontSize: 999, chatFontSize: -9, codeFontSize: NaN, accent: "red; display:none", chatWidth: "99999", lineSpacing: null }))
    .toEqual({ ...DEFAULT_APPEARANCE, uiFontSize: 18, chatFontSize: 12 });
  expect(normalizeAppearance(null)).toEqual(DEFAULT_APPEARANCE);
  expect(normalizeAppearance({ accent: "#ABCDEF" }).accent).toBe("#abcdef");
});
it("keeps appearance global even when returning to an old remote workspace snapshot", () => {
  const current = { ...DEFAULT_PREFS, theme: "light" as const, appearance: { ...DEFAULT_APPEARANCE, codeFontSize: 19 }, endpointState: { remote: { ...DEFAULT_PREFS, drafts: { r: "remote" } } } };
  const remote = switchEndpointPrefs(current, "http://127.0.0.1:5000", "remote");
  expect(remote.theme).toBe("light"); expect(remote.appearance.codeFontSize).toBe(19); expect(remote.drafts).toEqual({ r: "remote" });
  const back = switchEndpointPrefs({ ...remote, appearance: { ...remote.appearance, uiFontSize: 17 } }, DEFAULT_PREFS.endpoint);
  expect(back.appearance.uiFontSize).toBe(17);
});
it("applies independent font/width/spacing variables and clears a custom accent on reset", () => {
  document.documentElement.dataset.theme = "dark";
  applyAppearance({ ...DEFAULT_APPEARANCE, uiFontSize: 16, chatFontSize: 22, codeFontSize: 18, accent: "#5599ee", chatWidth: "wide", lineSpacing: "relaxed" });
  const style = document.documentElement.style;
  expect(style.getPropertyValue("--ui-font-size")).toBe("16px"); expect(style.getPropertyValue("--chat-font-size")).toBe("22px"); expect(style.getPropertyValue("--code-font-size")).toBe("18px");
  expect(style.getPropertyValue("--chat-width")).toBe("1060px"); expect(style.getPropertyValue("--chat-line-height")).toBe("1.85");
  applyAppearance(DEFAULT_APPEARANCE); expect(style.getPropertyValue("--accent")).toBe(""); expect(style.getPropertyValue("--accent-fill")).toBe(""); expect(style.getPropertyValue("--chat-font-size")).toBe("14px");
});
it("keeps the CPU helper address global when switching OpenCode servers", () => {
  const current = { ...DEFAULT_PREFS, helperEndpoint: "http://127.0.0.1:18109", endpointState: { remote: { helperEndpoint: "http://127.0.0.1:18107" } } };
  const remote = switchEndpointPrefs(current, "http://127.0.0.1:5000", "remote");
  expect(remote.helperEndpoint).toBe("http://127.0.0.1:18109");
  const back = switchEndpointPrefs(remote, DEFAULT_PREFS.endpoint);
  expect(back.helperEndpoint).toBe("http://127.0.0.1:18109");
});
it("keeps local engine paths when switching to and from a remote workspace", () => {
  const current = {
    ...DEFAULT_PREFS,
    localOpenCodeProgram: "/opt/homebrew/bin/opencode",
    pi: { program: "/opt/homebrew/bin/pi", nodeProgram: "/opt/homebrew/bin/node" },
    endpointState: { remote: { localOpenCodeProgram: "/stale/opencode", pi: { program: "/stale/pi" } } },
  };
  const remote = switchEndpointPrefs(current, "http://127.0.0.1:5000", "remote");
  expect(remote.localOpenCodeProgram).toBe(current.localOpenCodeProgram);
  expect(remote.pi).toEqual(current.pi);
  const back = switchEndpointPrefs(remote, DEFAULT_PREFS.endpoint);
  expect(back.localOpenCodeProgram).toBe(current.localOpenCodeProgram);
  expect(back.pi).toEqual(current.pi);
});
it("keeps arbitrary accent labels and filled buttons legible in both themes", () => {
  for (const color of ["#ffffff", "#000000", "#5599ee", "#e3b341", "#9b83ee", "#4caa86", "#e78060"]) for (const dark of [true, false]) {
    const a = accentColors(color, dark); expect(contrast(a.ink, dark ? "#202020" : "#ffffff")).toBeGreaterThanOrEqual(4.5); expect(contrast(a.fill, a.on)).toBeGreaterThanOrEqual(4.5);
  }
});
