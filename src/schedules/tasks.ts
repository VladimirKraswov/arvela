/** Desktop-owned recurring prompts; execution remains owned by the selected agent. */
export interface ScheduledTask {
  id: string; server: string; directory: string; sessionID: string; engine: string;
  title: string; prompt: string; minutes: number;
  model: { providerID: string; modelID: string; variant?: string | null }; agent?: string;
  enabled: boolean; nextAt: number; lastAt?: number;
  state: "ready" | "waiting" | "dispatching" | "sent" | "error"; detail?: string;
}
export type NewScheduledTask = Omit<ScheduledTask, "id" | "enabled" | "nextAt" | "state" | "lastAt" | "detail">;

/** Outcome of one due task. Every kind except "sent" means the agent accepted nothing. */
export type DispatchResult =
  | { kind: "sent" }
  /** The chat, agent or connection is not ready. Checked again later; nothing accumulates. */
  | { kind: "waiting"; detail: string }
  /** The scheduler withdrew the attempt (pause, delete or slow check) before sending. */
  | { kind: "cancelled" };
/** The signal aborts when the attempt is withdrawn. It must never abort a prompt already being sent. */
export type Dispatch = (task: ScheduledTask, signal: AbortSignal) => Promise<DispatchResult>;

/**
 * A definitive reason the prompt was NOT sent and cannot be without the user (chat
 * archived, agent changed, model removed, request refused). The message is written
 * by this app — never a backend body — so it is safe to persist and show.
 */
export class ScheduleBlocked extends Error {
  constructor(message: string) { super(message); this.name = "ScheduleBlocked"; }
}

export interface SchedulerStatus {
  /** "unavailable": durable storage failed; automatic sending stays stopped until restart. */
  storage: "ok" | "unavailable";
  /** Stored entries that could not be read. The original value is kept under a backup key. */
  skipped: number;
  /** Pause/delete the user requested while the task was being checked or sent. */
  pending: Readonly<Record<string, "pause" | "remove">>;
  /** The task this window is dispatching. A "dispatching" task not listed here belongs to another window. */
  flight: string | null;
}

export const TASK_LIMIT = 50;
export const MAX_MINUTES = 10080;
const MINUTE = 60_000;
/** A chat that is busy or waiting for the user is checked again after this delay. */
export const RETRY_MS = 15_000;
/** Read-only checks (and browser preparation) are withdrawn after this long. */
export const PREFLIGHT_MS = 120_000;
/** Past this, an unanswered dispatch is treated as uncertain delivery and paused. */
export const DISPATCH_LIMIT_MS = 180_000;
/** Longer than a whole dispatch, so a live owner never loses its lease mid-flight. */
const LEASE_MS = DISPATCH_LIMIT_MS + 60_000;

const KEY = "ocdesktop.scheduled-prompts.v1";
const BACKUP_KEY = `${KEY}.unreadable`;
const LEASE_KEY = "ocdesktop.scheduled-prompts.lease.v1";
const OWNER_KEY = "ocdesktop.scheduled-prompts.owner";

export const STORAGE_FAILED = "Хранилище расписания недоступно. Автоматическая отправка остановлена до перезапуска Desktop.";
const INTERRUPTED = "Desktop закрылся или потерял связь во время отправки. Проверьте историю чата перед возобновлением.";
const UNCERTAIN = "Отправку не удалось подтвердить. Проверьте историю чата и подключение; затем возобновите вручную.";
const SLOW_CHECK = "Проверка чата заняла слишком много времени; запрос не отправлен. Повторная проверка позже.";

