// Thin bridge to the native Pi RPC commands.
//
// Every call goes through `bridge`, which tests replace with a fake. Nothing in
// this file reaches the network: Pi speaks over its child process's stdio only,
// and the native side never opens a listener.

import type { PiEnvelope } from "./protocol";

export interface PiInstall {
  installed: boolean;
  path: string;
  version: string;
  source: "" | "configured" | "managed" | "system";
  error: string;
}

export interface PiSessionFile {
  id: string;
  file: string;
  cwd: string;
  created: string;
  updated: number;
}

export interface PiOpenRequest {
  directory: string;
  sessionId: string;
  provider?: string;
  model?: string;
  thinking?: string;
  program?: string;
  nodeProgram?: string;
  browserEnabled?: boolean;
  extensions?: string[];
  /** Probe only: `--no-session`, so it leaves no transcript behind. */
  ephemeral?: boolean;
  /** "ask" (default) or "full"; anything else is treated as "ask". */
  toolPolicy?: "ask" | "full";
}

export interface PiOpened {
  key: string;
  sessionId: string;
  sessionDir: string;
  program: string;
  reused: boolean;
}

export interface LspServerInfo {
  id: string;
  command: string;
  args: string[];
  extensions: string[];
  languageId: string;
}

export interface LspSetup {
  extensionPath: string;
  configPath: string;
  servers: LspServerInfo[];
  /** Servers we know about but could not find on this machine. */
  missing: string[];
}

export interface PiBridge {
  detect(configuredPath?: string, nodeProgram?: string): Promise<PiInstall>;
  open(request: PiOpenRequest): Promise<PiOpened>;
  request(key: string, command: unknown, timeoutMs?: number): Promise<unknown>;
  post(key: string, message: unknown): Promise<void>;
  close(key: string): Promise<void>;
  sessions(directory: string): Promise<PiSessionFile[]>;
  liveSessions(): Promise<string[]>;
  setupLsp(extraPaths?: string[]): Promise<LspSetup>;
  probeDirectory(): Promise<string>;
  prepareChatWorkspace(): Promise<{ directory: string; root: string }>;
  subscribe(handler: (envelope: PiEnvelope) => void): () => void;
}

export function isNativeHost(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const UNAVAILABLE =
  "Pi доступен только в установленном приложении OpenCode Desktop.";

/** Used in the browser preview, where no native host exists. */
const unavailableBridge: PiBridge = {
  detect: async () => ({
    installed: false,
    path: "",
    version: "",
    source: "",
    error: UNAVAILABLE,
  }),
  open: async () => {
    throw new Error(UNAVAILABLE);
  },
  request: async () => {
    throw new Error(UNAVAILABLE);
  },
  post: async () => {
    throw new Error(UNAVAILABLE);
  },
  close: async () => {},
  sessions: async () => [],
  liveSessions: async () => [],
  setupLsp: async () => {
    throw new Error(UNAVAILABLE);
  },
  probeDirectory: async () => "",
  prepareChatWorkspace: async () => { throw new Error(UNAVAILABLE); },
  subscribe: () => () => {},
};

function tauriBridge(): PiBridge {
  const core = () => import("@tauri-apps/api/core");
  const events = () => import("@tauri-apps/api/event");
  return {
    detect: async (configuredPath, nodeProgram) =>
      (await core()).invoke("pi_detect", { configuredPath: configuredPath ?? null, nodeProgram: nodeProgram ?? null }),
    open: async (request) => (await core()).invoke("pi_open", { request }),
    request: async (key, command, timeoutMs) =>
      (await core()).invoke("pi_request", {
        key,
        command,
        timeoutMs: timeoutMs ?? null,
      }),
    post: async (key, message) => (await core()).invoke("pi_post", { key, message }),
    close: async (key) => (await core()).invoke("pi_close", { key }),
    sessions: async (directory) => (await core()).invoke("pi_sessions", { directory }),
    liveSessions: async () => (await core()).invoke("pi_live_sessions"),
    setupLsp: async (extraPaths) =>
      (await core()).invoke("pi_setup_lsp", { extraPaths: extraPaths ?? [] }),
    probeDirectory: async () => (await core()).invoke("pi_probe_directory"),
    prepareChatWorkspace: async () => (await core()).invoke("pi_prepare_chat_workspace", { id: crypto.randomUUID() }),
    subscribe: (handler) => {
      let stop: (() => void) | undefined;
      let disposed = false;
      void events()
        .then((api) =>
          api.listen<PiEnvelope>("pi://event", (event) => handler(event.payload)),
        )
        .then((unlisten) => {
          if (disposed) unlisten();
          else stop = unlisten;
        })
        .catch(() => {});
      return () => {
        disposed = true;
        stop?.();
      };
    },
  };
}

let current: PiBridge | null = null;

export function piBridge(): PiBridge {
  if (!current) current = isNativeHost() ? tauriBridge() : unavailableBridge;
  return current;
}

/** Test seam: install a fake bridge. Pass null to restore the real one. */
export function setPiBridge(bridge: PiBridge | null): void {
  current = bridge;
}
