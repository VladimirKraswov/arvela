import { BrowserPerformance } from "./BrowserPerformance";
import { useEffect, useState } from "react";
import { browserNative, openSessionBrowser, browserSetupSnapshot, useBrowserSetup, type BrowserSetup, type BrowserStatus } from "../browser/integration";
import { browserEnabled, browserNodeProgram } from "../browser/preferences";
import { isLocalComputer } from "../state/computer";
import { Icon } from "./Icon";
import { isNative } from "../native/platform";
import { store, useAppState } from "../state/store";

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const IN_PROGRESS: BrowserSetup["phase"][] = ["checking", "installing", "configuring"];

function setupSummary(setup: BrowserSetup, enabled: boolean): string {
  switch (setup.phase) {
    case "checking": return "Проверка установленных агентов…";
    case "installing": return "Установка Playwright и Chromium выполняется в фоне…";
    case "configuring": return "Подключение инструментов к агентам…";
    case "ready": return "Инструменты готовы";
    case "error": return "Настройка не завершена";
    case "disabled": return "Управление браузером выключено";
    default:
      if (!enabled) return "Управление браузером выключено";
      return setup.openCode.includes("пропущен") && setup.pi.includes("пропущен")
        ? "OpenCode и Pi не найдены; установите агента и повторите проверку"
        : "Настройка при запуске приложения";
  }
}

export function BrowserSettings() {
  const app = useAppState(), setup = useBrowserSetup();
  const [status, setStatus] = useState<BrowserStatus | undefined>(setup.status);
  const [node, setNode] = useState(app.prefs.browser?.nodeProgram ?? "");
  const [url, setUrl] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const enabled = browserEnabled(app.prefs);
  const nodeProgram = browserNodeProgram(app.prefs);
  const native = isNative(), local = isLocalComputer(app.prefs.endpoint, !!store.currentHost());
  const configuring = IN_PROGRESS.includes(setup.phase);
  async function refresh() {
    if (!native) return;
    setStatus(await browserNative<BrowserStatus>("browser_status", { nodeProgram }));
    setError("");
  }
  useEffect(() => { setStatus(setup.status); }, [setup.status]);
  useEffect(() => { void refresh().catch(error => setError(message(error))); }, []);
  const action = async (command: "browser_open" | "browser_stop") => {
    setBusy(true); setError("");
    const current = () => store.state.activeSessionId === app.activeSessionId && store.state.directory === app.directory && store.state.prefs.endpoint === app.prefs.endpoint;
    try {
      // Disable first, so a setup job cancelled by this stop is already
      // superseded and cannot report the cancellation as a setup error.
      if (command === "browser_stop") store.setBrowserSettings({ enabled: false });
      const value = command === "browser_open" ? await openSessionBrowser({directory:app.directory, engine:store.engineIdFor(), sessionId:app.activeSessionId},current,url.trim() || null,nodeProgram)
        : await browserNative<BrowserStatus>(command);
      if (!current()) return;
      setStatus(value);
      if (command === "browser_open") store.setUi({ browserOpen: true, settingsOpen: false });
    } catch (error) { if (current()) setError(message(error)); }
    finally { setBusy(false); }
  };
  return <>
    <p className="settings-intro">Chromium внутри панели Arvela. Агент читает структуру страниц через Playwright MCP; панель показывает живую страницу и его курсор. Логины сохраняются в отдельном профиле.</p>
    {!native && <p role="status">Откройте установленное приложение, чтобы настроить браузер.</p>}
    {!local && <p role="status">Инструменты браузера подключаются к локальному OpenCode и Pi. Для настройки выберите «Этот компьютер».</p>}
    <section className="setting-group" aria-label="Настройка браузера"><h2>Подключение</h2><div className="setting-card">
      <div className="setting-row"><div className="setting-label"><span>Браузер агента</span><small>При запуске Desktop настраивает установленные OpenCode и Pi. Окно открывается по кнопке или по заданию агента.</small></div><div className="setting-control"><label className="switch-label"><input type="checkbox" aria-label="Браузер агента" checked={enabled} disabled={!native || !local || busy} onChange={event => store.setBrowserSettings({ enabled: event.target.checked })}/><span>{enabled ? "Включён" : "Выключен"}</span></label></div></div>
      <div className="setting-row"><div className="setting-label"><label htmlFor="browser-mode">Режим работы</label><small>Быстрый — структура страницы и точные действия. Эмуляция — клики только мышью, ввод клавиатурой; выполнение кода и изменение DOM отключены.</small></div><div className="setting-control"><select id="browser-mode" value={app.prefs.browser?.mode ?? "fast"} disabled={!native || !local || !enabled || busy || configuring} onChange={event => {
        const mode = event.target.value as "fast" | "human";
        setBusy(true); setError("");
        void browserNative("browser_input", { action: "mode", args: { mode } }).then(() => store.setBrowserSettings({ mode })).catch(e => setError(message(e))).finally(() => setBusy(false));
      }}><option value="fast">Быстрый</option><option value="human">Полная эмуляция</option></select></div></div>
      <div className="setting-row"><div className="setting-label"><span>Инструментарий</span><small>Устанавливается отдельно в данные приложения; версии пакетов закреплены.</small></div><div className="setting-control"><span>{setup.phase === "installing" ? "Установка Playwright и Chromium…" : status?.installed ? `Playwright MCP ${status.version ?? ""}` : "Ещё не установлен"}</span></div></div>
      <div className="setting-row"><div className="setting-label"><span>OpenCode</span></div><div className="setting-control"><span>{setup.openCode}</span></div></div>
      <div className="setting-row"><div className="setting-label"><span>Pi</span><small>Расширение браузера загружается в новые сессии Desktop. Учётные данные и модели Pi сохраняются.</small></div><div className="setting-control"><span>{setup.pi}</span></div></div>
      <div className="setting-row"><div className="setting-label"><span>Разрешения на действия</span><small>Действуют настройки доступа выбранного агента. Подключение браузера не изменяет их автоматически.</small></div><div className="setting-control"><span>Настройки OpenCode / Pi</span></div></div>
      <div className="settings-actions"><span className="settings-muted" role="status">{setupSummary(setup, enabled)}</span><button className="btn" disabled={!native || !local || busy || configuring} onClick={() => { setError(""); void store.configureBrowser(true); }}>Настроить и проверить</button></div>
    </div></section>
    <section className="setting-group" aria-label="Панель браузера"><h2>Панель браузера</h2><div className="setting-card">
      <div className="setting-row engine-field-row"><div className="setting-label"><label htmlFor="browser-address">Адрес страницы</label><small>Пустой адрес покажет панель, сохранив текущую страницу.</small></div><div className="setting-control"><input id="browser-address" type="url" value={url} placeholder="https://example.com" onChange={event => setUrl(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && native && local && enabled && status?.installed && !busy && !configuring) void action("browser_open"); }}/></div></div>
      <div className="setting-row"><div className="setting-label"><span>Состояние</span></div><div className="setting-control"><span>{status?.browserOpen ? "Браузер открыт внутри Desktop" : status?.running ? "Сервис готов; страница откроется по запросу" : "Остановлен"}</span></div></div>
      <div className="setting-row"><div className="setting-label"><span>Отдельный профиль</span><small>Cookies и входы принадлежат этому браузеру; обычные браузеры не затрагиваются.</small></div><div className="setting-control"><span className="settings-path">{status?.profilePath ?? "—"}</span></div></div>
      <div className="settings-actions"><button className="btn primary" disabled={!native || !local || !enabled || !status?.installed || busy || configuring} onClick={() => void action("browser_open")}>Открыть браузер</button><button className="btn" disabled={!native || busy || (!status?.running && !configuring)} title={configuring ? "Останавливает и отменяет текущую установку или запуск" : undefined} onClick={() => void action("browser_stop")}>Остановить управление</button><button className="btn" disabled={!native || busy} onClick={() => void refresh().catch(error => setError(message(error)))}>Обновить состояние</button></div>
    </div></section>
    <section className="setting-group" aria-label="Среда браузера"><h2>Среда</h2><div className="setting-card">
      <div className="setting-row engine-field-row"><div className="setting-label"><label htmlFor="browser-node">Путь к Node.js</label><small>Необязательно. Пусто — использовать настройку Pi или найти Node.js 20+ в стандартных местах и менеджерах версий.</small></div><div className="setting-control"><input id="browser-node" value={node} placeholder={status?.nodeProgram ?? "Автоматически"} spellCheck={false} onChange={event => setNode(event.target.value)}/></div></div>
      <div className="settings-actions"><button className="btn" disabled={!native || !local || configuring} onClick={() => store.setBrowserSettings({ nodeProgram: node.trim() || undefined })}>Сохранить и проверить путь</button><button className="btn" onClick={() => void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl("https://nodejs.org/en/download"))}>Установить Node.js…</button></div>
    </div></section>
    <BrowserPerformance />
    {(error || setup.error || status?.error) && <p className="settings-inline-error" role="alert">{error || setup.error || status?.error}</p>}
  </>;
}

