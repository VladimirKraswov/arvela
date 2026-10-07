import { HubSettings } from "./HubSettings";
import { CapabilitiesSettings } from "./CapabilitiesSettings";
import { ModelServicesSettings } from "./ModelServicesSettings";
import { BrowserSettings } from "./BrowserSettings";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { version as appVersion } from "../../package.json";
import { store, useAppState } from "../state/store";
import { DEFAULT_BASE_URL, isAllowedBaseUrl } from "../api/client";
import { ACCENTS, DEFAULT_APPEARANCE } from "../state/appearance";
import { defaultAsr, getAsrKey, setAsrKey, validateAsr } from "../voice/asr";
import { OpenCodeSettings, type EngineSection } from "./OpenCodeSettings";
import { ComputerSettings } from "./ComputerSettings";
import { AgentControlSettings } from "./AgentControlSettings";
import { PiSettings } from "./PiSettings";
import { UsageSettings } from "./UsageSettings";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";
import { DEFAULT_HELPER_ENDPOINT, helperHealth, validHelperEndpoint, type HelperHealth } from "../attachments/helper";
import { detectLocalOpenCode } from "../native/localServer";

export const SETTINGS_SECTIONS = [
  { id: "general", title: "Общее", group: "Приложение", icon: "settings", description: "Рабочее пространство и удалённые компьютеры", keywords: "сервер адрес endpoint ssh хост" },
  { id: "engines", title: "Обзор агентов", group: "Агенты", icon: "chat", description: "OpenCode и Pi: возможности и отдельные настройки", keywords: "engine движок агент Pi OpenCode модель" },
  { id: "appearance", title: "Внешний вид", group: "Приложение", icon: "sun", description: "Тема, основной цвет, размеры шрифтов и ширина чата", keywords: "оформление акцент интерфейс текст код межстрочный интервал светлая тёмная" },
  { id: "usage", title: "Использование", group: "Приложение", icon: "monitor", description: "Расход токенов по моделям и дням", keywords: "метрики статистика токены модель кэш расход" },
  { id: "voice", title: "Диктовка", group: "Приложение", icon: "mic", description: "Распознавание речи, модель и язык", keywords: "голос микрофон ASR GigaAM ключ API" },
  { id: "hub", title: "Облачная библиотека", group: "Общие возможности", icon: "file", description: "Общие пакеты, история и метрики устройств", keywords: "облако hub синхронизация история устройства" },
  { id: "capabilities", title: "Навыки и инструменты", group: "Общие возможности", icon: "file", description: "Общий каталог навыков и MCP для OpenCode и Pi", keywords: "skills tools MCP источники инструменты общие Pi" },
  { id: "browser", title: "Браузер", group: "Общие возможности", icon: "browser", description: "Управляемый Chromium и автонастройка OpenCode / Pi", keywords: "browser playwright chromium MCP окна вкладки формы пароли" },
  { id: "computer", title: "Управление компьютером", group: "Общие возможности", icon: "monitor", description: "Только macOS: курсор агента, Cua Driver и системные разрешения", keywords: "запись экрана универсальный доступ мышь" },
  { id: "agentControl", title: "API для агентов", group: "Общие возможности", icon: "server", description: "Управление Desktop через локальный MCP без мышки", keywords: "mcp api automation управление агент subagent" },
  { id: "modelServices", title: "Сервисы моделей", group: "Общие возможности", icon: "server", description: "Переключение моделей, загрузка и доступные агенты", keywords: "inference api модели loader прогресс Pi OpenCode" },
  { id: "helper", title: "Сервисы помощника", group: "Общие возможности", icon: "server", description: "Обработка PDF, аудио и видео на CPU-контейнере", keywords: "вложения файлы контейнер Proxmox PDF видео аудио MCP" },
  { id: "tools", title: "Разрешения OpenCode", group: "OpenCode", icon: "terminal", description: "Разрешения на команды, файлы и поиск", keywords: "bash read edit tools доступ permission" },
  { id: "skills", title: "Навыки OpenCode", group: "OpenCode", icon: "file", description: "Обнаруженные навыки и их источники", keywords: "skills skill" },
  { id: "plugins", title: "Плагины OpenCode", group: "OpenCode", icon: "plus", description: "Расширения OpenCode из npm", keywords: "plugins пакеты" },
  { id: "mcp", title: "MCP OpenCode", group: "OpenCode", icon: "server", description: "Подключения инструментов и их статус", keywords: "mcp интеграции серверы" },
  { id: "agents", title: "Профили OpenCode", group: "OpenCode", icon: "chat", description: "Профили инструкций и инструментов OpenCode", keywords: "agents build plan" },
  { id: "opencode", title: "OpenCode", group: "Агенты", icon: "chat", description: "Подключение, разрешения, профили и дополнения OpenCode", keywords: "CLI путь сервер endpoint установка" },
  { id: "pi", title: "Pi", group: "Агенты", icon: "chat", description: "Установка, модели, расширения и LSP локального агента Pi", keywords: "pi rpc движок engine модель расширение lsp язык сервер" },
  { id: "about", title: "О приложении", group: "Приложение", icon: "code", description: "Версия приложения и состояние сервера", keywords: "диагностика поток событий SSE провайдеры" },
] as const;
type Section = typeof SETTINGS_SECTIONS[number]["id"];
export function searchSettings(query: string) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/);
  return SETTINGS_SECTIONS.filter(s => words.every(word => `${s.group} ${s.title} ${s.description} ${s.keywords}`.toLocaleLowerCase().includes(word)));
}
const isEngine = (id: Section): id is EngineSection => ["tools", "skills", "plugins", "mcp", "agents"].includes(id);
function Row({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <div className="setting-row"><div className="setting-label"><span>{title}</span>{description && <small>{description}</small>}</div><div className="setting-control">{children}</div></div>;
}
function Group({ title, children }: { title: string; children: ReactNode }) {
  return <section className="setting-group" aria-label={title}><h2>{title}</h2><div className="setting-card">{children}</div></section>;
}
function AppearanceSettings() {
  const { prefs } = useAppState(), a = prefs.appearance;
  const [custom, setCustom] = useState(a.accent === "neutral" ? "#5599ee" : a.accent);
  const [colorError, setColorError] = useState(false);
  useEffect(() => { setCustom(a.accent === "neutral" ? "#5599ee" : a.accent); setColorError(false); }, [a.accent]);
  const saveColor = () => {
    if (!/^#[0-9a-f]{6}$/i.test(custom)) { setColorError(true); return; }
    store.setAppearance({ accent: custom }); setColorError(false);
  };
  return <>
    <p className="settings-intro">Изменения сразу видны во всём приложении и сохраняются на этом компьютере.</p>
    <Group title="Оформление">
      <Row title="Тема" description="Системная тема следует настройкам операционной системы."><select aria-label="Тема" value={prefs.theme} onChange={e => store.setTheme(e.target.value as typeof prefs.theme)}><option value="system">Системная</option><option value="light">Светлая</option><option value="dark">Тёмная</option></select></Row>
      <Row title="Основной цвет" description="Кнопки, ссылки и выделения."><div className="accent-swatches" role="group" aria-label="Основной цвет">{ACCENTS.map(([value, title]) => <button key={value} aria-label={title} title={title} aria-pressed={a.accent === value} onClick={() => store.setAppearance({ accent: value })} style={{ background: value === "neutral" ? "var(--text)" : value, color: "#111" }}>{a.accent === value && <Icon name="check" size={15} />}</button>)}</div></Row>
      <Row title="Свой цвет" description="Цвет в формате HEX, например #5599ee."><div className="custom-color"><input type="color" aria-label="Выбрать свой цвет" value={/^#[0-9a-f]{6}$/i.test(custom) ? custom : "#5599ee"} onChange={e => { setCustom(e.target.value); store.setAppearance({ accent: e.target.value }); }}/><input aria-label="HEX цвета" value={custom} spellCheck={false} maxLength={7} aria-invalid={colorError} onChange={e => { setCustom(e.target.value); setColorError(false); }} onKeyDown={e => { if (e.key === "Enter") saveColor(); }}/><button className="btn small" onClick={saveColor}>Применить цвет</button></div></Row>
      {colorError && <p className="settings-inline-error" role="alert">Введите # и шесть шестнадцатеричных символов.</p>}
    </Group>
    <Group title="Размер текста">
      {([
        ["uiFontSize", "Интерфейс", "Меню, проекты и элементы управления.", 12, 18],
        ["chatFontSize", "Сообщения", "Ответы, ваши сообщения и поле ввода.", 12, 24],
        ["codeFontSize", "Код", "Блоки кода, команды и результаты инструментов.", 10, 22],
      ] as const).map(([key, title, description, min, max]) => <Row key={key} title={title} description={description}><div className="font-control"><input type="range" min={min} max={max} step={1} aria-label={`Размер шрифта: ${title}`} value={a[key]} onChange={e => store.setAppearance({ [key]: Number(e.target.value) })}/><output>{a[key]} px</output></div></Row>)}
    </Group>
    <Group title="Чтение чата">
      <Row title="Ширина сообщений" description="Доступная ширина зависит от размера окна и боковых панелей."><select aria-label="Ширина сообщений" value={a.chatWidth} onChange={e => store.setAppearance({ chatWidth: e.target.value as typeof a.chatWidth })}><option value="standard">Обычная</option><option value="wide">Широкая</option><option value="full">На всю ширину</option></select></Row>
      <Row title="Межстрочный интервал"><select aria-label="Межстрочный интервал" value={a.lineSpacing} onChange={e => store.setAppearance({ lineSpacing: e.target.value as typeof a.lineSpacing })}><option value="standard">Обычный</option><option value="relaxed">Свободный</option></select></Row>
    </Group>
    <section className="appearance-preview" aria-label="Предпросмотр оформления"><h2>Предпросмотр</h2><div className="preview-chat"><div className="preview-label"><span className="preview-dot"/>Arvela</div><Markdown source={'Так будет выглядеть ответ в чате. **Важное легко заметить**, а код удобно читать.\n\n```typescript\nconst greeting = "Привет, мир!";\nconsole.log(greeting);\n```'}/><span className="preview-caption">Размеры текста и кода настраиваются отдельно.</span></div></section>
    <div className="settings-actions"><span className="settings-muted">Сохранено автоматически</span><button className="btn" onClick={() => { store.setAppearance(DEFAULT_APPEARANCE); store.setTheme("dark"); }}>Сбросить оформление</button></div>
  </>;
}

export function SettingsScreen() {
  const s = useAppState();
  const [section, setSection] = useState<Section>("general"), [query, setQuery] = useState("");
  const [engineSection, setEngineSection] = useState<EngineSection>("tools"), [engineVisited, setEngineVisited] = useState(false);
  const [capabilitiesDirty,setCapabilitiesDirty] = useState(false), [capabilitiesVisited,setCapabilitiesVisited] = useState(false);
  const [hubVisited, setHubVisited] = useState(false), [hubDirty, setHubDirty] = useState(false);
  const [piVisited, setPiVisited] = useState(false), [piDirty, setPiDirty] = useState(false);
  const [engineDirty, setEngineDirty] = useState(false), [leave, setLeave] = useState<"close" | "hosts" | null>(null);
  const [endpoint, setEndpoint] = useState(s.prefs.localEndpoint ?? s.prefs.endpoint);
  const [openCodeProgram, setOpenCodeProgram] = useState(s.prefs.localOpenCodeProgram ?? "");
  const [asr, setAsr] = useState(s.prefs.asr ?? defaultAsr), [key, setKey] = useState(getAsrKey(asr.endpoint));
  const [helper, setHelper] = useState(s.prefs.helperEndpoint ?? DEFAULT_HELPER_ENDPOINT), [helperStatus, setHelperStatus] = useState<HelperHealth | null>(null), [testingHelper, setTestingHelper] = useState(false);
  const [savedKey, setSavedKey] = useState(key);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [connecting, setConnecting] = useState(false);
  const [cliInstalled, setCliInstalled] = useState<boolean | null>(null);
  const checkCli = () => { void detectLocalOpenCode(openCodeProgram.trim() || undefined).then(setCliInstalled).catch(() => setCliInstalled(null)); };
  useEffect(checkCli, []);
  const content = useRef<HTMLDivElement>(null), back = useRef<HTMLButtonElement>(null), stay = useRef<HTMLButtonElement>(null);
  const endpointDirty = endpoint !== (s.prefs.localEndpoint ?? s.prefs.endpoint);
  const programDirty = openCodeProgram !== (s.prefs.localOpenCodeProgram ?? "");
  const localDirty = endpointDirty || programDirty;
  const voiceDirty = JSON.stringify(asr) !== JSON.stringify(s.prefs.asr ?? defaultAsr) || key !== savedKey;
  const helperDirty = helper !== (s.prefs.helperEndpoint ?? DEFAULT_HELPER_ENDPOINT);
  const dirty = hubDirty || capabilitiesDirty || engineDirty || piDirty || localDirty || voiceDirty || helperDirty;
  const exit = (target: "close" | "hosts") => { store.setUi({ settingsOpen: false, ...(target === "hosts" ? { hostDialogOpen: true } : {}) }); };
  const requestExit = (target: "close" | "hosts") => { if (connecting) return; if (dirty) setLeave(target); else exit(target); };
  const navigate = (id: Section) => { if (id === "hub") setHubVisited(true); if (id === "pi") setPiVisited(true); if (id === "capabilities") setCapabilitiesVisited(true); setSection(id); setQuery(""); setError(""); setNotice(""); if (isEngine(id)) { setEngineVisited(true); setEngineSection(id); } content.current?.scrollTo(0, 0); };
  useEffect(() => { if (leave) { content.current?.scrollTo(0, 0); stay.current?.focus(); } }, [leave]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    back.current?.focus();
    return () => { requestAnimationFrame(() => { if (previous?.isConnected) previous.focus({ preventScroll: true }); }); };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || s.ui.hostDialogOpen) return;
      e.preventDefault();
      if (query) setQuery(""); else if (leave) setLeave(null); else requestExit("close");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const selected = SETTINGS_SECTIONS.find(x => x.id === section)!;
  const matches = searchSettings(query);
  return <section className="settings-screen" aria-label="Настройки" data-unsaved-settings={dirty ? "true" : undefined}>
    <aside className="settings-sidebar">
      <div className="settings-window-drag" data-tauri-drag-region />
      <button ref={back} className="settings-back" onClick={() => requestExit("close")} disabled={connecting}><Icon name="arrowDown" size={17} style={{ transform: "rotate(90deg)" }}/>Вернуться в приложение</button>
      <div className="settings-search"><Icon name="search" size={16}/><input type="search" aria-label="Поиск настроек" placeholder="Поиск настроек…" value={query} onChange={e => setQuery(e.target.value)}/></div>
      <nav aria-label="Разделы настроек">{["Приложение", "Общие возможности", "Агенты"].map(group => <div className="settings-nav-group" key={group}><div className="settings-nav-label">{group}</div>{SETTINGS_SECTIONS.filter(x => x.group === group).map(item => <button key={item.id} aria-current={!query && (section === item.id || item.id === "opencode" && isEngine(section)) ? "page" : undefined} onClick={() => navigate(item.id)}><Icon name={item.icon} size={17}/>{item.title}</button>)}</div>)}</nav>
      <span className="settings-sidebar-version">Arvela {appVersion}</span>
    </aside>
    <div className="settings-main" ref={content}><div className="settings-window-drag" data-tauri-drag-region/><div className="settings-page">
      <header><h1>{query.trim() ? "Поиск настроек" : selected.title}</h1><p>{query.trim() ? `Результаты для «${query.trim()}»` : selected.description}</p></header>
      {leave && <div className="settings-review" role="alert"><span>Есть несохранённые изменения настроек. Оформление уже сохранено.</span><button ref={stay} className="btn" onClick={() => setLeave(null)}>Остаться</button><button className="btn" onClick={() => exit(leave)}>Не сохранять и выйти</button></div>}
      {query.trim() ? <div className="settings-results">{matches.length ? matches.map(item => <button key={item.id} onClick={() => navigate(item.id)}><Icon name={item.icon}/><span><b>{item.title}</b><small>{item.description}</small></span><Icon name="chevron" size={16}/></button>) : <p>Ничего не найдено. Попробуйте «шрифт», «диктовка» или «MCP».</p>}</div> : <>
        {section === "general" && <Group title="Рабочее пространство"><Row title="Текущий компьютер"><span>{store.hostLabel()}</span></Row><Row title="Удалённые компьютеры" description="Подключения к серверам рабочих пространств."><button className="btn" onClick={() => requestExit("hosts")}>Управлять…</button></Row></Group>}
        {(section === "opencode" || isEngine(section)) && <nav className="settings-agent-tabs" aria-label="Настройки OpenCode">{([
          ["opencode", "Подключение"], ["tools", "Разрешения"], ["agents", "Профили"], ["plugins", "Плагины"], ["skills", "Навыки"], ["mcp", "MCP"],
        ] as const).map(([id,title]) => <button key={id} aria-current={section === id ? "page" : undefined} onClick={() => navigate(id)}>{title}</button>)}</nav>}
        {section === "opencode" && <>
          <Group title="Подключение"><Row title="Текущий компьютер" description={s.prefs.endpoint}><span>{store.hostLabel()}</span></Row><Row title="Локальный сервер OpenCode" description="Если сервер не запущен, приложение запустит установленный OpenCode на этом адресе."><input aria-label="Адрес локального сервера OpenCode" spellCheck={false} value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder={DEFAULT_BASE_URL}/></Row><Row title="OpenCode CLI" description="Движок устанавливается отдельно от приложения."><span>{cliInstalled === null ? "Не проверено" : cliInstalled ? "Установлен" : "Не найден"}</span>{cliInstalled === false && <button className="btn" onClick={() => void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl("https://opencode.ai/docs/"))}>Установить OpenCode…</button>}<button className="btn" onClick={checkCli}>Проверить снова</button></Row><Row title="Путь к OpenCode CLI" description="Абсолютный путь к локальному CLI. Пусто — искать автоматически. Работающий сервер не перезапускается."><input aria-label="Путь к OpenCode CLI" spellCheck={false} placeholder="/opt/homebrew/bin/opencode" value={openCodeProgram} onChange={e => { setOpenCodeProgram(e.target.value); setCliInstalled(null); }}/></Row><Row title="Удалённые компьютеры" description="Подключения к OpenCode через SSH."><button className="btn" onClick={() => requestExit("hosts")}>Управлять…</button></Row></Group>
          <Group title="Диагностика OpenCode"><Row title="Версия"><span>{s.connection.version ?? "—"}</span></Row><Row title="Поток событий"><span>{s.connection.streamState}</span></Row><Row title="Подключённые провайдеры"><span>{s.connectedProviderIds.length}</span></Row><Row title="Профили агента"><span>{s.agents.map(a => a.name).join(", ") || "—"}</span></Row></Group>
          <div className="settings-actions"><span className="settings-muted">Перезапуск сервера не требуется.</span><button className="btn primary" disabled={connecting || !localDirty} onClick={async () => {
            setError(""); setNotice("");
            if (!isAllowedBaseUrl(endpoint.trim())) { setError("Укажите HTTP-адрес loopback сервера. Для удалённого компьютера используйте SSH-подключение."); return; }
            setConnecting(true);
            try {
              const program = openCodeProgram.trim();
              if (program && !(await detectLocalOpenCode(program))) { setError("Укажите абсолютный путь к существующему исполняемому файлу OpenCode CLI."); setCliInstalled(false); return; }
              store.setLocalOpenCodeProgram(program || undefined);
              setOpenCodeProgram(program);
              setCliInstalled(await detectLocalOpenCode(program || undefined));
              if (endpointDirty) {
                const ok = await store.connect(endpoint.trim());
                if (ok) { setEndpoint(endpoint.trim()); setNotice("Подключено."); }
                else setError(store.state.connection.error ?? "Подключиться не удалось.");
              } else setNotice("Путь к OpenCode CLI сохранён. Работающий сервер не перезапускался.");
            }
            catch (e) { setError(e instanceof Error ? e.message : String(e)); }
            finally { setConnecting(false); }
          }}>{connecting ? "Сохранение…" : endpointDirty ? "Сохранить и подключиться" : "Сохранить путь"}</button></div>
        </>}
        {section === "appearance" && <AppearanceSettings/>}
        {section === "usage" && <UsageSettings/>}
        {section === "voice" && <>
          <p className="settings-intro">Диктовка распознаёт речь и добавляет текст в черновик сообщения.</p>
          <Group title="Распознавание речи"><Row title="URL распознавания" description="Полный адрес ASR API, совместимого с OpenAI."><input aria-label="URL распознавания" spellCheck={false} value={asr.endpoint} onChange={e => { setAsr({ ...asr, endpoint: e.target.value }); setKey(getAsrKey(e.target.value)); }}/></Row><Row title="Модель"><input aria-label="Модель ASR" value={asr.model} onChange={e => setAsr({ ...asr, model: e.target.value })}/></Row><Row title="Язык" description="Например, ru. Пустое значение — автоматический выбор."><input aria-label="Язык ASR" value={asr.language} onChange={e => setAsr({ ...asr, language: e.target.value })}/></Row><Row title="API-ключ" description="Только если сервис требует авторизацию. Хранится до закрытия приложения."><input aria-label="API-ключ ASR" type="password" autoComplete="off" placeholder="Необязательно" value={key} onChange={e => setKey(e.target.value)}/></Row></Group>
          <p className="settings-muted">Запись — до 2 минут. Аудио не сохраняется на диск. Для удалённого сервиса используйте HTTPS.</p>
          <div className="settings-actions"><button className="btn" disabled={!voiceDirty} onClick={() => { setAsr(s.prefs.asr ?? defaultAsr); const original = getAsrKey(s.prefs.asr?.endpoint ?? ""); setKey(original); setSavedKey(original); setError(""); }}>Отменить изменения</button><button className="btn primary" disabled={!voiceDirty} onClick={() => { const problem = asr.endpoint.trim() ? validateAsr(asr) : null; if (problem) { setError(problem); return; } const next = { ...asr, endpoint: asr.endpoint.trim(), model: asr.model.trim() }; store.setAsr(next); setAsr(next); setAsrKey(next.endpoint, key); setSavedKey(key); setError(""); setNotice("Настройки диктовки сохранены."); }}>Сохранить диктовку</button></div>
        </>}
        {capabilitiesVisited && <div hidden={section !== "capabilities"}><CapabilitiesSettings onDirtyChange={setCapabilitiesDirty} onNavigate={navigate}/></div>}
        {hubVisited && <div hidden={section !== "hub"}><HubSettings onDirtyChange={setHubDirty}/></div>}
        {section === "browser" && <BrowserSettings/>}
        {section === "computer" && <ComputerSettings/>}
        {section === "agentControl" && <AgentControlSettings/>}

        {section === "engines" && <>
        <p className="settings-intro">У каждого чата свой агент и модель. Для новых проектов по умолчанию выбран OpenCode; Pi можно выбрать при создании проекта или чата. Существующий диалог переносится через «Продолжить в…», сохраняя исходную историю.</p>
        <Group title="Агенты">
          <Row title="OpenCode" description="Сессии и исполнение на подключённом локальном или удалённом сервере. Свои модели, профили, плагины и разрешения."><span>{s.connection.phase === "connected" ? `Подключён · ${s.connection.version ?? ""}` : "Не подключён"}</span><button className="btn" onClick={() => navigate("opencode")}>Настроить OpenCode</button></Row>
          <Row title="Pi" description="Локальный агент с отдельными моделями, расширениями, LSP и подтверждениями инструментов."><span>{store.piInstalled ? "Установлен" : "Не найден"}</span><button className="btn" onClick={() => navigate("pi")}>Настроить Pi</button></Row>
        </Group>
        <Group title="Общие функции">
          <p className="handoff-note">Чат, рассуждения, остановка, ветвление, сжатие, диктовка, вложения, браузер, источники, результаты, расписания и статистика доступны для обоих агентов. Терминал и просмотр файлов и Git используют сервер рабочего пространства; они доступны в чате Pi, когда этот сервер подключён. Удалённое исполнение Pi через SSH пока не реализовано.</p>
        </Group>
      </>}
      {section === "modelServices" && <ModelServicesSettings/>}
        {section === "helper" && <>
          <p className="settings-intro">CPU-помощник в контейнере Proxmox подготавливает вложения для выбранной модели. Если модель поддерживает формат, файл идёт напрямую. Иначе помощник извлекает текст, кадры и звук. Аудио распознаёт отдельный GigaAM ASR из раздела «Диктовка».</p>
          <Group title="Подключение"><Row title="Локальный адрес помощника" description="SSH-туннель на этом компьютере; удалённый адрес контейнера сюда не вводится."><input aria-label="Адрес помощника" spellCheck={false} value={helper} onChange={event => { setHelper(event.target.value); setHelperStatus(null); }}/></Row><Row title="Состояние"><span>{helperStatus?.ok ? `Работает · версия ${helperStatus.version}` : "Проверка не выполнялась"}</span></Row><Row title="Доступные сервисы"><span>{helperStatus?.services.join(", ") || "—"}</span></Row></Group>
          <p className="settings-muted">Общие MCP-подключения находятся в разделе «Навыки и инструменты»; настройки конкретного агента — в его разделе. Файлы не хранятся в контейнере после обработки.</p>
          <div className="settings-actions"><button className="btn" disabled={testingHelper} onClick={async () => { setError(""); setNotice(""); setTestingHelper(true); try { setHelperStatus(await helperHealth(helper.trim())); setNotice("Помощник доступен."); } catch (problem) { setHelperStatus(null); setError(problem instanceof Error ? problem.message : String(problem)); } finally { setTestingHelper(false); } }}>{testingHelper ? "Проверка…" : "Проверить подключение"}</button><button className="btn primary" disabled={!helperDirty} onClick={() => { const next = helper.trim().replace(/\/$/, ""); if (!validHelperEndpoint(next)) { setError("Укажите локальный HTTP-адрес без пути и учётных данных."); return; } store.setHelperEndpoint(next); setHelper(next); setError(""); setNotice("Адрес помощника сохранён."); }}>Сохранить</button></div>
        </>}
        {section === "about" && <Group title="Состояние приложения"><Row title="Arvela"><span>{appVersion}</span></Row><Row title="OpenCode"><span>{s.connection.phase === "connected" ? `Подключён · ${s.connection.version ?? ""}` : "Не подключён"}</span></Row><Row title="Pi"><span>{s.piHealth?.install?.installed ? `Установлен · ${s.piHealth.install.version ?? ""}` : "Не проверен"}</span></Row></Group>}
      </>}
      <div hidden={!!query.trim() || section !== "pi"}>{piVisited && <PiSettings onDirtyChange={setPiDirty}/>}</div>
      <div hidden={!!query.trim() || !isEngine(section)}>{engineVisited && <OpenCodeSettings section={engineSection} onDirtyChange={setEngineDirty}/>}</div>
      {error && <p role="alert" className="composer-error">{error}</p>}{notice && <p role="status" className="settings-notice">{notice}</p>}
    </div></div>
  </section>;
}
