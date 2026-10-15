import { useEffect, useState } from "react";
import { browserNative } from "../browser/integration";
import { browserEnvironment, browserEnvironmentDefaults, type BrowserEnvironment } from "../browser/environment";
import { store, useAppState } from "../state/store";

type Props = { disabled: boolean; running: boolean };
export function BrowserEnvironmentSettings({ disabled, running }: Props) {
  const app = useAppState();
  const saved = app.prefs.browser?.environment;
  const [draft, setDraft] = useState(() => browserEnvironment(saved));
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  useEffect(() => { setDraft(browserEnvironment(saved)); }, [saved]);
  const locked = disabled || busy;
  const dirty = JSON.stringify(draft) !== JSON.stringify(browserEnvironment(saved));
  const change = <K extends keyof BrowserEnvironment>(key: K, value: BrowserEnvironment[K]) => {
    setDraft(previous => ({ ...previous, [key]: value })); setNotice(""); setError("");
  };
  const select = <K extends keyof BrowserEnvironment>(key: K, label: string, options: [BrowserEnvironment[K], string][]) =>
    <div className="setting-row"><div className="setting-label"><label htmlFor={`browser-env-${key}`}>{label}</label></div><div className="setting-control"><select id={`browser-env-${key}`} value={String(draft[key])} disabled={locked} onChange={event => change(key, (key === "actionDelayMs" ? Number(event.target.value) : event.target.value) as BrowserEnvironment[K])}>{options.map(([value, text]) => <option key={String(value)} value={String(value)}>{text}</option>)}</select></div></div>;
  const toggle = (key: "doNotTrack" | "protectWebRTC" | "reduceAutomationSignals", label: string) =>
    <div className="setting-row"><div className="setting-label"><label htmlFor={`browser-env-${key}`}>{label}</label></div><div className="setting-control"><label className="switch-label"><input id={`browser-env-${key}`} type="checkbox" checked={draft[key]} disabled={locked} onChange={event => change(key, event.target.checked)}/><span>{draft[key] ? "Включено" : "Выключено"}</span></label></div></div>;
  async function save() {
    setBusy(true); setError(""); setNotice("");
    try {
      // Validate before persisting, even when the service is currently stopped.
      const environment = { ...draft, locale: draft.locale.trim(), timezone: draft.timezone.trim() };
      if (environment.locale) environment.locale = Intl.getCanonicalLocales(environment.locale)[0];
      if (environment.timezone) new Intl.DateTimeFormat("en", { timeZone: environment.timezone });
      const result = running ? await browserNative<{pending?:number}>("browser_input", {action:"preferences", args:{environment}}) : undefined;
      store.setBrowserSettings({environment});
      setDraft(environment);
      setNotice(result?.pending ? `Сохранено. Открытых браузеров со старым профилем: ${result.pending}.` : "Сохранено. Профиль применится к новым браузерам.");
    } catch (error) { setError(error instanceof RangeError ? "Проверьте язык и часовой пояс." : error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <section className="setting-group" aria-label="Профиль и приватность браузера"><h2>Профиль и приватность</h2><div className="setting-card">
    <div className="settings-actions" aria-label="Готовые профили браузера">
      <button className="btn" disabled={locked} onClick={() => { setDraft({...browserEnvironmentDefaults}); setError(""); setNotice("Выбран стандартный профиль."); }}>Стандартный</button>
      <button className="btn" disabled={locked} onClick={() => { setDraft({...browserEnvironmentDefaults,engine:"chrome",display:"window",reduceAutomationSignals:true,actionDelayMs:150}); setError(""); setNotice("Профиль «Совместимость» использует установленный Chrome в обычном окне. Сохраните изменения."); }}>Совместимость</button>
      <button className="btn" disabled={locked} onClick={() => { setDraft({...browserEnvironmentDefaults,storage:"temporary",doNotTrack:true,protectWebRTC:true,serviceWorkers:"block"}); setError(""); setNotice("Профиль «Приватный» не сохраняет авторизацию между запусками браузера. Сохраните изменения."); }}>Приватный</button>
    </div>
    {select("engine", "Браузер", [["chromium", "Chromium Arvela"], ["chrome", "Установленный Google Chrome"]])}
    {select("display", "Запуск", [["embedded", "Во встроенной панели"], ["window", "С обычным окном браузера"]])}
    {select("storage", "Данные сайтов", [["persistent", "Сохранять отдельно для каждой сессии"], ["temporary", "Временный профиль до закрытия браузера"]])}
    <div className="setting-row engine-field-row"><div className="setting-label"><label htmlFor="browser-env-locale">Язык сайтов</label></div><div className="setting-control"><input id="browser-env-locale" value={draft.locale} maxLength={100} placeholder="Системный · ru-RU, en-US" disabled={locked} onChange={event => change("locale", event.target.value)}/></div></div>
    <div className="setting-row engine-field-row"><div className="setting-label"><label htmlFor="browser-env-timezone">Часовой пояс</label></div><div className="setting-control"><input id="browser-env-timezone" value={draft.timezone} maxLength={100} placeholder="Системный · Europe/Moscow" disabled={locked} onChange={event => change("timezone", event.target.value)}/></div></div>
    {select("colorScheme", "Тема сайтов", [["system", "Системная"], ["light", "Светлая"], ["dark", "Тёмная"]])}
    {select("reducedMotion", "Анимации сайтов", [["no-preference", "Как на сайте"], ["reduce", "Уменьшить движение"]])}
    {select("actionDelayMs", "Пауза перед действием агента", [[0, "Без дополнительной паузы"], [150, "150 мс"], [350, "350 мс"], [700, "700 мс"]])}
    {select("serviceWorkers", "Фоновая работа сайтов", [["allow", "Разрешить Service Workers"], ["block", "Блокировать Service Workers"]])}
    {toggle("reduceAutomationSignals", "Уменьшить маркеры автоматизации")}
    {toggle("doNotTrack", "Отправлять Do Not Track")}
    {toggle("protectWebRTC", "Ограничить прямые UDP-соединения WebRTC")}
    <details className="browser-environment-help"><summary>Совместимость и разрешения</summary><p>Chrome должен быть установлен отдельно. Используется настоящий движок без подмены версии и ОС. Параметр маркеров изменяет navigator.webdriver и баннер автоматизации, сохраняя защиту браузера. Обычное окно можно использовать для ручной работы; оно не гарантирует вход в Google или прохождение проверок сайтов.</p><p>Do Not Track — запрос сайту, а не блокировка рекламы. Ограничение WebRTC может мешать звонкам; блокировка Service Workers — офлайн-режиму сайтов. Камера, микрофон, геолокация и уведомления не получают автоматических разрешений. Профиль отделён от личного Chrome.</p></details>
    <div className="settings-actions"><button className="btn primary" disabled={locked || !dirty} onClick={() => void save()}>{busy ? "Сохраняю…" : "Сохранить профиль"}</button><button className="btn" disabled={locked} onClick={() => { setDraft({...browserEnvironmentDefaults}); setNotice(""); setError(""); }}>Сбросить профиль</button></div>
    <p className="settings-muted" role="status">{notice || "Для открытых браузеров потребуется перезапуск управления. Сохранение не прерывает агентов."}</p>
    {error && <p className="settings-inline-error" role="alert">{error}</p>}
  </div></section>;
}
