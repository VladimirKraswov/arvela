import { capabilityNative, invalidateCapabilities } from '../capabilities/integration';
import type { Catalog, SharedServer } from '../capabilities/registry';
import { idle } from '../hub/client';
import type { Binding, ProjectScope } from './projects';
export interface RetrievalScope extends ProjectScope { project: string }
export interface Grant { scope: RetrievalScope; enabled: boolean; revision: number }
export interface Connection { grant: Grant | null; key: string; registered?: boolean }
const id = 'project-memory';
export const retrievalScope = (scope: ProjectScope, binding: Binding): RetrievalScope => ({ ...scope, project: binding.projectID });
export async function readRetrieval(scope: RetrievalScope): Promise<Connection> {
  const connection = await capabilityNative<Connection>('memory_retrieval', { scope, enabled: null, expected: null });
  const catalog = await capabilityNative<Catalog>('shared_catalog', { scope: 'project', directory: scope.directory });
  const spec = catalog.registry.servers.find(s => s.id === id);
  return { ...connection, registered: !!spec?.enabled && owned(spec,catalog.command) && spec.args[1] === connection.key && spec.args[2] === String(connection.grant?.revision) };
}
export const isGranted = (connection: Connection | null, scope: RetrievalScope) => !!connection?.grant?.enabled && ['hub','server','directory','project'].every(k => connection.grant!.scope[k as keyof RetrievalScope] === scope[k as keyof RetrievalScope]);
export const isConnected = (connection: Connection | null, scope: RetrievalScope) => !!connection?.registered && isGranted(connection,scope);
function owned(server: SharedServer, executable: string) {
  return server.kind === 'stdio' && server.command === executable && server.args[0] === '--memory-mcp' && server.args.length === 3 && !server.bearer && !server.envKeys.length;
}
/** Explicit opt-in only. Revoke first on disable; failure never leaves a usable grant.
 * Shared adapter supplies both agents, while agent permissions remain authoritative.
 */
export async function connectRetrieval(scope: RetrievalScope, enabled: boolean) {
  if (!idle()) throw Error('Завершите работу агентов перед изменением подключения памяти.');
  if (!enabled) {
    const previous = await capabilityNative<Connection>('memory_retrieval', { scope, enabled: null, expected: null });
    const revoked = await capabilityNative<Connection>('memory_retrieval', { scope, enabled: false, expected: previous.grant });
    invalidateCapabilities();
    // A changed/foreign registry never prevents revoking native data access.
    const c = await capabilityNative<Catalog>('shared_catalog', { scope: 'project', directory: scope.directory });
    const spec = c.registry.servers.find(s => s.id === id);
    if (spec && owned(spec,c.command)) await capabilityNative('shared_save', { scope:'project', directory:scope.directory, expected:c.content, registry:{...c.registry,servers:c.registry.servers.map(s=>s.id===id?{...s,enabled:false}:s)} });
    return { ...revoked, registered:false };
  }
  const catalog = await capabilityNative<Catalog>('shared_catalog', { scope: 'project', directory: scope.directory });
  const existing = catalog.registry.servers.find(s => s.id === id);
  if (existing && !owned(existing, catalog.command) || catalog.inherited.servers.some(s => s.id === id)) throw Error('Имя project-memory занято другим MCP. Он сохранён.');
  if (enabled && !catalog.runtimeReady) throw Error('Сначала установите общие MCP-инструменты в настройках.');
  const previous = await readRetrieval(scope);
  const connection = await capabilityNative<Connection>('memory_retrieval', { scope, enabled, expected: previous.grant });
  const server: SharedServer = { id, name: 'Память проекта', kind: 'stdio', command: catalog.command,
    args: ['--memory-mcp', connection.key, String(connection.grant!.revision)], enabled, url: '', envKeys: [], bearer: false };
  try {
    if (!idle()) throw Error('Агент начал работу; подключение отменено.');
    await capabilityNative('shared_save', { scope: 'project', directory: scope.directory, expected: catalog.content,
      registry: { ...catalog.registry, servers: [...catalog.registry.servers.filter(s => s.id !== id), server] } });
    invalidateCapabilities(); return { ...connection, registered: enabled };
  } catch (e) {
    if (enabled) await capabilityNative('memory_retrieval', { scope, enabled: false, expected: connection.grant });
    throw e;
  }
}

export function retrievalAvailable(server: string) { try { const u = new URL(server); return u.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(u.hostname) && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash; } catch { return false; } }
