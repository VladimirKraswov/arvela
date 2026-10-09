import { useSyncExternalStore } from "react";
import { isNative } from "../native/platform";
import { isAbsoluteLocalPath, pathBasename } from "../util/paths";
import { parseConfig, updateConfig } from "../state/configEditor";
import { isLocalComputer } from "../state/computer";
import { browserEnabled, browserNodeProgram } from "./preferences";

export const BROWSER_MCP = "desktop_browser";
export interface BrowserPreferences { enabled?: boolean; nodeProgram?: string; mode?: "fast" | "human"; taskEffort?: "low" | "medium" }
export interface BrowserStatus {
  supported: boolean; installed: boolean; running: boolean; browserOpen?: boolean;
  command: string; nodeProgram: string | null; skillPath: string; runtimePath: string;
  profilePath: string; version: string | null; error?: string | null;
}
export interface BrowserSetup {
  phase: "idle" | "checking" | "installing" | "configuring" | "ready" | "disabled" | "error";
  status?: BrowserStatus; openCode: string; pi: string; error?: string;
}
/** Phases during which a background setup job owns the state. */
const IN_PROGRESS: readonly BrowserSetup["phase"][] = ["checking", "installing", "configuring"];
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
export async function openSessionBrowser(selection: { directory: string | null; engine: string; sessionId: string | null },
  current: () => boolean, url: string | null, nodeProgram?: string | null, invoke = browserNative): Promise<BrowserStatus> {
  if (!selection.directory || !selection.sessionId) throw new Error("Выберите чат для браузера.");
  await invoke("browser_start", { nodeProgram });
  if (!current()) throw new Error("Выбран другой чат; браузер не открыт.");
  const selected = await invoke<{result:{scopeKey:string;scope:{engine:string;sessionID:string}}}>("browser_session", selection);
  if (!current()) throw new Error("Выбран другой чат; браузер не открыт.");
  if (selected.result.scope?.engine !== selection.engine || selected.result.scope?.sessionID !== selection.sessionId)
    throw new Error("Браузер уже выбран для другого чата.");
  return invoke("browser_open", { url, nodeProgram, scopeKey: selected.result.scopeKey });
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * Whether an existing reserved entry was written by this application. The
 * executable may live elsewhere after the app bundle was moved or reinstalled,
 * so the same executable name with the private flag is still ours; any other
 * program is a collision and is never overwritten.
 */
function ownedEntry(existing: unknown, command: string): boolean {
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) return false;
  const entry = existing as { type?: unknown; command?: unknown };
  if (entry.type !== "local" || !Array.isArray(entry.command) || entry.command.length !== 2
      || entry.command[1] !== "--browser-mcp") return false;
  const previous = entry.command[0];
  if (typeof previous !== "string" || !isAbsoluteLocalPath(previous)) return false;
  if (previous === command) return true;
  // Drive-letter and UNC file systems compare names without case.
  const caseless = /^(?:[A-Za-z]:[\\/]|[\\/]{2})/u.test(command);
  const name = (path: string) => caseless ? pathBasename(path).toLowerCase() : pathBasename(path);
  return name(previous) === name(command);
}

/** Reserved entry only; JSONC, other MCPs and all engine permissions remain intact. */
export function browserConfig(source: string, status: BrowserStatus, enabled: boolean) {
  if (!isAbsoluteLocalPath(status.command) || !isAbsoluteLocalPath(status.skillPath))
    throw new Error("Браузер не сообщил абсолютные пути приложения и навыка.");
  const value = parseConfig(source);
  if (value.mcp !== undefined && (!value.mcp || typeof value.mcp !== "object" || Array.isArray(value.mcp)))
    throw new Error("Проверьте объект mcp в конфигурации OpenCode.");
  const existing = (value.mcp as Record<string, unknown> | undefined)?.[BROWSER_MCP];
  if (existing !== undefined && !ownedEntry(existing, status.command))
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
  if (value.plugin !== undefined && (!Array.isArray(value.plugin) || !value.plugin.every(p => typeof p === "string")))
    throw new Error("Проверьте plugin в конфигурации OpenCode.");
  const plugins = (value.plugin ?? []) as string[];
  const normalized = status.runtimePath.replace(/\\/g, "/").replace(/\/$/, "");
  const plugin = normalized.startsWith("//") ? `file:${encodeURI(normalized)}/opencode-session-plugin.mjs`
    : `file://${normalized.startsWith("/") ? "" : "/"}${encodeURI(normalized).replace(/#/g,"%23").replace(/\?/g,"%3F")}/opencode-session-plugin.mjs`;
  if (enabled && !plugins.includes(plugin)) content = updateConfig(content, ["plugin"], [...plugins, plugin]);
  return { content, config };
}