const bounded = (s: unknown, max: number): s is string => typeof s === "string" && !!s.trim() && s.length <= max;
export function validTask(value: unknown): value is ScheduledTask {
  if (!value || typeof value !== "object") return false;
  const t = value as ScheduledTask;
  return bounded(t.id, 128) && bounded(t.server, 4096) && bounded(t.directory, 4096) && bounded(t.sessionID, 512)
    && ["opencode", "pi"].includes(t.engine) && bounded(t.title, 120) && bounded(t.prompt, 20000)
    && Number.isInteger(t.minutes) && t.minutes >= 1 && t.minutes <= MAX_MINUTES
    && !!t.model && typeof t.model === "object" && bounded(t.model.providerID, 512) && bounded(t.model.modelID, 512)
    && (t.model.variant == null || bounded(t.model.variant, 512)) && (t.agent == null || bounded(t.agent, 512))
    && typeof t.enabled === "boolean" && Number.isFinite(t.nextAt) && t.nextAt >= 0
    && (t.lastAt === undefined || (Number.isFinite(t.lastAt) && t.lastAt >= 0))
    && ["ready", "waiting", "dispatching", "sent", "error"].includes(t.state)
    && (t.detail === undefined || typeof t.detail === "string" && t.detail.length <= 2000);
}
/** Only known fields are kept, so stored data never carries arbitrary payloads forward. */
function normalizeTask(t: ScheduledTask): ScheduledTask {
  return {
    id: t.id, server: t.server, directory: t.directory, sessionID: t.sessionID, engine: t.engine,
    title: t.title, prompt: t.prompt, minutes: t.minutes,
    model: { providerID: t.model.providerID, modelID: t.model.modelID, ...(t.model.variant !== undefined ? { variant: t.model.variant } : {}) },
    ...(t.agent != null ? { agent: t.agent } : {}),
    enabled: t.enabled, nextAt: t.nextAt, ...(t.lastAt !== undefined ? { lastAt: t.lastAt } : {}),
    state: t.state, ...(t.detail !== undefined ? { detail: t.detail } : {}),
  };
}
/** Valid entries, plus a count of everything that was rejected (corrupt, duplicate or over the limit). */
export function parseTasks(raw: string | null): { tasks: ScheduledTask[]; skipped: number } {
  if (!raw) return { tasks: [], skipped: 0 };
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return { tasks: [], skipped: 1 }; }
  if (!Array.isArray(value)) return { tasks: [], skipped: 1 };
  const tasks: ScheduledTask[] = [], ids = new Set<string>();
  let skipped = 0;
  for (const item of value) {
    if (!validTask(item) || ids.has(item.id) || tasks.length >= TASK_LIMIT) { skipped++; continue; }
    ids.add(item.id); tasks.push(normalizeTask(item));
  }
  return { tasks, skipped };
}

interface Lease { owner: string; until: number }
function parseLease(raw: string | null): Lease | null {
  try {
    const value = JSON.parse(raw ?? "null") as Lease | null;
    return value && typeof value.owner === "string" && Number.isFinite(value.until) ? value : null;
  } catch { return null; }
}

type Outcome = DispatchResult | { kind: "blocked"; detail: string } | { kind: "uncertain" };
export interface TaskStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface SchedulerOptions {
  /**
   * Identity of this window. With it, windows sharing the profile take turns through
   * a storage lease, so two of them never dispatch at once. Omitted in unit tests.
   */
  owner?: string;
}

/**
 * Durable state lives in storage and is re-read before every change, so an edit
 * made by another window is never overwritten with a stale copy.
 */
export class TaskScheduler {
  private tasks: ScheduledTask[] = [];
  private raw: string | null | undefined;
  private info: SchedulerStatus = { storage: "ok", skipped: 0, pending: {}, flight: null };
  private listeners = new Set<() => void>();
  private flight: { id: string; abort: AbortController } | null = null;
  private retryAt = new Map<string, number>();

  constructor(private storage: TaskStorage, private options: SchedulerOptions = {}) {
    if (!this.reload()) return;
    const now = Date.now();
    // A live window that owns the lease may be dispatching right now: leave its state alone.
    if (this.leaseHeldByOther(now)) return;
    let changed = false;
    const next = this.tasks.map(t => {
      if (t.state === "dispatching") { changed = true; return { ...t, enabled: false, state: "error" as const, detail: INTERRUPTED }; }
      // A late relaunch never produces a burst of missed prompts.
      if (t.nextAt < now) { changed = true; return { ...t, nextAt: now + t.minutes * MINUTE }; }
      return t;
    });
    if (changed) try { this.settle(next); } catch { /* status() reports the storage failure */ }
  }

  snapshot = () => this.tasks;
  status = () => this.info;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  /** Another window changed the stored schedule. */
  refresh() { this.reload(); }

  add(input: NewScheduledTask, now = Date.now()) {
    this.fresh();
    const candidate = { ...input, id: crypto.randomUUID(), enabled: true, nextAt: now + input.minutes * MINUTE, state: "ready" as const };
    if (!validTask(candidate)) throw new Error("Проверьте название, текст и интервал задания.");
    if (this.tasks.length >= TASK_LIMIT) throw new Error(`Можно сохранить до ${TASK_LIMIT} заданий. Удалите ненужные.`);
    const task = normalizeTask(candidate);
    this.persist([...this.tasks, task]);
    return task;
  }

