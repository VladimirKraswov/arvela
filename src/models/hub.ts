import {retryHub} from '../hub/retry';
import {HubRequestError} from '../hub/errors';
import { capabilityNative } from "../capabilities/integration";
import { hubOrigin } from "../hub/identity";
import { validStatus, type SwitchStatus } from "./services";

export interface HubRoute { service: string; label: string; providerID: string; modelID: string; agent: string; target: string }
interface Lease { ticket: string; owner: string; route: HubRoute; scope: string; since: number; seenActive?: boolean }
export interface ModelHubTransport {
  identity(): Promise<string | null>;
  request<T>(path: string, body: unknown | undefined, scope: string): Promise<T>;
}
const nativeTransport: ModelHubTransport = {
  async identity() {
    const config = await capabilityNative<{enabled: boolean; endpoint: string; certificate: string}>("hub_config", {config: null, key: null, expected: null});
    return config.enabled && config.endpoint ? hubOrigin(config) : null;
  },
  request: (path, body, scope) => capabilityNative("hub_request", {path: `model-services/${path}`, body: body ?? null, expected: scope}),
};
const CACHE = "arvela.model-coordinator.v1";

/** The Hub owns coordination. The UI only holds cancellable readiness waits and
 * renews reservations for genuinely running sessions; it never runs an agent loop. */