function browserButtonTitle(local: boolean, native: boolean, enabled: boolean, phase: BrowserSetup["phase"]): string {
  if (!native) return "Браузер агента доступен в установленном приложении";
  if (!local) return "Браузер агента работает только на этом компьютере";
  if (!enabled) return "Браузер агента выключен в настройках";
  if (IN_PROGRESS.includes(phase)) return "Настройка браузера выполняется; окно откроется после её завершения";
  return "Открыть встроенную панель браузера агента";
}

export function BrowserButton() {
  const app = useAppState(), setup = useBrowserSetup();
  const [busy, setBusy] = useState(false);
  const native = isNative(), local = isLocalComputer(app.prefs.endpoint, !!store.currentHost());
  const enabled = browserEnabled(app.prefs);
  return <button className="icon-btn browser-button" aria-label="Открыть браузер агента" title={browserButtonTitle(local, native, enabled, setup.phase)} disabled={busy || !local || !native || !enabled} onClick={() => {
    setBusy(true);
    const current = () => store.state.activeSessionId === app.activeSessionId && store.state.directory === app.directory && store.state.prefs.endpoint === app.prefs.endpoint;
    // A failed setup is retried from scratch: clicking again after fixing
    // Node.js or the network must not replay the cached failure.
    void store.configureBrowser(browserSetupSnapshot().phase === "error").then(() => {
      const setup = browserSetupSnapshot();
      if (setup.phase === "error") throw new Error(setup.error || "Инструменты браузера не подключены.");
      return openSessionBrowser({directory:app.directory, engine:store.engineIdFor(), sessionId:app.activeSessionId},current,null,browserNodeProgram(app.prefs));
    }).then(() => { if (current()) store.setUi({ browserOpen: true }); })
      .catch(error => { if (current()) store.setUi({ toast: `Браузер: ${message(error)}` }); }).finally(() => setBusy(false));
  }}><Icon name="browser" size={17}/><span>{busy ? "Открываю…" : "Браузер"}</span></button>;
}