  /** Pause or resume. Resuming starts a full interval from now; nothing is sent immediately. */
  toggle(id: string, now = Date.now()) {
    if (this.flight?.id === id) { this.request(id, "pause"); return; }
    this.fresh();
    const task = this.tasks.find(t => t.id === id);
    if (!task || task.state === "dispatching") return; // another window is sending it right now
    this.retryAt.delete(id);
    this.persist(this.tasks.map(t => t.id === id
      ? { ...t, enabled: !t.enabled, state: "ready", detail: undefined, nextAt: now + t.minutes * MINUTE } : t));
  }

  /** A task being checked is withdrawn; one being sent is removed once the send settles. */
  remove(id: string) {
    if (this.flight?.id === id) { this.request(id, "remove"); return; }
    this.fresh();
    const task = this.tasks.find(t => t.id === id);
    if (!task || task.state === "dispatching") return;
    this.retryAt.delete(id);
    this.persist(this.tasks.filter(t => t.id !== id));
  }

  async tick(server: string, dispatch: Dispatch, now = Date.now()) {
    if (this.flight || !this.reload() || !this.holdLease(now)) return;
    this.recoverOrphans();
    const task = this.tasks
      .filter(t => t.enabled && t.server === server && t.state !== "dispatching" && t.nextAt <= now && (this.retryAt.get(t.id) ?? 0) <= now)
      .reduce<ScheduledTask | undefined>((first, t) => !first || t.nextAt < first.nextAt ? t : first, undefined);
    if (!task) return;
    const abort = new AbortController();
    this.flight = { id: task.id, abort };
    this.update({ flight: task.id });
    let timedOut = false, limit: ReturnType<typeof setTimeout> | undefined;
    const preflight = setTimeout(() => { timedOut = true; abort.abort(new Error("timeout")); }, PREFLIGHT_MS);
    try {
      // Persisted before any agent side effect; a crash from here on pauses the task.
      this.persist(this.tasks.map(t => t.id === task.id ? { ...t, state: "dispatching", detail: undefined } : t));
      let outcome: Outcome;
      try {
        const result = await Promise.race([
          dispatch(task, abort.signal),
          new Promise<"limit">(resolve => { limit = setTimeout(() => resolve("limit"), DISPATCH_LIMIT_MS); }),
        ]);
        outcome = result === "limit" ? { kind: "uncertain" } : result;
      } catch (error) {
        // Never persist backend error bodies (they may contain credentials) or retry ambiguous delivery.
        outcome = error instanceof ScheduleBlocked ? { kind: "blocked", detail: error.message.slice(0, 2000) } : { kind: "uncertain" };
      }
      if (outcome.kind === "cancelled" && timedOut && !this.info.pending[task.id]) outcome = { kind: "waiting", detail: SLOW_CHECK };
      this.finish(task.id, outcome, now);
    } finally {
      clearTimeout(preflight); clearTimeout(limit);
      this.flight = null;
      const pending = { ...this.info.pending };
      delete pending[task.id];
      this.update({ pending, flight: null });
    }
  }

  /** Let another window take over at once when this one closes normally. */
  releaseLease() {
    const owner = this.options.owner;
    if (!owner) return;
    try {
      if (parseLease(this.storage.getItem(LEASE_KEY))?.owner === owner)
        this.storage.setItem(LEASE_KEY, JSON.stringify({ owner, until: 0 }));
    } catch { /* the lease expires on its own */ }
  }

  private finish(id: string, outcome: Outcome, now: number) {
    const intent = this.info.pending[id];
    this.reload(); // apply to the freshest copy; when storage failed, to the in-memory one
    if (outcome.kind === "waiting" && !intent) this.retryAt.set(id, now + RETRY_MS);
    else this.retryAt.delete(id);
    const at = Date.now();
    const apply = (t: ScheduledTask): ScheduledTask[] => {
      if (intent === "remove") return [];
      let next: ScheduledTask;
      switch (outcome.kind) {
        case "sent": next = { ...t, state: "sent", detail: undefined, lastAt: at, nextAt: at + t.minutes * MINUTE }; break;
        case "waiting": next = { ...t, state: "waiting", detail: outcome.detail.slice(0, 2000) }; break;
        case "cancelled": next = { ...t, state: "ready", detail: undefined }; break;
        case "blocked": next = { ...t, enabled: false, state: "error", detail: outcome.detail }; break;
        default: next = { ...t, enabled: false, state: "error", detail: UNCERTAIN }; // uncertain delivery
      }
      if (intent === "pause" && next.enabled)
        next = { ...next, enabled: false, state: next.state === "sent" ? "sent" : "ready", detail: undefined };
      return [next];
    };
    this.settle(this.tasks.flatMap(t => t.id === id ? apply(t) : [t]));
  }