export class HubModelServices {
  private recoveries = new Map<symbol, string>();
  private routes: HubRoute[] = [];
  private knownRoutes: HubRoute[] = [];
  private scope = "";
  private states = new Map<string, SwitchStatus>();
  private leases = new Map<string, Lease>();
  private pending = new Map<string, string>();
  private listeners = new Set<() => void>();
  private refreshing?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private renewing = false;
  private started = Date.now();
  private generation = 0;
  private enabled = false;
  private flights = new Map<string, {task: Promise<void>; signal?: AbortSignal}>();
  constructor(private transport: ModelHubTransport = nativeTransport,
    private active: (owner: string) => boolean = () => false) {}
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit() { this.listeners.forEach(fn => fn()); }
  configuredRoutes(): readonly HubRoute[] { return this.routes; }
  configured() { return this.enabled; }
  connectionChanged() { this.generation++; this.refreshing = undefined; this.recoveries.clear(); }
  route(providerID: string, modelID: string, agent?: string) {
    return [...this.routes, ...this.knownRoutes].find(r => r.providerID === providerID && r.modelID === modelID && (!agent || r.agent === agent));
  }
  status(providerID: string, modelID: string, context?: string, agent?: string) {
    const route = this.route(providerID, modelID, agent);
    if (!route) return;
    const state = this.states.get(this.stateKey(route, context));
    const notices = [...this.recoveries.values()];
    const detail = notices[notices.length - 1];
    return detail ? {schema: 1 as const, operation_id: null, active_model: null, target_model: route.target,
      elapsed_seconds: 0, active_requests: 0, loader: null, error: null, ...state, phase: 'reconnecting', ready: false, detail} : state;
  }
  private async request<T>(path: string, body: unknown, scope: string, signal?: AbortSignal, check?: () => void): Promise<T> {
    const generation = this.generation, token = Symbol();
    const current = () => {
      if (generation !== this.generation || scope !== this.scope) throw new Error('Подключение Hub изменилось; повтор отменён.');
      check?.();
    };
    try {
      return await retryHub(() => this.transport.request<T>(path, body, scope), {
        safe: path === 'catalog' || path === 'status' || path === 'prepare' && !!(body as {requestKey?: string})?.requestKey,
        signal, current,
        onRetry: (attempt,total) => { this.recoveries.set(token, `Восстанавливаем связь с Hub: попытка ${attempt} из ${total}. Запрос сохранён.`); this.emit(); },
      });
    } finally { if (this.recoveries.delete(token)) this.emit(); }
  }
  private stateKey(route: HubRoute, context?: string) { return JSON.stringify([route.agent, route.providerID, route.modelID, context ?? "@selection"]); }
  private publish(route: HubRoute, value: SwitchStatus, context?: string) {
    if (!validStatus(value)) throw new Error("Hub вернул неподдерживаемый статус модели.");
    this.states.set(this.stateKey(route, context), value); this.emit();
  }
  private save() {
    try { localStorage.setItem(CACHE, JSON.stringify({scope: this.scope, routes: this.knownRoutes, leases: [...this.leases.values()], pending: [...this.pending]})); }
    catch { /* Reservations still expire on the Hub; no credential is stored here. */ }
  }
  refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    const task = this.load(); this.refreshing = task;
    void task.finally(() => { if (this.refreshing === task) this.refreshing = undefined; }).catch(() => {});
    return task;
  }
  private async load() {
    const generation = this.generation;
    const scope = await this.transport.identity();
    if (generation !== this.generation) throw new Error("Подключение Hub изменилось.");
    this.enabled = !!scope;
    if (!scope) throw new Error("Подключите Hub для переключения этой модели.");
    if (scope !== this.scope) {
      this.scope = scope; this.routes = []; this.knownRoutes = []; this.leases.clear(); this.pending.clear(); this.states.clear();
      try {
        const cache = JSON.parse(localStorage.getItem(CACHE) || "null");
        if (cache?.scope === scope && Array.isArray(cache.routes) && Array.isArray(cache.leases)) {
          this.routes = cache.routes.filter(validRoute);
          this.knownRoutes = this.routes;
          for (const pair of Array.isArray(cache.pending) ? cache.pending.slice(0, 128) : [])
            if (Array.isArray(pair) && typeof pair[0] === "string" && pair[0].length < 1024 && /^[a-f0-9-]{36}$/.test(pair[1])) this.pending.set(pair[0], pair[1]);
          for (const lease of cache.leases)
            if (validRoute(lease?.route) && typeof lease.owner === "string" && Number.isFinite(lease.since) && /^[a-f0-9-]{36}$/.test(lease.ticket) && lease.scope === scope)
              this.leases.set(lease.owner, lease);
        }
      } catch { /* Corrupt cache grants no access; fresh Hub catalog is required. */ }
    }
    const catalog = await this.request<{schema: number; routes: HubRoute[]}>("catalog", undefined, scope);
    if (catalog.schema !== 1 || !Array.isArray(catalog.routes) || !catalog.routes.every(validRoute))
      throw new Error("Hub вернул неподдерживаемый каталог сервисов.");
    if (this.scope !== scope || generation !== this.generation) throw new Error("Подключение Hub изменилось.");
    this.knownRoutes = [...this.knownRoutes.filter(old => !catalog.routes.some(r => r.providerID === old.providerID && r.modelID === old.modelID && r.agent === old.agent)), ...catalog.routes];
    this.routes = catalog.routes; this.save(); this.emit();
  }
  start() {
    if (this.timer) return;
    void this.refresh().catch(() => {});
    this.timer = setInterval(() => { void this.renew(); }, 15_000);
  }
  dispose() { clearInterval(this.timer); this.timer = undefined; }
  async check(providerID: string, modelID: string, agent: string) {
    await this.refresh();
    const route = this.route(providerID, modelID, agent);
    if (!route) throw new Error("У модели нет привязки к Hub.");
    const state = await this.transport.request<SwitchStatus>("inspect", {providerID, modelID, agent}, this.scope);
    this.publish(route, state);
    if (!state.ready || state.phase !== "ready" || state.active_model !== route.target)
      throw new Error("Сервис доступен, но эта модель сейчас не готова.");
  }
  async ensure(providerID: string, modelID: string, agent: string, owner?: string, signal?: AbortSignal, context = owner) {
    const key = JSON.stringify([providerID, modelID, agent, owner, context]);
    const flight = this.flights.get(key);
    if (flight && !flight.signal?.aborted) return flight.task;
    const task = this.prepare(providerID, modelID, agent, owner, signal, context);
    this.flights.set(key, {task, signal});
    try { await task; } finally { if (this.flights.get(key)?.task === task) this.flights.delete(key); }
  }
  private async prepare(providerID: string, modelID: string, agent: string, owner?: string, signal?: AbortSignal, context = owner) {
    const route = this.route(providerID, modelID, agent);
    if (!route) throw new Error("Модель недоступна выбранному агенту в каталоге Hub.");
    const scope = this.scope;
    const generation = this.generation;
    const current = () => {
      signal?.throwIfAborted();
      const currentRoute = this.route(providerID, modelID, agent);
      if (scope !== this.scope || generation !== this.generation || currentRoute?.target !== route.target || currentRoute.service !== route.service)
        throw new Error("Каталог или подключение Hub изменились; отправка отменена.");
    };
    this.publish(route, {schema: 1, operation_id: null, phase: "checking", ready: false, active_model: null,
      target_model: route.target, elapsed_seconds: 0, active_requests: 0, loader: null, error: null}, context);
    let ticket: string | undefined;
    let created = false;
    const pendingKey = JSON.stringify([providerID, modelID, agent, owner, context]);
    try {
      current();
      const existing = owner && this.leases.get(owner);
      let state!: SwitchStatus;
      let needsPrepare = true;
      const stale = (error: unknown) => error instanceof HubRequestError && error.code === 'lease_expired';
      if (existing && existing.scope === scope && existing.route.target === route.target && existing.route.service === route.service) {
        ticket = existing.ticket;
        try {
          state = await this.request<SwitchStatus>("status", {ticket}, scope, signal, current);
          needsPrepare = false;
        } catch (error) {
          if (!stale(error) || this.active(owner!)) throw error;
          current();
          if (this.leases.get(owner!) === existing) this.leases.delete(owner!);
          this.pending.delete(pendingKey); this.save(); ticket = undefined;
        }
      }
      if (needsPrepare) {
        if (owner) await this.release(owner);
        current();
        let requestKey = this.pending.get(pendingKey) ?? crypto.randomUUID();
        this.pending.set(pendingKey, requestKey); this.save();
        const prepare = () => this.request<SwitchStatus>("prepare", {providerID, modelID, agent, mode: owner ? "run" : "select", requestKey}, scope, signal, current);
        try { state = await prepare(); }
        catch (error) {
          // A rejected expired/conflicting key cannot represent an accepted new
          // operation. Recover ONCE before dispatch; never change an active run.
          if (!stale(error) || owner && this.active(owner)) throw error;
          current(); requestKey = crypto.randomUUID(); this.pending.set(pendingKey, requestKey); this.save();
          state = await prepare();
        }
        ticket = state.operation_id ?? undefined;
        created = true;
      }
      const deadline = Date.now() + 31 * 60_000;
      for (;;) {
        current(); this.publish(route, state, context);
        if (!ticket || state.operation_id !== ticket || state.target_model !== route.target)
          throw new Error("Hub изменил заявку; запрос агенту не отправлен.");
        if (state.error || state.phase === "failed") throw new Error(state.error || "Загрузка модели не удалась.");
        if (state.ready && state.phase === "ready" && state.active_model === route.target) break;
        if (Date.now() >= deadline) throw new Error("Истекло время ожидания модели; черновик сохранён.");
        await new Promise(resolve => setTimeout(resolve, 800)); current();
        state = await this.request<SwitchStatus>("status", {ticket}, scope, signal, current);
      }
      if (owner) { this.leases.set(owner, {ticket, owner, route, scope, since: Date.now()}); this.save(); }
      this.pending.delete(pendingKey); this.save();
    } catch (error) {
      if (ticket && created) await this.transport.request("release", {ticket}, scope).catch(() => {});
      const detail = signal?.aborted ? "Подготовка модели отменена." : error instanceof Error ? error.message : String(error);
      if (ticket || error instanceof HubRequestError && error.code === 'http' && (error.status ?? 0) < 500 || /Hub HTTP 4\d\d\b/.test(detail)) { this.pending.delete(pendingKey); this.save(); }
      if (scope === this.scope && generation === this.generation) this.publish(route, {schema: 1, operation_id: ticket ?? null, phase: signal?.aborted ? "cancelled" : "failed", ready: false,
        active_model: null, target_model: route.target, elapsed_seconds: 0, active_requests: 0, loader: null, error: signal?.aborted ? null : detail}, context);
      throw new Error(detail);
    }
  }
  async release(owner: string) {
    const lease = this.leases.get(owner); if (!lease) return;
    await this.transport.request("release", {ticket: lease.ticket}, lease.scope);
    if (this.leases.get(owner) === lease) { this.leases.delete(owner); this.save(); }
  }
  async renew() {
    if (this.renewing) return;
    this.renewing = true;
    try {
      for (const lease of this.leases.values()) {
        // Startup resynchronization and POST acknowledgement can lag the UI.
        if (!this.active(lease.owner) && (lease.seenActive || Date.now() - Math.max(lease.since, this.started) > 60_000))
          await this.release(lease.owner).catch(() => {});
        else await this.transport.request<SwitchStatus>("status", {ticket: lease.ticket}, lease.scope)
          .then(state => {
            const current = this.route(lease.route.providerID, lease.route.modelID, lease.route.agent);
            if (this.leases.get(lease.owner) === lease && current?.service === lease.route.service && current.target === lease.route.target)
              this.publish(lease.route, state, lease.owner);
          }).catch(() => {});
      }
    } finally { this.renewing = false; }
  }
  observeActivity() {
    let changed = false;
    for (const lease of this.leases.values()) if (!lease.seenActive && this.active(lease.owner)) {
      lease.seenActive = true; changed = true;
    }
    if (changed) this.save();
  }
}
function validRoute(value: unknown): value is HubRoute {
  if (!value || typeof value !== "object") return false;
  const r = value as HubRoute;
  return [r.service, r.label, r.providerID, r.modelID, r.target].every(v => typeof v === "string" && v.length > 0 && v.length <= 200)
    && (r.agent === "opencode" || r.agent === "pi");
}
