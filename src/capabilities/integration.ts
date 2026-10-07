import { isNative } from "../native/platform";
import { sharedOpenCodeConfig, type Catalog, type Scope } from "./registry";
export async function capabilityNative<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isNative())
    throw new Error("Каталог доступен в установленном приложении.");
  return (await import("@tauri-apps/api/core")).invoke<T>(command, args);
}
type Request = (
  method: "GET" | "POST",
  path: string,
  options: { query: { directory: string }; body?: unknown; timeoutMs: number },
) => Promise<Record<string, { status?: string; error?: string }>>;
const connected = new Map<string, string>(),
  flights = new Map<string, Promise<void>>();
export function invalidateCapabilities() {
  connected.clear();
}
export async function synchronizeSources(
  catalog: Catalog,
  scope: Scope,
  directory: string | null,
  invoke = capabilityNative,
) {
  const doc = await invoke<{ content: string }>("read_opencode_config", {
    scope,
    directory,
  });
  const next = sharedOpenCodeConfig(doc.content, catalog);
  if (next.content !== doc.content)
    await invoke("write_opencode_config", {
      scope,
      directory,
      expected: doc.content,
      content: next.content,
    });
  if (
    JSON.stringify(next.appliedPaths) !==
    JSON.stringify(catalog.registry.appliedPaths)
  ) {
    catalog = await invoke<Catalog>("shared_save", {
      scope,
      directory,
      expected: catalog.content,
      registry: { ...catalog.registry, appliedPaths: next.appliedPaths },
    });
  }
  return { catalog, entries: next.entries };
}
/** Calls are metadata/connection only, scoped to the actual prompt workspace. */
export async function configureShared(
  o: {
    endpoint: string;
    directory: string;
    current: () => boolean;
    request: Request;
  },
  invoke = capabilityNative,
) {
  if (invoke === capabilityNative && !isNative()) return;
  const key = JSON.stringify([o.endpoint, o.directory]);
  if (flights.has(key)) return flights.get(key);
  const work = (async () => {
    for (const scope of ["global", "project"] as const) {
      if (!o.current()) throw new Error("Рабочее пространство изменилось.");
      let catalog = await invoke<Catalog>("shared_catalog", {
        scope,
        directory: o.directory,
      });
      if (
        !catalog.registry.sources.length &&
        !catalog.registry.servers.length &&
        !catalog.registry.appliedPaths.length
      )
        continue;
      const next = await synchronizeSources(
        catalog,
        scope,
        scope === "project" ? o.directory : null,
        invoke,
      );
      catalog = next.catalog;
      for (const s of catalog.registry.servers) {
        if (!o.current()) throw new Error("Рабочее пространство изменилось.");
        const name = `mesh_${s.id.replace(/-/g, "_")}`,
          cache = `${key}/${name}`,
          config = next.entries[name],
          fingerprint = JSON.stringify([config, s]);
        if (connected.get(cache) === fingerprint) continue;
        if (!s.enabled) {
          await o.request("POST", `/mcp/${name}/disconnect`, {
            query: { directory: o.directory },
            body: {},
            timeoutMs: 10000,
          });
          connected.set(cache, fingerprint);
          continue;
        }
        if (!catalog.runtimeReady)
          throw new Error("Установите общие MCP-инструменты в настройках.");
        const existing = await o.request("GET", "/mcp", {
          query: { directory: o.directory },
          timeoutMs: 10000,
        });
        // A new client process cannot confirm the revision of an existing proxy.
        // Reattach only our reserved entry; subsequent identical sends use the cache.
        if (
          existing[name]?.status !== "connected" ||
          connected.get(cache) !== fingerprint
        ) {
          const result = await o.request("POST", "/mcp", {
            query: { directory: o.directory },
            body: { name, config },
            timeoutMs: 45000,
          });
          if (result[name]?.status !== "connected")
            throw new Error(
              `MCP ${s.name} не подтвердил подключение. Проверьте настройки.`,
            );
        }
        if (o.current()) connected.set(cache, fingerprint);
      }
    }
  })();
  flights.set(key, work);
  try {
    await work;
  } finally {
    if (flights.get(key) === work) flights.delete(key);
  }
}
