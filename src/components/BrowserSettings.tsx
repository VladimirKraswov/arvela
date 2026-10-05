import { useEffect, useState } from "react";
import { browserNative, browserSetupSnapshot, useBrowserSetup, type BrowserStatus } from "../browser/integration";
import { isLocalComputer } from "../state/computer";
import { Icon } from "./Icon";
import { isNative } from "../native/platform";
import { store, useAppState } from "../state/store";

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
export function BrowserSettings() {
  const app = useAppState(), setup = useBrowserSetup();
  const [status, setStatus] = useState<BrowserStatus | undefined>(setup.status);
  const [node, setNode] = useState(app.prefs.browser?.nodeProgram ?? "");
  const [url, setUrl] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const enabled = app.prefs.browser?.enabled !== false;
  const native = isNative(), local = isLocalComputer(app.prefs.endpoint, !!store.currentHost());
  const configuring = ["checking", "installing", "configuring"].includes(setup.phase);
  async function refresh() {
    if (!native) return;
    setStatus(await browserNative<BrowserStatus>("browser_status", { nodeProgram: app.prefs.browser?.nodeProgram ?? app.prefs.pi?.nodeProgram ?? null }));
    setError("");
  }
  useEffect(() => { setStatus(setup.status); }, [setup.status]);
  useEffect(() => { void refresh().catch(error => setError(message(error))); }, []);
  const action = async (command: "browser_open" | "browser_stop") => {
    setBusy(true); setError("");
    try {
      const value = await browserNative<BrowserStatus>(command, command === "browser_open"
        ? { url: url.trim() || null, nodeProgram: app.prefs.browser?.nodeProgram ?? app.prefs.pi?.nodeProgram ?? null } : undefined);
      setStatus(value);
      if (command === "browser_stop") store.setBrowserSettings({ enabled: false });
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  };
  return <>
    <p className="settings-intro">Отдельное окно Chromium для действий агента. Playwright MCP читает страницы, управляет вкладками, заполняет формы и парольные поля, загружает файлы проекта и делает снимки. Логины сохраняются в отдельном профиле OpenCode Desktop.</p>
    {!native && <p role="status">Откройте установленное приложение, чтобы настроить браузер.</p>}
    {!local && <p role="status">Инструменты браузера подключаются к локальному OpenCode и Pi. Для настройки выберите «Этот компьютер».</p>}
    <section className="setting-group" aria-label="Настройка браузера"><h2>Подключение</h2><div className="setting-card">
      <div className="setting-row"><div className="setting-label"><span>Браузер агента</span><small>При запуске Desktop настраивает установленные OpenCode и Pi. Окно открывается по кнопке или по заданию агента.</small></div><div className="setting-control"><label className="switch-label"><input type="checkbox" aria-label="Браузер агента" checked={enabled} disabled={!native || !local || busy} onChange={event => store.setBrowserSettings({ enabled: event.target.checked })}/><span>{enabled ? "Включён" : "Выключен"}</span></label></div></div>
      <div className="setting-row"><div className="setting-label"><span>Инструментарий</span><small>Устанавливается отдельно в данные приложения; версии пакетов закреплены.</small></div><div className="setting-control"><span>{setup.phase === "installing" ? "Установка Playwright и Chromium…" : status?.installed ? `Playwright MCP ${status.version ?? ""}` : "Ещё не установлен"}</span></div></div>
      <div className="setting-row"><div className="setting-label"><span>OpenCode</span></div><div className="setting-control"><span>{setup.openCode}</span></div></div>
      <div className="setting-row"><div className="setting-label"><span>Pi</span><small>Расширение браузера загружается в новые сессии Desktop. Учётные данные и модели Pi сохраняются.</small></div><div className="setting-control"><span>{setup.pi}</span></div></div>
      <div className="setting-row"><div className="setting-label"><span>Разрешения на действия</span><small>Действуют настройки доступа выбранного агента. Подключение браузера не изменяет их автоматически.</small></div><div className="setting-control"><span>Настройки OpenCode / Pi</span></div></div>
      <div className="settings-actions"><span className="settings-muted" role="status">{configuring ? "Настройка выполняется в фоне" : setup.phase === "ready" ? "Инструменты готовы" : enabled ? "Настройка при запуске приложения" : "Управление браузером выключено"}</span><button className="btn" disabled={!native || !local || busy || configuring} onClick={() => { setError(""); void store.configureBrowser(true); }}>Настроить и проверить</button></div>
    </div></section>
    <section className="setting-group" aria-label="Окно браузера"><h2>Окно браузера</h2><div className="setting-card">
      <div className="setting-row engine-field-row"><div className="setting-label"><label htmlFor="browser-address">Адрес страницы</label><small>Пустой адрес покажет открытое окно, сохранив текущую страницу.</small></div><div className="setting-control"><input id="browser-address" type="url" value={url} placeholder="https://example.com" onChange={event => setUrl(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && native && local && enabled && status?.installed && !busy && !configuring) void action("browser_open"); }}/></div></div>
      <div className="setting-row"><div className="setting-label"><span>Состояние</span></div><div className="setting-control"><span>{status?.browserOpen ? "Окно открыто" : status?.running ? "Сервис готов; окно откроется по запросу" : "Остановлен"}</span></div></div>
      <div className="setting-row"><div className="setting-label"><span>Отдельный профиль</span><small>Cookies и входы принадлежат этому браузеру; обычные браузеры не затрагиваются.</small></div><div className="setting-control"><span className="settings-path">{status?.profilePath ?? "—"}</span></div></div>
      <div className="settings-actions"><button className="btn primary" disabled={!native || !local || !enabled || !status?.installed || busy || configuring} onClick={() => void action("browser_open")}>Открыть браузер</button><button className="btn" disabled={!native || busy || !status?.running} onClick={() => void action("browser_stop")}>Остановить управление</button><button className="btn" disabled={!native || busy} onClick={() => void refresh().catch(error => setError(message(error)))}>Обновить состояние</button></div>
    </div></section>
    <section className="setting-group" aria-label="Среда браузера"><h2>Среда</h2><div className="setting-card">
      <div className="setting-row engine-field-row"><div className="setting-label"><label htmlFor="browser-node">Путь к Node.js</label><small>Необязательно. Пусто — использовать настройку Pi или найти Node.js в стандартных местах.</small></div><div className="setting-control"><input id="browser-node" value={node} placeholder={status?.nodeProgram ?? "Автоматически"} spellCheck={false} onChange={event => setNode(event.target.value)}/></div></div>
      <div className="settings-actions"><button className="btn" disabled={!native || !local || configuring} onClick={() => store.setBrowserSettings({ nodeProgram: node.trim() || undefined })}>Сохранить и проверить путь</button><button className="btn" onClick={() => void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl("https://nodejs.org/en/download"))}>Установить Node.js…</button></div>
    </div></section>
    {(error || setup.error || status?.error) && <p className="settings-inline-error" role="alert">{error || setup.error || status?.error}</p>}
  </>;
}

export function BrowserButton() {
  const app = useAppState();
  const [busy, setBusy] = useState(false);
  return <button className="icon-btn browser-button" aria-label="Открыть браузер агента" title="Открыть отдельный браузер для работы агента" disabled={busy || !isLocalComputer(app.prefs.endpoint, !!store.currentHost()) || !isNative() || app.prefs.browser?.enabled === false} onClick={() => {
    setBusy(true);
    void store.configureBrowser().then(() => {
      const setup = browserSetupSnapshot();
      if (setup.phase === "error") throw new Error(setup.error || "Инструменты браузера не подключены.");
      return browserNative("browser_open", { url: null, nodeProgram: app.prefs.browser?.nodeProgram ?? app.prefs.pi?.nodeProgram ?? null });
    }).catch(error => store.setUi({ toast: `Браузер: ${message(error)}` })).finally(() => setBusy(false));
  }}><Icon name="browser" size={17}/><span>{busy ? "Открываю…" : "Браузер"}</span></button>;
}
