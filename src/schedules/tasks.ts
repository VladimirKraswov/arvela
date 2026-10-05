/** Desktop-owned recurring prompts; execution remains owned by the selected agent. */
export interface ScheduledTask {
  id: string; server: string; directory: string; sessionID: string; engine: string;
  title: string; prompt: string; minutes: number;
  model: { providerID: string; modelID: string; variant?: string | null }; agent?: string;
  enabled: boolean; nextAt: number; lastAt?: number;
  state: "ready" | "waiting" | "dispatching" | "sent" | "error"; detail?: string;
}
export type DispatchResult = { kind: "sent" } | { kind: "waiting"; detail: string };
const KEY = "ocdesktop.scheduled-prompts.v1";
const bounded = (s: unknown, max: number): s is string => typeof s === "string" && !!s.trim() && s.length <= max;
export function validTask(value: unknown): value is ScheduledTask {
  if (!value || typeof value !== "object") return false;
  const t = value as ScheduledTask;
  return bounded(t.id, 128) && bounded(t.server, 4096) && bounded(t.directory, 4096) && bounded(t.sessionID, 512)
    && ["opencode", "pi"].includes(t.engine) && bounded(t.title, 120) && bounded(t.prompt, 20000)
    && Number.isInteger(t.minutes) && t.minutes >= 1 && t.minutes <= 10080
    && !!t.model && bounded(t.model.providerID, 512) && bounded(t.model.modelID, 512)
    && (t.model.variant == null || bounded(t.model.variant, 512)) && (t.agent == null || bounded(t.agent, 512))
    && typeof t.enabled === "boolean" && Number.isFinite(t.nextAt) && t.nextAt >= 0
    && (t.lastAt === undefined || (Number.isFinite(t.lastAt) && t.lastAt >= 0))
    && ["ready", "waiting", "dispatching", "sent", "error"].includes(t.state)
    && (t.detail === undefined || typeof t.detail === "string" && t.detail.length <= 2000);
}
export interface TaskStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export class TaskScheduler {
  private tasks: ScheduledTask[] = [];
  private listeners = new Set<() => void>();
  private flight = false;
  private retryAt = new Map<string, number>();
  constructor(private storage: TaskStorage) {
    try {
      const raw: unknown = JSON.parse(storage.getItem(KEY) || "[]");
      if (Array.isArray(raw)) this.tasks = raw.filter(validTask).slice(0, 50).map(t => t.state === "dispatching"
        ? { ...t, enabled: false, state: "error", detail: "Приложение закрылось во время отправки. Проверьте историю перед возобновлением." } : t);
      // A late wake/relaunch never produces a burst of missed prompts.
      const now = Date.now(); this.tasks = this.tasks.map(t => t.nextAt < now ? { ...t, nextAt: now + t.minutes * 60000 } : t);
    } catch { this.tasks = []; }
  }
  snapshot = () => this.tasks;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private write(next: ScheduledTask[]) {
    this.storage.setItem(KEY, JSON.stringify(next)); // fail closed before any agent side effect
    this.tasks = next; this.listeners.forEach(l => l());
  }
  add(task: Omit<ScheduledTask, "id" | "enabled" | "nextAt" | "state">, now = Date.now()) {
    const next: ScheduledTask = { ...task, id: crypto.randomUUID(), enabled: true, nextAt: now + task.minutes * 60000, state: "ready" };
    if (!validTask(next)) throw new Error("Проверьте название, текст и интервал задания.");
    if (this.tasks.length >= 50) throw new Error("Можно сохранить до 50 заданий. Удалите ненужные.");
    this.write([...this.tasks, next]); return next;
  }
  toggle(id: string, now = Date.now()) {
    if (this.tasks.find(t => t.id === id)?.state === "dispatching") return;
    this.write(this.tasks.map(t => t.id === id ? { ...t, enabled: !t.enabled, state: "ready", detail: undefined, nextAt: now + t.minutes * 60000 } : t));
  }
  remove(id: string) {
    if (this.tasks.find(t => t.id === id)?.state === "dispatching") return;
    this.write(this.tasks.filter(t => t.id !== id)); this.retryAt.delete(id);
  }
  async tick(server: string, dispatch: (task: ScheduledTask) => Promise<DispatchResult>, now = Date.now()) {
    if (this.flight) return;
    const task = this.tasks.find(t => t.enabled && t.server === server && t.nextAt <= now && (this.retryAt.get(t.id) || 0) <= now);
    if (!task) return;
    this.flight = true;
    try {
      this.write(this.tasks.map(t => t.id === task.id ? { ...t, state: "dispatching", detail: undefined } : t));
      let result: DispatchResult;
      try { result = await dispatch(task); }
      catch {
        // Do not store backend error bodies (may contain credentials) or retry ambiguous delivery.
        this.write(this.tasks.map(t => t.id === task.id ? { ...t, enabled: false, state: "error", detail: "Отправку не удалось подтвердить. Проверьте историю и подключение; затем возобновите вручную." } : t));
        return;
      }
      if (result.kind === "waiting") {
        this.retryAt.set(task.id, now + 15000);
        this.write(this.tasks.map(t => t.id === task.id ? { ...t, state: "waiting", detail: result.detail } : t));
      } else {
        this.retryAt.delete(task.id);
        this.write(this.tasks.map(t => t.id === task.id ? { ...t, state: "sent", detail: undefined, lastAt: Date.now(), nextAt: Date.now() + t.minutes * 60000 } : t));
      }
    } finally { this.flight = false; }
  }
}
let instance: TaskScheduler | undefined;
export function taskScheduler() { return instance ??= new TaskScheduler(localStorage); }
