// Backend-neutral agent contract.
//
// The application state machine (src/state/store.ts) talks to an *agent backend*,
// never to a concrete HTTP client. OpenCode is the only implemented backend today
// (src/agent/opencode.ts) and stays the default; this file exists so another agent
// runtime can be added by implementing `AgentBackend` + registering a descriptor,
// instead of rewriting the UI/state layer or inventing a second agent loop.
//
// Rules for any future implementation:
// - The backend owns the transport. It never exposes URLs or wire formats upwards.
// - Every directory-sensitive call carries the directory it belongs to.
// - `prompt` acknowledges *acceptance*, not completion. Progress arrives as events.
// - Permission/question prompts are surfaced, never auto-answered.

import type {
  AgentInfo,
  HealthInfo,
  MessageResponse,
  PermissionRequest,
  PermissionRule,
  PromptRequest,
  Project,
  ProviderResponse,
  QuestionRequest,
  ServerEvent,
  Session,
  SessionStatus,
  VcsInfo,
} from "../api/types";
import type { CompactionConfig } from "../state/context";

/** Optional surfaces. The UI must degrade per-capability, never by version gate. */
export interface AgentCapabilities {
  /** Interactive shell sessions owned by the backend. */
  pty: boolean;
  /** Tool-call approval prompts the user answers. */
  permissions: boolean;
  /** Structured questions the agent asks mid-run. */
  questions: boolean;
  /** File/image/audio parts in a prompt. */
  attachments: boolean;
  /** Branching a conversation from an earlier message. */
  fork: boolean;
  /** Server-side history summarization. */
  compaction: boolean;
  /** Working-tree diffs for the review panel. */
  vcsDiff: boolean;
  /** A chat that owns a managed directory instead of a user project. */
  projectlessChat: boolean;
}

export interface AgentRuntimeConfig {
  default_agent?: string;
  model?: string;
  compaction?: CompactionConfig;
}

export interface AgentPaths {
  home: string;
  directory: string;
  worktree: string;
}

export interface CreateSessionInput {
  directory: string;
  title?: string;
  permission?: PermissionRule[];
  agent?: string;
  model?: { id: string; providerID: string; variant?: string };
  signal?: AbortSignal;
}

export interface SessionPatch {
  title?: string;
  permission?: PermissionRule[];
  time?: { archived?: number | null };
}

export type StreamState =
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed"
  | "error";

export interface EventSubscription<T> {
  signal: AbortSignal;
  onEvent: (event: T) => void;
  onState: (state: StreamState, detail?: string) => void;
}

/** An event observed on the backend-wide stream, tagged with its directory. */
export interface DirectoryEvent {
  directory?: string;
  payload: ServerEvent;
}

export interface AgentBackend {
  readonly id: string;
  /** Stable origin identity used for request guards and preference scoping. */
  readonly endpoint: string;
  readonly capabilities: AgentCapabilities;

  /** Credentials stay in memory and are bound to the connection, never persisted. */
  setAuthHeaders(headers: Record<string, string>): void;

  // ---- connection / runtime metadata ----
  health(signal?: AbortSignal): Promise<HealthInfo>;
  providers(
    signal: AbortSignal | undefined,
    directory: string | null,
  ): Promise<ProviderResponse>;
  agents(
    signal: AbortSignal | undefined,
    directory: string | null,
  ): Promise<AgentInfo[]>;
  config(directory: string | null): Promise<AgentRuntimeConfig>;

  // ---- workspaces ----
  projects(signal?: AbortSignal): Promise<Project[]>;
  paths(directory?: string | null): Promise<AgentPaths>;
  vcs(directory: string, signal?: AbortSignal): Promise<VcsInfo | null>;

  // ---- sessions ----
  listSessions(
    directory: string | null,
    opts?: { limit?: number; signal?: AbortSignal },
  ): Promise<Session[]>;
  recentSessions(
    archived?: boolean,
    cursor?: number,
    filter?: { search?: string; directory?: string },
  ): Promise<{ sessions: Session[]; cursor: number | null }>;
  getSession(
    sessionID: string,
    directory: string | null,
    signal?: AbortSignal,
  ): Promise<Session>;
  createSession(input: CreateSessionInput): Promise<Session>;
  updateSession(
    sessionID: string,
    patch: SessionPatch,
    directory: string | null,
  ): Promise<Session>;
  forkSession(
    sessionID: string,
    directory: string,
    messageID: string,
  ): Promise<Session>;
  deleteSession(sessionID: string, directory: string | null): Promise<void>;
  sessionStatuses(
    directory: string | null,
    signal?: AbortSignal,
  ): Promise<Record<string, SessionStatus>>;

  // ---- history / execution ----
  messages(
    sessionID: string,
    opts?: {
      directory?: string | null;
      limit?: number;
      before?: string;
      signal?: AbortSignal;
    },
  ): Promise<{ messages: MessageResponse[]; before?: string }>;
  /** Resolves when the run was *accepted*. Completion is observed through events. */
  prompt(
    sessionID: string,
    directory: string,
    body: PromptRequest,
    signal?: AbortSignal,
  ): Promise<void>;
  abort(sessionID: string, directory: string): Promise<void>;
  summarize(
    sessionID: string,
    directory: string,
    providerID: string,
    modelID: string,
  ): Promise<void>;

  // ---- interaction ----
  pendingPermissions(
    directory: string | null,
    signal?: AbortSignal,
  ): Promise<PermissionRequest[]>;
  replyPermission(
    requestID: string,
    reply: "once" | "always" | "reject",
    directory: string,
  ): Promise<void>;
  pendingQuestions(
    directory: string | null,
    signal?: AbortSignal,
  ): Promise<QuestionRequest[]>;
  replyQuestion(
    requestID: string,
    answers: string[][],
    directory: string,
  ): Promise<void>;
  rejectQuestion(requestID: string, directory: string): Promise<void>;

  // ---- events ----
  /** Incremental updates for one directory. Aborting the signal ends the subscription. */
  subscribeDirectory(
    directory: string,
    subscription: EventSubscription<ServerEvent>,
  ): void;
  /** Backend-wide activity, used to notice work finishing outside the open chat. */
  subscribeAll(subscription: EventSubscription<DirectoryEvent>): void;
}

/** Everything needed to offer, validate and construct one backend kind. */
export interface AgentBackendDescriptor {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly defaultEndpoint: string;
  readonly capabilities: AgentCapabilities;
  /** Rejects endpoints the security model does not allow (e.g. non-loopback). */
  isAllowedEndpoint(endpoint: string): boolean;
  normalizeEndpoint(endpoint: string): string;
  create(endpoint: string): AgentBackend;
}
