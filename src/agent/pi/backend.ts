// Pi as a real second `AgentBackend`.
//
// Pi is a local CLI, not a server: there is no project registry, no VCS service
// and no PTY. Those capabilities are reported false and the UI hides them — the
// backend never fakes a surface it does not have. What Pi does provide is a
// durable, directory-isolated conversation with streaming, tool steps, cancel
// and compaction, and that is what this adapter maps onto the app's model.
//
// Session metadata the RPC protocol does not own (display title, archived flag)
// is app-owned and lives in preferences; Pi owns the transcript itself.

import type {
  AgentBackend,
  AgentBackendDescriptor,
  AgentCapabilities,
  AgentPaths,
  AgentRuntimeConfig,
  CreateSessionInput,
  DirectoryEvent,
  EventSubscription,
  SessionPatch,
} from "../backend";
import type {
  AgentInfo,
  HealthInfo,
  MessageResponse,
  PermissionRequest,
  Project,
  PromptRequest,
  ProviderResponse,
  QuestionRequest,
  ServerEvent,
  Session,
  SessionStatus,
  VcsInfo,
} from "../../api/types";
import { piBridge, type PiInstall, type PiSessionFile } from "./native";
import {
  isDialogMethod,
  type PiCommand,
  type PiAssistantMessage,
  type PiEntry,
  type PiEnvelope,
  type PiEvent,
  type PiModel,
  type PiState,
  type PiUiRequest,
} from "./protocol";
import { entriesToHistory, PiStreamTranslator } from "./translate";

export const PI_BACKEND_ID = "pi";

/** Pi runs on this computer only: there is no remote transport in RPC mode. */
export const PI_CAPABILITIES: AgentCapabilities = {
  pty: false,
  permissions: false,
  questions: false,
  attachments: true, // images only; see `supportsAttachment`
  fork: false,
  compaction: true,
  vcsDiff: false,
  projectlessChat: true,
};

/** Pi accepts images inline; everything else must go through the file system. */
export function supportsAttachment(mime: string): boolean {
  return mime.startsWith("image/");
}

export interface PiSessionMeta {
  id: string;
  directory: string;
  title: string;
  created: number;
  updated: number;
  archived?: number;
  /** Set when the conversation was carried over from another engine. */
  handoffFrom?: string;
}

/** App-owned session metadata, supplied by the store from preferences. */
export interface PiMetaStore {
  all(): Record<string, PiSessionMeta>;
  save(meta: PiSessionMeta): void;
  remove(id: string): void;
}

export interface PiRuntimeChoice {
  provider?: string;
  model?: string;
  thinking?: string;
  program?: string;
  extensions?: string[];
  /** Approval policy for Pi's built-in tools; "ask" when unset. */
  toolPolicy?: "ask" | "full";
}

/** Everything the settings screen needs to describe the Pi engine honestly. */
export interface PiHealth {
  install: PiInstall;
  models: PiModel[];
  commands: PiCommand[];
  state: PiState | null;
  error: string;
}

type Notice = { level: "warning" | "error"; text: string };

export interface PiHost {
  /** Runtime selection for a directory (provider/model/extensions). */
  choice(directory: string): PiRuntimeChoice;
  meta: PiMetaStore;
  /** Surfaced outside the conversation: extension faults, transport errors. */
  onNotice?(directory: string, sessionId: string, notice: Notice): void;
  /** A blocking extension dialog needs a user answer. */
  onDialog?(request: PiDialogRequest): void;
  /** Provisional streaming ids are stale; re-read the durable history. */
  onHistoryStale?(directory: string, sessionId: string): void;
}

export interface PiDialogRequest {
  key: string;
  directory: string;
  sessionId: string;
  request: PiUiRequest;
}

function sessionOf(meta: PiSessionMeta): Session {
  return {
    id: meta.id,
    directory: meta.directory,
    title: meta.title,
    projectID: "pi",
    time: {
      created: meta.created,
      updated: meta.updated,
      ...(meta.archived ? { archived: meta.archived } : {}),
    },
  } as Session;
}

