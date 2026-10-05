import type { BrowserPreferences } from "./integration";

/**
 * The one rule for the managed browser's interpreter, shared by background
 * setup, settings and the toolbar: the browser's own Node.js path, else Pi's
 * Node.js path, else null so native discovery chooses. Blank values never
 * hide the fallback.
 */
export function browserNodeProgram(prefs: {
  browser?: Pick<BrowserPreferences, "nodeProgram">;
  pi?: { nodeProgram?: string };
}): string | null {
  return prefs.browser?.nodeProgram?.trim() || prefs.pi?.nodeProgram?.trim() || null;
}

/** Absent means enabled: the browser is opt-out, as before. */
export function browserEnabled(prefs: { browser?: Pick<BrowserPreferences, "enabled"> }): boolean {
  return prefs.browser?.enabled !== false;
}
