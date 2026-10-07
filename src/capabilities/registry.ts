import { parseConfig, updateConfig, remoteMcpUrl } from "../state/configEditor";
import { isAbsoluteLocalPath, pathBasename } from "../util/paths";
export type Scope = "global" | "project";
export interface SkillSource {
  id: string;
  path: string;
  enabled: boolean;
}
export interface SharedServer {
  id: string;
  name: string;
  enabled: boolean;
  kind: "stdio" | "http";
  command: string;
  args: string[];
  url: string;
  envKeys: string[];
  bearer: boolean;
  authRevision?: string;
}
export interface Registry {
  version: 1;
  directory: string | null;
  sources: SkillSource[];
  servers: SharedServer[];
  appliedPaths: string[];
}
export interface Skill {
  name: string;
  description: string;
  path: string;
  source: string;
  managed: boolean;
  enabled: boolean;
  engines: string[];
  error: string | null;
}
export interface Catalog {
  key: string;
  content: string;
  registry: Registry;
  inherited: Registry;
  skills: Skill[];
  runtimeReady: boolean;
  command: string;
  scopeDirectory: string | null;
  sourceHealth?: Record<string, boolean>;
  scanLimited?: boolean;
}
export const emptyRegistry = (): Registry => ({
  version: 1,
  directory: null,
  sources: [],
  servers: [],
  appliedPaths: [],
});
export const serverName = (id: string) => `mesh_${id.replace(/-/g, "_")}`;
export function signature(value: unknown) {
  let h = 0xcbf29ce484222325n;
  for (const b of new TextEncoder().encode(
    value && typeof value === "object" && "envKeys" in value
      ? JSON.stringify(value, [
          "id",
          "name",
          "enabled",
          "kind",
          "command",
          "args",
          "url",
          "envKeys",
          "bearer",
          "authRevision",
        ])
      : JSON.stringify(value),
  ))
    h = BigInt.asUintN(64, (h ^ BigInt(b)) * 0x100000001b3n);
  return h.toString(16).padStart(16, "0");
}
export function validateServer(s: SharedServer): string | null {
  if (
    !/^[a-z][a-z0-9-]{0,31}$/.test(s.id) ||
    !s.name.trim() ||
    s.name.length > 120
  )
    return "Задайте короткий идентификатор и название MCP.";
  if (
    s.args.length > 64 ||
    s.args.some(
      (a) => typeof a !== "string" || a.length > 4096 || a.includes("\0"),
    )
  )
    return "Аргументы должны быть JSON-массивом строк.";
  if (s.envKeys.some((n) => !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(n)))
    return "Укажите только имена переменных окружения, без их значений.";
  if (
    s.kind === "stdio" &&
    (!isAbsoluteLocalPath(s.command) || /\.(cmd|bat)$/i.test(s.command))
  )
    return "Укажите абсолютный путь к программе; для npm-инструмента используйте Node и JS-файл в аргументах.";
  if (s.kind === "http") {
    try {
      const u = new URL(s.url);
      if (!remoteMcpUrl(s.url) || u.search)
        return "Нужен HTTPS или loopback HTTP без секретов в URL.";
    } catch {
      return "Проверьте URL MCP.";
    }
  }
  return null;
}
function owned(value: unknown, key: string, id: string, executable: string) {
  if (!value || typeof value !== "object") return false;
  const v = value as { type?: unknown; command?: unknown };
  if (
    v.type !== "local" ||
    !Array.isArray(v.command) ||
    v.command.length !== 4 ||
    v.command[1] !== "--shared-mcp" ||
    v.command[2] !== key ||
    v.command[3] !== id ||
    typeof v.command[0] !== "string" ||
    !isAbsoluteLocalPath(v.command[0])
  )
    return false;
  return (
    pathBasename(v.command[0]).toLowerCase() ===
    pathBasename(executable).toLowerCase()
  );
}
/** Reserved entries only. Foreign MCPs, comments, plugins and permissions survive. */
export function sharedOpenCodeConfig(source: string, catalog: Catalog) {
  const config = parseConfig(source),
    registry = catalog.registry;
  const mcp = config.mcp;
  if (
    mcp !== undefined &&
    (!mcp || typeof mcp !== "object" || Array.isArray(mcp))
  )
    throw new Error("Проверьте объект mcp в OpenCode.");
  const skills = config.skills as { paths?: unknown } | undefined;
  if (
    skills !== undefined &&
    (!skills || typeof skills !== "object" || Array.isArray(skills))
  )
    throw new Error("Проверьте объект skills в OpenCode.");
  if (
    skills?.paths !== undefined &&
    (!Array.isArray(skills.paths) ||
      skills.paths.some((p) => typeof p !== "string"))
  )
    throw new Error("Проверьте skills.paths в OpenCode.");
  let content = source;
  const entries: Record<string, unknown> = {};
  for (const s of registry.servers) {
    const name = serverName(s.id),
      existing = (mcp as Record<string, unknown> | undefined)?.[name];
    if (
      existing !== undefined &&
      !owned(existing, catalog.key, s.id, catalog.command)
    )
      throw new Error(`Имя ${name} занято другой интеграцией. Она сохранена.`);
    const entry = {
      type: "local",
      command: [catalog.command, "--shared-mcp", catalog.key, s.id],
      enabled: s.enabled,
      timeout: 45000,
    };
    content = updateConfig(content, ["mcp", name], entry);
    entries[name] = entry;
  }
  const desired = registry.sources.filter((s) => s.enabled).map((s) => s.path),
    previous = (skills?.paths ?? []) as string[];
  const paths = previous.filter(
    (p) => !registry.appliedPaths.includes(p) || desired.includes(p),
  );
  const applied = registry.appliedPaths.filter((p) => desired.includes(p));
  for (const p of desired) {
    if (!paths.includes(p)) {
      paths.push(p);
      applied.push(p);
    }
  }
  if (desired.length || registry.appliedPaths.length)
    content = updateConfig(content, ["skills", "paths"], paths);
  return { content, entries, appliedPaths: [...new Set(applied)] };
}
export interface PiServerStatus {
  id: string;
  signature: string;
  state: string;
  tools: string[];
}
export function piServerState(
  server: SharedServer,
  statuses: PiServerStatus[],
  running: boolean,
) {
  if (!server.enabled) return "Выключено";
  if (!running) return "Откройте сессию Pi";
  const status = statuses.find((s) => s.id === server.id);
  if (!status || status.signature !== signature(server))
    return "Переоткройте сессию Pi";
  return status.state === "connected"
    ? `Подключено · ${status.tools.length} инструментов`
    : status.state === "checking"
      ? "Подключается"
      : "Ошибка подключения";
}
