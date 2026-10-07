/** Effort is a real per-chat model variant, never hidden reasoning or a global rewrite. */
export function browserTaskKey(server: string, engine: string, session: string) { return JSON.stringify([server, engine, session]); }
export function browserEfforts(engine: string, variants: Record<string, unknown> | undefined, reasoning: boolean, thinkingMap?: Record<string, unknown>): string[] {
  if (engine !== "pi") return Object.keys(variants ?? {});
  if (!reasoning) return [];
  // Pi's installed getSupportedThinkingLevels uses explicit maps for xhigh/max;
  // a generic reasoning flag cannot establish those extra capabilities.
  return ["off", "minimal", "low", "medium", "high", "xhigh", "max"].filter(level =>
    thinkingMap?.[level] !== null && (!["xhigh", "max"].includes(level) || thinkingMap?.[level] !== undefined));
}
export function browserDefaultEffort(available: string[], preferred = "low"): string | null {
  return available.includes(preferred) ? preferred : null;
}
