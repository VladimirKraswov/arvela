import {
  connectSsh,
  prepareChat,
  remoteKey,
  hostHeaders,
  validRemote,
  type RemoteHost,
} from "../native/hosts";
import { contextUsage, type CompactionConfig } from "./context";
import { accessRules, accessMode, type AccessMode } from "./access";
import { newMessageId, type QueuedPrompt } from "./queue";
import type { AsrSettings } from "../voice/asr";
// Central application store: connection lifecycle, project/session selection,
// chat state driven by the pure stream reducer, and command actions.
// Designed to be testable: Tauri is only touched through theme/window niceties.

import { useSyncExternalStore } from "react";
import {
  ApiError,
  ConnectionError,
  isAllowedBaseUrl,
  OpenCodeClient,
} from "../api/client";
import { eventStreamUrl, globalEventStreamUrl, runEventStream, type GlobalEvent } from "../api/events";
import { completionChime } from "../native/sound";
import type {
  AgentInfo,
  ModelInfo,
  PermissionRequest,
  Project,
  ProviderInfo,
  QuestionRequest,
  ServerEvent,
  Session,
  SessionStatus,
  VcsInfo,
} from "../api/types";
import {
  applyHistory,
  emptyChatRoot,
  emptySessionChat,
  pendingForSession,
  prependHistory,
  reduceEvent,
  reconcileHistoryEvents,
  type ChatRootState,
} from "./chatReducer";
import {
  DEFAULT_PREFS,
  flushPrefs,
  draftKey,
  loadPrefs,
  savePrefs,
  switchEndpointPrefs,
  type Prefs,
} from "./prefs";

export type ConnectionPhase =
  | "unknown"
  | "connecting"
  | "connected"
  | "disconnected"
  | "incompatible";

export interface ConnectionState {
  phase: ConnectionPhase;
  version: string | null;
  error: string | null;
  streamState:
    | "idle"
    | "connecting"
    | "open"
    | "reconnecting"
    | "closed"
    | "error";
  lastEventAt: number;
  endpoint: string;
}

export interface UiState {
  remoteFolderOpen: boolean;
  hostDialogOpen: boolean;
  workspacePreparing: boolean;
  runtimeLoading: boolean;
  sessionListLoading: boolean;
  sessionListError: string | null;
  historyLoading: boolean;
  historyError: string | null;
  sending: boolean;
  sendError: string | null;
  vcs: VcsInfo | null;
  settingsOpen: boolean;
  paletteOpen: boolean;
  confirmDelete: Session | null;
  toast: string | null;
}

export interface AppState {
  prefs: Prefs;
  connection: ConnectionState;
  projects: Project[];
  directory: string | null;
  sessions: Session[];
  archivedSessions: Session[];
  activeSessionId: string | null;
  statuses: Record<string, SessionStatus>;
  activityStatuses: Record<string, SessionStatus>;
  chat: ChatRootState;
  providers: ProviderInfo[];
  connectedProviderIds: string[];
  providerDefaults: Record<string, string> | null;
  configDefaultAgent: string | null;
  configModel: string | null;
  compaction: CompactionConfig;
  agents: AgentInfo[];
  olderExhausted: Record<string, boolean>;
  historyCursors: Record<string, string | null>;
  ui: UiState;
  rev: number;
}

/** Compatibility is a major-version contract; features degrade per-capability, not by version gate. */

function initialState(): AppState {
  const prefs =
    typeof localStorage !== "undefined" ? loadPrefs() : { ...DEFAULT_PREFS };
  return {
    prefs,
    connection: {
      phase: "unknown",
      version: null,
      error: null,
      streamState: "idle",
      lastEventAt: 0,
      endpoint: prefs.endpoint,
    },
    projects: [],
    directory: prefs.selectedDirectory,
    sessions: [],
    archivedSessions: [],
    activeSessionId: prefs.selectedDirectory
      ? (prefs.lastSessionByDir[prefs.selectedDirectory] ?? null)
      : null,
    statuses: {},
    activityStatuses: {},
    chat: emptyChatRoot(),
    providers: [],
    connectedProviderIds: [],
    providerDefaults: null,
    configDefaultAgent: null,
    configModel: null,
    compaction: {},
    agents: [],
    olderExhausted: {},
    historyCursors: {},
    ui: {
      remoteFolderOpen: false,
      hostDialogOpen: false,
      workspacePreparing: false,
      runtimeLoading: false,
      sessionListLoading: false,
      sessionListError: null,
      historyLoading: false,
      historyError: null,
      sending: false,
      sendError: null,
      vcs: null,
      settingsOpen: false,
      paletteOpen: false,
      confirmDelete: null,
      toast: null,
    },
    rev: 0,
  };
}

class Store {
  state: AppState = initialState();
  client = new OpenCodeClient(this.state.prefs.endpoint);
  private listeners = new Set<() => void>();
  private streamAbort: AbortController | null = null;
  private globalAbort: AbortController | null = null;
  private activityDirectories = new Map<string, string>();
  private conversationAtBottom = true;
  private directoryGeneration = 0;
  private saveTimerQueued = false;
  private connectionGeneration = 0;
  private statusSequence = 0;
  private statusVersions = new Map<string, number>();
  private historyGeneration = 0;
  private hostGeneration = 0;
  private workspacePromise: Promise<boolean> | null = null;
  private queueArmed = new Set<string>();
  private queueLocks = new Set<string>();
  private accessChanging = false;
  private compactLocks = new Set<string>();
  private historyJournals = new Set<ServerEvent[]>();

  dispose(): void {
    this.connectionGeneration++;
    this.directoryGeneration++;
    this.streamAbort?.abort();
    this.globalAbort?.abort();
    this.queueArmed.clear();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): AppState => this.state;

  private mutate(
    patch: Partial<AppState> | ((s: AppState) => Partial<AppState>),
  ): void {
    const p = typeof patch === "function" ? patch(this.state) : patch;
    this.state = { ...this.state, ...p, rev: this.state.rev + 1 };
    if (p.sessions || p.archivedSessions) {
      const managed = new Set(this.state.prefs.projectlessDirectories ?? []);
      const index = new Map(
        (this.state.prefs.projectlessSessions ?? []).map((x) => [x.id, x]),
      );
      for (const x of [...(p.sessions ?? []), ...(p.archivedSessions ?? [])]) {
        if (managed.has(x.directory)) index.set(x.id, x);
      }
      this.state.prefs = {
        ...this.state.prefs,
        projectlessSessions: [...index.values()],
      };
      this.persistPrefs();
    }
    for (const l of this.listeners) l();
  }

  private patchUi(patch: Partial<UiState>): void {
    this.mutate((s) => ({ ui: { ...s.ui, ...patch } }));
  }

  persistPrefs(): void {
    if (this.saveTimerQueued) return;
    this.saveTimerQueued = true;
    queueMicrotask(() => {
      this.saveTimerQueued = false;
      savePrefs(this.state.prefs);
    });
  }

  // ---------- connection ----------

  private connectPromise: Promise<boolean> | null = null;

  /** Idempotent: concurrent calls (e.g. React StrictMode double-mount) share one attempt. */
  connect(endpoint?: string): Promise<boolean> {
    if (!endpoint && this.connectPromise) return this.connectPromise;
    const p = endpoint
      ? this.connectLocal(endpoint)
      : this.connectHost(this.state.prefs.activeHost ?? "local");
    if (!endpoint) {
      this.connectPromise = p;
      void p.finally(() => {
        if (this.connectPromise === p) this.connectPromise = null;
      });
    }
    return p;
  }

