import { FullAccessLoop } from "./fullAccessLoop";
import { OPENCODE_BACKEND_ID } from "./ids";
// The OpenCode agent backend: the default and, today, the only implementation of
// `AgentBackend`. It owns the loopback HTTP client and both SSE subscriptions so
// that no URL or wire-format knowledge leaks into the state layer.

import {
  DEFAULT_BASE_URL,
  isAllowedBaseUrl,
  normalizeBaseUrl,
  OpenCodeClient,
} from "../api/client";
import {
  eventStreamUrl,
  globalEventStreamUrl,
  runEventStream,
  type GlobalEvent,
} from "../api/events";
import type { ServerEvent } from "../api/types";
import type {
  AgentBackend,
  AgentBackendDescriptor,
  AgentCapabilities,
  DirectoryEvent,
  EventSubscription,
} from "./backend";

export { OPENCODE_BACKEND_ID } from "./ids";

/** Verified against OpenCode 1.18.x. Additive server fields must not change these. */
export const OPENCODE_CAPABILITIES: AgentCapabilities = {
  pty: true,
  permissions: true,
  questions: true,
  attachments: true,
  fork: true,
  compaction: true,
  vcsDiff: true,
  projectlessChat: true,
};

export class OpenCodeBackend implements AgentBackend {
  readonly id = OPENCODE_BACKEND_ID;
  /**
   * OpenCode-specific transport. Reachable only through `asOpenCodeClient`, for the
   * surfaces that are deliberately outside the neutral contract: PTY WebSockets,
   * the JSONC config editor and the `/mcp` inventory.
   */
  readonly client: OpenCodeClient;
  private fullAccessLoop: FullAccessLoop;

  constructor(endpoint: string) {
    this.client = new OpenCodeClient(endpoint);
    this.fullAccessLoop = new FullAccessLoop(this.client);
  }

  get endpoint(): string {
    return this.client.baseUrl;
  }
  get capabilities(): AgentCapabilities {
    return OPENCODE_CAPABILITIES;
  }
  setAuthHeaders(headers: Record<string, string>): void {
    this.client.headers = headers;
  }

  // Delegation keeps argument arity identical to the caller's: the adapter must not
  // invent defaults or trailing `undefined`s that the transport would forward.
  // ---- connection / runtime metadata ----
  health(...args: Parameters<OpenCodeClient["health"]>) {
    return this.client.health(...args);
  }
  providers(...args: Parameters<OpenCodeClient["providers"]>) {
    return this.client.providers(...args);
  }
  agents(...args: Parameters<OpenCodeClient["agents"]>) {
    return this.client.agents(...args);
  }
  config(...args: Parameters<OpenCodeClient["config"]>) {
    return this.client.config(...args);
  }

  // ---- workspaces ----
  projects(...args: Parameters<OpenCodeClient["projects"]>) {
    return this.client.projects(...args);
  }
  paths(...args: Parameters<OpenCodeClient["paths"]>) {
    return this.client.paths(...args);
  }
  vcs(...args: Parameters<OpenCodeClient["vcs"]>) {
    return this.client.vcs(...args);
  }

  // ---- sessions ----
  listSessions(...args: Parameters<OpenCodeClient["listSessions"]>) {
    return this.client.listSessions(...args);
  }
  recentSessions(...args: Parameters<OpenCodeClient["recentSessions"]>) {
    return this.client.recentSessions(...args);
  }
  getSession(...args: Parameters<OpenCodeClient["getSession"]>) {
    return this.client.getSession(...args);
  }
  createSession(...args: Parameters<OpenCodeClient["createSession"]>) {
    return this.client.createSession(...args);
  }
  updateSession(...args: Parameters<OpenCodeClient["updateSession"]>) {
    return this.client.updateSession(...args);
  }
  forkSession(...args: Parameters<OpenCodeClient["forkSession"]>) {
    return this.client.forkSession(...args);
  }
  deleteSession(...args: Parameters<OpenCodeClient["deleteSession"]>) {
    return this.client.deleteSession(...args);
  }
  sessionStatuses(...args: Parameters<OpenCodeClient["sessionStatuses"]>) {
    return this.client.sessionStatuses(...args);
  }