export interface SetupOptions {
  endpoint: string; directory: string | null; remote: boolean;
  preferences?: BrowserPreferences; openCodeProgram?: string; piProgram?: string; piNodeProgram?: string;
  current: () => boolean; activeDirectory?: () => string | null;
  request: (method: "GET" | "POST", path: string, options: { query: { directory: string }; body?: unknown; timeoutMs: number }) => Promise<Record<string, { status?: string; error?: string }>>;
}
type Invoke = typeof browserNative;
type Document = { path: string; content: string };
type McpConfig = { type: "local"; command: string[]; enabled: boolean; timeout: number };
/** Directories whose dynamic OpenCode attachment was confirmed as connected. */
const attached = new Set<string>();
/** In-flight attachments; their outcome is a fact about the server, not a setup revision. */
const attaching = new Map<string, Promise<void>>();
let flight: Promise<BrowserStatus | undefined> | null = null;
let flightKey = "";
/** Identifies the newest setup job; only it may settle a stale in-progress phase. */
let flightSerial = 0;
let configuredOpenCode: string | null = null;
let setupRevision = 0;
/**
 * Start setup over on the next request. Engine-path and Pi changes keep the
 * confirmed OpenCode attachments: re-adding a connected MCP would restart its
 * proxy and break a browser call another session has in flight. Reconnecting,
 * an explicit check and browser preference changes re-verify them.
 */
export function invalidateBrowserSetup(options: { keepAttachments?: boolean } = {}) {
  setupRevision++; flightKey = "";
  if (!options.keepAttachments) attached.clear();
}
const isLocal = (o: SetupOptions) => isLocalComputer(o.endpoint, o.remote);
const activeHere = (o: SetupOptions) => !o.activeDirectory || o.activeDirectory() === o.directory;
function current(o: SetupOptions, revision: number) { return o.current() && revision === setupRevision; }
async function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error("Проверка установленного агента превысила время ожидания.")), ms); })]); }
  finally { clearTimeout(timer); }
}

/** Dynamically attach to the running OpenCode for one directory; it must confirm a real connection. */
async function attach(o: SetupOptions, directory: string, config: McpConfig): Promise<void> {
  const inventory = await o.request("POST", "/mcp", { query: { directory }, body: { name: BROWSER_MCP, config }, timeoutMs: 45000 });
  if (inventory[BROWSER_MCP]?.status !== "connected")
    throw new Error(inventory[BROWSER_MCP]?.error || "OpenCode не подтвердил подключение браузера.");
}