  currentHost(): RemoteHost | undefined {
    return this.state.prefs.remoteHosts?.find(
      (h) => h.id === this.state.prefs.activeHost,
    );
  }
  hostLabel(): string {
    return this.currentHost()?.name ?? "Этот компьютер";
  }
  async connectLocal(endpoint: string): Promise<boolean> {
    this.hostGeneration++;
    this.mutate((s) => ({
      prefs: { ...s.prefs, activeHost: "local", localEndpoint: endpoint },
    }));
    return this.doConnect(endpoint, endpoint);
  }
  async connectHost(id: string): Promise<boolean> {
    const request = ++this.hostGeneration;
    const host = this.state.prefs.remoteHosts?.find((h) => h.id === id);
    if (id !== "local" && !host) {
      this.patchUi({ toast: "Подключение не найдено." });
      return false;
    }
    this.connectionGeneration++;
    this.directoryGeneration++;
    this.streamAbort?.abort();
    this.globalAbort?.abort();
    this.queueArmed.clear();
    this.mutate((s) => ({
      prefs: {
        ...s.prefs,
        activeHost: id,
        localEndpoint:
          s.prefs.localEndpoint ??
          (s.prefs.workspaceKey?.startsWith("ssh:")
            ? DEFAULT_PREFS.endpoint
            : s.prefs.endpoint),
      },
      connection: {
        ...s.connection,
        phase: "connecting",
        error: null,
        streamState: "idle",
      },
      ui: { ...s.ui, sending: false, workspacePreparing: false },
    }));
    this.persistPrefs();
    try {
      const endpoint = host
        ? await connectSsh(host)
        : (this.state.prefs.localEndpoint ?? DEFAULT_PREFS.endpoint);
      if (request !== this.hostGeneration) return false;
      return await this.doConnect(endpoint, host ? remoteKey(host) : endpoint);
    } catch (e) {
      if (request === this.hostGeneration)
        this.mutate((s) => ({
          connection: {
            ...s.connection,
            phase: "disconnected",
            error: errText(e),
          },
        }));
      return false;
    }
  }
  saveRemoteHost(host: RemoteHost): void {
    if (!validRemote(host)) throw new Error("Некорректный SSH-адрес или порт.");
    this.mutate((s) => ({
      prefs: {
        ...s.prefs,
        remoteHosts: [
          ...(s.prefs.remoteHosts ?? []).filter((h) => h.id !== host.id),
          host,
        ],
      },
    }));
    this.persistPrefs();
  }
  removeRemoteHost(id: string): void {
    if (id === this.state.prefs.activeHost) return;
    this.mutate((s) => ({
      prefs: {
        ...s.prefs,
        remoteHosts: s.prefs.remoteHosts?.filter((h) => h.id !== id),
      },
    }));
    this.persistPrefs();
  }

  private async doConnect(
    endpoint?: string,
    workspaceKey?: string,
  ): Promise<boolean> {
    const requested =
      endpoint?.trim().replace(/\/+$/, "") ?? this.client.baseUrl;
    if (!isAllowedBaseUrl(requested)) {
      this.patchUi({
        toast:
          "Use a plain HTTP loopback origin, such as http://127.0.0.1:4096 (no path, credentials or query).",
      });
      return false;
    }
    this.queueArmed.clear();
    const gen = ++this.connectionGeneration;
    this.directoryGeneration++;
    this.streamAbort?.abort();
    this.streamAbort = null;
    this.globalAbort?.abort();
    this.globalAbort = null;
    const key = workspaceKey ?? requested;
    if (
      requested !== this.client.baseUrl ||
      key !== (this.state.prefs.workspaceKey ?? this.state.prefs.endpoint)
    ) {
      const prefs =
        key === (this.state.prefs.workspaceKey ?? this.state.prefs.endpoint)
          ? { ...this.state.prefs, endpoint: requested }
          : switchEndpointPrefs(this.state.prefs, requested, key);
      if (key !== (this.state.prefs.workspaceKey ?? this.state.prefs.endpoint))
        this.activityDirectories.clear();
      this.client = new OpenCodeClient(requested);
      this.mutate({
        prefs,
        directory: prefs.selectedDirectory,
        activeSessionId: null,
        projects: [],
        sessions: [],
        archivedSessions: [],
        statuses: {},
        activityStatuses: {},
        chat: emptyChatRoot(),
        providers: [],
        connectedProviderIds: [],
        agents: [],
        olderExhausted: {},
        historyCursors: {},
        configModel: null,
        compaction: {},
        configDefaultAgent: null,
      });
      this.patchUi({
        sending: false,
        sendError: null,
        historyError: null,
        vcs: null,
      });
      this.persistPrefs();
    }
    this.client.headers = hostHeaders(key);
    const client = this.client;
    this.mutate((s) => ({
      connection: {
        ...s.connection,
        phase: "connecting",
        streamState: "idle",
        error: null,
        endpoint: requested,
      },
    }));
    try {
      const health = await client.health();
      if (gen !== this.connectionGeneration) return false;
      if (!health.healthy) throw new Error("Server reports unhealthy");
      if (Number(health.version.split(".")[0]) !== 1)
        throw new Error(
          `OpenCode ${health.version}: this adapter is tested with 1.18.18.`,
        );
      this.mutate((s) => ({
        connection: {
          ...s.connection,
          phase: "connected",
          version: health.version,
          error: null,
        },
      }));
      await Promise.all([this.refreshProjects(), this.loadRuntimeMetadata()]);
      if (gen !== this.connectionGeneration) return false;
      if (this.state.directory)
        await this.setDirectory(this.state.directory, { restoreSession: true });
      else await this.setDirectory(null);
      if (gen !== this.connectionGeneration) return false;
      this.startGlobalStream(client, gen);
      return true;
    } catch (e) {
      if (gen === this.connectionGeneration)
        this.mutate((s) => ({
          connection: {
            ...s.connection,
            phase: "disconnected",
            version: null,
            error: errText(e),
          },
        }));
      return false;
    }
  }

  private async loadRuntimeMetadata(): Promise<void> {
    const gen = this.directoryGeneration,
      client = this.client,
      directory = this.state.directory;
    this.patchUi({ runtimeLoading: true });
    try {
      const [prov, agents, config] = await Promise.all([
        client.providers(undefined, directory),
        client.agents(undefined, directory),
        client.config(directory),
      ]);
      if (gen !== this.directoryGeneration || client !== this.client) return;
      this.mutate({
        providers: prov.all ?? [],
        connectedProviderIds: prov.connected ?? [],
        providerDefaults: prov.default ?? null,
        configDefaultAgent: config.default_agent ?? null,
        configModel: config.model ?? null,
        compaction: config.compaction ?? {},
        agents: (agents ?? []).filter((a) => !a.hidden),
      });
    } catch (e) {
      if (gen === this.directoryGeneration && client === this.client)
        this.patchUi({
          toast: `Could not load model/agent list: ${errText(e)}`,
        });
    } finally {
      if (gen === this.directoryGeneration && client === this.client)
        this.patchUi({ runtimeLoading: false });
    }
  }

  /** Primary (non-subagent) agents are the only ones selectable as the main conversation agent. */
  primaryAgentNames(): string[] {
    return this.state.agents
      .filter((a) => a.mode !== "subagent")
      .map((a) => a.name);
  }

  async retryConnection(): Promise<void> {
    await this.connect();
  }

  setEndpoint(endpoint: string): void {
    const normalized =
      this.client.baseUrl && endpoint === this.client.baseUrl
        ? endpoint
        : endpoint;
    this.mutate((s) => ({ prefs: { ...s.prefs, endpoint: normalized } }));
    this.persistPrefs();
  }

  // ---------- projects / directories ----------

  async refreshProjects(): Promise<void> {
    if (this.state.connection.phase !== "connected") return;
    try {
      const client = this.client,
        gen = this.connectionGeneration;
      const projects = await client.projects();
      if (client === this.client && gen === this.connectionGeneration)
        this.mutate({ projects });
    } catch (e) {
      this.patchUi({ toast: `Could not load projects: ${errText(e)}` });
    }
  }

  async addProjectDirectory(dir: string): Promise<void> {
    const trimmed = dir.trim();
    if (!trimmed) return;
    this.mutate((s) => ({
      prefs: {
        ...s.prefs,
        pinnedProjects: [
          ...new Set([...(s.prefs.pinnedProjects ?? []), trimmed]),
        ],
      },
      projects: [
        ...s.projects.filter((p) => p.worktree !== trimmed),
        { id: `local:${trimmed}`, worktree: trimmed, vcs: null, sandboxes: [] },
      ],
    }));
    await this.setDirectory(trimmed);
  }

