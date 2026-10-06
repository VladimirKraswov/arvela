import { systemCredentials, type CredentialStore } from "./credentials";
import { isAllowedBaseUrl, OpenCodeClient } from "../api/client";

/** Persisted routing contains no credential and no model-name heuristics. */
export interface ModelService {
  id: string;
  providerID: string;
  endpoint: string;
  bindings: Record<string, string>;
}
export interface ServiceModel {
  id: string;
  label: string;
  agents: string[];
  context_window?: number;
}
export interface SwitchStatus {
  schema: 1;
  operation_id: string | null;
  phase: string;
  ready: boolean;
  active_model: string | null;
  target_model: string | null;
  elapsed_seconds: number;
  active_requests: number;
  error: string | null;
  loader: {
    phase: string;
    unit: "bytes" | null;
    current: number;
    total: number;
  } | null;
}
export interface ServiceSnapshot {
  revision: number;
  states: Record<string, SwitchStatus>;
  errors: Record<string, string>;
}
const EMPTY: ServiceSnapshot = { revision: 0, states: {}, errors: {} };

export function validateServices(services: unknown): string | null {
  if (!Array.isArray(services)) return "Список сервисов повреждён.";
  const ids = new Set<string>(),
    bindings = new Set<string>();
  for (const service of services) {
    if (
      !service ||
      typeof service.id !== "string" ||
      typeof service.providerID !== "string" ||
      typeof service.endpoint !== "string" ||
      !service.bindings ||
      typeof service.bindings !== "object" ||
      Array.isArray(service.bindings)
    )
      return "Настройки сервиса повреждены.";
    if (!service.id.trim() || ids.has(service.id))
      return "У сервисов должны быть разные непустые имена.";
    ids.add(service.id);
    if (!isAllowedBaseUrl(service.endpoint))
      return "Укажите локальный HTTP-адрес SSH-туннеля без пути и учётных данных.";
    if (!service.providerID.trim() || !Object.keys(service.bindings).length)
      return "Укажите провайдера и соответствие моделей.";
    for (const [source, target] of Object.entries(service.bindings)) {
      if (!source.trim() || typeof target !== "string" || !target.trim())
        return "Идентификаторы моделей не могут быть пустыми.";
      const key = `${service.providerID}/${source}`;
      if (bindings.has(key))
        return "Модель может принадлежать только одному сервису.";
      bindings.add(key);
    }
  }
  return null;
}

function validStatus(value: SwitchStatus): boolean {
  const textOrNull = (v: unknown) => v === null || typeof v === "string";
  const counter = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0;
  return (
    !!value &&
    value.schema === 1 &&
    typeof value.ready === "boolean" &&
    typeof value.phase === "string" &&
    textOrNull(value.operation_id) &&
    textOrNull(value.active_model) &&
    textOrNull(value.target_model) &&
    textOrNull(value.error) &&
    counter(value.elapsed_seconds) &&
    counter(value.active_requests) &&
    (value.loader === null ||
      (!!value.loader &&
        typeof value.loader.phase === "string" &&
        (value.loader.unit === null || value.loader.unit === "bytes") &&
        counter(value.loader.current) &&
        counter(value.loader.total)))
  );
}

