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
import { eventStreamUrl, runEventStream } from "../api/events";
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
  private directoryGeneration = 0;
  private saveTimerQueued = false;
  private connectionGeneration = 0;
  private statusSequence = 0;
  private statusVersions = new Map<string, number>();
  private historyGeneration = 0;
  private queueArmed = new Set<string>();
  private queueLocks = new Set<string>();
  private accessChanging = false;
  private compactLocks = new Set<string>();
  private historyJournals = new Set<ServerEvent[]>();

  dispose(): void {
    this.connectionGeneration++;
    this.directoryGeneration++;
    this.streamAbort?.abort();
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
    const p = this.doConnect(endpoint);
    if (!endpoint) {
      this.connectPromise = p;
      void p.finally(() => {
        if (this.connectPromise === p) this.connectPromise = null;
      });
    }
    return p;
  }

  private async doConnect(endpoint?: string): Promise<boolean> {
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
    if (requested !== this.client.baseUrl) {
      const prefs = switchEndpointPrefs(this.state.prefs, requested);
      this.client = new OpenCodeClient(requested);
      this.mutate({
        prefs,
        directory: prefs.selectedDirectory,
        activeSessionId: null,
        projects: [],
        sessions: [],
        archivedSessions: [],
        statuses: {},
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
      activeSessionId: directory
        ? (s.prefs.lastSessionByDir[directory] ?? null)
        : null,
      statuses: {},
      prefs: { ...s.prefs, selectedDirectory: directory },
      ui: { ...s.ui, vcs: null, sessionListError: null },
    }));
    this.persistPrefs();
    if (!directory) return;
    void this.loadRuntimeMetadata();

    void this.client.vcs(directory).then((vcs) => {
      if (gen === this.directoryGeneration) this.patchUi({ vcs });
    });
    await this.refreshSessions();
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
    if (sessionId === this.state.activeSessionId) return;
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

  async newSession(): Promise<void> {
    // Composer targets the "new conversation" slot; the session is created lazily on first send.
    await this.selectSession(null);
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
        this.state.directory,
      );
      if (gen !== this.directoryGeneration) return;
      this.mutate((s) => ({
        sessions: s.sessions.map((x) => (x.id === updated.id ? updated : x)),
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
        this.state.directory,
      );
      if (gen !== this.directoryGeneration) return;
      this.mutate((s) => ({
        sessions: s.sessions.filter((x) => x.id !== session.id),
        archivedSessions: [
          updated,
          ...s.archivedSessions.filter((x) => x.id !== session.id),
        ],
        activeSessionId:
          s.activeSessionId === session.id ? null : s.activeSessionId,
        prefs: {
          ...s.prefs,
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
        this.state.directory,
      );
      if (gen !== this.directoryGeneration) return;
      this.mutate((s) => ({
        archivedSessions: s.archivedSessions.filter((x) => x.id !== session.id),
        sessions: s.sessions.some((x) => x.id === session.id)
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
      await this.client.deleteSession(session.id, this.state.directory);
      if (gen !== this.directoryGeneration) return;
      this.mutate((s) => ({
        sessions: s.sessions.filter((x) => x.id !== session.id),
        archivedSessions: s.archivedSessions.filter((x) => x.id !== session.id),
        activeSessionId:
          s.activeSessionId === session.id ? null : s.activeSessionId,
        prefs: {
          ...s.prefs,
          lastSessionByDir:
            s.directory && s.prefs.lastSessionByDir[s.directory] === session.id
              ? { ...s.prefs.lastSessionByDir, [s.directory]: "" }
              : s.prefs.lastSessionByDir,
        },
        ui: { ...s.ui, confirmDelete: null },
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
    const dir = this.state.directory ?? "";
    const stored =
      this.state.prefs.modelChoice[dir] ?? this.state.prefs.modelChoice["*"];
    if (stored && this.state.connectedProviderIds.includes(stored.providerID))
      return stored;
    const active = this.state.activeSessionId
      ? this.state.sessions.find((s) => s.id === this.state.activeSessionId)
          ?.model
      : undefined;
    if (
      active?.id &&
      this.state.connectedProviderIds.includes(active.providerID)
    ) {
      return {
        providerID: active.providerID,
        modelID: active.id,
        variant: active.variant ?? null,
      };
    }
    const agent = this.state.agents.find(
      (a) => a.name === this.getAgentChoice(),
    );
    if (
      agent?.model &&
      this.state.connectedProviderIds.includes(agent.model.providerID)
    ) {
      return { ...agent.model, variant: agent.variant ?? null };
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
        variant: null,
      };
    }
    const defaults = this.state.providerDefaults;
    if (defaults) {
      for (const [pid, mid] of Object.entries(defaults)) {
        if (this.state.connectedProviderIds.includes(pid))
          return { providerID: pid, modelID: mid, variant: null };
      }
    }
    for (const pid of this.state.connectedProviderIds) {
      const provider = this.state.providers.find((p) => p.id === pid);
      const first = provider && Object.values(provider.models)[0];
      if (first) return { providerID: pid, modelID: first.id, variant: null };
    }
    return null;
  }

  setModelChoice(
    providerID: string,
    modelID: string,
    variant?: string | null,
  ): void {
    const dir = this.state.directory ?? "";
    this.mutate((s) => ({
      prefs: {
        ...s.prefs,
        modelChoice: {
          ...s.prefs.modelChoice,
          [dir || "*"]: { providerID, modelID, variant: variant ?? null },
        },
      },
    }));
    this.persistPrefs();
  }

  /** Explicit user selection always wins over a legacy session's agent (R2). */
  getAgentChoice(): string | null {
    const dir = this.state.directory ?? "*";
    const explicit =
      this.state.prefs.agentChoice[dir] ?? this.state.prefs.agentChoice["*"];
    if (explicit) return explicit;
    if (this.state.configDefaultAgent) return this.state.configDefaultAgent;
    const active = this.state.activeSessionId
      ? this.state.sessions.find((s) => s.id === this.state.activeSessionId)
          ?.agent
      : undefined;
    if (active) return active;
    return this.primaryAgentNames()[0] ?? null;
  }

  setAgentOverride(dir: string, name: string): void {
    this.mutate((s) => ({
      prefs: {
        ...s.prefs,
        agentChoice: { ...s.prefs.agentChoice, [dir || "*"]: name },
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
    const status = selected
      ? (this.state.chat.sessions[selected]?.status ??
        this.state.statuses[selected])
      : null;
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
    const status = id
      ? (this.state.chat.sessions[id]?.status ?? this.state.statuses[id])
      : null;
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

  // ---------- ui helpers ----------

  setUi(patch: Partial<UiState>): void {
    this.patchUi(patch);
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