  async setDirectory(
    directory: string | null,
    opts: { restoreSession?: boolean } = {},
  ): Promise<void> {
    const gen = ++this.directoryGeneration;
    this.listGeneration++; // in-flight list requests belong to the previous project
    this.streamAbort?.abort();
    this.streamAbort = null;
    this.mutate((s) => ({
      directory,
      sessions: [],
      archivedSessions: [],
      activeSessionId:
        directory && opts.restoreSession
          ? s.prefs.lastSessionByDir[directory] || null
          : null,
      statuses: {},
      prefs: {
        ...s.prefs,
        selectedDirectory: directory,
        newChatMode:
          !directory || this.isProjectlessDirectory(directory)
            ? "projectless"
            : "project",
      },
      ui: {
        ...s.ui,
        vcs: null,
        sessionListError: null,
        sendError: null,
        historyError: null,
        historyLoading: false,
        sessionListLoading: false,
      },
    }));
    this.persistPrefs();
    const metadata = this.loadRuntimeMetadata();
    if (!directory) {
      await metadata;
      return;
    }

    void this.client.vcs(directory).then((vcs) => {
      if (gen === this.directoryGeneration) this.patchUi({ vcs });
    });
    await Promise.all([this.refreshSessions(), metadata]);
    if (gen !== this.directoryGeneration) return;
    if (
      !opts.restoreSession &&
      !this.state.activeSessionId &&
      this.state.sessions.length > 0
    ) {
      // keep "new conversation" state by default; do not auto-open old sessions
    }
    this.startEventStream(directory, gen);
  }

  /**
   * Session list refresh. Uses its own request generation, never the project/stream
   * generation: a list refresh must not invalidate the live event stream (R1).
   */
  private listGeneration = 0;

  async refreshSessions(): Promise<void> {
    const directory = this.state.directory;
    const dirGen = this.directoryGeneration;
    if (!directory || this.state.connection.phase !== "connected") return;
    const myGen = ++this.listGeneration;
    const current = () =>
      myGen === this.listGeneration && dirGen === this.directoryGeneration;
    this.patchUi({ sessionListLoading: true, sessionListError: null });
    try {
      const [sessions, statuses] = await Promise.all([
        this.client.listSessions(directory),
        this.client.sessionStatuses(directory),
      ]);
      if (!current()) return;
      const visible = sessions.filter((s) => !s.parentID);
      for (const item of visible) this.activityDirectories.set(item.id, directory);
      for (const [id, status] of Object.entries(statuses))
        this.observeSessionStatus(id, status, directory);
      this.rememberChatListing(directory, visible);
      this.mutate({
        sessions: visible.filter((s) => !s.time.archived),
        archivedSessions: visible.filter((s) => s.time.archived),
        statuses,
      });
    } catch (e) {
      if (current()) this.patchUi({ sessionListError: errText(e) });
    } finally {
      if (current()) this.patchUi({ sessionListLoading: false });
    }
  }

  // ---------- session selection / history ----------

  async selectSession(sessionId: string | null): Promise<void> {
    if (sessionId === this.state.activeSessionId) {
      this.markReadIfViewing();
      return;
    }
    const directory = this.state.directory;
    this.mutate((s) => ({
      activeSessionId: sessionId,
      prefs: {
        ...s.prefs,
        lastSessionByDir: directory
          ? { ...s.prefs.lastSessionByDir, [directory]: sessionId ?? "" }
          : s.prefs.lastSessionByDir,
      },
    }));
    this.persistPrefs();
    if (!sessionId || !directory) return;
    if (!this.state.chat.sessions[sessionId]) {
      await this.loadHistory(sessionId, directory);
    }
    if (!this.state.ui.historyError) this.markReadIfViewing();
    void this.drainQueue();
  }

  async loadHistory(sessionId: string, directory: string): Promise<void> {
    const gen = this.directoryGeneration,
      request = ++this.historyGeneration;
    const journal: ServerEvent[] = [];
    this.historyJournals.add(journal);
    this.patchUi({ historyLoading: true, historyError: null });
    try {
      const { messages, before } = await this.client.messages(sessionId, {
        directory,
        limit: 200,
      });
      if (
        gen !== this.directoryGeneration ||
        this.state.activeSessionId !== sessionId ||
        request !== this.historyGeneration ||
        journal.length >= 20000
      )
        return;
      this.mutate((s) => {
        const chat: ChatRootState = {
          ...s.chat,
          sessions: { ...s.chat.sessions },
        };
        const previous = chat.sessions[sessionId];
        // Retain previously paginated history; replay post-request events over the snapshot.
        applyHistory(chat, sessionId, messages);
        if (previous && messages.length) {
          const first = messages[0].info.id;
          prependHistory(
            chat,
            sessionId,
            previous.messageOrder
              .filter((id) => id < first)
              .map((id) => ({
                info: previous.messages[id],
                parts: (previous.partsByMessage[id] ?? []).map(
                  (p) => previous.parts[p],
                ),
              })),
          );
        }
        reconcileHistoryEvents(chat, sessionId, previous, journal);
        return {
          chat,
          historyCursors: {
            ...s.historyCursors,
            [sessionId]:
              previous && previous.messageOrder.length > messages.length
                ? s.historyCursors[sessionId]
                : (before ?? null),
          },
          olderExhausted: {
            ...s.olderExhausted,
            [sessionId]:
              previous && previous.messageOrder.length > messages.length
                ? s.olderExhausted[sessionId]
                : !before,
          },
        };
      });
    } catch (e) {
      if (
        gen === this.directoryGeneration &&
        request === this.historyGeneration
      )
        this.patchUi({ historyError: errText(e) });
    } finally {
      this.historyJournals.delete(journal);
      if (
        gen === this.directoryGeneration &&
        request === this.historyGeneration
      )
        this.patchUi({ historyLoading: false });
    }
  }

  isProjectlessDirectory(dir: string): boolean {
    const root = this.state.prefs.projectlessRoot;
    return (
      (this.state.prefs.projectlessDirectories ?? []).includes(dir) ||
      (!!root && (dir === root || dir.startsWith(root + "/")))
    );
  }
  isProjectless(): boolean {
    return (
      !this.state.directory || this.isProjectlessDirectory(this.state.directory)
    );
  }
  projectDirectories(): string[] {
    return [
      ...new Set([
        ...this.state.projects.map((p) => p.worktree),
        ...(this.state.prefs.pinnedProjects ?? []),
        ...(this.state.directory ? [this.state.directory] : []),
      ]),
    ].filter((p) => p && p !== "/" && !this.isProjectlessDirectory(p));
  }
  chatSessions(archived = false): Session[] {
    return (this.state.prefs.projectlessSessions ?? [])
      .filter((x) => Boolean(x.time.archived) === archived)
      .sort((a, b) => b.time.updated - a.time.updated);
  }
  async openChat(session: Session): Promise<void> {
    if (session.directory !== this.state.directory)
      await this.setDirectory(session.directory);
    // setDirectory may have been superseded by a user's later selection.
    if (this.state.directory === session.directory)
      await this.selectSession(session.id);
  }
  private rememberChatListing(directory: string, sessions: Session[]): void {
    if (!this.isProjectlessDirectory(directory)) return;
    this.mutate((s) => ({
      prefs: {
        ...s.prefs,
        projectlessSessions: [
          ...(s.prefs.projectlessSessions ?? []).filter(
            (x) => x.directory !== directory,
          ),
          ...sessions,
        ],
      },
    }));
    this.persistPrefs();
  }
  async ensureChatWorkspace(): Promise<boolean> {
    if (this.state.connection.phase !== "connected") return false;
    if (this.state.directory) return true;
    if (this.workspacePromise) return this.workspacePromise;
    const gen = this.directoryGeneration,
      client = this.client,
      host = this.currentHost();
    this.patchUi({ workspacePreparing: true, sendError: null });
    const p = (async () => {
      try {
        const paths = await client.paths();
        if (gen !== this.directoryGeneration || client !== this.client)
          return false;
        const workspace = await prepareChat(host, paths.home);
        if (gen !== this.directoryGeneration || client !== this.client)
          return false;
        const draft = this.getDraft();
        this.mutate((s) => ({
          prefs: {
            ...s.prefs,
            projectlessRoot: workspace.root,
            projectlessDirectories: [
              ...new Set([
                ...(s.prefs.projectlessDirectories ?? []),
                workspace.directory,
              ]),
            ],
            drafts: {
              ...s.prefs.drafts,
              [draftKey(null, workspace.directory)]: draft,
            },
          },
        }));
        const nextGen = this.directoryGeneration + 1;
        await this.setDirectory(workspace.directory);
        return nextGen === this.directoryGeneration && client === this.client;
      } catch (e) {
        if (gen === this.directoryGeneration && client === this.client)
          this.patchUi({ sendError: errText(e) });
        return false;
      } finally {
        if (client === this.client) this.patchUi({ workspacePreparing: false });
      }
    })();
    this.workspacePromise = p;
    try {
      return await p;
    } finally {
      if (this.workspacePromise === p) this.workspacePromise = null;
    }
  }

