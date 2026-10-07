import { useEffect, useRef, useState } from "react";
import { store, useAppState } from "../state/store";
import { isLocalComputer } from "../state/computer";
import { detectLocalOpenCode } from "../native/localServer";
import { isNative } from "../native/platform";
import {
  capabilityNative,
  invalidateCapabilities,
  synchronizeSources,
} from "../capabilities/integration";
import {
  piServerState,
  serverName,
  validateServer,
  type Catalog,
  type PiServerStatus,
  type Registry,
  type Scope,
  type SharedServer,
} from "../capabilities/registry";
const blankServer = (): SharedServer => ({
  id: "",
  name: "",
  enabled: true,
  kind: "stdio",
  command: "",
  args: [],
  url: "",
  envKeys: [],
  bearer: false,
});
interface LoadedSkill {
  name: string;
  location?: string;
  path?: string;
}
export function CapabilitiesSettings({
  onDirtyChange,
  onNavigate,
}: {
  onDirtyChange?: (dirty: boolean) => void;
  onNavigate?: (section: "browser" | "mcp" | "tools" | "pi") => void;
}) {
  const app = useAppState(),
    [scope, setScope] = useState<Scope>("global"),
    [catalog, setCatalog] = useState<Catalog | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [sourceId, setSourceId] = useState(""),
    [sourcePath, setSourcePath] = useState(""),
    [server, setServer] = useState(blankServer),
    [args, setArgs] = useState("[]"),
    [env, setEnv] = useState(""),
    [token, setToken] = useState("");
  const [openTools, setOpenTools] = useState<string[] | null>(null);
  const [openSkills, setOpenSkills] = useState<LoadedSkill[] | null>(null),
    [piSkills, setPiSkills] = useState<LoadedSkill[] | null>(null),
    [mcp, setMcp] = useState<Record<string, { status?: string }>>({}),
    [piStatuses, setPiStatuses] = useState<PiServerStatus[]>([]),
    [piRunning, setPiRunning] = useState(false),
    [probes, setProbes] = useState<Record<string, string[]>>({});
  const generation = useRef(0),
    local = isLocalComputer(app.prefs.endpoint, !!store.currentHost()),
    directory = scope === "project" ? app.directory : null;
  const running =
    Object.values({ ...app.statuses, ...app.activityStatuses }).some(
      (s) => s.type === "busy" || s.type === "retry",
    ) || app.ui.sending;
  const dirty = !!sourceId || !!sourcePath || !!server.id || !!token;
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  const refresh = async () => {
    const serial = ++generation.current;
    setError("");
    setBusy(true);
    setCatalog(null);
    setOpenSkills(null);
    setPiSkills(null);
    setMcp({});
    setPiStatuses([]);
    setPiRunning(false);
    setOpenTools(null);
    try {
      const value = await capabilityNative<Catalog>("shared_catalog", {
        scope,
        directory,
      });
      if (serial !== generation.current) return;
      setCatalog(value);
      const results = await Promise.allSettled([
        store.client.request<LoadedSkill[]>("GET", "/skill", {
          query: { directory: app.directory },
          timeoutMs: 10000,
        }),
        store.client.request<Record<string, { status?: string }>>(
          "GET",
          "/mcp",
          { query: { directory: app.directory }, timeoutMs: 10000 },
        ),
        app.activeSessionId && app.directory && store.engineIdFor() === "pi"
          ? store.pi().loadedSkillCommands(app.activeSessionId)
          : Promise.resolve(null),
        app.activeSessionId && app.directory && store.engineIdFor() === "pi"
          ? capabilityNative<{
              servers: PiServerStatus[];
              notRunning?: boolean;
            }>("pi_shared_inventory", {
              directory: app.directory,
              sessionId: app.activeSessionId,
            })
          : Promise.resolve(null),
        store.client.request<string[]>("GET", "/experimental/tool/ids", {
          query: { directory: app.directory },
          timeoutMs: 10000,
        }),
      ]);
      if (serial !== generation.current) return;
      if (results[0].status === "fulfilled") setOpenSkills(results[0].value);
      if (results[1].status === "fulfilled") setMcp(results[1].value);
      if (results[4].status === "fulfilled" && Array.isArray(results[4].value))
        setOpenTools(results[4].value.filter((v) => typeof v === "string"));
      if (results[2].status === "fulfilled") setPiSkills(results[2].value);
      if (results[3].status === "fulfilled" && results[3].value) {
        setPiStatuses(results[3].value.servers);
        setPiRunning(!results[3].value.notRunning);
      }
    } catch {
      if (serial === generation.current)
        setError(
          "Каталог не прочитан. Проверьте локальный проект и состояние приложения.",
        );
    } finally {
      if (serial === generation.current) setBusy(false);
    }
  };
  useEffect(() => {
    setSourceId("");
    setSourcePath("");
    setServer(blankServer());
    setArgs("[]");
    setEnv("");
    setToken("");
    setNotice("");
    setProbes({});
    if (local && isNative() && (scope === "global" || directory))
      void refresh();
    else {
      generation.current++;
      setCatalog(null);
    }
    return () => {
      generation.current++;
    };
  }, [
    scope,
    directory,
    app.directory,
    app.activeSessionId,
    app.prefs.endpoint,
    local,
  ]);
  const save = async (registry: Registry) => {
    if (!catalog || running || busy) return;
    const serial = generation.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let saved = await capabilityNative<Catalog>("shared_save", {
        scope,
        directory,
        expected: catalog.content,
        registry,
      });
      if (serial !== generation.current) return;
      setCatalog(saved);
      setMcp({});
      invalidateCapabilities();
      // A missing OpenCode never blocks Pi. Configuration is synchronized once an
      // installed OpenCode is present; live status is checked separately.
      if (
        app.connection.phase === "connected" ||
        (await detectLocalOpenCode(app.prefs.localOpenCodeProgram))
      ) {
        const next = await synchronizeSources(saved, scope, directory);
        saved = next.catalog;
        if (serial !== generation.current) return;
        setCatalog(saved);
        if (app.connection.phase === "connected" && app.directory)
          await store.configureSharedTools(app.directory);
      }
      if (serial !== generation.current) return;
      setNotice(
        "Сохранено. Новые сессии Pi получат изменения; уже открытые переоткройте. Статус OpenCode обновите кнопкой проверки.",
      );
      setSourceId("");
      setSourcePath("");
      setServer(blankServer());
      setToken("");
      setArgs("[]");
      setEnv("");
      setProbes({});
    } catch (e) {
      if (serial === generation.current)
        setError(
          `Настройка не завершена: ${e instanceof Error ? e.message : String(e)}. Сохранённый реестр можно перечитать и повторно подключить.`,
        );
    } finally {
      if (serial === generation.current) setBusy(false);
    }
  };
  const servers = catalog
    ? [
        ...catalog.inherited.servers.map((s) => ({ ...s, inherited: true })),
        ...catalog.registry.servers.map((s) => ({ ...s, inherited: false })),
      ]
    : [];
  const sources = catalog
    ? [
        ...catalog.inherited.sources.map((s) => ({ ...s, inherited: true })),
        ...catalog.registry.sources.map((s) => ({ ...s, inherited: false })),
      ]
    : [];
  const loaded = (
    path: string,
    skills: LoadedSkill[] | null,
    supported: boolean,
    enabled: boolean,
  ) => {
    if (skills?.some((s) => (s.location ?? s.path) === path))
      return enabled ? "Обнаружен агентом" : "Обнаружен; источник выключен";
    if (!supported) return "Другой агент";
    if (!enabled) return "Выключен источник; проверьте сессию";
    return skills === null ? "Не проверено" : "Не подтверждено";
  };
  const skills = catalog ? [...catalog.skills] : [];
  for (const found of openSkills ?? []) {
    const path = found.location ?? found.path;
    if (path && !skills.some((s) => s.path === path))
      skills.push({
        name: found.name,
        description: "Обнаружен OpenCode API",
        path,
        source: "opencode",
        managed: false,
        enabled: true,
        engines: ["opencode"],
        error: null,
      });
  }
  for (const found of piSkills ?? []) {
    if (found.path && !skills.some((s) => s.path === found.path))
      skills.push({
        name: found.name.replace(/^skill:/, ""),
        description: "Обнаружен в открытой сессии Pi",
        path: found.path,
        source: "pi",
        managed: false,
        enabled: true,
        engines: ["pi"],
        error: null,
      });
  }
  const sourceFolder = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const path = await open({
        directory: true,
        multiple: false,
        title: "Каталог общих навыков",
      });
      if (typeof path === "string") setSourcePath(path);
    } catch {
      setError("Не удалось выбрать каталог. Можно указать абсолютный путь.");
    }
  };
  const act = async (fn: () => Promise<void>) => {
    const serial = generation.current;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (serial === generation.current)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (serial === generation.current) setBusy(false);
    }
  };
  const editable = !!catalog && !busy && !running;
  return (
    <div className="capabilities-settings">
      <p className="settings-intro">
        Один каталог для OpenCode и Pi. Навыки используют SKILL.md; инструменты
        подключаются через общий MCP-мост. Разрешения, встроенные инструменты и
        плагины каждого агента сохраняются.
      </p>
      {!local && (
        <p role="status">
          Общий каталог настраивается на этом компьютере. Для SSH используйте
          настройки подключённого OpenCode; локальный Pi к удалённому проекту не
          подключается.
        </p>
      )}
      {!isNative() && (
        <p>Управление доступно в установленном AgentMesh Desktop.</p>
      )}
      <div className="settings-actions">
        <label>
          Область{" "}
          <select
            aria-label="Область общего каталога"
            disabled={busy || dirty || !local}
            value={scope}
            onChange={(e) => setScope(e.target.value as Scope)}
          >
            <option value="global">Весь компьютер</option>
            <option value="project" disabled={!app.directory}>
              Этот проект
            </option>
          </select>
        </label>
        <button
          className="btn"
          disabled={busy || !local || !isNative() || dirty}
          onClick={() => void refresh()}
        >
          Обновить статус
        </button>
      </div>
      {running && (
        <p className="settings-muted">
          Сохранение подключений доступно после завершения работающих агентов.
        </p>
      )}
      {catalog && (
        <>
          <section className="setting-group">
            <h2>Общий инструментарий</h2>
            <div className="setting-card">
              <div className="setting-row">
                <div className="setting-label">
                  <span>MCP SDK</span>
                  <small>
                    Закреплённый общий мост без установки второго браузера. Для
                    навыков без MCP не требуется.
                  </small>
                </div>
                <div className="setting-control">
                  <span>
                    {catalog.runtimeReady ? "Установлен" : "Не установлен"}
                  </span>
                  <button
                    className="btn"
                    disabled={!editable}
                    onClick={() =>
                      void act(async () => {
                        await capabilityNative("shared_install", {
                          nodeProgram:
                            app.prefs.pi?.nodeProgram ??
                            app.prefs.browser?.nodeProgram ??
                            null,
                        });
                        await refresh();
                      })
                    }
                  >
                    {catalog.runtimeReady
                      ? "Проверить мост"
                      : "Установить мост"}
                  </button>
                </div>
              </div>
            </div>
          </section>
          <section className="setting-group">
            <h2>Источники навыков</h2>
            <div className="setting-card">
              <p className="handoff-note">
                Общие стандартные каталоги: ~/.agents/skills и .agents/skills
                проекта. Они обнаруживаются агентами самостоятельно.
                Подключённые ниже каталоги добавляются через настройки OpenCode
                и --skill у Pi; файлы не копируются и не переписываются.
              </p>
              {sources.map((s) => (
                <div className="capability-item" key={`${s.inherited}:${s.id}`}>
                  <div>
                    <b>{s.id}</b>
                    <code>{s.path}</code>
                    <small>
                      {s.inherited
                        ? "Из общей области"
                        : "Источник этой области"}{" "}
                      ·{" "}
                      {catalog.sourceHealth?.[s.id] === false
                        ? "Каталог недоступен"
                        : "Каталог на диске"}
                    </small>
                  </div>
                  <label>
                    <input
                      type="checkbox"
                      aria-label={`Источник ${s.id}`}
                      checked={s.enabled}
                      disabled={!editable || s.inherited}
                      onChange={(e) =>
                        void save({
                          ...catalog.registry,
                          sources: catalog.registry.sources.map((v) =>
                            v.id === s.id
                              ? { ...v, enabled: e.target.checked }
                              : v,
                          ),
                        })
                      }
                    />
                    Включён
                  </label>
                </div>
              ))}
              <div className="capability-form">
                <label>
                  Идентификатор источника
                  <input
                    aria-label="Идентификатор источника"
                    value={sourceId}
                    onChange={(e) => setSourceId(e.target.value)}
                    placeholder="my-skills"
                  />
                </label>
                <label>
                  Каталог навыков
                  <input
                    aria-label="Каталог навыков"
                    value={sourcePath}
                    onChange={(e) => setSourcePath(e.target.value)}
                    placeholder="Абсолютный путь"
                  />
                </label>
                <div className="settings-actions">
                  <button
                    className="btn"
                    disabled={!editable}
                    onClick={() => void sourceFolder()}
                  >
                    Выбрать папку
                  </button>
                  <button
                    className="btn"
                    disabled={!editable || !sourceId || !sourcePath}
                    onClick={() => {
                      if (
                        !/^[a-z][a-z0-9-]{0,31}$/.test(sourceId) ||
                        sources.some((s) => s.id === sourceId)
                      ) {
                        setError(
                          "Нужен уникальный идентификатор: строчные латинские буквы, цифры и дефис.",
                        );
                        return;
                      }
                      void save({
                        ...catalog.registry,
                        sources: [
                          ...catalog.registry.sources,
                          { id: sourceId, path: sourcePath, enabled: true },
                        ],
                      });
                    }}
                  >
                    Подключить источник
                  </button>
                </div>
              </div>
            </div>
          </section>
          <section className="setting-group">
            <h2>Навыки</h2>
            <div className="setting-card">
              {catalog.scanLimited && (
                <p role="status" className="handoff-note">
                  Просмотр ограничен 3000 записями. Подключите более точные
                  каталоги навыков.
                </p>
              )}
              <p className="handoff-note">
                «Обнаружен агентом» означает наличие в его каталоге, а не
                выполнение. Автоматически найденные источники управляются самим
                агентом. Коллизии имён и необходимые программы проверяйте перед
                использованием; весь текст навыка заранее в контекст не
                загружается.
              </p>
              {!skills.length && (
                <p className="handoff-note">
                  Навыки в проверенных каталогах не найдены.
                </p>
              )}
              {skills.map((s, i) => (
                <article className="capability-skill" key={`${s.path}:${i}`}>
                  <b>{s.name}</b>
                  <p>{s.description}</p>
                  <code>{s.path}</code>
                  {s.error ? (
                    <p role="alert">{s.error}</p>
                  ) : (
                    <div className="capability-statuses">
                      <span>
                        OpenCode:{" "}
                        {loaded(
                          s.path,
                          openSkills,
                          s.engines.includes("opencode"),
                          s.enabled,
                        )}
                      </span>
                      <span>
                        Pi:{" "}
                        {loaded(
                          s.path,
                          piSkills,
                          s.engines.includes("pi"),
                          s.enabled,
                        )}
                      </span>
                    </div>
                  )}
                  <small>
                    {s.managed
                      ? `Источник: ${s.source}`
                      : "Обнаружен на диске автоматически"}
                  </small>
                </article>
              ))}
            </div>
          </section>
          <section className="setting-group">
            <h2>Общие MCP-инструменты</h2>
            <div className="setting-card">
              <p className="handoff-note">
                Один сервис, одинаковые имена инструментов у обоих агентов.
                Проверка подключается к сервису и читает список, не вызывает его
                инструменты. HTTP: Streamable HTTP; OAuth-подключения остаются в
                настройках OpenCode, пока общий мост не поддерживает их.
              </p>
              {!servers.length && (
                <p className="handoff-note">
                  Общие MCP пока не подключены. Браузер и существующие MCP
                  OpenCode сохранены в своих разделах.
                </p>
              )}
              {servers.map((s) => (
                <article
                  className="capability-skill"
                  key={`${s.inherited}:${s.id}`}
                >
                  <div className="capability-item">
                    <b>{s.name}</b>
                    <label>
                      <input
                        aria-label={`MCP ${s.id}`}
                        type="checkbox"
                        checked={s.enabled}
                        disabled={!editable || s.inherited}
                        onChange={(e) =>
                          void save({
                            ...catalog.registry,
                            servers: catalog.registry.servers.map((v) =>
                              v.id === s.id
                                ? { ...v, enabled: e.target.checked }
                                : v,
                            ),
                          })
                        }
                      />
                      Включён
                    </label>
                  </div>
                  <code>{s.kind === "http" ? s.url : s.command}</code>
                  <div className="capability-statuses">
                    <span>
                      OpenCode:{" "}
                      {!s.enabled
                        ? "Выключено"
                        : mcp[serverName(s.id)]?.status === "connected"
                          ? "Подключено"
                          : (mcp[serverName(s.id)]?.status ??
                            "Не подтверждено")}
                    </span>
                    <span>Pi: {piServerState(s, piStatuses, piRunning)}</span>
                  </div>
                  <div className="settings-actions">
                    <button
                      className="btn"
                      disabled={
                        !editable || !s.enabled || !catalog.runtimeReady
                      }
                      onClick={() =>
                        void act(async () => {
                          const result = await capabilityNative<{
                            tools: { name: string }[];
                          }>("shared_probe", {
                            scope,
                            directory: app.directory,
                            id: s.id,
                            nodeProgram: app.prefs.pi?.nodeProgram ?? null,
                          });
                          setProbes((p) => ({
                            ...p,
                            [s.id]: result.tools.map((t) => t.name),
                          }));
                        })
                      }
                    >
                      Проверить MCP
                    </button>
                    <button
                      className="btn"
                      disabled={!editable || s.inherited}
                      onClick={() => {
                        setServer(s);
                        setArgs(JSON.stringify(s.args));
                        setEnv(s.envKeys.join(", "));
                        setToken("");
                      }}
                    >
                      Изменить
                    </button>
                  </div>
                  {probes[s.id] && (
                    <details>
                      <summary>
                        Сервис ответил · {probes[s.id].length} инструментов
                      </summary>
                      <ul>
                        {probes[s.id].map((t) => (
                          <li key={t}>
                            <code>{`${serverName(s.id)}_${t.replace(/-/g, "_")}`}</code>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </article>
              ))}
              <div className="capability-form">
                <h3>
                  {catalog.registry.servers.some((s) => s.id === server.id)
                    ? "Изменение MCP"
                    : "Новое подключение"}
                </h3>
                <label>
                  Идентификатор MCP
                  <input
                    aria-label="Идентификатор общего MCP"
                    value={server.id}
                    onChange={(e) =>
                      setServer({ ...server, id: e.target.value })
                    }
                    placeholder="project-search"
                  />
                </label>
                <label>
                  Название
                  <input
                    aria-label="Название общего MCP"
                    value={server.name}
                    onChange={(e) =>
                      setServer({ ...server, name: e.target.value })
                    }
                  />
                </label>
                <label>
                  Транспорт
                  <select
                    aria-label="Транспорт общего MCP"
                    value={server.kind}
                    onChange={(e) =>
                      setServer({
                        ...server,
                        kind: e.target.value as SharedServer["kind"],
                        bearer: false,
                      })
                    }
                  >
                    <option value="stdio">Локальная программа · stdio</option>
                    <option value="http">Streamable HTTP</option>
                  </select>
                </label>
                {server.kind === "stdio" ? (
                  <>
                    <label>
                      Программа
                      <input
                        aria-label="Программа общего MCP"
                        value={server.command}
                        onChange={(e) =>
                          setServer({ ...server, command: e.target.value })
                        }
                        placeholder="Абсолютный путь к node / python / программе"
                      />
                    </label>
                    <label>
                      Аргументы · JSON
                      <input
                        aria-label="Аргументы общего MCP"
                        value={args}
                        onChange={(e) => setArgs(e.target.value)}
                        placeholder='["/path/server.mjs"]'
                      />
                    </label>
                    <label>
                      Имена переменных окружения
                      <input
                        aria-label="Переменные общего MCP"
                        value={env}
                        onChange={(e) => setEnv(e.target.value)}
                        placeholder="API_KEY, CONFIG_PATH"
                      />
                      <small>
                        Значения берутся из окружения запущенного Desktop; в
                        реестр не сохраняются.
                      </small>
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      URL
                      <input
                        aria-label="URL общего MCP"
                        value={server.url}
                        onChange={(e) =>
                          setServer({ ...server, url: e.target.value })
                        }
                        placeholder="https://service.example/mcp"
                      />
                    </label>
                    <label>
                      Bearer-токен
                      <input
                        aria-label="Токен общего MCP"
                        type="password"
                        autoComplete="off"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        placeholder={
                          server.bearer
                            ? "Сохранён в связке ключей; пусто — оставить"
                            : "Необязательно"
                        }
                      />
                      <small>
                        Сохраняется в системной связке ключей; не передаётся в
                        URL или аргументах процесса.
                      </small>
                    </label>
                    {server.bearer && (
                      <button
                        className="btn"
                        disabled={!editable}
                        onClick={() => {
                          setServer({ ...server, bearer: false });
                          setToken("");
                        }}
                      >
                        Убрать авторизацию при сохранении
                      </button>
                    )}
                  </>
                )}
                <div className="settings-actions">
                  <button
                    className="btn primary"
                    disabled={!editable || !server.id || !server.name}
                    onClick={() =>
                      void (async () => {
                        let parsed;
                        try {
                          parsed = JSON.parse(args);
                          if (
                            !Array.isArray(parsed) ||
                            parsed.some((v) => typeof v !== "string")
                          )
                            throw Error();
                        } catch {
                          setError(
                            "Аргументы должны быть JSON-массивом строк.",
                          );
                          return;
                        }
                        const spec = {
                          ...server,
                          authRevision: token
                            ? crypto.randomUUID()
                            : server.authRevision,
                          args: parsed,
                          envKeys: env
                            .split(",")
                            .map((v) => v.trim())
                            .filter(Boolean),
                          bearer:
                            server.kind === "http" &&
                            (server.bearer || !!token),
                        };
                        const problem = validateServer(spec);
                        if (problem) {
                          setError(problem);
                          return;
                        }
                        if (
                          catalog.inherited.servers.some(
                            (s) => s.id === spec.id,
                          )
                        ) {
                          setError("Этот идентификатор задан в общей области.");
                          return;
                        }
                        if (spec.kind === "http" && !spec.bearer) {
                          try {
                            await capabilityNative("shared_mcp_key", {
                              key: catalog.key,
                              id: spec.id,
                              value: null,
                            });
                          } catch {
                            setError(
                              "Не удалось удалить токен из связки ключей.",
                            );
                            return;
                          }
                        }
                        if (token) {
                          try {
                            await capabilityNative("shared_mcp_key", {
                              key: catalog.key,
                              id: spec.id,
                              value: token,
                            });
                            setToken("");
                            setServer(spec);
                          } catch {
                            setError(
                              "Не удалось сохранить токен в системной связке ключей.",
                            );
                            return;
                          }
                        }
                        void save({
                          ...catalog.registry,
                          servers: [
                            ...catalog.registry.servers.filter(
                              (s) => s.id !== spec.id,
                            ),
                            spec,
                          ],
                        });
                      })()
                    }
                  >
                    Сохранить и подключить
                  </button>
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => {
                      setServer(blankServer());
                      setSourceId("");
                      setSourcePath("");
                      setToken("");
                      setArgs("[]");
                      setEnv("");
                    }}
                  >
                    Очистить форму
                  </button>
                </div>
              </div>
            </div>
          </section>
          <section className="setting-group">
            <h2>Возможности агентов</h2>
            <div className="setting-card">
              <article className="capability-skill">
                <b>Встроенный браузер · общий</b>
                <p>
                  Один управляемый браузер для OpenCode и Pi, быстрый режим и
                  эмуляция. Его инструменты, профиль и разрешения настраиваются
                  в отдельном разделе.
                </p>
                <button className="btn" onClick={() => onNavigate?.("browser")}>
                  Настроить браузер
                </button>
              </article>
              <article className="capability-skill">
                <b>Инструменты OpenCode</b>
                <p>
                  Встроенные инструменты и подключённые плагины остаются у
                  OpenCode. Этот список получен от API текущего проекта;
                  разрешения проверяются отдельно.
                </p>
                {openTools === null ? (
                  <span>Не проверено</span>
                ) : (
                  <details>
                    <summary>Обнаружено {openTools.length}</summary>
                    <ul>
                      {openTools.map((t) => (
                        <li key={t}>
                          <code>{t}</code>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <div className="settings-actions">
                  <button className="btn" onClick={() => onNavigate?.("mcp")}>
                    MCP OpenCode
                  </button>
                  <button className="btn" onClick={() => onNavigate?.("tools")}>
                    Разрешения OpenCode
                  </button>
                </div>
              </article>
              <article className="capability-skill">
                <b>Инструменты Pi</b>
                <p>
                  Чтение, запись, редактирование файлов и команды предоставляет
                  сам Pi. Общие MCP добавляет мост; их подтверждённый список
                  отображается выше. Собственные расширения Pi настраиваются
                  отдельно и автоматически в плагины OpenCode не превращаются.
                </p>
                <button className="btn" onClick={() => onNavigate?.("pi")}>
                  Настроить Pi
                </button>
              </article>
            </div>
          </section>
          <div className="settings-actions">
            <button
              className="btn"
              disabled={!editable}
              onClick={() =>
                void act(async () => {
                  invalidateCapabilities();
                  if (app.directory) await store.configureSharedTools();
                  else await synchronizeSources(catalog, scope, directory);
                  await refresh();
                })
              }
            >
              Повторно подключить OpenCode
            </button>
            <button
              className="btn"
              disabled={
                !editable ||
                !app.activeSessionId ||
                store.engineIdFor() !== "pi"
              }
              onClick={() =>
                void act(async () => {
                  await store.pi().closeSession(app.activeSessionId!);
                  setPiStatuses([]);
                  setPiSkills(null);
                  setPiRunning(false);
                  setNotice(
                    "Процесс текущей сессии Pi закрыт. История сохранена; следующее сообщение запустит Pi с новым набором.",
                  );
                })
              }
            >
              Переоткрыть текущую Pi
            </button>
          </div>
        </>
      )}
      {busy && <p role="status">Проверяю каталог и подключения…</p>}
      {error && (
        <p role="alert" className="settings-inline-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="settings-notice">
          {notice}
        </p>
      )}
    </div>
  );
}
