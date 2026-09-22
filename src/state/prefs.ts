// Persisted shell preferences. The shell owns theme/layout/directories/drafts;
// OpenCode owns sessions, models, credentials. No engine data is rewritten here.

export interface Prefs {
  endpoint: string;
  theme: "light" | "dark" | "system";
  selectedDirectory: string | null;
  lastSessionByDir: Record<string, string>;
  drafts: Record<string, string>;
  layout: { sidebarWidth: number; rightWidth: number; bottomHeight: number; rightOpen: boolean; bottomOpen: boolean; rightTab: "files" | "changes" };
  modelChoice: Record<string, { providerID: string; modelID: string; variant?: string | null }>; // by directory
  agentChoice: Record<string, string>; // by directory
  ptyIds: Record<string, string>; // directory -> shell created by this app (never hijack foreign PTYs)
}

export const DEFAULT_PREFS: Prefs = {
  endpoint: "http://127.0.0.1:4096",
  theme: "system",
  selectedDirectory: null,
  lastSessionByDir: {},
  drafts: {},
  layout: { sidebarWidth: 260, rightWidth: 380, bottomHeight: 260, rightOpen: false, bottomOpen: false, rightTab: "changes" },
  modelChoice: {},
  agentChoice: {},
  ptyIds: {},
};

const KEY = "ocdesktop.prefs.v1";

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      ...DEFAULT_PREFS,
      ...parsed,
      layout: { ...DEFAULT_PREFS.layout, ...(parsed.layout ?? {}) },
      lastSessionByDir: parsed.lastSessionByDir ?? {},
      drafts: parsed.drafts ?? {},
      modelChoice: parsed.modelChoice ?? {},
      agentChoice: parsed.agentChoice ?? {},
      ptyIds: parsed.ptyIds ?? {},
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
export function savePrefs(prefs: Prefs): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      // Keep drafts bounded: newest 200 entries.
      const keys = Object.keys(prefs.drafts);
      const drafts = keys.length > 200 ? Object.fromEntries(keys.slice(-200).map((k) => [k, prefs.drafts[k]])) : prefs.drafts;
      localStorage.setItem(KEY, JSON.stringify({ ...prefs, drafts }));
    } catch {
      /* storage full or unavailable — non-fatal */
    }
  }, 400);
}

export function draftKey(sessionId: string | null, directory: string | null): string {
  return sessionId ?? `new::${directory ?? ""}`;
}