  async newSession(): Promise<void> {
    // Composer targets the "new conversation" slot; the session is created lazily on first send.
    await this.setDirectory(null);
  }

  async createSessionNow(title?: string): Promise<Session | null> {
    const directory = this.state.directory;
    if (!directory) return null;
    const gen = this.directoryGeneration;
    const endpoint = this.client.baseUrl;
    const choice = this.getModelChoice();
    try {
      const session = await this.client.createSession({
        directory,
        title,
        agent: this.getAgentChoice() ?? undefined,
        model: choice
          ? {
              id: choice.modelID,
              providerID: choice.providerID,
              variant: choice.variant ?? undefined,
            }
          : undefined,
      });
      // Identity guard: the session belongs to the project it was requested for. If the
      // user already switched projects, never inject/select it here (R3).
      if (
        gen !== this.directoryGeneration ||
        this.state.directory !== directory ||
        this.client.baseUrl !== endpoint
      ) {
        return session;
      }
      this.mutate((s) => ({
        sessions: [session, ...s.sessions.filter((x) => x.id !== session.id)],
      }));
      await this.selectSession(session.id);
      return session;
    } catch (e) {
      if (gen === this.directoryGeneration)
        this.patchUi({ toast: `Could not create session: ${errText(e)}` });
      return null;
    }
  }

  async renameSession(session: Session, title: string): Promise<void> {
    const gen = this.directoryGeneration;
    try {
      const updated = await this.client.updateSession(
        session.id,
        { title },
        session.directory,
      );
      if (gen !== this.directoryGeneration) return;
      this.mutate((s) => ({
        sessions: s.sessions.map((x) => (x.id === updated.id ? updated : x)),
        prefs: {
          ...s.prefs,
          projectlessSessions: s.prefs.projectlessSessions?.map((x) =>
            x.id === updated.id ? updated : x,
          ),
        },
      }));
    } catch (e) {
      if (gen !== this.directoryGeneration) return;
      this.patchUi({ toast: `Rename failed: ${errText(e)}` });
    }
  }

  async archiveSession(session: Session): Promise<void> {
    const gen = this.directoryGeneration;
    try {
      const updated = await this.client.updateSession(
        session.id,
        { time: { archived: Date.now() } },
        session.directory,
      );
      if (gen !== this.directoryGeneration) return;
      this.clearUnread(session.id);
      this.mutate((s) => ({
        sessions: s.sessions.filter((x) => x.id !== session.id),
        archivedSessions:
          updated.directory === s.directory
            ? [
                updated,
                ...s.archivedSessions.filter((x) => x.id !== session.id),
              ]
            : s.archivedSessions,
        activeSessionId:
          s.activeSessionId === session.id ? null : s.activeSessionId,
        prefs: {
          ...s.prefs,
          projectlessSessions: s.prefs.projectlessSessions?.map((x) =>
            x.id === updated.id ? updated : x,
          ),
          lastSessionByDir:
            s.directory && s.prefs.lastSessionByDir[s.directory] === session.id
              ? { ...s.prefs.lastSessionByDir, [s.directory]: "" }
              : s.prefs.lastSessionByDir,
        },
      }));
      this.persistPrefs();
      this.patchUi({ toast: "Session archived" });
    } catch (e) {
      if (gen !== this.directoryGeneration) return;
      this.patchUi({ toast: `Archive failed: ${errText(e)}` });
    }
  }

  async unarchiveSession(session: Session): Promise<void> {
    const gen = this.directoryGeneration;
    try {
      const updated = await this.client.updateSession(
        session.id,
        { time: { archived: 0 } },
        session.directory,
      );
      if (gen !== this.directoryGeneration) return;
      this.mutate((s) => ({
        archivedSessions: s.archivedSessions.filter((x) => x.id !== session.id),
        prefs: {
          ...s.prefs,
          projectlessSessions: s.prefs.projectlessSessions?.map((x) =>
            x.id === updated.id
              ? { ...updated, time: { ...updated.time, archived: undefined } }
              : x,
          ),
        },
        sessions:
          updated.directory !== s.directory ||
          s.sessions.some((x) => x.id === session.id)
            ? s.sessions
            : [
                { ...updated, time: { ...updated.time, archived: undefined } },
                ...s.sessions,
              ],
      }));
      this.patchUi({ toast: "Session restored" });
    } catch (e) {
      if (gen !== this.directoryGeneration) return;
      this.patchUi({ toast: `Restore failed: ${errText(e)}` });
    }
  }

  async deleteSession(session: Session): Promise<void> {
    const gen = this.directoryGeneration;
    try {
      await this.client.deleteSession(session.id, session.directory);
      if (gen !== this.directoryGeneration) return;
      this.forgetActivity(session.id);
      this.mutate((s) => ({
        sessions: s.sessions.filter((x) => x.id !== session.id),
        archivedSessions: s.archivedSessions.filter((x) => x.id !== session.id),
        activeSessionId:
          s.activeSessionId === session.id ? null : s.activeSessionId,
        ui: { ...s.ui, confirmDelete: null },
        prefs: {
          ...s.prefs,
          projectlessSessions: s.prefs.projectlessSessions?.filter(
            (x) => x.id !== session.id,
          ),
          lastSessionByDir:
            s.directory && s.prefs.lastSessionByDir[s.directory] === session.id
              ? { ...s.prefs.lastSessionByDir, [s.directory]: "" }
              : s.prefs.lastSessionByDir,
        },
      }));
      this.persistPrefs();
      this.patchUi({ toast: "Session deleted permanently" });
    } catch (e) {
      if (gen !== this.directoryGeneration) return;
      this.patchUi({ toast: `Delete failed: ${errText(e)}` });
    }
  }

  // ---------- model / agent selection ----------

  getModelChoice(): {
    providerID: string;
    modelID: string;
    variant?: string | null;
  } | null {
    const dir = this.isProjectless() ? "@chats" : (this.state.directory ?? "");
    const sessionId = this.state.activeSessionId;
    const sessionChoice = sessionId
      ? this.state.prefs.modelChoice[`session:${sessionId}`]
      : undefined;
    if (sessionChoice && this.state.connectedProviderIds.includes(sessionChoice.providerID))
      return sessionChoice;
    const active = sessionId
      ? this.state.sessions.find((s) => s.id === sessionId)?.model
      : undefined;
    if (active?.id && this.state.connectedProviderIds.includes(active.providerID)) {
      return {
        providerID: active.providerID,
        modelID: active.id,
        variant: active.variant ?? null,
      };
    }
    const stored =
      this.state.prefs.modelChoice[dir] ?? this.state.prefs.modelChoice["*"];
    if (stored && this.state.connectedProviderIds.includes(stored.providerID))
      return stored;
    const agent = this.state.agents.find(
      (a) => a.name === this.getAgentChoice(),
    );
    if (
      agent?.model &&
      this.state.connectedProviderIds.includes(agent.model.providerID)
    ) {
      return {
        ...agent.model,
        variant:
          agent.variant ??
          this.defaultVariant(agent.model.providerID, agent.model.modelID),
      };
    }
    const configured = this.state.configModel?.split("/");
    if (
      configured &&
      configured.length > 1 &&
      this.state.connectedProviderIds.includes(configured[0])
    ) {
      return {
        providerID: configured[0],
        modelID: configured.slice(1).join("/"),
        variant: this.defaultVariant(
          configured[0],
          configured.slice(1).join("/"),
        ),
      };
    }
    const defaults = this.state.providerDefaults;
    if (defaults) {
      for (const [pid, mid] of Object.entries(defaults)) {
        if (this.state.connectedProviderIds.includes(pid))
          return {
            providerID: pid,
            modelID: mid,
            variant: this.defaultVariant(pid, mid),
          };
      }
    }
    for (const pid of this.state.connectedProviderIds) {
      const provider = this.state.providers.find((p) => p.id === pid);
      const first = provider && Object.values(provider.models)[0];
      if (first)
        return {
          providerID: pid,
          modelID: first.id,
          variant: this.defaultVariant(pid, first.id),
        };
    }
    return null;
  }