export class ModelServices {
  private services: ModelService[] = [];
  private catalogs = new Map<string, ServiceModel[]>();
  private keys = new Map<string, string>();
  private flights = new Map<
    string,
    { model: string; promise: Promise<void> }
  >();
  private listeners = new Set<() => void>();
  private value = EMPTY;
  private generation = 0;
  private restored = new Map<string, Promise<void>>();
  private credentialRevision = 0;
  constructor(private credentials: CredentialStore = systemCredentials) {}
  private restore(service: ModelService): Promise<void> {
    if (this.keys.has(service.endpoint)) return Promise.resolve();
    let pending = this.restored.get(service.endpoint);
    if (!pending) {
      const gen = this.generation;
      const revision = this.credentialRevision;
      pending = this.credentials.get(service.endpoint).then((key) => {
        if (key && gen === this.generation && revision === this.credentialRevision && !this.keys.has(service.endpoint)) this.keys.set(service.endpoint, key);
      });
      this.restored.set(service.endpoint, pending);
    }
    return pending;
  }
  async saveKey(id: string, key: string): Promise<void> {
    const service = this.services.find((s) => s.id === id);
    if (!service) throw new Error("Сервис не настроен.");
    await this.credentials.set(service.endpoint, key.trim());
    this.setKey(id, key);
  }
  async forgetKey(id: string): Promise<void> {
    const service = this.services.find((s) => s.id === id);
    if (!service) return;
    await this.credentials.delete(service.endpoint);
    this.credentialRevision++;
    this.generation++;
    this.restored.clear();
    this.catalogs.clear();
    this.keys.delete(service.endpoint);
    this.restored.set(service.endpoint, Promise.resolve());
    for (const item of this.services.filter((s) => s.endpoint === service.endpoint)) this.catalogs.delete(item.id);
    this.emit();
  }
  snapshot = () => this.value;
  catalogFor(id: string): readonly ServiceModel[] | undefined {
    return this.catalogs.get(id);
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private emit(patch: Partial<ServiceSnapshot> = {}) {
    this.value = { ...this.value, ...patch, revision: this.value.revision + 1 };
    this.listeners.forEach((fn) => fn());
  }
  configure(services: ModelService[]) {
    const error = validateServices(services);
    if (error) throw new Error(error);
    this.generation++;
    this.services = structuredClone(services).map((service) => ({
      ...service,
      endpoint: new URL(service.endpoint).origin,
    }));
    this.catalogs.clear();
    this.restored.clear();
    for (const endpoint of this.keys.keys()) {
      if (!this.services.some((service) => service.endpoint === endpoint))
        this.keys.delete(endpoint);
    }
    this.emit({ states: {}, errors: {} });
    for (const service of services)
      void this.refresh(service.id).catch(() => {});
  }
  setKey(id: string, key: string) {
    const service = this.services.find((s) => s.id === id);
    if (!service) throw new Error("Сервис не настроен.");
    this.keys.set(service.endpoint, key.trim());
    for (const item of this.services.filter(
      (s) => s.endpoint === service.endpoint,
    ))
      this.catalogs.delete(item.id);
    this.emit();
  }
  private client(service: ModelService) {
    const client = new OpenCodeClient(service.endpoint, 5000);
    const key = this.keys.get(service.endpoint);
    if (key) client.headers = { Authorization: `Bearer ${key}` };
    return client;
  }
  private route(providerID: string, modelID: string) {
    return this.services.find(
      (service) =>
        service.providerID === providerID && service.bindings[modelID],
    );
  }
  statusFor(providerID: string, modelID: string) {
    const service = this.route(providerID, modelID);
    return service ? this.value.states[service.id] : undefined;
  }
  errorFor(providerID: string, modelID: string) {
    const service = this.route(providerID, modelID);
    return service ? this.value.errors[service.id] : undefined;
  }
  manages(providerID: string, modelID: string): boolean {
    return !!this.route(providerID, modelID);
  }
  allowed(providerID: string, modelID: string, agent: string): boolean {
    const service = this.route(providerID, modelID);
    if (!service) {
      const providerServices = this.services.filter((s) => s.providerID === providerID);
      if (!providerServices.length) return true;
      // Discovery can expose extra IDs from a provider. Registered service models
      // need an explicit routing binding, even when the public ID happens to match.
      if (providerServices.some((s) => !this.catalogs.has(s.id))) return false;
      if (providerServices.some((s) => this.catalogs.get(s.id)?.some((m) => m.id === modelID))) return false;
      return true;
    }
    return (
      this.catalogs
        .get(service.id)
        ?.find((m) => m.id === service.bindings[modelID])
        ?.agents.includes(agent) ?? false
    );
  }
  async refresh(id: string): Promise<ServiceModel[]> {
    const service = this.services.find((s) => s.id === id);
    if (!service) throw new Error("Сервис не настроен.");
    const gen = this.generation;
    try {
      // Browser tests and unmanaged clients have no native vault overhead.
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window || this.credentials !== systemCredentials) await this.restore(service);
      if (gen !== this.generation) return [];
      const catalog = await this.client(service).request<{
        schema: number;
        models: ServiceModel[];
      }>("GET", "/v1/model-control/catalog");
      if (
        catalog.schema !== 1 ||
        !Array.isArray(catalog.models) ||
        catalog.models.some(
          (m) =>
            !m ||
            typeof m.id !== "string" ||
            !m.id ||
            typeof m.label !== "string" ||
            !Array.isArray(m.agents) ||
            m.agents.some((a) => typeof a !== "string"),
        )
      )
        throw new Error("Неподдерживаемый каталог сервиса.");
      if (gen !== this.generation) return [];
      for (const item of this.services.filter(
        (s) => s.endpoint === service.endpoint,
      ))
        this.catalogs.set(item.id, catalog.models);
      const errors = { ...this.value.errors };
      for (const item of this.services.filter((s) => s.endpoint === service.endpoint)) delete errors[item.id];
      this.emit({ errors });
      return catalog.models;
    } catch (error) {
      if (gen === this.generation)
        this.emit({
          errors: {
            ...this.value.errors,
            [id]: error instanceof Error ? error.message : "Сервис недоступен.",
          },
        });
      throw error;
    }
  }
  async ensure(
    providerID: string,
    modelID: string,
    agent: string,
  ): Promise<void> {
    const service = this.route(providerID, modelID);
    if (!service) {
      if (!this.allowed(providerID, modelID, agent)) throw new Error("Для этой модели требуется привязка к сервису и проверка агента.");
      return;
    }
    const gen = this.generation;
    if (!this.catalogs.has(service.id)) await this.refresh(service.id);
    if (gen !== this.generation)
      throw new Error("Настройки сервиса изменились; отправка отменена.");
    if (!this.allowed(providerID, modelID, agent))
      throw new Error("Эта модель недоступна выбранному агенту.");
    const target = service.bindings[modelID],
      flight = this.flights.get(service.endpoint);
    if (flight) {
      if (flight.model !== target)
        throw new Error("Дождитесь текущего переключения модели.");
      return flight.promise;
    }
    const promise = this.switch(service, target, agent);
    this.flights.set(service.endpoint, { model: target, promise });
    try {
      await promise;
    } finally {
      if (this.flights.get(service.endpoint)?.promise === promise)
        this.flights.delete(service.endpoint);
    }
  }
  private async switch(
    service: ModelService,
    model: string,
    agent: string,
  ): Promise<void> {
    const client = this.client(service),
      gen = this.generation;
    const errors = { ...this.value.errors };
    for (const item of this.services.filter((s) => s.endpoint === service.endpoint)) delete errors[item.id];
    this.emit({ errors });
    const publish = (state: SwitchStatus) => {
      if (gen !== this.generation)
        throw new Error("Настройки сервиса изменились; отправка отменена.");
      if (!validStatus(state))
        throw new Error("Неподдерживаемое состояние сервиса.");
      this.emit({
        states: {
          ...this.value.states,
          ...Object.fromEntries(
            this.services
              .filter((s) => s.endpoint === service.endpoint)
              .map((s) => [s.id, state]),
          ),
        },
      });
    };
    try {
      let state = await client.request<SwitchStatus>(
        "POST",
        "/v1/model-control/select",
        { body: { model, agent } },
      );
      const operation = state.operation_id,
        deadline = Date.now() + 31 * 60_000;
      for (;;) {
        publish(state);
        if (state.error || state.phase === "failed")
          throw new Error(state.error || "Загрузка модели не удалась.");
        if (state.ready && state.active_model === model) return;
        if (state.operation_id !== operation || state.target_model !== model)
          throw new Error(
            "Модель переключена другим клиентом; запрос не отправлен.",
          );
        if (Date.now() >= deadline)
          throw new Error(
            "Время ожидания истекло. Проверьте сервис; черновик сохранён.",
          );
        await new Promise((resolve) => setTimeout(resolve, 800));
        state = await client.request<SwitchStatus>(
          "GET",
          "/v1/model-control/status",
        );
      }
    } catch (error) {
      if (gen === this.generation)
        this.emit({
          errors: {
            ...this.value.errors,
            [service.id]:
              error instanceof Error
                ? error.message
                : "Не удалось переключить модель.",
          },
        });
      throw error;
    }
  }
}
export const modelServices = new ModelServices();
export const switchPhaseLabels: Record<string, string> = {
  unloaded: "Модель выгружена",
  draining: "Ожидание завершения запросов",
  unloading: "Выгрузка модели",
  loading: "Загрузка модели",
  warming: "Прогрев модели",
  ready: "Модель готова",
  failed: "Ошибка загрузки",
};