  // ---- history / execution ----
  messages(...args: Parameters<OpenCodeClient["messages"]>) {
    return this.client.messages(...args);
  }
  prompt(...args: Parameters<OpenCodeClient["prompt"]>) {
    return this.client.prompt(...args);
  }
  abort(...args: Parameters<OpenCodeClient["abort"]>) {
    return this.client.abort(...args);
  }
  summarize(...args: Parameters<OpenCodeClient["summarize"]>) {
    return this.client.summarize(...args);
  }

  // ---- interaction ----
  async pendingPermissions(...args: Parameters<OpenCodeClient["pendingPermissions"]>) {
    const requests = await this.client.pendingPermissions(...args);
    const resolved = await Promise.all(requests.map(request => this.fullAccessLoop.resolve(request, args[0], args[1])));
    return requests.filter((_, index) => !resolved[index]);
  }
  replyPermission(...args: Parameters<OpenCodeClient["replyPermission"]>) {
    return this.client.replyPermission(...args);
  }
  pendingQuestions(...args: Parameters<OpenCodeClient["pendingQuestions"]>) {
    return this.client.pendingQuestions(...args);
  }
  replyQuestion(...args: Parameters<OpenCodeClient["replyQuestion"]>) {
    return this.client.replyQuestion(...args);
  }
  rejectQuestion(...args: Parameters<OpenCodeClient["rejectQuestion"]>) {
    return this.client.rejectQuestion(...args);
  }

  subscribeDirectory(
    directory: string,
    subscription: EventSubscription<ServerEvent>,
  ): void {
    void runEventStream<ServerEvent>({
      url: eventStreamUrl(this.client.baseUrl, directory),
      headers: this.client.headers,
      signal: subscription.signal,
      onEvent: event => {
        subscription.onEvent(event);
        if (event.type === 'permission.asked' || event.type === 'permission.v2.asked')
          void this.fullAccessLoop.resolve(event.properties as unknown as import('../api/types').PermissionRequest, directory, subscription.signal);
      },
      onState: subscription.onState,
    });
  }

  subscribeAll(subscription: EventSubscription<DirectoryEvent>): void {
    void runEventStream<GlobalEvent>({
      url: globalEventStreamUrl(this.client.baseUrl),
      headers: this.client.headers,
      signal: subscription.signal,
      onEvent: envelope => {
        subscription.onEvent(envelope);
        const event = envelope.payload;
        if (event && (event.type === 'permission.asked' || event.type === 'permission.v2.asked'))
          void this.fullAccessLoop.resolve(event.properties as unknown as import('../api/types').PermissionRequest, envelope.directory ?? null, subscription.signal);
      },
      onState: subscription.onState,
    });
  }
}

export const openCodeDescriptor: AgentBackendDescriptor = {
  id: OPENCODE_BACKEND_ID,
  label: "OpenCode",
  description:
    "Отдельно установленный сервер OpenCode: сессии, выполнение, разрешения, PTY и провайдеры моделей.",
  defaultEndpoint: DEFAULT_BASE_URL,
  capabilities: OPENCODE_CAPABILITIES,
  isAllowedEndpoint: isAllowedBaseUrl,
  normalizeEndpoint: normalizeBaseUrl,
  create: (endpoint) => new OpenCodeBackend(endpoint),
};

/**
 * Escape hatch for the deliberately OpenCode-specific UI surfaces (PTY terminal,
 * `/mcp` inventory, JSONC config editor). Returns null for any other backend so
 * callers gate the feature instead of assuming OpenCode.
 */
export function asOpenCodeClient(
  backend: AgentBackend | null | undefined,
): OpenCodeClient | null {
  return backend instanceof OpenCodeBackend ? backend.client : null;
}