  private defaultVariant(providerID: string, modelID: string): string | null {
    return this.modelInfo(providerID, modelID)?.variants?.medium
      ? "medium"
      : null;
  }

  setModelChoice(
    providerID: string,
    modelID: string,
    variant?: string | null,
  ): void {
    const dir = this.isProjectless() ? "@chats" : (this.state.directory ?? "");
    const key = this.state.activeSessionId
      ? `session:${this.state.activeSessionId}`
      : dir || "*";
    this.mutate((s) => ({
      prefs: {
        ...s.prefs,
        modelChoice: {
          ...s.prefs.modelChoice,
          [key]: { providerID, modelID, variant: variant ?? null },
        },
      },
    }));
    this.persistPrefs();
  }

  /** Explicit selection in this session wins, without changing other sessions. */
  getAgentChoice(): string | null {
    const dir = this.isProjectless() ? "@chats" : (this.state.directory ?? "*");
    const sessionId = this.state.activeSessionId;
    if (sessionId) {
      const selected = this.state.prefs.agentChoice[`session:${sessionId}`];
      if (selected) return selected;
      const active = this.state.sessions.find((s) => s.id === sessionId)?.agent;
      if (active) return active;
    }
    const explicit =
      this.state.prefs.agentChoice[dir] ?? this.state.prefs.agentChoice["*"];
    if (explicit) return explicit;
    if (this.state.configDefaultAgent) return this.state.configDefaultAgent;
    return this.primaryAgentNames()[0] ?? null;
  }

  setAgentOverride(dir: string, name: string): void {
    const key = this.state.activeSessionId
      ? `session:${this.state.activeSessionId}`
      : this.isProjectless() ? "@chats" : dir || "*";
    this.mutate((s) => ({
      prefs: {
        ...s.prefs,
        agentChoice: { ...s.prefs.agentChoice, [key]: name },
      },
    }));
    this.persistPrefs();
  }

  connectedProvidersWithModels(): ProviderInfo[] {
    return this.state.providers.filter((p) =>
      this.state.connectedProviderIds.includes(p.id),
    );
  }

  modelInfo(providerID: string, modelID: string): ModelInfo | null {
    return (
      this.state.providers.find((p) => p.id === providerID)?.models[modelID] ??
      null
    );
  }

  // ---------- drafts ----------

  getDraft(): string {
    return (
      this.state.prefs.drafts[
        draftKey(this.state.activeSessionId, this.state.directory)
      ] ?? ""
    );
  }

  setDraft(text: string): void {
    const key = draftKey(this.state.activeSessionId, this.state.directory);
    this.mutate((s) => ({
      prefs: { ...s.prefs, drafts: { ...s.prefs.drafts, [key]: text } },
    }));
    this.persistPrefs();
  }

  // ---------- execution ----------

  async sendPrompt(text: string): Promise<boolean> {
    if (
      this.state.connection.phase !== "connected" ||
      !text.trim() ||
      this.state.ui.sending ||
      this.state.ui.workspacePreparing ||
      this.state.ui.runtimeLoading
    )
      return false;
    if (!this.state.directory && !(await this.ensureChatWorkspace()))
      return false;
    const directory = this.state.directory;
    if (
      !directory ||
      !text.trim() ||
      this.state.ui.sending ||
      this.accessChanging
    )
      return false;
    // Capture the full request identity before any await: it must never be re-read after
    // the user switched project/session mid-flight (R3), and the draft slot is revision-bound (R5).
    const gen = this.directoryGeneration;
    const endpoint = this.client.baseUrl;
    const client = this.client;
    const selected = this.state.activeSessionId;
    const sentAtStatus = this.statusSequence;
    const status = selected ? this.activityStatus(selected) : null;
    if (status?.type === "busy" || status?.type === "retry") return false;
    const slotKey = draftKey(this.state.activeSessionId, directory);
    const model = this.getModelChoice();
    if (!model) {
      this.patchUi({
        sendError:
          "No connected model is available. Check provider configuration in OpenCode.",
      });
      return false;
    }
    const agent = this.getAgentChoice();
    const trimmed = text.trim();
    const sameContext = () =>
      gen === this.directoryGeneration &&
      this.state.directory === directory &&
      this.client.baseUrl === endpoint;
    this.patchUi({ sending: true, sendError: null });
    let sessionId = this.state.activeSessionId;
    try {
      if (!sessionId) {
        const created = await client.createSession({
          directory,
          permission: accessRules(this.state.prefs.newAccess ?? "inherit"),
          title: trimmed.slice(0, 60),
          agent: agent ?? undefined,
          model: {
            id: model.modelID,
            providerID: model.providerID,
            variant: model.variant ?? undefined,
          },
        });
        if (!sameContext() || this.state.activeSessionId !== selected)
          return false; // selection changed during creation
        sessionId = created.id;
        this.mutate((s) => ({
          sessions: [created, ...s.sessions.filter((x) => x.id !== created.id)],
          activeSessionId: created.id,
          prefs: {
            ...s.prefs,
            lastSessionByDir: {
              ...s.prefs.lastSessionByDir,
              [directory]: created.id,
            },
          },
        }));
        this.persistPrefs();
      }
      const target = sessionId;
      await client.prompt(target, directory, {
        model: { providerID: model.providerID, modelID: model.modelID },
        agent: agent ?? undefined,
        variant: model.variant ?? undefined,
        parts: [{ type: "text", text: trimmed }],
      });
      if (!sameContext()) return true;
      // Accepted: clear only the exact draft revision we submitted, in its original slot.
      // Anything typed while awaiting acknowledgement stays untouched (R5).
      this.mutate((s) => {
        const drafts = { ...s.prefs.drafts };
        if (drafts[slotKey] === text) delete drafts[slotKey];
        if (
          this.isProjectlessDirectory(directory) &&
          drafts[draftKey(null, null)] === text
        )
          delete drafts[draftKey(null, null)];
        const prev = s.chat.sessions[target] ?? emptySessionChat();
        const chat: ChatRootState = {
          ...s.chat,
          sessions: {
            ...s.chat.sessions,
            [target]: {
              ...prev,
              status:
                (this.statusVersions.get(target) ?? 0) > sentAtStatus
                  ? prev.status
                  : { type: "busy" },
            },
          },
        };
        return { prefs: { ...s.prefs, drafts }, chat };
      });
      this.persistPrefs();
      return true;
    } catch (e) {
      // Ambiguous outcome: never auto-resend. The draft was never cleared, so the user decides.
      if (sameContext()) this.patchUi({ sendError: errText(e) });
      return false;
    } finally {
      if (this.client === client) {
        this.patchUi({ sending: false });
        void this.drainQueue();
      }
    }
  }

  /** Pagination uses the server-provided opaque X-Next-Cursor, never a message ID. */
  async loadOlderMessages(sessionId: string): Promise<void> {
    const directory = this.state.directory;
    if (!directory || this.state.ui.historyLoading) return;
    const cursor = this.state.historyCursors[sessionId];
    if (!cursor) return;
    const gen = this.directoryGeneration;
    this.patchUi({ historyLoading: true, historyError: null });
    try {
      const { messages, before } = await this.client.messages(sessionId, {
        directory,
        limit: 200,
        before: cursor,
      });
      if (
        gen !== this.directoryGeneration ||
        this.state.activeSessionId !== sessionId
      )
        return;
      this.mutate((s) => {
        const chat: ChatRootState = {
          ...s.chat,
          sessions: { ...s.chat.sessions },
        };
        prependHistory(chat, sessionId, messages);
        return {
          chat,
          historyCursors: { ...s.historyCursors, [sessionId]: before ?? null },
          olderExhausted: {
            ...s.olderExhausted,
            [sessionId]: !before || before === cursor,
          },
        };
      });
    } catch (e) {
      if (gen === this.directoryGeneration)
        this.patchUi({ historyError: errText(e) });
    } finally {
      if (gen === this.directoryGeneration)
        this.patchUi({ historyLoading: false });
    }
  }