/** Pi writes `<timestamp>_<id>.jsonl`; ids must stay filename-safe. */
export function newPiSessionId(): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `chat-${random.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
}

export class PiBackend implements AgentBackend {
  readonly id = PI_BACKEND_ID;
  readonly capabilities = PI_CAPABILITIES;
  /** Pi is local; the "endpoint" is a stable identity, not a URL. */
  readonly endpoint = "pi://local";

  private bridge = piBridge();
  private translators = new Map<string, PiStreamTranslator>();
  private keys = new Map<string, string>();
  private subscribers = new Set<{
    directory: string | null;
    subscription: EventSubscription<ServerEvent> | EventSubscription<DirectoryEvent>;
    global: boolean;
  }>();
  private unsubscribe: (() => void) | null = null;
  private statuses = new Map<string, SessionStatus>();

  constructor(private readonly host: PiHost) {}

  setAuthHeaders(): void {
    // Pi authenticates itself through its own credential store / environment.
    // The app never handles, forwards or persists a provider key for Pi.
  }

  // ---- health / metadata ----

  async health(): Promise<HealthInfo> {
    const install = await this.bridge.detect(this.host.choice("").program);
    if (!install.installed)
      throw new Error(install.error || "Pi CLI не найден.");
    return { healthy: true, version: install.version } as HealthInfo;
  }

  /**
   * A short-lived probe session: the only reliable way to ask Pi what models and
   * commands it actually has, because that depends on its own configuration.
   */
  async describe(directory: string): Promise<PiHealth> {
    const choice = this.host.choice(directory);
    const install = await this.bridge.detect(choice.program);
    const empty: PiHealth = {
      install,
      models: [],
      commands: [],
      state: null,
      error: install.error,
    };
    if (!install.installed || !directory) return empty;
    const probeId = `probe-${Date.now().toString(36)}`;
    try {
      const opened = await this.bridge.open({
        directory,
        sessionId: probeId,
        // A capability probe must not create a persistent Pi session; an empty
        // transcript would otherwise show up in the user's chat list. It also
        // loads no extensions: starting language servers just to read a model
        // list would be pure waste.
        ephemeral: true,
        provider: choice.provider,
        model: choice.model,
        program: choice.program,
      });
      try {
        const [models, commands, state] = await Promise.all([
          this.command<{ models: PiModel[] }>(opened.key, { type: "get_available_models" }),
          this.command<{ commands: PiCommand[] }>(opened.key, { type: "get_commands" }),
          this.command<PiState>(opened.key, { type: "get_state" }),
        ]);
        return {
          install,
          models: models?.models ?? [],
          commands: commands?.commands ?? [],
          state: state ?? null,
          error: "",
        };
      } finally {
        await this.bridge.close(opened.key).catch(() => {});
      }
    } catch (error) {
      return { ...empty, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Prove that a model is actually reachable by making the smallest real
   * request. Runs in an ephemeral session so it leaves no transcript, and with
   * no extensions so no tool gate can interfere.
   */
  async checkAccess(
    directory: string,
    choice: { providerID: string; modelID: string },
  ): Promise<string> {
    if (!directory) throw new Error("Нет рабочего каталога для проверки.");
    const opened = await this.bridge.open({
      directory,
      sessionId: `probe-${Date.now().toString(36)}`,
      ephemeral: true,
      provider: choice.providerID,
      model: `${choice.providerID}/${choice.modelID}`,
      program: this.host.choice(directory).program,
    });
    try {
      let assistant: PiAssistantMessage | undefined;
      const settled = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Модель не ответила за 60 с.")),
          60_000,
        );
        const stop = this.bridge.subscribe((envelope) => {
          if (envelope.key !== opened.key) return;
          const payload = envelope.payload as PiEvent;
          if (payload.type === "message_end" && payload.message?.role === "assistant")
            assistant = payload.message as PiAssistantMessage;
          if (payload.type === "agent_settled") {
            clearTimeout(timer);
            stop();
            const text = assistant?.content
              ?.filter((part) => part.type === "text")
              .map((part) => String("text" in part ? part.text : ""))
              .join("")
              .trim();
            if (!text || assistant?.stopReason === "error" || assistant?.stopReason === "aborted")
              reject(new Error("Pi завершил проверку без ответа модели."));
            else
              resolve("Модель ответила на тестовый запрос.");
          }
          if (payload.type === "pi_exited") {
            clearTimeout(timer);
            stop();
            reject(new Error("Процесс Pi завершился во время проверки."));
          }
        });
      });
      const response = await this.raw(
        opened.key,
        { type: "prompt", message: "Reply with exactly: OK" },
        60_000,
      );
      if (response && response.success === false)
        throw new Error(String(response.error ?? "Pi отклонил проверочный запрос."));
      return await settled;
    } finally {
      await this.bridge.close(opened.key).catch(() => {});
    }
  }

  async providers(): Promise<ProviderResponse> {
    // Model discovery needs a live Pi; the settings screen and the store call
    // `describe()` instead. Returning an empty catalog here keeps the neutral
    // contract honest rather than inventing OpenCode-shaped providers.
    return { all: [], connected: [], default: {} } as ProviderResponse;
  }
  async agents(): Promise<AgentInfo[]> {
    return [];
  }
  async config(): Promise<AgentRuntimeConfig> {
    return {};
  }

  // ---- workspaces ----

  async projects(): Promise<Project[]> {
    return [];
  }
  async paths(directory?: string | null): Promise<AgentPaths> {
    const dir = directory ?? "";
    return { home: "", directory: dir, worktree: dir };
  }
  async vcs(): Promise<VcsInfo | null> {
    return null;
  }

  // ---- sessions ----

  async listSessions(directory: string | null): Promise<Session[]> {
    if (!directory) return [];
    const files = await this.bridge.sessions(directory);
    const meta = this.host.meta.all();
    const out: Session[] = [];
    for (const file of files) {
      const known = meta[file.id];
      const merged: PiSessionMeta = known ?? {
        id: file.id,
        directory,
        title: fallbackTitle(file),
        created: Date.parse(file.created) || file.updated,
        updated: file.updated,
      };
      // Keep the listing's mtime authoritative for ordering.
      out.push(sessionOf({ ...merged, updated: Math.max(merged.updated, file.updated) }));
    }
    return out;
  }

  async recentSessions(archived = false): Promise<{ sessions: Session[]; cursor: number | null }> {
    // Pi has no server-side cross-directory index. The app owns the metadata
    // for every Pi chat, including its directory and archive state.
    return {
      sessions: Object.values(this.host.meta.all())
        .filter((meta) => Boolean(meta.archived) === archived)
        .map(sessionOf)
        .sort((a, b) => b.time.updated - a.time.updated),
      cursor: null,
    };
  }

  async getSession(sessionID: string, directory: string | null): Promise<Session> {
    const known = this.host.meta.all()[sessionID];
    if (known) return sessionOf(known);
    const list = await this.listSessions(directory);
    const found = list.find((s) => s.id === sessionID);
    if (!found) throw new Error("Сессия Pi не найдена.");
    return found;
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    const id = newPiSessionId();
    const meta: PiSessionMeta = {
      id,
      directory: input.directory,
      title: input.title?.trim() || "Новый чат Pi",
      created: Date.now(),
      updated: Date.now(),
    };
    this.host.meta.save(meta);
    // The child is created lazily on the first prompt; creating it here would
    // leave an idle agent behind for a chat the user may never send.
    return sessionOf(meta);
  }

  async updateSession(
    sessionID: string,
    patch: SessionPatch,
    directory: string | null,
  ): Promise<Session> {
    const current =
      this.host.meta.all()[sessionID] ??
      (await this.getSession(sessionID, directory).then(toMeta));
    const next: PiSessionMeta = {
      ...current,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.time?.archived !== undefined
        ? { archived: patch.time.archived ?? undefined }
        : {}),
      updated: Date.now(),
    };
    this.host.meta.save(next);
    if (patch.title) {
      const key = this.keys.get(sessionID);
      if (key)
        await this.command(key, { type: "set_session_name", name: patch.title }).catch(
          () => {},
        );
    }
    return sessionOf(next);
  }

  async forkSession(): Promise<Session> {
    throw new Error("Ветвление сообщений пока не поддержано для Pi.");
  }

  async deleteSession(sessionID: string): Promise<void> {
    await this.closeSession(sessionID);
    this.host.meta.remove(sessionID);
  }

  async sessionStatuses(
    directory: string | null,
  ): Promise<Record<string, SessionStatus>> {
    const out: Record<string, SessionStatus> = {};
    for (const [id, status] of this.statuses) {
      const meta = this.host.meta.all()[id];
      if (!directory || !meta || meta.directory === directory) out[id] = status;
    }
    return out;
  }

  // ---- history ----

  async messages(
    sessionID: string,
    opts: { directory?: string | null; limit?: number; before?: string } = {},
  ): Promise<{ messages: MessageResponse[]; before?: string }> {
    const directory = opts.directory ?? this.host.meta.all()[sessionID]?.directory;
    if (!directory) return { messages: [] };
    const key = await this.ensureSession(directory, sessionID);
    const data = await this.command<{ entries: PiEntry[] }>(key, {
      type: "get_entries",
    });
    const all = entriesToHistory(sessionID, data?.entries ?? []);
    const limit = opts.limit ?? 200;
    // Pi returns the whole append-only log; page it from the end like OpenCode.
    const end = opts.before
      ? Math.max(0, all.findIndex((m) => m.info.id === opts.before))
      : all.length;
    const start = Math.max(0, end - limit);
    const page = all.slice(start, end);
    return {
      messages: page,
      before: start > 0 ? page[0]?.info.id : undefined,
    };
  }

  // ---- execution ----

  async prompt(
    sessionID: string,
    directory: string,
    body: PromptRequest,
  ): Promise<void> {
    const key = await this.ensureSession(directory, sessionID, body);
    const text = body.parts
      .filter((p) => p.type === "text")
      .map((p) => String((p as { text?: string }).text ?? ""))
      .join("\n\n");
    const images = body.parts
      .filter(
        (p): p is typeof p & { mime: string; url: string } =>
          p.type === "file" &&
          typeof (p as { mime?: string }).mime === "string" &&
          supportsAttachment(String((p as { mime?: string }).mime)),
      )
      .map((p) => ({
        type: "image" as const,
        mimeType: p.mime,
        data: String(p.url).replace(/^data:[^,]*,/, ""),
      }));
    const rejected = body.parts.filter(
      (p) =>
        p.type === "file" &&
        !supportsAttachment(String((p as { mime?: string }).mime ?? "")),
    );
    if (rejected.length)
      throw new Error(
        "Pi принимает только изображения во вложениях. Остальные файлы передайте через путь в тексте запроса.",
      );

    const running = this.statuses.get(sessionID)?.type === "busy";
    const command: Record<string, unknown> = {
      type: "prompt",
      message: text,
      ...(images.length ? { images } : {}),
      // Never silently drop a prompt sent while the agent is mid-run.
      ...(running ? { streamingBehavior: "followUp" } : {}),
    };
    const response = await this.raw(key, command, 60_000);
    if (response && response.success === false)
      throw new Error(String(response.error ?? "Pi отклонил запрос."));
    this.setStatus(sessionID, { type: "busy" });
  }

  async abort(sessionID: string): Promise<void> {
    const key = this.keys.get(sessionID);
    if (!key) return;
    await this.command(key, { type: "abort" }, 30_000);
    this.setStatus(sessionID, { type: "idle" });
  }

  async summarize(sessionID: string): Promise<void> {
    const key = this.keys.get(sessionID);
    if (!key) throw new Error("Сессия Pi не запущена.");
    await this.command(key, { type: "compact" }, 300_000);
  }

  // ---- interaction (Pi uses extension dialogs, not a permission queue) ----

  async pendingPermissions(): Promise<PermissionRequest[]> {
    return [];
  }
  async replyPermission(): Promise<void> {}
  async pendingQuestions(): Promise<QuestionRequest[]> {
    return [];
  }
  async replyQuestion(): Promise<void> {}
  async rejectQuestion(): Promise<void> {}

  /** Answer a blocking extension dialog. Cancel is the safe default. */
  async answerDialog(
    key: string,
    id: string,
    answer: { value?: string; confirmed?: boolean; cancelled?: boolean },
  ): Promise<void> {
    await this.bridge.post(key, {
      type: "extension_ui_response",
      id,
      ...answer,
    });
  }

  // ---- events ----

  subscribeDirectory(
    directory: string,
    subscription: EventSubscription<ServerEvent>,
  ): void {
    this.attach({ directory, subscription, global: false });
    subscription.onState("open");
  }

  subscribeAll(subscription: EventSubscription<DirectoryEvent>): void {
    this.attach({ directory: null, subscription, global: true });
    subscription.onState("open");
  }

  private attach(entry: {
    directory: string | null;
    subscription: EventSubscription<ServerEvent> | EventSubscription<DirectoryEvent>;
    global: boolean;
  }): void {
    this.subscribers.add(entry);
    entry.subscription.signal.addEventListener(
      "abort",
      () => {
        this.subscribers.delete(entry);
        entry.subscription.onState("closed");
        if (!this.subscribers.size) {
          this.unsubscribe?.();
          this.unsubscribe = null;
        }
      },
      { once: true },
    );
    this.unsubscribe ??= this.bridge.subscribe((envelope) => this.onEnvelope(envelope));
  }

  private onEnvelope(envelope: PiEnvelope): void {
    const payload = envelope.payload;
    if ((payload as PiUiRequest).type === "extension_ui_request") {
      this.onUiRequest(envelope, payload as PiUiRequest);
      return;
    }
    const translator = this.translatorFor(envelope.sessionId);
    const result = translator.translate(payload as PiEvent);
    for (const event of result.events) {
      this.trackStatus(envelope.sessionId, event);
      this.dispatch(envelope.directory, event);
    }
    if (result.notice)
      this.host.onNotice?.(envelope.directory, envelope.sessionId, result.notice);
    if (result.needsHistoryResync)
      this.host.onHistoryStale?.(envelope.directory, envelope.sessionId);
    if ((payload as PiEvent).type === "pi_exited") {
      this.keys.delete(envelope.sessionId);
      this.translators.delete(envelope.sessionId);
    }
  }

  private onUiRequest(envelope: PiEnvelope, request: PiUiRequest): void {
    if (!isDialogMethod(request.method)) {
      if (request.method === "notify")
        this.host.onNotice?.(envelope.directory, envelope.sessionId, {
          level: request.notifyType === "error" ? "error" : "warning",
          text: String(request.message ?? ""),
        });
      return;
    }
    if (!this.host.onDialog) {
      // Nothing can display it, so deny rather than let the agent hang or the
      // native timeout decide silently.
      void this.answerDialog(envelope.key, request.id, { cancelled: true });
      return;
    }
    this.host.onDialog({
      key: envelope.key,
      directory: envelope.directory,
      sessionId: envelope.sessionId,
      request,
    });
  }

  private trackStatus(sessionID: string, event: ServerEvent): void {
    if (event.type === "session.status" && event.properties?.status)
      this.statuses.set(sessionID, event.properties.status as SessionStatus);
    if (event.type === "session.idle" || event.type === "session.error")
      this.statuses.set(sessionID, { type: "idle" });
  }

  private setStatus(sessionID: string, status: SessionStatus): void {
    this.statuses.set(sessionID, status);
    const directory = this.host.meta.all()[sessionID]?.directory ?? "";
    this.dispatch(directory, {
      type: status.type === "idle" ? "session.idle" : "session.status",
      properties: { sessionID, status },
    });
  }

  private dispatch(directory: string, event: ServerEvent): void {
    for (const entry of this.subscribers) {
      if (entry.global) {
        (entry.subscription as EventSubscription<DirectoryEvent>).onEvent({
          directory,
          payload: event,
        });
      } else if (entry.directory === directory) {
        (entry.subscription as EventSubscription<ServerEvent>).onEvent(event);
      }
    }
  }

  private translatorFor(sessionID: string): PiStreamTranslator {
    let translator = this.translators.get(sessionID);
    if (!translator) {
      translator = new PiStreamTranslator(sessionID);
      this.translators.set(sessionID, translator);
    }
    return translator;
  }

  // ---- process lifetime ----

  /** Idempotent: a live child for this session is reused, never duplicated. */
  private async ensureSession(
    directory: string,
    sessionID: string,
    body?: PromptRequest,
  ): Promise<string> {
    const existing = this.keys.get(sessionID);
    if (existing) return existing;
    const choice = this.host.choice(directory);
    const opened = await this.bridge.open({
      directory,
      sessionId: sessionID,
      provider: body?.model?.providerID ?? choice.provider,
      // Pi takes `provider/id`; a bare id would be matched against its bundled
      // catalog and rejected for a custom model the account actually has.
      model: body?.model
        ? `${body.model.providerID}/${body.model.modelID}`
        : choice.model,
      thinking: body?.variant ?? choice.thinking,
      program: choice.program,
      extensions: choice.extensions,
      toolPolicy: choice.toolPolicy,
    });
    this.keys.set(sessionID, opened.key);
    return opened.key;
  }

  async closeSession(sessionID: string): Promise<void> {
    const key = this.keys.get(sessionID);
    if (!key) return;
    this.keys.delete(sessionID);
    this.translators.delete(sessionID);
    this.statuses.delete(sessionID);
    await this.bridge.close(key).catch(() => {});
  }

  /** Live process keys, for settings and for proving no duplicates exist. */
  liveSessions(): Promise<string[]> {
    return this.bridge.liveSessions();
  }

  private async raw(
    key: string,
    command: unknown,
    timeoutMs?: number,
  ): Promise<{ success?: boolean; error?: unknown; data?: unknown } | null> {
    const response = (await this.bridge.request(key, command, timeoutMs)) as {
      success?: boolean;
      error?: unknown;
      data?: unknown;
    } | null;
    return response;
  }

  private async command<T>(
    key: string,
    command: unknown,
    timeoutMs?: number,
  ): Promise<T | null> {
    const response = await this.raw(key, command, timeoutMs);
    if (!response) return null;
    if (response.success === false)
      throw new Error(String(response.error ?? "Команда Pi не выполнена."));
    return (response.data ?? null) as T | null;
  }
}

function fallbackTitle(file: PiSessionFile): string {
  const created = Date.parse(file.created);
  return Number.isFinite(created)
    ? `Чат Pi ${new Date(created).toLocaleString("ru-RU")}`
    : `Чат Pi ${file.id}`;
}

function toMeta(session: Session): PiSessionMeta {
  return {
    id: session.id,
    directory: session.directory,
    title: session.title,
    created: session.time.created,
    updated: session.time.updated,
    archived: session.time.archived ?? undefined,
  };
}

/**
 * Registered so the registry is the single truthful list of engines. `create`
 * returns the store-bound instance rather than a fresh one: a Pi backend needs
 * app-owned session metadata, and two instances would disagree about it.
 */
export function piDescriptor(create: () => AgentBackend): AgentBackendDescriptor {
  return {
    id: PI_BACKEND_ID,
    label: "Pi",
    description:
      "Локальный агент Pi через его режим RPC. Работает на этом компьютере, со своей историей сессий и своим каталогом моделей.",
    defaultEndpoint: "pi://local",
    capabilities: PI_CAPABILITIES,
    isAllowedEndpoint: (endpoint) => endpoint === "pi://local",
    normalizeEndpoint: () => "pi://local",
    create,
  };
}
