import { managedPlugins } from '../util/managedPlugins';
import { isNative } from "../native/platform";
import { accessPluginUri, sharedOpenCodeConfig, type Catalog, type Scope } from "./registry";
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
export interface SharedSetupReport { reloaded?: boolean; unavailable: { id: string; name: string }[] }
const connected = new Map<string, string>(),
  unavailable = new Map<string, { fingerprint: string; retryAt: number }>(),
  flights = new Map<string, Promise<SharedSetupReport>>();
export function invalidateCapabilities() {
  connected.clear();
  unavailable.clear();
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
    refreshGlobal?: (catalog:Catalog)=>Promise<boolean>;
  },
  invoke = capabilityNative,
) {
  if (invoke === capabilityNative && !isNative()) return { unavailable: [] };
  const key = JSON.stringify([o.endpoint, o.directory]);
  if (flights.has(key)) return flights.get(key)!;
  const work = (async () => {
    const issues = new Map<string, {id: string; name: string}>();
    let reloaded=false;
    // Migrate both files before reloading: the effective engine config merges global and project plugins.
    const prepared: {scope:Scope;catalog:Catalog;entries:Record<string,unknown>}[] = [];
    for (const scope of ["project", "global"] as const) {
      if (!o.current()) throw new Error("Рабочее пространство изменилось.");
      let catalog = await invoke<Catalog>("shared_catalog", {
        scope,
        directory: o.directory,
      });
      if (
        !catalog.registry.sources.length &&
        !catalog.registry.servers.length &&
        !catalog.registry.appliedPaths.length &&
        !catalog.accessPluginPath
      )
        continue;
      const next = await synchronizeSources(
        catalog,
        scope,
        scope === "project" ? o.directory : null,
        invoke,
      );
      prepared.push({scope,catalog:next.catalog,entries:next.entries});
    }
    // Refresh scoped policy before attaching any global MCP connections.
    for (const {scope,catalog,entries} of prepared) {
      if (!o.current()) throw new Error("Рабочее пространство изменилось.");
      if (scope === "project" && catalog.accessPluginPath) {
        const plugin = accessPluginUri(catalog.accessPluginPath);
        const loaded = async () => {
          const config = await o.request("GET", "/config", { query: { directory: o.directory }, timeoutMs: 10000 });
          return Array.isArray(config.plugin) && config.plugin.every(p => typeof p === 'string')
            && config.plugin.includes(plugin)
            && JSON.stringify(managedPlugins(config.plugin, catalog, {access:true,browser:false})) === JSON.stringify(config.plugin);
        };
        if (!(await loaded())) {
          const statuses = await o.request("GET", "/session/status", { query: { directory: o.directory }, timeoutMs: 10000 });
          if (Object.values(statuses).some(s => s.status !== "idle" && (s as { type?: string }).type !== "idle"))
            throw new Error("Политика доступа обновится после завершения задач в этом проекте.");
          if (!o.current()) throw new Error("Рабочее пространство изменилось.");
          await o.request("POST", "/instance/dispose", { query: { directory: o.directory }, body: {}, timeoutMs: 10000 });
          // Disposed instances lose live MCP connections; reconnect only this scope.
          for (const cache of connected.keys()) if (cache.startsWith(`${key}/`)) connected.delete(cache);
          if (!(await loaded())) {
            reloaded=await o.refreshGlobal?.(catalog)??false;
            if(reloaded)invalidateCapabilities();
            if (!(await loaded())) throw new Error("OpenCode не загрузил политику доступа проекта.");
          }
        }
      }
      for (const s of catalog.registry.servers) {
        if (!o.current()) throw new Error("Рабочее пространство изменилось.");
        const name = `mesh_${s.id.replace(/-/g, "_")}`,
          cache = `${key}/${name}`,
          config = entries[name],
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
        if (!catalog.runtimeReady) {
          issues.set(s.id, {id:s.id,name:s.name});
          continue;
        }
        const failed = unavailable.get(cache);
        if (failed?.fingerprint === fingerprint && failed.retryAt > Date.now()) {
          issues.set(s.id, {id:s.id,name:s.name});
          continue;
        }
        const noteUnavailable = () => {
          issues.set(s.id, {id:s.id,name:s.name});
          unavailable.set(cache, {fingerprint,retryAt:Date.now()+30000});
        };
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
          let result;
          try {
            result = await o.request("POST", "/mcp", {
              query: { directory: o.directory }, body: { name, config }, timeoutMs: 45000,
            });
          } catch {
            if (!o.current()) throw new Error("Рабочее пространство изменилось.");
            noteUnavailable(); continue;
          }
          if (!o.current()) throw new Error("Рабочее пространство изменилось.");
          if (result[name]?.status !== "connected") {
            noteUnavailable(); continue;
          }
        }
        unavailable.delete(cache);
        if (o.current()) connected.set(cache, fingerprint);
      }
    }
    return {unavailable:[...issues.values()],...(reloaded?{reloaded:true}:{})};
  })();
  flights.set(key, work);
  try {
    return await work;
  } finally {
    if (flights.get(key) === work) flights.delete(key);
  }
}
