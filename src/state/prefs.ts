import type { BrowserPreferences } from "../browser/integration";
import { DEFAULT_APPEARANCE, normalizeAppearance, type Appearance } from "./appearance";
import type { RemoteHost } from "../native/hosts";
import type { Session } from "../api/types";
import type { QueuedPrompt } from "./queue";
import type { AccessMode } from "./access";
import { defaultAsr, type AsrSettings } from "../voice/asr";
import { DEFAULT_HELPER_ENDPOINT } from "../attachments/helper";
// Persisted shell preferences. The shell owns theme/layout/directories/drafts;
// OpenCode owns sessions, models, credentials. No engine data is rewritten here.

/** App-owned metadata for a Pi chat; Pi itself owns only the transcript. */
export interface PiSessionMeta {
  id: string;
  directory: string;
  title: string;
  created: number;
  updated: number;
  archived?: number;
  /** Set when this chat was carried over from another engine. */
  handoffFrom?: string;
}

/** Pi runtime configuration. Never holds a credential: Pi owns its own auth. */
export interface PiSettings {
  /** Absolute path override when Pi is not in a known location. */
  program?: string;
  /** Optional absolute Node.js executable for an env-node Pi installation. */
  nodeProgram?: string;
  provider?: string;
  model?: string;
  thinking?: string;
  /** Absolute paths of Pi extensions to load (e.g. the LSP extension). */
  extensions?: string[];
  lspEnabled?: boolean;
  /**
   * Approval policy for Pi's built-in tools. "ask" is the safe default and the
   * value used when this is unset; "full" is only ever set by an explicit,
   * informed choice in settings.
   */
  toolPolicy?: "ask" | "full";
  /**
   * Explicit `provider/model` the user pinned, used even when Pi's bundled
   * catalog does not list it (Pi itself accepts such ids as custom models).
   */
  customModel?: string;
  /** `provider/model` that answered a real request; evidence, not a promise. */
  verifiedModel?: string;
  /** Models that answered a real Pi request, keyed by provider/model. */
  verifiedModels?: Record<string, number>;
  /**
   * Absolute paths to language servers, tried before the built-in candidates.
   * Needed on macOS, where an app launched from Finder inherits neither
   * `/opt/homebrew/bin` nor `~/.cargo/bin`.
   */
  lspServerPaths?: string[];
}

export interface Prefs {
  modelServices?: import("../models/services").ModelService[];
  appearance: Appearance;
  /** Local browser lifecycle and executable choice; engines retain their own permissions. */
  browser?: BrowserPreferences;
  /** Explicit browser-task profiles; selected engine/model/permissions remain independent. */
  browserTasks?: Record<string, { previousVariant?: string | null; appliedVariant?: string | null; providerID: string; modelID: string }>;
  /** Preferred engine per project folder. Absent means OpenCode. */
  projectEngine?: Record<string, string>;
  /** Per-chat engine override. Absent means the folder preference. */
  sessionEngine?: Record<string, string>;
  piSessions?: Record<string, PiSessionMeta>;
  /**
   * Where a chat's starting context came from, for either engine. Kept engine
   * neutral so the provenance banner works for OpenCode→Pi and Pi→OpenCode.
   */
  handoffOrigins?: Record<
    string,
    {
      from: string;
      fromEngine: string;
      title: string;
      directory: string;
      omitted: number;
    }
  >;
  pi?: PiSettings;
  /** Engine for a chat that has no folder yet. */
  newChatEngine?: string;
  // Stable server identity is independent of an ephemeral SSH forwarding port.
  workspaceKey?: string;
  activeHost?: string;
  localEndpoint?: string;
  /** Optional local OpenCode CLI path; does not affect remote workspaces. */
  localOpenCodeProgram?: string;
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
  helperEndpoint?: string;
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
  helperEndpoint: DEFAULT_HELPER_ENDPOINT,
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
export function flushPrefs(): boolean {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const prefs = pendingPrefs;
  if (!prefs) return true;
  try {
    const keys = Object.keys(prefs.drafts);
    const drafts =
      keys.length > 200
        ? Object.fromEntries(keys.slice(-200).map((k) => [k, prefs.drafts[k]]))
        : prefs.drafts;
    localStorage.setItem(KEY, JSON.stringify({ ...prefs, drafts }));
    pendingPrefs = null;
    return true;
  } catch {
    /* Keep pending state available for a later retry. */
    return false;
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
    layout: prefs.layout,
    ...saved,
    // The CPU helper and speech recognizer belong to this computer, not an
    // OpenCode workspace. Pi is local too: its runtime settings and its chats
    // must survive switching to another OpenCode server.
    asr: prefs.asr,
    helperEndpoint: prefs.helperEndpoint,
    modelServices: prefs.modelServices,
    pi: prefs.pi,
    browser: prefs.browser,
    browserTasks: prefs.browserTasks,
    piSessions: prefs.piSessions,
    sessionEngine: prefs.sessionEngine,
    handoffOrigins: prefs.handoffOrigins,
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
    localOpenCodeProgram: prefs.localOpenCodeProgram,
    remoteHosts: prefs.remoteHosts,
    endpointState: {
      ...endpointState,
      [prefs.workspaceKey ?? prefs.endpoint]: current,
    },
  };
}