  /** "dispatching" without a live flight belongs to a window that closed or lost its lease. */
  private recoverOrphans() {
    if (!this.tasks.some(t => t.state === "dispatching")) return;
    this.settle(this.tasks.map(t => t.state === "dispatching" ? { ...t, enabled: false, state: "error" as const, detail: INTERRUPTED } : t));
  }

  private request(id: string, intent: "pause" | "remove") {
    if (this.info.pending[id] === "remove") return;
    this.update({ pending: { ...this.info.pending, [id]: intent } });
    // The dispatcher stops before sending; a prompt already being sent is never aborted.
    this.flight?.abort.abort(new Error("withdrawn"));
  }

  /** Re-read durable state. False when storage is unusable; the in-memory copy is then kept. */
  private reload(): boolean {
    if (this.info.storage !== "ok") return false;
    let raw: string | null;
    try { raw = this.storage.getItem(KEY); } catch { this.halt(); return false; }
    if (raw === this.raw) return true;
    const parsed = parseTasks(raw);
    if (parsed.skipped && raw && !this.keepUnreadable(raw)) return false;
    this.raw = raw;
    this.tasks = parsed.tasks;
    this.update({ skipped: parsed.skipped });
    return true;
  }
  private fresh() { if (!this.reload()) throw new Error(STORAGE_FAILED); }
  private persist(next: ScheduledTask[]) {
    const raw = JSON.stringify(next);
    try { this.storage.setItem(KEY, raw); } catch { this.halt(); throw new Error(STORAGE_FAILED); }
    this.raw = raw; this.tasks = next; this.notify();
  }
  /** Record an outcome. If storage fails, memory still reflects it, so a sent prompt is never due again. */
  private settle(next: ScheduledTask[]) {
    try { this.persist(next); } catch (error) { this.tasks = next; this.notify(); throw error; }
  }
  /** Unreadable entries are dropped from the live list, but never silently destroyed. */
  private keepUnreadable(raw: string): boolean {
    try {
      if (this.storage.getItem(BACKUP_KEY) !== raw) this.storage.setItem(BACKUP_KEY, raw);
      return true;
    } catch { this.halt(); return false; } // never overwrite records without a verified backup
  }
  private halt() { if (this.info.storage !== "unavailable") this.update({ storage: "unavailable" }); }
  private update(patch: Partial<SchedulerStatus>) { this.info = { ...this.info, ...patch }; this.notify(); }
  private notify() { this.listeners.forEach(listener => listener()); }

  private holdLease(now: number): boolean {
    const owner = this.options.owner;
    if (!owner) return true;
    try {
      const lease = parseLease(this.storage.getItem(LEASE_KEY));
      if (lease && lease.owner !== owner && lease.until > now) return false;
      this.storage.setItem(LEASE_KEY, JSON.stringify({ owner, until: now + LEASE_MS }));
      return parseLease(this.storage.getItem(LEASE_KEY))?.owner === owner;
    } catch { this.halt(); return false; }
  }
  private leaseHeldByOther(now: number): boolean {
    const owner = this.options.owner;
    if (!owner) return false;
    try {
      const lease = parseLease(this.storage.getItem(LEASE_KEY));
      return !!lease && lease.owner !== owner && lease.until > now;
    } catch { return false; }
  }
}

/** Survives a reload of the same window, so the reloaded page reclaims its own lease at once. */
function windowOwner(): string {
  try {
    const id = sessionStorage.getItem(OWNER_KEY) || crypto.randomUUID();
    sessionStorage.setItem(OWNER_KEY, id);
    return id;
  } catch { return crypto.randomUUID(); }
}

let instance: TaskScheduler | undefined;
/** One scheduler per window; windows sharing the profile coordinate through the lease. */
export function taskScheduler(): TaskScheduler {
  if (instance) return instance;
  // Access to the property itself can throw (disabled storage/private WebViews).
  // Delay it until the scheduler's guarded read/write path so the app still opens.
  const storage: TaskStorage = {
    getItem: key => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
  };
  const scheduler = new TaskScheduler(storage, { owner: windowOwner() });
  instance = scheduler;
  if (typeof window !== "undefined") {
    window.addEventListener("storage", event => { if (event.key === null || event.key === KEY) scheduler.refresh(); });
    window.addEventListener("pagehide", () => scheduler.releaseLease());
  }
  return scheduler;
}
