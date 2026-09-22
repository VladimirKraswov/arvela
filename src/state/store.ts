// Central application store: connection lifecycle, project/session selection,
// chat state driven by the pure stream reducer, and command actions.
// Designed to be testable: Tauri is only touched through theme/window niceties.

import { useSyncExternalStore } from "react";
import { ApiError, ConnectionError, isAllowedBaseUrl, OpenCodeClient } from "../api/client";
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
import { applyHistory, emptyChatRoot, emptySessionChat, pendingForSession, prependHistory, reduceEvent, type ChatRootState } from "./chatReducer";
import { DEFAULT_PREFS, draftKey, loadPrefs, savePrefs, type Prefs } from "./prefs";

export type ConnectionPhase = "unknown" | "connecting" | "connected" | "disconnected" | "incompatible";

export interface ConnectionState {
  phase: ConnectionPhase;
  version: string | null;
  error: string | null;
  streamState: "idle" | "connecting" | "open" | "reconnecting" | "closed" | "error";
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
  agents: AgentInfo[];
  olderExhausted: Record<string, boolean>;
  ui: UiState;
  rev: number;
}

/** Compatibility is a major-version contract; features degrade per-capability, not by version gate. */

function initialState(): AppState {
  const prefs = typeof localStorage !== "undefined" ? loadPrefs() : { ...DEFAULT_PREFS };
  return {
    prefs,
    connection: { phase: "unknown", version: null, error: null, streamState: "idle", lastEventAt: 0, endpoint: prefs.endpoint },
    projects: [],
    directory: prefs.selectedDirectory,
    sessions: [],
    archivedSessions: [],
    activeSessionId: prefs.selectedDirectory ? (prefs.lastSessionByDir[prefs.selectedDirectory] ?? null) : null,
    statuses: {},
    chat: emptyChatRoot(),
    providers: [],
    connectedProviderIds: [],
    providerDefaults: null,
    configDefaultAgent: null,
    agents: [],
    olderExhausted: {},
    ui: {
      sessionListLoading: false,
      sessionListError: null,
      historyLoading: false,
      historyError: null,
      sending: false,
      sendError: null,
      vcs: null,
      settingsOpen: false,
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

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): AppState => this.state;

  private mutate(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
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
    if (endpoint) {
      // Reject invalid input visibly instead of silently falling back to another server.
      if (!isAllowedBaseUrl(endpoint.trim().replace(/\/+$/, ""))) {
        this.mutate((s) => ({
          connection: { ...s.connection, phase: "disconnected", error: `Invalid endpoint "${endpoint}". Only plain-HTTP loopback URLs (http://127.0.0.1:PORT) are allowed.` },
        }));
        return false;
      }
      // A new endpoint owns a new server-side world: cancel old streams/requests first.
      this.streamAbort?.abort();
      this.streamAbort = null;
      this.directoryGeneration++;
      this.client.setBaseUrl(endpoint);
      this.mutate((s) => ({ prefs: { ...s.prefs, endpoint: this.client.baseUrl }, connection: { ...s.connection, endpoint: this.client.baseUrl } }));
      this.persistPrefs();
    }
    this.mutate((s) => ({ connection: { ...s.connection, phase: "connecting", error: null, endpoint: this.client.baseUrl } }));
    try {
      const health = await this.client.health();
      const major = parseInt(health.version.split(".")[0] ?? "0", 10);
      if (!health.healthy) throw new Error("Server reports unhealthy");
      if (!Number.isFinite(major) || major !== 1) {
        this.mutate((s) => ({ connection: { ...s.connection, phase: "incompatible", version: health.version, error: `OpenCode ${health.version} is outside the tested compatibility range.` } }));
        return false;
      }
      this.mutate((s) => ({ connection: { ...s.connection, phase: "connected", version: health.version, error: null } }));
      // Chain startup: projects only exist once the health check succeeded.
      void this.refreshProjects();
      void this.loadRuntimeMetadata();
      if (this.state.directory) await this.setDirectory(this.state.directory, { restoreSession: true });
      return true;
    } catch (e) {
      const msg = e instanceof ConnectionError ? e.message : e instanceof Error ? e.message : String(e);
      this.mutate((s) => ({ connection: { ...s.connection, phase: "disconnected", version: null, error: msg } }));
      return false;
    }
  }

  private async loadRuntimeMetadata(): Promise<void> {
    try {
      const [prov, agents, configAgent] = await Promise.all([this.client.providers(), this.client.agents(), this.client.defaultAgent()]);
      this.mutate({
        providers: prov.all ?? [],
        connectedProviderIds: prov.connected ?? [],
        providerDefaults: prov.default ?? null,
        configDefaultAgent: configAgent,
        agents: (agents ?? []).filter((a) => !a.hidden),
      });
    } catch (e) {
      this.patchUi({ toast: `Could not load model/agent list: ${errText(e)}` });
    }
  }

  /** Primary (non-subagent) agents are the only ones selectable as the main conversation agent. */
  primaryAgentNames(): string[] {
    return this.state.agents.filter((a) => a.mode !== "subagent").map((a) => a.name);
  }

  async retryConnection(): Promise<void> {
    await this.connect();
  }

  setEndpoint(endpoint: string): void {
    const normalized = this.client.baseUrl && endpoint === this.client.baseUrl ? endpoint : endpoint;
    this.mutate((s) => ({ prefs: { ...s.prefs, endpoint: normalized } }));
    this.persistPrefs();
  }

  // ---------- projects / directories ----------

  async refreshProjects(): Promise<void> {
    if (this.state.connection.phase !== "connected") return;
    try {
      const projects = await this.client.projects();
      this.mutate({ projects });
    } catch (e) {
      this.patchUi({ toast: `Could not load projects: ${errText(e)}` });
    }
  }

  async addProjectDirectory(dir: string): Promise<void> {
    const trimmed = dir.trim();
    if (!trimmed) return;
    this.mutate((s) => ({ projects: [...s.projects.filter((p) => p.worktree !== trimmed), { id: `local:${trimmed}`, worktree: trimmed, vcs: null, sandboxes: [] }] }));
    await this.setDirectory(trimmed);
  }

  async setDirectory(directory: string | null, opts: { restoreSession?: boolean } = {}): Promise<void> {
    const gen = ++this.directoryGeneration;
    this.listGeneration++; // in-flight list requests belong to the previous project
    this.streamAbort?.abort();
    this.streamAbort = null;
    this.mutate((s) => ({
      directory,
      sessions: [],
      activeSessionId: directory ? (s.prefs.lastSessionByDir[directory] ?? null) : null,
      statuses: {},
      prefs: { ...s.prefs, selectedDirectory: directory },
      ui: { ...s.ui, vcs: null, sessionListError: null },
    }));
    this.persistPrefs();
    if (!directory) return;

    void this.client.vcs(directory).then((vcs) => {
      if (gen === this.directoryGeneration) this.patchUi({ vcs });
    });
    await this.refreshSessions();
    if (gen !== this.directoryGeneration) return;
    if (!opts.restoreSession && !this.state.activeSessionId && this.state.sessions.length > 0) {
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
    const current = () => myGen === this.listGeneration && dirGen === this.directoryGeneration;
    this.patchUi({ sessionListLoading: true, sessionListError: null });
    try {
      const [sessions, statuses] = await Promise.all([this.client.listSessions(directory), this.client.sessionStatuses(directory)]);
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
      prefs: { ...s.prefs, lastSessionByDir: directory ? { ...s.prefs.lastSessionByDir, [directory]: sessionId ?? "" } : s.prefs.lastSessionByDir },
    }));
    this.persistPrefs();
    if (!sessionId || !directory) return;
    if (!this.state.chat.sessions[sessionId]) {
      await this.loadHistory(sessionId, directory);
    }
  }

  async loadHistory(sessionId: string, directory: string): Promise<void> {
    const gen = this.directoryGeneration;
    this.patchUi({ historyLoading: true, historyError: null });
    try {
      const { messages } = await this.client.messages(sessionId, { directory, limit: 200 });
      if (gen !== this.directoryGeneration || this.state.activeSessionId !== sessionId) return;
      this.mutate((s) => {
        const chat: ChatRootState = { ...s.chat, sessions: { ...s.chat.sessions } };
        applyHistory(chat, sessionId, messages);
        return { chat };
      });
    } catch (e) {
      if (gen === this.directoryGeneration) this.patchUi({ historyError: errText(e) });
    } finally {
      if (gen === this.directoryGeneration) this.patchUi({ historyLoading: false });
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
        model: choice ? { id: choice.modelID, providerID: choice.providerID, variant: choice.variant ?? undefined } : undefined,
      });
      // Identity guard: the session belongs to the project it was requested for. If the
      // user already switched projects, never inject/select it here (R3).
      if (gen !== this.directoryGeneration || this.state.directory !== directory || this.client.baseUrl !== endpoint) {
        return session;
      }
      this.mutate((s) => ({ sessions: [session, ...s.sessions.filter((x) => x.id !== session.id)] }));
      await this.selectSession(session.id);
      return session;
    } catch (e) {
      if (gen === this.directoryGeneration) this.patchUi({ toast: `Could not create session: ${errText(e)}` });
      return null;
    }
  }

  async renameSession(session: Session, title: string): Promise<void> {
    try {
      const updated = await this.client.updateSession(session.id, { title }, this.state.directory);
      this.mutate((s) => ({ sessions: s.sessions.map((x) => (x.id === updated.id ? updated : x)) }));
    } catch (e) {
      this.patchUi({ toast: `Rename failed: ${errText(e)}` });
    }
  }

  async archiveSession(session: Session): Promise<void> {
    try {
      const updated = await this.client.updateSession(session.id, { time: { archived: Date.now() } }, this.state.directory);
      this.mutate((s) => ({
        sessions: s.sessions.filter((x) => x.id !== session.id),
        archivedSessions: [updated, ...s.archivedSessions.filter((x) => x.id !== session.id)],
        activeSessionId: s.activeSessionId === session.id ? null : s.activeSessionId,
        prefs: { ...s.prefs, lastSessionByDir: s.directory ? { ...s.prefs.lastSessionByDir, [s.directory]: "" } : s.prefs.lastSessionByDir },
      }));
      this.persistPrefs();
      this.patchUi({ toast: "Session archived" });
    } catch (e) {
      this.patchUi({ toast: `Archive failed: ${errText(e)}` });
    }
  }

  async unarchiveSession(session: Session): Promise<void> {
    try {
      const updated = await this.client.updateSession(session.id, { time: { archived: 0 } }, this.state.directory);
      this.mutate((s) => ({
        archivedSessions: s.archivedSessions.filter((x) => x.id !== session.id),
        sessions: s.sessions.some((x) => x.id === session.id) ? s.sessions : [{ ...updated, time: { ...updated.time, archived: undefined } }, ...s.sessions],
      }));
      this.patchUi({ toast: "Session restored" });
    } catch (e) {
      this.patchUi({ toast: `Restore failed: ${errText(e)}` });
    }
  }

  async deleteSession(session: Session): Promise<void> {
    try {
      await this.client.deleteSession(session.id, this.state.directory);
      this.mutate((s) => ({
        sessions: s.sessions.filter((x) => x.id !== session.id),
        archivedSessions: s.archivedSessions.filter((x) => x.id !== session.id),
        activeSessionId: s.activeSessionId === session.id ? null : s.activeSessionId,
        prefs: { ...s.prefs, lastSessionByDir: s.directory ? { ...s.prefs.lastSessionByDir, [s.directory]: "" } : s.prefs.lastSessionByDir },
        ui: { ...s.ui, confirmDelete: null },
      }));
      this.persistPrefs();
      this.patchUi({ toast: "Session deleted permanently" });
    } catch (e) {
      this.patchUi({ toast: `Delete failed: ${errText(e)}` });
    }
  }

  // ---------- model / agent selection ----------

  getModelChoice(): { providerID: string; modelID: string; variant?: string | null } | null {
    const dir = this.state.directory ?? "";
    const stored = this.state.prefs.modelChoice[dir] ?? this.state.prefs.modelChoice["*"];
    if (stored && this.state.connectedProviderIds.includes(stored.providerID)) return stored;
    const active = this.state.activeSessionId ? this.state.sessions.find((s) => s.id === this.state.activeSessionId)?.model : undefined;
    if (active?.id && this.state.connectedProviderIds.includes(active.providerID)) {
      return { providerID: active.providerID, modelID: active.id, variant: active.variant ?? null };
    }
    const defaults = this.state.providerDefaults;
    if (defaults) {
      for (const [pid, mid] of Object.entries(defaults)) {
        if (this.state.connectedProviderIds.includes(pid)) return { providerID: pid, modelID: mid, variant: null };
      }
    }
    for (const pid of this.state.connectedProviderIds) {
      const provider = this.state.providers.find((p) => p.id === pid);
      const first = provider && Object.values(provider.models)[0];
      if (first) return { providerID: pid, modelID: first.id, variant: null };
    }
    return null;
  }

  setModelChoice(providerID: string, modelID: string, variant?: string | null): void {
    const dir = this.state.directory ?? "";
    this.mutate((s) => ({
      prefs: { ...s.prefs, modelChoice: { ...s.prefs.modelChoice, [dir || "*"]: { providerID, modelID, variant: variant ?? null } } },
    }));
    this.persistPrefs();
  }

  /** Explicit user selection always wins over a legacy session's agent (R2). */
  getAgentChoice(): string | null {
    const dir = this.state.directory ?? "*";
    const explicit = this.state.prefs.agentChoice[dir] ?? this.state.prefs.agentChoice["*"];
    if (explicit) return explicit;
    if (this.state.configDefaultAgent) return this.state.configDefaultAgent;
    const active = this.state.activeSessionId ? this.state.sessions.find((s) => s.id === this.state.activeSessionId)?.agent : undefined;
    if (active) return active;
    return this.primaryAgentNames()[0] ?? null;
  }

  setAgentOverride(dir: string, name: string): void {
    this.mutate((s) => ({ prefs: { ...s.prefs, agentChoice: { ...s.prefs.agentChoice, [dir || "*"]: name } } }));
    this.persistPrefs();
  }

  connectedProvidersWithModels(): ProviderInfo[] {
    return this.state.providers.filter((p) => this.state.connectedProviderIds.includes(p.id));
  }

  modelInfo(providerID: string, modelID: string): ModelInfo | null {
    return this.state.providers.find((p) => p.id === providerID)?.models[modelID] ?? null;
  }

  // ---------- drafts ----------

  getDraft(): string {
    return this.state.prefs.drafts[draftKey(this.state.activeSessionId, this.state.directory)] ?? "";
  }

  setDraft(text: string): void {
    const key = draftKey(this.state.activeSessionId, this.state.directory);
    this.mutate((s) => ({ prefs: { ...s.prefs, drafts: { ...s.prefs.drafts, [key]: text } } }));
    this.persistPrefs();
  }

  // ---------- execution ----------

  async sendPrompt(text: string): Promise<boolean> {
    const directory = this.state.directory;
    if (!directory || !text.trim() || this.state.ui.sending) return false;
    // Capture the full request identity before any await: it must never be re-read after
    // the user switched project/session mid-flight (R3), and the draft slot is revision-bound (R5).
    const gen = this.directoryGeneration;
    const endpoint = this.client.baseUrl;
    const slotKey = draftKey(this.state.activeSessionId, directory);
    const model = this.getModelChoice();
    if (!model) {
      this.patchUi({ sendError: "No connected model is available. Check provider configuration in OpenCode." });
      return false;
    }
    const agent = this.getAgentChoice();
    const trimmed = text.trim();
    const sameContext = () => gen === this.directoryGeneration && this.state.directory === directory && this.client.baseUrl === endpoint;
    this.patchUi({ sending: true, sendError: null });
    let sessionId = this.state.activeSessionId;
    try {
      if (!sessionId) {
        const created = await this.client.createSession({
          directory,
          title: trimmed.slice(0, 60),
          agent: agent ?? undefined,
          model: { id: model.modelID, providerID: model.providerID, variant: model.variant ?? undefined },
        });
        if (!sameContext()) return false; // project switched while creating: never submit into the wrong context
        sessionId = created.id;
        this.mutate((s) => ({
          sessions: [created, ...s.sessions.filter((x) => x.id !== created.id)],
          activeSessionId: created.id,
          prefs: { ...s.prefs, lastSessionByDir: { ...s.prefs.lastSessionByDir, [directory]: created.id } },
        }));
        this.persistPrefs();
      }
      const target = sessionId;
      await this.client.prompt(target, directory, {
        model: { providerID: model.providerID, modelID: model.modelID },
        agent: agent ?? undefined,
        variant: model.variant ?? undefined,
        parts: [{ type: "text", text: trimmed }],
      });
      // Accepted: clear only the exact draft revision we submitted, in its original slot.
      // Anything typed while awaiting acknowledgement stays untouched (R5).
      this.mutate((s) => {
        const drafts = { ...s.prefs.drafts };
        if (drafts[slotKey] === text) delete drafts[slotKey];
        const prev = s.chat.sessions[target] ?? emptySessionChat();
        const chat: ChatRootState = { ...s.chat, sessions: { ...s.chat.sessions, [target]: { ...prev, status: { type: "busy" } } } };
        return { prefs: { ...s.prefs, drafts }, chat };
      });
      this.persistPrefs();
      return true;
    } catch (e) {
      // Ambiguous outcome: never auto-resend. The draft was never cleared, so the user decides.
      this.patchUi({ sendError: errText(e) });
      return false;
    } finally {
      this.patchUi({ sending: false });
    }
  }

  /** Pagination: fetch a page of older messages with the oldest known id as cursor. */
  async loadOlderMessages(sessionId: string): Promise<void> {
    const directory = this.state.directory;
    if (!directory || this.state.ui.historyLoading) return;
    const oldest = this.state.chat.sessions[sessionId]?.messageOrder[0];
    const gen = this.directoryGeneration;
    this.patchUi({ historyLoading: true, historyError: null });
    try {
      const { messages } = await this.client.messages(sessionId, { directory, limit: 200, before: oldest });
      if (gen !== this.directoryGeneration || this.state.activeSessionId !== sessionId) return;
      this.mutate((s) => {
        const chat: ChatRootState = { ...s.chat, sessions: { ...s.chat.sessions } };
        prependHistory(chat, sessionId, messages);
        return { chat, olderExhausted: { ...s.olderExhausted, [sessionId]: messages.length === 0 } };
      });
    } catch (e) {
      if (gen === this.directoryGeneration) this.patchUi({ historyError: errText(e) });
    } finally {
      if (gen === this.directoryGeneration) this.patchUi({ historyLoading: false });
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
    if (!directory || !model) return;
    try {
      await this.client.summarize(sessionId, directory, model.providerID, model.modelID);
      this.patchUi({ toast: "Compaction requested" });
    } catch (e) {
      this.patchUi({ toast: `Compaction failed: ${errText(e)}` });
    }
  }

  // ---------- interaction ----------

  async replyPermission(req: PermissionRequest, reply: "once" | "always" | "reject"): Promise<void> {
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

  async replyQuestion(req: QuestionRequest, answers: string[][]): Promise<void> {
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
        this.mutate((s) => ({ connection: { ...s.connection, streamState: state === "closed" ? "closed" : state } }));
        if (state === "open") void this.resyncAfterReconnect(directory, gen);
        if (state === "error" && detail) {
          // Keep chat; report transport trouble without claiming the model is dead.
        }
      },
    });
  }

  private async resyncAfterReconnect(directory: string, gen: number): Promise<void> {
    try {
      const [sessions, statuses, permissions, questions] = await Promise.all([
        this.client.listSessions(directory),
        this.client.sessionStatuses(directory),
        this.client.pendingPermissions(directory),
        this.client.pendingQuestions(directory),
      ]);
      if (gen !== this.directoryGeneration) return;
      const visible = sessions.filter((s) => !s.parentID);
      this.mutate((s) => {
        // Authoritative reconciliation (R4): the server's status list replaces any
        // locally accumulated busy state; sessions absent from it are idle again.
        const chatSessions: ChatRootState["sessions"] = { ...s.chat.sessions };
        for (const id of Object.keys(chatSessions)) {
          chatSessions[id] = { ...chatSessions[id], status: statuses[id] ?? { type: "idle" } };
        }
        for (const [id, status] of Object.entries(statuses)) {
          if (!chatSessions[id]) chatSessions[id] = { ...emptySessionChat(), status };
        }
        const chat: ChatRootState = {
          ...s.chat,
          sessions: chatSessions,
          permissions: Object.fromEntries(permissions.map((p) => [p.id, p])),
          questions: Object.fromEntries(questions.map((q) => [q.id, q])),
        };
        return {
          sessions: visible.filter((x) => !x.time.archived),
          archivedSessions: visible.filter((x) => x.time.archived),
          statuses,
          chat,
        };
      });
      const active = this.state.activeSessionId;
      if (active) await this.loadHistory(active, directory);
    } catch {
      /* stream state will retry */
    }
  }

  private handleEvent(event: ServerEvent): void {
    if (event.type === "session.updated" && event.properties?.info) {
      const info = event.properties.info as Session;
      this.mutate((s) => {
        const merged = s.sessions.some((x) => x.id === info.id) ? s.sessions.map((x) => (x.id === info.id ? { ...x, ...info } : x)) : s.sessions;
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
    const changed = reduceEvent(this.state.chat, event);
    if (changed) {
      this.state = { ...this.state, rev: this.state.rev + 1 };
      for (const l of this.listeners) l();
    }
  }

  // ---------- ui helpers ----------

  setUi(patch: Partial<UiState>): void {
    this.patchUi(patch);
  }

  setLayout(patch: Partial<Prefs["layout"]>): void {
    this.mutate((s) => ({ prefs: { ...s.prefs, layout: { ...s.prefs.layout, ...patch } } }));
    this.persistPrefs();
  }

  setTheme(theme: Prefs["theme"]): void {
    this.mutate((s) => ({ prefs: { ...s.prefs, theme } }));
    this.persistPrefs();
    applyTheme(theme);
  }

  pendingInteraction(sessionId: string | null): { permissions: PermissionRequest[]; questions: QuestionRequest[] } {
    if (!sessionId) return { permissions: [], questions: [] };
    return pendingForSession(this.state.chat, sessionId);
  }
}

export function errText(e: unknown): string {
  if (e instanceof ApiError) return e.status === 404 ? "Not found on the OpenCode server" : e.detail;
  if (e instanceof ConnectionError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

export const store = new Store();

export function useAppState(): AppState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export function applyTheme(theme: Prefs["theme"]): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const effective = theme === "system" ? (mq.matches ? "dark" : "light") : theme;
  root.dataset.theme = effective;
  root.style.colorScheme = effective;
}

if (typeof window !== "undefined") {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme(store.state.prefs.theme));
}
