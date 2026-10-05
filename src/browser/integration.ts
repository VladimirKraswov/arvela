import { useSyncExternalStore } from "react";
import { isNative } from "../native/platform";
import { isAbsoluteLocalPath } from "../util/paths";
import { parseConfig, updateConfig } from "../state/configEditor";

export const BROWSER_MCP = "desktop_browser";
export interface BrowserPreferences { enabled?: boolean; nodeProgram?: string }
export interface BrowserStatus {
  supported: boolean; installed: boolean; running: boolean; browserOpen?: boolean;
  command: string; nodeProgram: string | null; skillPath: string; runtimePath: string;
  profilePath: string; version: string | null; error?: string | null;
}
export interface BrowserSetup {
  phase: "idle" | "checking" | "installing" | "configuring" | "ready" | "disabled" | "error";
  status?: BrowserStatus; openCode: string; pi: string; error?: string;
}
const INITIAL: BrowserSetup = { phase: "idle", openCode: "Не проверено", pi: "Не проверено" };
let state = INITIAL;
const listeners = new Set<() => void>();
function publish(patch: Partial<BrowserSetup>) {
  state = { ...state, ...patch }; listeners.forEach(listener => listener());
}
export function useBrowserSetup() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => state);
}
export function browserSetupSnapshot() { return state; }
export async function browserNative<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isNative()) throw new Error("Управляемый браузер доступен в установленном приложении.");
  return (await import("@tauri-apps/api/core")).invoke<T>(command, args);
}

/** Reserved entry only; JSONC, other MCPs and all engine permissions remain intact. */
export function browserConfig(source: string, status: BrowserStatus, enabled: boolean) {
  if (!isAbsoluteLocalPath(status.command) || !isAbsoluteLocalPath(status.skillPath))
    throw new Error("Браузер не сообщил абсолютные пути приложения и навыка.");
  const value = parseConfig(source);
  if (value.mcp !== undefined && (!value.mcp || typeof value.mcp !== "object" || Array.isArray(value.mcp)))
    throw new Error("Проверьте объект mcp в конфигурации OpenCode.");
  const existing = (value.mcp as Record<string, unknown> | undefined)?.[BROWSER_MCP];
  if (existing !== undefined && (!existing || typeof existing !== "object" || Array.isArray(existing)
      || (existing as { type?: unknown }).type !== "local"
      || !Array.isArray((existing as { command?: unknown }).command)
      || ((existing as { command: unknown[] }).command).length !== 2
      || ((existing as { command: unknown[] }).command)[0] !== status.command
      || ((existing as { command: unknown[] }).command)[1] !== "--browser-mcp"))
    throw new Error("Имя desktop_browser занято другой интеграцией. Её настройки сохранены.");
  const config = { type: "local" as const, command: [status.command, "--browser-mcp"], enabled, timeout: 45000 };
  let content = updateConfig(source, ["mcp", BROWSER_MCP], config);
  if (value.skills !== undefined && (!value.skills || typeof value.skills !== "object" || Array.isArray(value.skills)))
    throw new Error("Проверьте объект skills в конфигурации OpenCode.");
  const skills = value.skills as { paths?: unknown } | undefined;
  if (skills?.paths !== undefined && (!Array.isArray(skills.paths) || !skills.paths.every(p => typeof p === "string")))
    throw new Error("Проверьте skills.paths в конфигурации OpenCode.");
  const paths = (skills?.paths ?? []) as string[];
  if (enabled && !paths.includes(status.skillPath)) content = updateConfig(content, ["skills", "paths"], [...paths, status.skillPath]);
  return { content, config };
}

export interface SetupOptions {
  endpoint: string; directory: string | null; remote: boolean;
  preferences?: BrowserPreferences; openCodeProgram?: string; piProgram?: string; piNodeProgram?: string;
  current: () => boolean; activeDirectory?: () => string | null;
  request: (method: "POST", path: string, options: { query: { directory: string }; body: unknown; timeoutMs: number }) => Promise<Record<string, { status?: string; error?: string }>>;
}
type Invoke = typeof browserNative;
type Document = { path: string; content: string };
const attached = new Set<string>();
const attaching = new Map<string, Promise<void>>();
let flight: Promise<BrowserStatus | undefined> | null = null;
let flightKey = "";
let configuredOpenCode: string | null = null;
let setupRevision = 0;
export function invalidateBrowserSetup() { setupRevision++; attached.clear(); flightKey = ""; }
const isLocal = (o: SetupOptions) => {
  try { const u = new URL(o.endpoint); return !o.remote && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname); }
  catch { return false; }
};
function current(o: SetupOptions, revision: number) { return o.current() && revision === setupRevision; }
async function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error("Проверка установленного агента превысила время ожидания.")), ms); })]); }
  finally { clearTimeout(timer); }
}

