import { useEffect, useState } from "react";
import { store, useAppState } from "../state/store";
import { npmPluginName, parseConfig, permissionValue, remoteMcpUrl, updateConfig, type ConfigValue } from "../state/configEditor";

type Scope = "global" | "project";
type Document = { path: string; content: string };
type Section = "tools" | "skills" | "plugins" | "mcp" | "agents";
const DEFAULT_TOOLS = ["bash", "read", "glob", "grep", "edit", "webfetch", "websearch", "task", "skill", "lsp"];
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const asStrings = (value: unknown): string[] => Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];

export function OpenCodeSettings() {
  const s = useAppState();
  const remote = !!store.currentHost();
  const native = "__TAURI_INTERNALS__" in window;
  const [scope, setScope] = useState<Scope>("global");
  const [section, setSection] = useState<Section>("tools");
  const [doc, setDoc] = useState<Document | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [tools, setTools] = useState<string[]>(DEFAULT_TOOLS);
  const [skills, setSkills] = useState<{name: string; description?: string; location: string}[]>([]);
  const [mcpStatus, setMcpStatus] = useState<Record<string, {status?: string}>>({});
  const [pluginName, setPluginName] = useState("");
  const [skillUrl, setSkillUrl] = useState("");
  const [mcpName, setMcpName] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const directory = scope === "project" ? s.directory : null;

  useEffect(() => {
    if (!s.ui.settingsOpen) return;
    let live = true;
    void Promise.allSettled([
      store.client.request<string[]>("GET", "/experimental/tool/ids", { query: {directory: s.directory} }),
      store.client.request<typeof skills>("GET", "/skill", { query: {directory: s.directory} }),
      store.client.request<typeof mcpStatus>("GET", "/mcp", { query: {directory: s.directory} }),
    ]).then(([toolResult, skillResult, mcpResult]) => {
      if (!live) return;
      if (toolResult.status === "fulfilled") setTools(toolResult.value.filter((x) => x !== "invalid"));
      if (skillResult.status === "fulfilled") setSkills(skillResult.value);
      if (mcpResult.status === "fulfilled") setMcpStatus(mcpResult.value);
    });
    return () => { live = false; };
  }, [s.ui.settingsOpen, s.directory, s.prefs.endpoint]);

  useEffect(() => {
    if (!s.ui.settingsOpen) return;
    setError(""); setNotice(""); setDoc(null);
    if (!native || remote || (scope === "project" && !directory)) return;
    let live = true;
    void import("@tauri-apps/api/core").then(({invoke}) =>
      invoke<Document>("read_opencode_config", {scope, directory})
    ).then((result) => {
      if (!live) return;
      parseConfig(result.content);
      setDoc(result);
    }).catch((e) => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, [s.ui.settingsOpen, scope, directory, native, remote]);

  let config: ConfigValue = {};
  try { config = parseConfig(doc?.content ?? ""); } catch { /* displayed above */ }
  const writable = !!doc && !busy && !remote;
  const save = async (path: (string | number)[], value: unknown) => {
    if (!doc || remote) return false;
    if ([...Object.values(store.state.activityStatuses), ...Object.values(store.state.statuses)]
      .some((status) => status.type === "busy" || status.type === "retry")) {
      setError("Дождитесь завершения работающего агента перед изменением конфигурации.");
      return false;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const content = updateConfig(doc.content, path, value);
      const {invoke} = await import("@tauri-apps/api/core");
      const saved = await invoke<Document>("write_opencode_config", {
        scope, directory, expected: doc.content, content,
      });
      setDoc(saved);
      setNotice("Сохранено с резервной копией. OpenCode применит настройки при следующем запуске сервера.");
      return true;
    } catch (e) { setError(String(e)); return false; }
    finally { setBusy(false); }
  };
  const permissions = asRecord(config.permission);
  const plugins = Array.isArray(config.plugin) ? config.plugin : [];
  const mcp = asRecord(config.mcp);
  const skillSources = asRecord(config.skills);
  const agentNames = s.agents.map((agent) => agent.name);
  const hasBusySession = [...Object.values(s.activityStatuses), ...Object.values(s.statuses)]
    .some((status) => status.type === "busy" || status.type === "retry");
  const canEdit = writable && !hasBusySession;

  return <div className="engine-settings">
    <div className="settings-scope">
      <label>Область конфигурации
        <select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
          <option value="global">На этом Mac · все проекты</option>
          <option value="project" disabled={!s.directory || remote}>Текущий проект</option>
        </select>
      </label>
      <small>{doc?.path ?? (remote ? "Удалённый сервер: инвентарь доступен, редактирование локального файла отключено." : !native ? "Редактирование доступно в установленном приложении." : "Загрузка конфигурации…")}</small>
    </div>
    <nav className="engine-tabs" aria-label="Настройки OpenCode">
      {([ ["tools","Инструменты"], ["skills","Навыки"], ["plugins","Плагины"], ["mcp","MCP"], ["agents","Агенты"] ] as const).map(([id,label]) =>
        <button key={id} className={section === id ? "active" : ""} onClick={() => setSection(id)}>{label}</button>)}
    </nav>
    {error && <p role="alert" className="composer-error">{error}</p>}
    {notice && <p role="status" className="settings-notice">{notice}</p>}
    <div className="engine-content">
      {hasBusySession && <p role="status">Пока агент выполняет задачу, запись конфигурации отключена. Настройки можно просматривать.</p>}
      {section === "tools" && <>
        <p>Разрешения OpenCode для текущей области. Наследуемое значение зависит от других файлов конфигурации и настроек агента; сложные правила сохраняются без изменений.</p>
        {[...new Set([...tools, ...Object.keys(permissions)])].filter((x) => x !== "*").map((id) => {
          const value = permissionValue(config, id);
          return <div className="engine-row" key={id}>
            <code>{id}</code>
            <select aria-label={`Разрешение ${id}`} value={value} disabled={!canEdit || value === "custom"}
              onChange={(e) => {
                const next = e.target.value;
                const updated = {...permissions};
                if (next === "inherit") delete updated[id]; else updated[id] = next;
                void save(["permission"], updated);
              }}>
              <option value="inherit">Наследовать</option><option value="allow">Разрешить</option>
              <option value="ask">Спрашивать</option><option value="deny">Запретить</option>
              {value === "custom" && <option value="custom">Сложное правило в файле</option>}
            </select>
          </div>;
        })}
      </>}
      {section === "skills" && <>
        <p>Обнаруженные навыки берутся из OpenCode API. Дополнительный источник URL сохраняется в <code>skills.urls</code>; OpenCode загрузит его при следующем запуске.</p>
        {skills.length ? skills.map((skill) => <div className="engine-item" key={`${skill.name}:${skill.location}`}><b>{skill.name}</b><small>{skill.description}</small><code>{skill.location}</code></div>) : <p>Навыки не обнаружены.</p>}
        <label>Новый HTTPS-источник навыков
          <input value={skillUrl} onChange={(e) => setSkillUrl(e.target.value)} placeholder="https://example.com/skills/" />
        </label>
        <button className="btn" disabled={!canEdit || !skillUrl.trim()} onClick={() => {
          if (!remoteMcpUrl(skillUrl.trim()) || !skillUrl.trim().startsWith("https://")) { setError("Для навыков нужен HTTPS URL без учётных данных."); return; }
          const urls = asStrings(skillSources.urls);
          if (urls.includes(skillUrl.trim())) { setError("Источник уже добавлен."); return; }
          void save(["skills", "urls"], [...urls, skillUrl.trim()]).then((ok) => { if (ok) setSkillUrl(""); });
        }}>Добавить источник</button>
        {asStrings(skillSources.urls).map((url) => <div className="engine-row" key={url}><code>{url}</code><button className="btn small" disabled={!canEdit} onClick={() => void save(["skills", "urls"], asStrings(skillSources.urls).filter((x) => x !== url))}>Убрать</button></div>)}
        <p>Доступ к навыкам регулируется инструментом <code>skill</code> во вкладке «Инструменты».</p>
      </>}
      {section === "plugins" && <>
        <p>Пакеты npm в <code>plugin</code> OpenCode скачает и установит через Bun при следующем запуске. Добавляйте только проверенные пакеты; плагины исполняют код на компьютере.</p>
        {plugins.map((item, i) => <div className="engine-row" key={`${i}:${JSON.stringify(item)}`}><code>{typeof item === "string" ? item : JSON.stringify(item)}</code><button className="btn small" disabled={!canEdit} onClick={() => void save(["plugin"], plugins.filter((_, index) => index !== i))}>Убрать</button></div>)}
        <div className="engine-add"><input aria-label="Имя npm-пакета" value={pluginName} onChange={(e) => setPluginName(e.target.value)} placeholder="@scope/opencode-plugin@1.2.3" /><button className="btn" disabled={!canEdit || !pluginName.trim()} onClick={() => {
          const name = pluginName.trim();
          if (!npmPluginName(name)) { setError("Введите имя npm-пакета, без URL или команды."); return; }
          if (plugins.includes(name)) { setError("Плагин уже добавлен."); return; }
          void save(["plugin"], [...plugins, name]).then((ok) => { if (ok) setPluginName(""); });
        }}>Добавить пакет</button></div>
      </>}
      {section === "mcp" && <>
        <p>Удалённые MCP-серверы подключаются через конфигурацию OpenCode. URL сохраняется без секретов; используйте HTTPS или loopback HTTP.</p>
        {Object.entries(mcp).map(([name, value]) => <div className="engine-row" key={name}><span><b>{name}</b><small> · {mcpStatus[name]?.status ?? "после перезапуска"}</small></span><button className="btn small" disabled={!canEdit} onClick={() => { const next = {...mcp}; delete next[name]; void save(["mcp"], next); }}>Убрать</button><code>{asRecord(value).type === "remote" ? String(asRecord(value).url ?? "") : "Локальный MCP"}</code></div>)}
        <div className="engine-add"><input aria-label="Имя MCP" value={mcpName} onChange={(e) => setMcpName(e.target.value)} placeholder="имя-сервера" /><input aria-label="Адрес MCP" value={mcpUrl} onChange={(e) => setMcpUrl(e.target.value)} placeholder="https://server.example/mcp" /><button className="btn" disabled={!canEdit || !mcpName.trim() || !mcpUrl.trim()} onClick={() => {
          const name = mcpName.trim(), url = mcpUrl.trim();
          if (!/^[a-zA-Z][a-zA-Z0-9_-]{1,48}$/.test(name) || !remoteMcpUrl(url)) { setError("Проверьте имя и HTTPS/loopback адрес MCP без учётных данных."); return; }
          if (mcp[name]) { setError("MCP с таким именем уже существует."); return; }
          void save(["mcp"], {...mcp, [name]: {type: "remote", url}}).then((ok) => { if (ok) { setMcpName(""); setMcpUrl(""); } });
        }}>Добавить MCP</button></div>
      </>}
      {section === "agents" && <>
        <p>Агенты, обнаруженные OpenCode: {agentNames.join(", ") || "нет данных"}. Выбор агента для конкретного чата остаётся в поле ввода.</p>
        <label>Агент по умолчанию для этой области
          <select value={typeof config.default_agent === "string" ? config.default_agent : ""} disabled={!canEdit} onChange={(e) => void save(["default_agent"], e.target.value || undefined)}>
            <option value="">Наследовать</option>
            {agentNames.map((name) => <option value={name} key={name}>{name}</option>)}
          </select>
        </label>
      </>}
    </div>
  </div>;
}
