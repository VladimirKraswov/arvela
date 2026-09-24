import { DEFAULT_APPEARANCE, normalizeAppearance, type Appearance } from "./appearance";
import type { RemoteHost } from "../native/hosts";
import type { Session } from "../api/types";
import type { QueuedPrompt } from "./queue";
import type { AccessMode } from "./access";
import { defaultAsr, type AsrSettings } from "../voice/asr";
// Persisted shell preferences. The shell owns theme/layout/directories/drafts;
// OpenCode owns sessions, models, credentials. No engine data is rewritten here.

export interface Prefs {
  appearance: Appearance;
  // Stable server identity is independent of an ephemeral SSH forwarding port.
  workspaceKey?: string;
  activeHost?: string;
  localEndpoint?: string;
  remoteHosts?: RemoteHost[];
  projectlessDirectories?: string[];
  projectlessSessions?: Session[];
  projectlessRoot?: string;
  newChatMode?: "project" | "projectless";
  // Completion attention belongs to this server and survives app restarts.
  unreadSessions?: Record<string, { time: number; directory?: string }>;

  queues?: Record<string, QueuedPrompt[]>;
  newAccess?: AccessMode;
  asr?: AsrSettings;
  endpointState?: Record<string, Partial<Prefs>>;
  pinnedProjects?: string[];
  hiddenProjects?: string[];
  expandedProjects?: Record<string, boolean>;
  endpoint: string;
  theme: "light" | "dark" | "system";
  selectedDirectory: string | null;
  lastSessionByDir: Record<string, string>;
  drafts: Record<string, string>;
  layout: {
    sidebarOpen: boolean;
    sidebarWidth: number;
    rightWidth: number;
    bottomHeight: number;
    rightOpen: boolean;
    bottomOpen: boolean;
    rightTab: "files" | "changes";
  };
  modelChoice: Record<
    string,
    { providerID: string; modelID: string; variant?: string | null }
  >; // by directory for new chats, or session:<id> for an existing chat
  agentChoice: Record<string, string>; // same key scheme as modelChoice
  ptyIds: Record<string, string>; // directory -> shell created by this app (never hijack foreign PTYs)
}

export const DEFAULT_PREFS: Prefs = {
  appearance: DEFAULT_APPEARANCE,
  endpoint: "http://127.0.0.1:4096",
  theme: "dark",
  asr: defaultAsr,
  selectedDirectory: null,
  lastSessionByDir: {},
  drafts: {},
  layout: {
    sidebarOpen: true,
    sidebarWidth: 252,
    rightWidth: 380,
    bottomHeight: 260,
    rightOpen: false,
    bottomOpen: false,
    rightTab: "changes",
  },
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
      appearance: normalizeAppearance(parsed.appearance),
      asr: parsed.asr?.endpoint?.trim() ? parsed.asr : defaultAsr,
      layout: { ...DEFAULT_PREFS.layout, ...(parsed.layout ?? {}) },
      lastSessionByDir: parsed.lastSessionByDir ?? {},
      drafts: parsed.drafts ?? {},
      modelChoice: parsed.modelChoice ?? {},
      agentChoice: parsed.agentChoice ?? {},
      ptyIds: parsed.ptyIds ?? {},
      queues: Object.fromEntries(
        Object.entries(parsed.queues ?? {}).map(([id, list]) => [
          id,
          list.map((item) =>
            item.state === "sending"
              ? { ...item, state: "uncertain" as const }
              : item,
          ),
        ]),
      ),
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPrefs: Prefs | null = null;
export function flushPrefs(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const prefs = pendingPrefs;
  if (!prefs) return;
  try {
    const keys = Object.keys(prefs.drafts);
    const drafts =
      keys.length > 200
        ? Object.fromEntries(keys.slice(-200).map((k) => [k, prefs.drafts[k]]))
        : prefs.drafts;
    localStorage.setItem(KEY, JSON.stringify({ ...prefs, drafts }));
    pendingPrefs = null;
  } catch {
    /* Keep pending state available for a later retry. */
  }
}
export function savePrefs(prefs: Prefs): void {
  pendingPrefs = prefs;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushPrefs, 400);
}
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushPrefs);
  import.meta.hot?.dispose(() => {
    flushPrefs();
    window.removeEventListener("pagehide", flushPrefs);
  });
}

export function draftKey(
  sessionId: string | null,
  directory: string | null,
): string {
  return sessionId ?? `new::${directory ?? ""}`;
}

/** Server-owned IDs and drafts never migrate into another endpoint's workspace. */
export function switchEndpointPrefs(
  prefs: Prefs,
  endpoint: string,
  workspaceKey = endpoint,
): Prefs {
  const { endpointState = {}, ...current } = prefs;
  const saved = endpointState[workspaceKey];
  return {
    ...DEFAULT_PREFS,
    asr: prefs.asr,
    layout: prefs.layout,
    ...saved,
    // Appearance belongs to the app, not to a cached remote workspace.
    theme: prefs.theme,
    appearance: normalizeAppearance(prefs.appearance),
    queues: Object.fromEntries(
      Object.entries(saved?.queues ?? {}).map(([id, list]) => [
        id,
        list.map((item) =>
          item.state === "sending"
            ? { ...item, state: "uncertain" as const }
            : item,
        ),
      ]),
    ),
    endpoint,
    workspaceKey,
    activeHost: prefs.activeHost,
    localEndpoint: prefs.localEndpoint,
    remoteHosts: prefs.remoteHosts,
    endpointState: {
      ...endpointState,
      [prefs.workspaceKey ?? prefs.endpoint]: current,
    },
  };
}