  /** Remembers which shell this app created per project, so we never hijack a foreign PTY. */
  setPtyId(directory: string, id: string | null): void {
    this.mutate((s) => {
      const ptyIds = { ...s.prefs.ptyIds };
      if (id) ptyIds[directory] = id;
      else delete ptyIds[directory];
      return { prefs: { ...s.prefs, ptyIds } };
    });
    this.persistPrefs();
  }

  async stopSession(sessionId: string): Promise<void> {
    this.queueArmed.delete(sessionId);
    const directory = this.state.directory;
    if (!directory) return;
    try {
      await this.client.abort(sessionId, directory);
    } catch (e) {
      this.patchUi({ toast: `Stop failed: ${errText(e)}` });
    }
  }

  async compactSession(sessionId: string): Promise<void> {
    const directory = this.state.directory;
    const model = this.getModelChoice();
    if (
      !directory ||
      !model ||
      this.isRunning(sessionId) ||
      this.compactLocks.has(sessionId)
    )
      return;
    this.compactLocks.add(sessionId);
    try {
      await this.client.summarize(
        sessionId,
        directory,
        model.providerID,
        model.modelID,
      );
      this.patchUi({ toast: "Compaction requested" });
    } catch (e) {
      this.patchUi({ toast: `Compaction failed: ${errText(e)}` });
    } finally {
      this.compactLocks.delete(sessionId);
    }
  }

  isRunning(id = this.state.activeSessionId): boolean {
    const status = id ? this.activityStatus(id) : null;
    return status?.type === "busy" || status?.type === "retry";
  }

  contextInfo() {
    const choice = this.getModelChoice();
    const chat = this.state.activeSessionId
      ? this.state.chat.sessions[this.state.activeSessionId]
      : undefined;
    return contextUsage(
      chat,
      choice && this.modelInfo(choice.providerID, choice.modelID),
      this.state.compaction,
    );
  }

  getAccessMode() {
    const session = this.state.sessions.find(
      (x) => x.id === this.state.activeSessionId,
    );
    return session
      ? accessMode(session.permission)
      : (this.state.prefs.newAccess ?? "inherit");
  }
  async setAccessMode(mode: AccessMode) {
    if (this.isRunning() || this.state.ui.sending || this.accessChanging)
      return;
    const id = this.state.activeSessionId,
      directory = this.state.directory,
      client = this.client;
    if (!id) {
      this.mutate((s) => ({ prefs: { ...s.prefs, newAccess: mode } }));
      this.persistPrefs();
      return;
    }
    this.accessChanging = true;
    try {
      const updated = await client.updateSession(
        id,
        { permission: accessRules(mode) },
        directory,
      );
      if (client === this.client && directory === this.state.directory)
        this.mutate((s) => ({
          sessions: s.sessions.map((x) => (x.id === id ? updated : x)),
        }));
    } catch (e) {
      this.patchUi({ toast: `Не удалось изменить доступ: ${errText(e)}` });
    } finally {
      this.accessChanging = false;
    }
  }

  setAsr(settings: AsrSettings) {
    this.mutate((s) => ({ prefs: { ...s.prefs, asr: settings } }));
    this.persistPrefs();
  }
  /** Dictation is bound to its original draft even if navigation occurs meanwhile. */
  appendDictation(endpoint: string, key: string, text: string) {
    if (!text.trim()) return;
    this.mutate((s) => {
      if (s.prefs.endpoint === endpoint)
        return {
          prefs: {
            ...s.prefs,
            drafts: {
              ...s.prefs.drafts,
              [key]: [s.prefs.drafts[key], text].filter(Boolean).join(" "),
            },
          },
        };
      const old = s.prefs.endpointState?.[endpoint];
      return {
        prefs: {
          ...s.prefs,
          endpointState: {
            ...s.prefs.endpointState,
            [endpoint]: {
              ...old,
              drafts: {
                ...old?.drafts,
                [key]: [old?.drafts?.[key], text].filter(Boolean).join(" "),
              },
            },
          },
        },
      };
    });
    this.persistPrefs();
  }

  getQueue(id = this.state.activeSessionId): QueuedPrompt[] {
    return id ? (this.state.prefs.queues?.[id] ?? []) : [];
  }
  isQueueArmed(id = this.state.activeSessionId) {
    return !!id && this.queueArmed.has(id);
  }
  private writeQueue(id: string, list: QueuedPrompt[]) {
    this.mutate((s) => ({
      prefs: { ...s.prefs, queues: { ...s.prefs.queues, [id]: list } },
    }));
    this.persistPrefs();
  }
  enqueuePrompt(text: string): boolean {
    const id = this.state.activeSessionId,
      directory = this.state.directory,
      model = this.getModelChoice();
    if (
      !id ||
      !directory ||
      !model ||
      !text.trim() ||
      this.getQueue(id).length >= 20
    )
      return false;
    const item: QueuedPrompt = {
      id: newMessageId(),
      text: text.trim(),
      sessionID: id,
      directory,
      model: { ...model },
      agent: this.getAgentChoice() ?? undefined,
      state: "ready",
    };
    this.writeQueue(id, [...this.getQueue(id), item]);
    this.queueArmed.add(id);
    if (this.getDraft() === text) this.setDraft("");
    void this.drainQueue();
    return true;
  }
  removeQueued(id: string) {
    const sid = this.state.activeSessionId;
    if (!sid || this.queueLocks.has(sid)) return;
    this.writeQueue(
      sid,
      this.getQueue(sid).filter((x) => x.id !== id),
    );
  }
  editQueued(id: string) {
    const item = this.getQueue().find((x) => x.id === id);
    if (
      !item ||
      item.state !== "ready" ||
      this.getDraft().trim() ||
      this.queueLocks.has(item.sessionID)
    )
      return;
    this.setDraft(item.text);
    this.removeQueued(id);
  }
  resumeQueue() {
    const sid = this.state.activeSessionId;
    if (!sid) return;
    this.queueArmed.add(sid);
    this.patchUi({ sendError: null });
    void this.drainQueue(true);
  }
  private async drainQueue(explicit = false) {
    const sid = this.state.activeSessionId;
    if (
      !sid ||
      !this.queueArmed.has(sid) ||
      this.isRunning(sid) ||
      this.state.ui.sending ||
      this.queueLocks.has(sid) ||
      this.compactLocks.has(sid)
    )
      return;
    if (
      this.state.connection.phase !== "connected" ||
      this.state.connection.streamState !== "open"
    )
      return;
    if (!explicit && this.state.chat.sessions[sid]?.lastError) {
      this.queueArmed.delete(sid);
      return;
    }
    const pending = this.pendingInteraction(sid);
    if (pending.permissions.length || pending.questions.length) return;
    const item = this.getQueue(sid)[0];
    if (
      !item ||
      item.state !== "ready" ||
      item.directory !== this.state.directory
    )
      return;
    await this.dispatchQueued(item, false);
  }
  async steerQueued(id: string) {
    const item = this.getQueue().find((x) => x.id === id);
    if (!item || item.state !== "ready") return;
    await this.dispatchQueued(item, true);
  }
  private async dispatchQueued(item: QueuedPrompt, steer: boolean) {
    const sid = item.sessionID,
      client = this.client,
      endpoint = client.baseUrl;
    if (
      this.queueLocks.has(sid) ||
      this.state.ui.sending ||
      this.accessChanging ||
      sid !== this.state.activeSessionId ||
      this.state.directory !== item.directory ||
      this.state.connection.phase !== "connected"
    )
      return;
    if (!steer && this.isRunning(sid)) return;
    const pending = this.pendingInteraction(sid);
    if (pending.permissions.length || pending.questions.length) {
      this.patchUi({ toast: "Сначала ответьте на запрос агента." });
      return;
    }
    this.queueLocks.add(sid);
    this.writeQueue(
      sid,
      this.getQueue(sid).map((x) =>
        x.id === item.id ? { ...x, state: "sending" } : x,
      ),
    );
    savePrefs(this.state.prefs);
    flushPrefs(); // persist sending before the network side effect
    const seq = this.statusSequence;
    try {
      // OpenCode persists a new user message, then joins the existing run loop.
      // No abort: the correction is seen at the next model/tool boundary.
      await client.prompt(sid, item.directory, {
        messageID: newMessageId(),
        model: {
          providerID: item.model.providerID,
          modelID: item.model.modelID,
        },
        agent: item.agent,
        variant: item.model.variant ?? undefined,
        parts: [{ type: "text", text: item.text }],
      });
      if (client !== this.client) return;
      this.writeQueue(
        sid,
        this.getQueue(sid).filter((x) => x.id !== item.id),
      );
      if ((this.statusVersions.get(sid) ?? 0) <= seq) {
        const prev = this.state.chat.sessions[sid] ?? emptySessionChat();
        this.mutate((s) => ({
          chat: {
            ...s.chat,
            sessions: {
              ...s.chat.sessions,
              [sid]: { ...prev, status: { type: "busy" } },
            },
          },
        }));
      }
      if (steer)
        this.patchUi({
          toast:
            "Уточнение передано OpenCode. Агент учтёт его на следующем шаге.",
        });
    } catch (e) {
      this.queueArmed.delete(sid);
      // Persist an ambiguous outcome; NEVER automatically retry and execute it twice.
      if (client === this.client)
        this.writeQueue(
          sid,
          this.getQueue(sid).map((x) =>
            x.id === item.id
              ? { ...x, state: "uncertain", error: errText(e) }
              : x,
          ),
        );
    } finally {
      this.queueLocks.delete(sid);
      if (client === this.client && endpoint === this.state.prefs.endpoint)
        void this.drainQueue();
    }
  }