/** A detached startup job: downloads and MCP discovery never block connecting or changing project. */
export async function configureLocalBrowser(o: SetupOptions, invoke: Invoke = browserNative): Promise<BrowserStatus | undefined> {
  if (!isLocal(o) || (invoke === browserNative && !isNative())) return;
  const revision = setupRevision;
  const key = JSON.stringify([o.endpoint, o.preferences, o.openCodeProgram, o.piProgram, o.piNodeProgram]);
  if (!flight || flightKey !== key) {
    flightKey = key;
    configuredOpenCode = null;
    const serial = ++flightSerial;
    // A superseded job stops quietly. If nothing newer replaced it (for example
    // the user switched to a remote host), it must not leave the UI showing
    // checking/installing forever.
    const superseded = () => {
      if (current(o, revision)) return false;
      if (serial === flightSerial && IN_PROGRESS.includes(state.phase)) publish({ phase: "idle", error: undefined });
      return true;
    };
    flight = (async () => {
      publish({ phase: "checking", error: undefined });
      const enabled = browserEnabled({ browser: o.preferences });
      const nodeProgram = browserNodeProgram({ browser: o.preferences, pi: { nodeProgram: o.piNodeProgram } });
      const [openCode, pi] = await Promise.all([
        bounded(invoke<boolean>("detect_local_opencode", { program: o.openCodeProgram ?? null }), 10000).catch(() => false),
        bounded(invoke<{ installed: boolean }>("pi_detect", { configuredPath: o.piProgram ?? null, nodeProgram: o.piNodeProgram ?? null }), 10000).catch(() => ({ installed: false })),
      ]);
      if (superseded()) return;
      publish({ openCode: openCode ? "Установлен" : "Не установлен — пропущен", pi: pi.installed ? "Установлен" : "Не установлен — пропущен" });
      let status = await invoke<BrowserStatus>("browser_status", { nodeProgram });
      if (superseded()) return;
      if (!enabled) {
        // Stop first: a configuration problem must never keep the browser running.
        await invoke("browser_stop");
        if (superseded()) return;
        status = { ...status, running: false, browserOpen: false };
        publish({ phase: "disabled", status });
        if (openCode && current(o, revision)) {
          const document = await invoke<Document>("read_opencode_config", { scope: "global", directory: null });
          const entry = (parseConfig(document.content).mcp as Record<string, unknown> | undefined)?.[BROWSER_MCP];
          // Only this app's own entry is disabled; a foreign one is left untouched.
          if (entry !== undefined && ownedEntry(entry, status.command)) {
            const next = browserConfig(document.content, status, false);
            if (current(o, revision) && next.content !== document.content)
              await invoke("write_opencode_config", { scope: "global", directory: null, expected: document.content, content: next.content });
          }
        }
        if (superseded()) return;
        if (openCode && o.directory && activeHere(o))
          await o.request("POST", `/mcp/${BROWSER_MCP}/disconnect`, { query: { directory: o.directory }, body: {}, timeoutMs: 10000 }).catch(() => {});
        if (current(o, revision)) publish({ phase: "disabled", status: { ...status, running: false, browserOpen: false } });
        return;
      }
      if (!openCode && !pi.installed) { publish({ phase: "idle", status }); return; }
      if (!status.supported) throw new Error(status.error || "Браузер недоступен на этой платформе.");
      if (!status.installed) {
        publish({ phase: "installing", status });
        status = await invoke<BrowserStatus>("browser_install", { nodeProgram });
      }
      if (superseded()) return;
      if (!status.installed) throw new Error(status.error || "Инструментарий браузера не установлен.");
      status = await invoke<BrowserStatus>("browser_start", { nodeProgram });
      if (superseded()) return;
      if (!status.running) throw new Error(status.error || "Сервис браузера не запущен.");
      await invoke("browser_input", { action: "mode", args: { mode: o.preferences?.mode === "human" ? "human" : "fast" } });
      if (superseded()) return;
      publish({ phase: "configuring", status });
      if (openCode) {
        const document = await invoke<Document>("read_opencode_config", { scope: "global", directory: null });
        const next = browserConfig(document.content, status, true);
        if (superseded()) return;
        if (next.content !== document.content) await invoke("write_opencode_config", {
          scope: "global", directory: null, expected: document.content, content: next.content,
        });
        if (superseded()) return;
        configuredOpenCode = key;
        publish({ openCode: "Настроен; подключается к выбранному проекту" });
      }
      if (pi.installed) {
        await invoke("browser_pi_support", { nodeProgram });
        if (superseded()) return;
        publish({ pi: "Настроен для новых сессий Desktop" });
      }
      if (current(o, revision)) publish({ phase: "ready", status });
      return status;
    })().catch(error => {
      if (!superseded()) publish({ phase: "error", error: message(error) });
      return undefined;
    });
  }
  const status = await flight;
  const directory = o.directory;
  if (!status || configuredOpenCode !== key || !current(o, revision) || !directory || !isLocal(o) || !activeHere(o))
    return status;
  const config: McpConfig = { type: "local", command: [status.command, "--browser-mcp"], enabled: true, timeout: 45000 };
  const attachKey = JSON.stringify([o.endpoint, directory, config.command]);
  if (attached.has(attachKey)) {
    // A confirmed proxy may subsequently exit. Check the live inventory rather
    // than declaring a cached connection ready; never restart a healthy proxy.
    try {
      const inventory = await o.request("GET", "/mcp", { query: { directory }, timeoutMs: 10000 });
      if (!current(o, revision) || !activeHere(o)) return status;
      if (inventory[BROWSER_MCP]?.status === "connected") {
        publish({ phase: "ready", error: undefined, openCode: "Подключён к выбранному проекту" });
        return status;
      }
      attached.delete(attachKey);
    } catch (error) {
      if (current(o, revision)) publish({ phase: "error", error: message(error) });
      return status;
    }
  }
  let pending = attaching.get(attachKey);
  if (!pending) {
    pending = attach(o, directory, config).finally(() => attaching.delete(attachKey));
    attaching.set(attachKey, pending);
  }
  try {
    await pending;
    // Only a confirmed connection is cached, and only for the setup that is
    // still current; an invalidated caller re-verifies on its next request.
    if (!current(o, revision)) return status;
    attached.add(attachKey);
    if (activeHere(o)) publish({ phase: "ready", error: undefined, openCode: "Подключён к выбранному проекту" });
  } catch (error) {
    if (current(o, revision)) publish({ phase: "error", error: message(error) });
  }
  return status;
}