/** A detached startup job: downloads and MCP discovery never block connecting or changing project. */
export async function configureLocalBrowser(o: SetupOptions, invoke: Invoke = browserNative): Promise<BrowserStatus | undefined> {
  if (!isLocal(o) || (invoke === browserNative && !isNative())) return;
  const revision = setupRevision;
  const key = JSON.stringify([o.endpoint, o.preferences, o.openCodeProgram, o.piProgram, o.piNodeProgram]);
  if (!flight || flightKey !== key) {
    flightKey = key;
    configuredOpenCode = null;
    flight = (async () => {
      publish({ phase: "checking", error: undefined });
      const enabled = o.preferences?.enabled !== false;
      const nodeProgram = o.preferences?.nodeProgram || o.piNodeProgram || null;
      const [openCode, pi] = await Promise.all([
        bounded(invoke<boolean>("detect_local_opencode", { program: o.openCodeProgram ?? null }), 10000).catch(() => false),
        bounded(invoke<{ installed: boolean }>("pi_detect", { configuredPath: o.piProgram ?? null, nodeProgram: o.piNodeProgram ?? null }), 10000).catch(() => ({ installed: false })),
      ]);
      if (!current(o, revision)) return;
      publish({ openCode: openCode ? "Установлен" : "Не установлен — пропущен", pi: pi.installed ? "Установлен" : "Не установлен — пропущен" });
      let status = await invoke<BrowserStatus>("browser_status", { nodeProgram });
      if (!current(o, revision)) return;
      if (!enabled) {
        if (openCode) {
          const document = await invoke<Document>("read_opencode_config", { scope: "global", directory: null });
          if ((parseConfig(document.content).mcp as Record<string, unknown> | undefined)?.[BROWSER_MCP]) {
            const next = browserConfig(document.content, status, false);
            if (current(o, revision) && next.content !== document.content)
              await invoke("write_opencode_config", { scope: "global", directory: null, expected: document.content, content: next.content });
          }
        }
        if (current(o, revision)) {
          await invoke("browser_stop");
          if (openCode && o.directory && (!o.activeDirectory || o.activeDirectory() === o.directory))
            await o.request("POST", `/mcp/${BROWSER_MCP}/disconnect`, { query: { directory: o.directory }, body: {}, timeoutMs: 10000 }).catch(() => {});
          publish({ phase: "disabled", status: { ...status, running: false, browserOpen: false } }); }
        return;
      }
      if (!openCode && !pi.installed) { publish({ phase: "idle", status }); return; }
      if (!status.supported) throw new Error(status.error || "Браузер недоступен на этой платформе.");
      if (!status.installed) {
        publish({ phase: "installing", status });
        status = await invoke<BrowserStatus>("browser_install", { nodeProgram });
      }
      if (!current(o, revision)) return;
      if (!status.installed) throw new Error(status.error || "Инструментарий браузера не установлен.");
      status = await invoke<BrowserStatus>("browser_start", { nodeProgram });
      if (!current(o, revision)) return;
      if (!status.running) throw new Error(status.error || "Сервис браузера не запущен.");
      publish({ phase: "configuring", status });
      if (openCode) {
        const document = await invoke<Document>("read_opencode_config", { scope: "global", directory: null });
        const next = browserConfig(document.content, status, true);
        if (!current(o, revision)) return;
        if (next.content !== document.content) await invoke("write_opencode_config", {
          scope: "global", directory: null, expected: document.content, content: next.content,
        });
        if (!current(o, revision)) return;
        configuredOpenCode = key;
        publish({ openCode: "Настроен; подключается к выбранному проекту" });
      }
      if (pi.installed) {
        await invoke("browser_pi_support", { nodeProgram });
        if (!current(o, revision)) return;
        publish({ pi: "Настроен для новых сессий Desktop" });
      }
      if (current(o, revision)) publish({ phase: "ready", status });
      return status;
    })().catch(error => {
      if (current(o, revision)) publish({ phase: "error", error: error instanceof Error ? error.message : String(error) });
      return undefined;
    });
  }
  const status = await flight;
  if (!status || configuredOpenCode !== key || !current(o, revision) || !o.directory || !isLocal(o)
      || (o.activeDirectory && o.activeDirectory() !== o.directory)) return status;
  const config = { type: "local", command: [status.command, "--browser-mcp"], enabled: true, timeout: 45000 };
  const attachKey = JSON.stringify([o.endpoint, o.directory, config.command]);
  if (attached.has(attachKey)) return status;
  if (!attaching.has(attachKey)) attaching.set(attachKey, (async () => {
    const inventory = await o.request("POST", "/mcp", { query: { directory: o.directory! }, body: { name: BROWSER_MCP, config }, timeoutMs: 45000 });
    if (!current(o, revision)) return;
    if (inventory[BROWSER_MCP]?.status !== "connected") throw new Error(inventory[BROWSER_MCP]?.error || "OpenCode не подтвердил подключение браузера.");
    attached.add(attachKey);
  })().finally(() => attaching.delete(attachKey)));
  try {
    await attaching.get(attachKey);
    if (current(o, revision) && (!o.activeDirectory || o.activeDirectory() === o.directory))
      publish({ phase: "ready", error: undefined, openCode: "Подключён к выбранному проекту" });
  } catch (error) {
    if (current(o, revision)) publish({ phase: "error", error: error instanceof Error ? error.message : String(error) });
  }
  return status;
}