  // ---------- interaction ----------

  async replyPermission(
    req: PermissionRequest,
    reply: "once" | "always" | "reject",
  ): Promise<void> {
    const directory = this.state.directory;
    if (!directory) return;
    try {
      await this.client.replyPermission(req.id, reply, directory);
      this.mutate((s) => {
        const permissions = { ...s.chat.permissions };
        delete permissions[req.id];
        return { chat: { ...s.chat, permissions } };
      });
    } catch (e) {
      this.patchUi({ toast: `Permission reply failed: ${errText(e)}` });
    }
  }

  async replyQuestion(
    req: QuestionRequest,
    answers: string[][],
  ): Promise<void> {
    const directory = this.state.directory;
    if (!directory) return;
    try {
      await this.client.replyQuestion(req.id, answers, directory);
      this.mutate((s) => {
        const questions = { ...s.chat.questions };
        delete questions[req.id];
        return { chat: { ...s.chat, questions } };
      });
    } catch (e) {
      this.patchUi({ toast: `Answer failed: ${errText(e)}` });
    }
  }

  async rejectQuestion(req: QuestionRequest): Promise<void> {
    const directory = this.state.directory;
    if (!directory) return;
    try {
      await this.client.rejectQuestion(req.id, directory);
      this.mutate((s) => {
        const questions = { ...s.chat.questions };
        delete questions[req.id];
        return { chat: { ...s.chat, questions } };
      });
    } catch (e) {
      this.patchUi({ toast: `Reject failed: ${errText(e)}` });
    }
  }

  // ---------- event stream ----------

  private startEventStream(directory: string, gen: number): void {
    const ctrl = new AbortController();
    this.streamAbort = ctrl;
    void runEventStream({
      url: eventStreamUrl(this.client.baseUrl, directory),
      headers: this.client.headers,
      signal: ctrl.signal,
      onEvent: (event: ServerEvent) => {
        if (gen !== this.directoryGeneration) return; // stale project events must not leak
        this.handleEvent(event);
      },
      onState: (state, detail) => {
        if (gen !== this.directoryGeneration) return;
        this.mutate((s) => ({
          connection: {
            ...s.connection,
            streamState: state === "closed" ? "closed" : state,
          },
        }));
        if (state === "open") void this.resyncAfterReconnect(directory, gen);
        if (state === "error" && detail) {
          // Keep chat; report transport trouble without claiming the model is dead.
        }
      },
    });
  }

  private async resyncAfterReconnect(
    directory: string,
    gen: number,
  ): Promise<void> {
    const journal: ServerEvent[] = [];
    this.historyJournals.add(journal);
    try {
      const [sessions, statuses, permissions, questions] = await Promise.all([
        this.client.listSessions(directory),
        this.client.sessionStatuses(directory),
        this.client.pendingPermissions(directory),
        this.client.pendingQuestions(directory),
      ]);
      if (gen !== this.directoryGeneration || journal.length >= 20000) return;
      const visible = sessions.filter((s) => !s.parentID);
      for (const item of visible) this.activityDirectories.set(item.id, directory);
      for (const [id, status] of Object.entries(statuses))
        this.observeSessionStatus(id, status, directory);
      this.rememberChatListing(directory, visible);
      this.mutate((s) => {
        // Authoritative reconciliation (R4): the server's status list replaces any
        // locally accumulated busy state; sessions absent from it are idle again.
        const chatSessions: ChatRootState["sessions"] = { ...s.chat.sessions };
        for (const id of Object.keys(chatSessions)) {
          chatSessions[id] = {
            ...chatSessions[id],
            status: statuses[id] ?? { type: "idle" },
          };
        }
        for (const [id, status] of Object.entries(statuses)) {
          if (!chatSessions[id])
            chatSessions[id] = { ...emptySessionChat(), status };
        }
        const chat: ChatRootState = {
          ...s.chat,
          sessions: chatSessions,
          permissions: Object.fromEntries(permissions.map((p) => [p.id, p])),
          questions: Object.fromEntries(questions.map((q) => [q.id, q])),
        };
        for (const event of journal) {
          if (
            event.type === "session.status" ||
            event.type.startsWith("permission.") ||
            event.type.startsWith("question.")
          )
            reduceEvent(chat, { ...event, id: undefined });
        }
        return {
          sessions: visible.filter((x) => !x.time.archived),
          archivedSessions: visible.filter((x) => x.time.archived),
          ui: { ...s.ui, sessionListError: null },
          statuses,
          chat,
        };
      });
      this.historyJournals.delete(journal);
      const active = this.state.activeSessionId;
      if (active) await this.loadHistory(active, directory);
      void this.drainQueue();
    } catch {
      /* stream state will retry */
    } finally {
      this.historyJournals.delete(journal);
    }
  }

  private handleEvent(event: ServerEvent): void {
    if ((event.type === "session.status" || event.type === "session.idle" || event.type === "session.error") &&
        typeof event.properties?.sessionID === "string") {
      this.observeSessionStatus(
        event.properties.sessionID,
        event.type === "session.status"
          ? ((event.properties.status as SessionStatus) ?? { type: "idle" })
          : { type: "idle" },
        this.state.directory ?? undefined,
      );
    }
    if (
      event.type === "session.status" &&
      typeof event.properties?.sessionID === "string"
    )
      this.statusVersions.set(
        event.properties.sessionID,
        ++this.statusSequence,
      );
    for (const journal of this.historyJournals)
      if (journal.length < 20000) journal.push(event);
    if (event.type === "session.updated" && event.properties?.info) {
      const info = event.properties.info as Session;
      this.mutate((s) => {
        const merged = s.sessions.some((x) => x.id === info.id)
          ? s.sessions.map((x) => (x.id === info.id ? { ...x, ...info } : x))
          : s.sessions;
        // keep the archived/live split consistent when the flag arrives via event
        return info.time?.archived
          ? { sessions: merged.filter((x) => x.id !== info.id) }
          : { sessions: merged };
      });
    }
    if (event.type === "session.created" || event.type === "session.deleted") {
      // List refresh only — must never touch the project/stream generation (R1).
      void this.refreshSessions();
      return;
    }
    const affected =
      typeof event.properties?.sessionID === "string"
        ? event.properties.sessionID
        : undefined;
    const info =
      event.type === "message.updated"
        ? (event.properties?.info as { sessionID?: string; error?: unknown })
        : undefined;
    if (event.type === "session.error" && affected)
      this.queueArmed.delete(affected);
    if (info?.error && info.sessionID) this.queueArmed.delete(info.sessionID);
    const changed = reduceEvent(this.state.chat, event);
    if (changed) {
      this.state = { ...this.state, rev: this.state.rev + 1 };
      for (const l of this.listeners) l();
    }
    if (event.type === "session.status") void this.drainQueue();
  }

