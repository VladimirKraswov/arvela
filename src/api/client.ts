import type { PermissionRule } from "./types";
import type { CompactionConfig } from "../state/context";
// Typed HTTP transport facade over the OpenCode loopback API.
// Loopback-only validation, request timeouts, caller cancellation and redacted errors.

import {
  asString,
  normalizeMessage,
  normalizeSession,
  normalizeStatusType,
  type AgentInfo,
  type FileEntry,
  type HealthInfo,
  type Message,
  type MessagePart,
  type MessageResponse,
  type PermissionRequest,
  type Project,
  type PromptRequest,
  type ProviderResponse,
  type QuestionRequest,
  type Session,
  type SessionDiffFile,
  type SessionStatus,
  type VcsInfo,
} from "./types";

export const DEFAULT_BASE_URL = "http://127.0.0.1:4096";

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;
  constructor(status: number, detail: string) {
    super(detail || `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

export class ConnectionError extends Error {
  constructor(message = "Cannot reach OpenCode server") {
    super(message);
    this.name = "ConnectionError";
  }
}

/** Only loopback endpoints: native SSH forwards remote engines without broadening WebView network access. */
export function isAllowedBaseUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (
    url.protocol !== "http:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    return false;
  const host = url.hostname.toLowerCase();
  if (
    host !== "127.0.0.1" &&
    host !== "localhost" &&
    host !== "[::1]" &&
    host !== "::1"
  )
    return false;
  if (url.port && !/^\d+$/.test(url.port)) return false;
  return true;
}

export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  return isAllowedBaseUrl(trimmed) ? trimmed : DEFAULT_BASE_URL;
}

type Query = Record<string, string | number | boolean | undefined | null>;

export class OpenCodeClient {
  baseUrl: string;
  private timeoutMs: number;
  headers: Record<string, string> = {};

  constructor(baseUrl: string = DEFAULT_BASE_URL, timeoutMs = 20000) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.timeoutMs = timeoutMs;
  }

  setBaseUrl(url: string) {
    this.baseUrl = normalizeBaseUrl(url);
  }

  private buildUrl(path: string, query?: Query): string {
    const url = new URL(this.baseUrl + path);
    if (query) {
      // Empty strings are meaningful for some endpoints (/file?path= lists the root),
      // so only undefined/null are omitted.
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  async request<T>(
    method: string,
    path: string,
    opts: {
      query?: Query;
      body?: unknown;
      signal?: AbortSignal;
      timeoutMs?: number;
      headers?: Record<string, string>;
      onResponse?: (response: Response) => void;
      allow204?: boolean;
    } = {},
  ): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(
      () => ctrl.abort(new Error("timeout")),
      opts.timeoutMs ?? this.timeoutMs,
    );
    const onAbort = () =>
      ctrl.abort(
        opts.signal?.reason instanceof Error ? opts.signal.reason : undefined,
      );
    if (opts.signal) {
      if (opts.signal.aborted) {
        clearTimeout(timer);
        throw opts.signal.reason ?? new DOMException("Aborted", "AbortError");
      }
      opts.signal.addEventListener("abort", onAbort, { once: true });
    }
    try {
      const res = await fetch(this.buildUrl(path, opts.query), {
        method,
        headers: {
          ...this.headers,
          ...(opts.body !== undefined
            ? { "Content-Type": "application/json" }
            : {}),
          ...opts.headers,
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: ctrl.signal,
        cache: "no-store",
      });
      if (res.status === 204) {
        if (opts.allow204) return undefined as T;
        throw new ApiError(204, "Unexpected empty response");
      }
      if (!res.ok) {
        const text = await res.text();
        let detail = text.slice(0, 400);
        try {
          const parsed = JSON.parse(text);
          detail = parsed.message ?? parsed.error ?? detail;
        } catch {
          /* plain text */
        }
        throw new ApiError(res.status, detail);
      }
      if (opts.allow204) return undefined as T;
      opts.onResponse?.(res);
      return (await res.json()) as T;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if (opts.signal?.aborted) throw opts.signal.reason ?? e;
      if (ctrl.signal.aborted)
        throw new ConnectionError(`Request timed out: ${method} ${path}`);
      throw new ConnectionError(
        `Cannot reach OpenCode server at ${this.baseUrl}`,
      );
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }

  // ---- Health / global ----
  health(signal?: AbortSignal): Promise<HealthInfo> {
    return this.request("GET", "/global/health", { signal, timeoutMs: 6000 });
  }

  providers(
    signal?: AbortSignal,
    directory?: string | null,
  ): Promise<ProviderResponse> {
    return this.request("GET", "/provider", { signal, query: { directory } });
  }

  agents(
    signal?: AbortSignal,
    directory?: string | null,
  ): Promise<AgentInfo[]> {
    return this.request("GET", "/agent", { signal, query: { directory } });
  }

  config(directory?: string | null): Promise<{
    default_agent?: string;
    model?: string;
    compaction?: CompactionConfig;
  }> {
    return this.request("GET", "/config", { query: { directory } });
  }

  defaultAgent(): Promise<string | null> {
    return this.request<Record<string, unknown>>("GET", "/config")
      .then((c) =>
        typeof c?.default_agent === "string" ? c.default_agent : null,
      )
      .catch(() => null);
  }

  // ---- Projects / paths ----
  projects(signal?: AbortSignal): Promise<Project[]> {
    return this.request<Array<Record<string, unknown>>>("GET", "/project", {
      signal,
    }).then((list) =>
      list.map((p) => ({
        id: asString(p.id),
        worktree: asString(p.worktree),
        vcs: typeof p.vcs === "string" ? p.vcs : null,
        sandboxes: Array.isArray(p.sandboxes) ? (p.sandboxes as string[]) : [],
      })),
    );
  }

  paths(directory?: string | null): Promise<{home: string; directory: string; worktree: string}> {
    return this.request("GET", "/path", { query: { directory } });
  }

  vcs(directory: string, signal?: AbortSignal): Promise<VcsInfo | null> {
    return this.request<VcsInfo>("GET", "/vcs", {
      query: { directory },
      signal,
    }).catch(() => null);
  }

  // ---- Sessions ----
  async recentSessions(archived = false, cursor?: number): Promise<{
    sessions: Session[]; cursor: number | null;
  }> {
    let next: number | null = null;
    const rows = await this.request<Array<Record<string, unknown>>>("GET", "/experimental/session", {
      query: { roots: true, archived, limit: 20, cursor },
      onResponse: (res) => {
        const value = res.headers.get("x-next-cursor");
        if (value && Number.isFinite(Number(value))) next = Number(value);
      },
    });
    return { sessions: rows.map(normalizeSession), cursor: next };
  }

  listSessions(
    directory: string | null,
    opts: { limit?: number; signal?: AbortSignal } = {},
  ): Promise<Session[]> {
    return this.request<Array<Record<string, unknown>>>("GET", "/session", {
      query: {
        directory: directory ?? undefined,
        limit: opts.limit,
        roots: undefined,
      },
      signal: opts.signal,
    }).then((list) => list.map(normalizeSession));
  }

  createSession(input: {
    directory: string;
    title?: string;
    permission?: PermissionRule[];
    agent?: string;
    model?: { id: string; providerID: string; variant?: string };
    signal?: AbortSignal;
  }): Promise<Session> {
    return this.request<Record<string, unknown>>("POST", "/session", {
      query: { directory: input.directory },
      body: {
        title: input.title || undefined,
        permission: input.permission,
        agent: input.agent || undefined,
        model: input.model || undefined,
      },
      signal: input.signal,
    }).then(normalizeSession);
  }

  getSession(
    sessionID: string,
    directory: string | null,
    signal?: AbortSignal,
  ): Promise<Session> {
    return this.request<Record<string, unknown>>(
      "GET",
      `/session/${sessionID}`,
      {
        query: { directory: directory ?? undefined },
        signal,
      },
    ).then(normalizeSession);
  }

  updateSession(
    sessionID: string,
    patch: {
      title?: string;
      permission?: PermissionRule[];
      time?: { archived?: number | null };
    },
    directory: string | null,
  ): Promise<Session> {
    return this.request<Record<string, unknown>>(
      "PATCH",
      `/session/${sessionID}`,
      {
        query: { directory: directory ?? undefined },
        body: patch,
      },
    ).then(normalizeSession);
  }

  deleteSession(sessionID: string, directory: string | null): Promise<void> {
    return this.request<void>("DELETE", `/session/${sessionID}`, {
      query: { directory: directory ?? undefined },
      allow204: true,
    });
  }

  sessionStatuses(
    directory: string | null,
    signal?: AbortSignal,
  ): Promise<Record<string, SessionStatus>> {
    return this.request<Record<string, Record<string, unknown>>>(
      "GET",
      "/session/status",
      {
        query: { directory: directory ?? undefined },
        signal,
      },
    ).then((map) =>
      Object.fromEntries(
        Object.entries(map).map(([k, v]) => [k, normalizeStatusType(v)]),
      ),
    );
  }

  // ---- History ----
  messages(
    sessionID: string,
    opts: {
      directory?: string | null;
      limit?: number;
      before?: string;
      signal?: AbortSignal;
    } = {},
  ): Promise<{ messages: MessageResponse[]; before?: string }> {
    type RawMessageItem = {
      info: Record<string, unknown>;
      parts: Array<Record<string, unknown>>;
    };
    let before: string | undefined;
    return this.request<RawMessageItem[]>(
      "GET",
      `/session/${sessionID}/message`,
      {
        query: {
          directory: opts.directory ?? undefined,
          limit: opts.limit,
          before: opts.before,
        },
        signal: opts.signal,
        onResponse: (res) => {
          before = res.headers.get("x-next-cursor") ?? undefined;
        },
      },
    ).then((list) => {
      const messages: MessageResponse[] = [];
      for (const item of list) {
        const info = normalizeMessage(item.info);
        if (!info) continue;
        messages.push({
          info,
          parts: (item.parts ?? []) as unknown as MessagePart[],
        });
      }
      return { messages, before };
    });
  }

  // ---- Execution ----
  prompt(
    sessionID: string,
    directory: string,
    body: PromptRequest,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.request<void>("POST", `/session/${sessionID}/prompt_async`, {
      query: { directory },
      body,
      signal,
      allow204: true,
    });
  }

  abort(sessionID: string, directory: string): Promise<void> {
    return this.request<void>("POST", `/session/${sessionID}/abort`, {
      query: { directory },
      allow204: true,
    });
  }

  summarize(
    sessionID: string,
    directory: string,
    providerID: string,
    modelID: string,
  ): Promise<void> {
    return this.request<void>("POST", `/session/${sessionID}/summarize`, {
      query: { directory },
      body: { providerID, modelID },
      timeoutMs: 180000,
      allow204: true,
    });
  }

  // ---- Interaction ----
  pendingPermissions(
    directory: string | null,
    signal?: AbortSignal,
  ): Promise<PermissionRequest[]> {
    return this.request<PermissionRequest[]>("GET", "/permission", {
      query: { directory: directory ?? undefined },
      signal,
    });
  }

  replyPermission(
    requestID: string,
    reply: "once" | "always" | "reject",
    directory: string,
  ): Promise<void> {
    return this.request<void>("POST", `/permission/${requestID}/reply`, {
      query: { directory },
      body: { reply },
      allow204: true,
    });
  }

  pendingQuestions(
    directory: string | null,
    signal?: AbortSignal,
  ): Promise<QuestionRequest[]> {
    return this.request<QuestionRequest[]>("GET", "/question", {
      query: { directory: directory ?? undefined },
      signal,
    });
  }

  replyQuestion(
    requestID: string,
    answers: string[][],
    directory: string,
  ): Promise<void> {
    return this.request<void>("POST", `/question/${requestID}/reply`, {
      query: { directory },
      body: { answers },
      allow204: true,
    });
  }

  rejectQuestion(requestID: string, directory: string): Promise<void> {
    return this.request<void>("POST", `/question/${requestID}/reject`, {
      query: { directory },
      allow204: true,
    });
  }

  // ---- Files / diff ----
  sessionDiff(
    sessionID: string,
    directory: string,
    signal?: AbortSignal,
  ): Promise<SessionDiffFile[]> {
    return this.request<Array<Record<string, unknown>>>(
      "GET",
      `/session/${sessionID}/diff`,
      {
        query: { directory },
        signal,
      },
    ).then((list) =>
      list.map((f) => ({
        file: asString(f.file ?? f.path),
        before: typeof f.before === "string" ? f.before : undefined,
        after: typeof f.after === "string" ? f.after : undefined,
        additions: typeof f.additions === "number" ? f.additions : undefined,
        deletions: typeof f.deletions === "number" ? f.deletions : undefined,
        status: typeof f.status === "string" ? f.status : undefined,
        patch: typeof f.patch === "string" ? f.patch : undefined,
      })),
    );
  }

  /** mode "git": working tree vs HEAD; mode "branch": vs the merge-base branch point. */
  vcsDiff(
    directory: string,
    opts: {
      mode?: "git" | "branch";
      context?: number;
      signal?: AbortSignal;
    } = {},
  ): Promise<SessionDiffFile[]> {
    return this.request<Array<Record<string, unknown>>>("GET", "/vcs/diff", {
      query: { directory, mode: opts.mode ?? "git", context: opts.context },
      signal: opts.signal,
    }).then((list) =>
      list.map((f) => ({
        file: asString(f.file ?? f.path),
        before: typeof f.before === "string" ? f.before : undefined,
        after: typeof f.after === "string" ? f.after : undefined,
        additions: typeof f.additions === "number" ? f.additions : undefined,
        deletions: typeof f.deletions === "number" ? f.deletions : undefined,
        status: typeof f.status === "string" ? f.status : undefined,
        patch: typeof f.patch === "string" ? f.patch : undefined,
      })),
    );
  }

  fileList(
    directory: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<FileEntry[]> {
    return this.request<FileEntry[]>("GET", "/file", {
      query: { directory, path },
      signal,
    });
  }

  fileContent(
    directory: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<{
    type: string;
    content?: string;
    source?: Record<string, unknown>;
  }> {
    return this.request("GET", "/file/content", {
      query: { directory, path },
      signal,
    });
  }

  vcsStatus(
    directory: string,
    signal?: AbortSignal,
  ): Promise<VcsInfo & { files?: unknown[] }> {
    return this.request("GET", "/vcs/status", { query: { directory }, signal });
  }

  // ---- PTY ---- (verified against 1.18.18: the directory query is required,
  // otherwise /pty/{id} routes answer 404)
  ptyList(directory: string, signal?: AbortSignal): Promise<string[]> {
    return this.request<string[]>("GET", "/pty", {
      query: { directory },
      signal,
    });
  }

  ptyCreate(
    body: { cwd?: string; command?: string; args?: string[]; title?: string },
    directory: string,
  ): Promise<import("./types").PtyInfo> {
    return this.request("POST", "/pty", { query: { directory }, body });
  }

  ptyGet(
    id: string,
    directory: string,
    signal?: AbortSignal,
  ): Promise<import("./types").PtyInfo> {
    return this.request("GET", `/pty/${id}`, { query: { directory }, signal });
  }

  ptyUpdate(
    id: string,
    directory: string,
    patch: { title?: string; size?: { rows: number; cols: number } },
  ): Promise<void> {
    return this.request<void>("PUT", `/pty/${id}`, {
      query: { directory },
      body: patch,
      allow204: true,
    });
  }

  ptyKill(id: string, directory: string): Promise<void> {
    return this.request<void>("DELETE", `/pty/${id}`, {
      query: { directory },
      allow204: true,
    });
  }

  /** 1.18.18 requires an explicit CSRF header and returns `ticket`, not `token`.
   * Tickets are short-lived WebSocket credentials required by this documented API.
   * Never turn authentication/origin rejection into an unauthenticated retry.
   */
  async ptyConnectToken(
    id: string,
    directory: string,
  ): Promise<{ token: string; rejected: boolean }> {
    const r = await this.request<{ ticket: string }>(
      "POST",
      `/pty/${id}/connect-token`,
      {
        query: { directory },
        headers: { "x-opencode-ticket": "1" },
        timeoutMs: 8000,
      },
    );
    if (!r.ticket)
      throw new ApiError(
        200,
        "OpenCode did not return a PTY connection ticket",
      );
    return { token: r.ticket, rejected: false };
  }

  /** WebSocket URL for the PTY byte stream (loopback only, like every endpoint). */
  ptySocketUrl(id: string, directory: string, ticket?: string): string {
    const u = new URL(this.baseUrl + `/pty/${id}/connect`);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    u.searchParams.set("directory", directory);
    if (ticket) u.searchParams.set("ticket", ticket);
    return u.toString();
  }
}

export type { Message, MessagePart, Session };