  activityStatus(id: string): SessionStatus | undefined {
    return this.state.activityStatuses[id] ??
      this.state.chat.sessions[id]?.status ?? this.state.statuses[id];
  }

  isUnread(id: string): boolean {
    return Boolean(this.state.prefs.unreadSessions?.[id]);
  }

  hasUnreadInDirectory(directory: string): boolean {
    return Object.values(this.state.prefs.unreadSessions ?? {})
      .some((item) => item.directory === directory);
  }

  hasRunningInDirectory(directory: string): boolean {
    return Object.entries(this.state.activityStatuses).some(([id, status]) =>
      this.activityDirectories.get(id) === directory &&
      (status.type === "busy" || status.type === "retry"));
  }

  private isViewing(id: string): boolean {
    return this.state.activeSessionId === id &&
      this.conversationAtBottom && !this.state.ui.historyLoading &&
      typeof document !== "undefined" && !document.hidden && document.hasFocus();
  }

  setConversationAtBottom(atBottom: boolean): void {
    if (this.conversationAtBottom === atBottom) return;
    this.conversationAtBottom = atBottom;
    if (atBottom) this.markReadIfViewing();
  }

  markReadIfViewing(): void {
    const id = this.state.activeSessionId;
    if (!id || !this.isViewing(id) || !this.isUnread(id)) return;
    this.clearUnread(id);
  }

  private clearUnread(id: string): void {
    if (!this.isUnread(id)) return;
    const unread = { ...this.state.prefs.unreadSessions };
    delete unread[id];
    this.mutate((s) => ({ prefs: { ...s.prefs, unreadSessions: unread } }));
    this.persistPrefs();
  }

  private observeSessionStatus(id: string, status: SessionStatus, directory?: string): void {
    if (directory) this.activityDirectories.set(id, directory);
    const previous = this.activityStatus(id);
    const wasRunning = previous?.type === "busy" || previous?.type === "retry";
    const running = status.type === "busy" || status.type === "retry";
    const finished = wasRunning && !running && status.type === "idle";
    if (previous?.type === status.type && !running) return;
    let unread = this.state.prefs.unreadSessions;
    if (running && unread?.[id]) {
      unread = { ...unread };
      delete unread[id];
    } else if (finished && !this.isViewing(id)) {
      unread = { ...unread, [id]: {
        time: Date.now(), directory: directory ?? this.activityDirectories.get(id),
      } };
      if (Object.keys(unread).length > 500)
        unread = Object.fromEntries(Object.entries(unread)
          .sort((a, b) => a[1].time - b[1].time).slice(-500));
    }
    const changedUnread = unread !== this.state.prefs.unreadSessions;
    this.mutate((s) => ({
      activityStatuses: { ...s.activityStatuses, [id]: status },
      ...(changedUnread
        ? { prefs: { ...s.prefs, unreadSessions: unread } }
        : {}),
    }));
    if (changedUnread) this.persistPrefs();
    if (finished && !this.isViewing(id)) void completionChime().catch(() => {});
  }

  private startGlobalStream(client: OpenCodeClient, generation: number): void {
    const ctrl = new AbortController();
    this.globalAbort = ctrl;
    let opened = false;
    void runEventStream<GlobalEvent>({
      url: globalEventStreamUrl(client.baseUrl),
      headers: client.headers,
      signal: ctrl.signal,
      onEvent: ({ directory, payload }) => {
        if (generation !== this.connectionGeneration || client !== this.client ||
            !payload || typeof payload.type !== "string") return;
        if (payload.type === "session.updated" && payload.properties?.info) {
          const info = payload.properties.info as Session;
          if (info.id && info.directory) this.activityDirectories.set(info.id, info.directory);
          if (info.id && info.time?.archived) this.clearUnread(info.id);
        }
        const id = payload.properties?.sessionID;
        if (typeof id !== "string") return;
        if (payload.type === "session.deleted") {
          this.forgetActivity(id);
          return;
        }
        if (payload.type === "session.status" || payload.type === "session.idle" || payload.type === "session.error") {
          this.observeSessionStatus(id,
            payload.type === "session.status"
              ? ((payload.properties.status as SessionStatus) ?? { type: "idle" })
              : { type: "idle" },
            directory);
        }
      },
      onState: (state) => {
        if (generation !== this.connectionGeneration || client !== this.client) return;
        if (state === "open") {
          if (opened) void this.reconcileBackgroundActivity(client, generation);
          opened = true;
        }
      },
    });
  }

  private forgetActivity(id: string): void {
    this.activityDirectories.delete(id);
    const unreadSessions = { ...this.state.prefs.unreadSessions };
    delete unreadSessions[id];
    const activityStatuses = { ...this.state.activityStatuses };
    delete activityStatuses[id];
    this.mutate((s) => ({
      activityStatuses,
      sessions: s.sessions.filter((item) => item.id !== id),
      archivedSessions: s.archivedSessions.filter((item) => item.id !== id),
      prefs: {
        ...s.prefs,
        unreadSessions,
        projectlessSessions: s.prefs.projectlessSessions?.filter((item) => item.id !== id),
      },
    }));
    this.persistPrefs();
  }

  private async reconcileBackgroundActivity(client: OpenCodeClient, generation: number) {
    const directories = new Set<string>();
    for (const [id, status] of Object.entries(this.state.activityStatuses))
      if (status.type === "busy" || status.type === "retry") {
        const dir = this.activityDirectories.get(id);
        if (dir) directories.add(dir);
      }
    for (const dir of directories) {
      try {
        const statuses = await client.sessionStatuses(dir);
        if (generation !== this.connectionGeneration || client !== this.client) return;
        for (const [id, status] of Object.entries(this.state.activityStatuses))
          if (this.activityDirectories.get(id) === dir &&
              (status.type === "busy" || status.type === "retry"))
            this.observeSessionStatus(id, statuses[id] ?? { type: "idle" }, dir);
      } catch { /* Keep prior state until a confirmed server status arrives. */ }
    }
  }

  // ---------- ui helpers ----------

  setUi(patch: Partial<UiState>): void {
    this.patchUi(patch);
  }

  async toggleTerminal(): Promise<void> {
    const next = !this.state.prefs.layout.bottomOpen;
    if (next && !(await this.ensureChatWorkspace())) return;
    this.setLayout({ bottomOpen: next });
  }

  setLayout(patch: Partial<Prefs["layout"]>): void {
    this.mutate((s) => ({
      prefs: { ...s.prefs, layout: { ...s.prefs.layout, ...patch } },
    }));
    this.persistPrefs();
  }

  setTheme(theme: Prefs["theme"]): void {
    this.mutate((s) => ({ prefs: { ...s.prefs, theme } }));
    this.persistPrefs();
    applyTheme(theme);
  }

  pendingInteraction(sessionId: string | null): {
    permissions: PermissionRequest[];
    questions: QuestionRequest[];
  } {
    if (!sessionId) return { permissions: [], questions: [] };
    return pendingForSession(this.state.chat, sessionId);
  }
}

export function errText(e: unknown): string {
  if (e instanceof ApiError)
    return e.status === 404 ? "Not found on the OpenCode server" : e.detail;
  if (e instanceof ConnectionError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

export const store = new Store();
import.meta.hot?.dispose(() => store.dispose());

export function useAppState(): AppState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export function applyTheme(theme: Prefs["theme"]): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const effective =
    theme === "system" ? (mq.matches ? "dark" : "light") : theme;
  root.dataset.theme = effective;
  root.style.colorScheme = effective;
}

if (typeof window !== "undefined") {
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => applyTheme(store.state.prefs.theme));
}
