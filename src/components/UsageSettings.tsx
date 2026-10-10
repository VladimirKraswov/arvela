import { usageSources } from "../usage/sources";
import { useEffect, useRef, useState } from "react";
import { store, useAppState } from "../state/store";
import { scanUsage, type UsagePeriod, type UsageReport } from "../usage/metrics";
import { Icon } from "./Icon";

const fmt = (value: number) => new Intl.NumberFormat("ru-RU").format(Math.round(value));

export function UsageSettings() {
  const state = useAppState();
  const unavailable = [
    state.connection.phase !== "connected" ? "OpenCode сейчас не подключён" : "",
    Object.keys(state.prefs.piSessions ?? {}).length > 0 && !store.piInstalled ? "Pi не установлен: его чаты пропущены" : "",
  ].filter(Boolean);
  const [period, setPeriod] = useState<UsagePeriod>("30d");
  const [refresh, setRefresh] = useState(0);
  const [report, setReport] = useState<UsageReport | null>(null);
  const [progress, setProgress] = useState<{ done: number; found: number } | null>(null);
  const [error, setError] = useState("");
  const currentScan = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    currentScan.current = controller;
    const current = usageSources();
    setReport(null);
    setError("");
    setProgress({ done: 0, found: 0 });
    if (!current.length) {
      setProgress(null);
      setError("Подключитесь к OpenCode или установите Pi, чтобы прочитать историю использования.");
      return () => { controller.abort(); if (currentScan.current === controller) currentScan.current = null; };
    }
    void scanUsage(current, period, controller.signal, (done, found) => {
      if (!controller.signal.aborted) setProgress({ done, found });
    }).then(value => {
      if (!controller.signal.aborted) { setReport(value); setProgress(null); currentScan.current = null; }
    }).catch(problem => {
      if (!controller.signal.aborted) { setError(problem instanceof Error ? problem.message : String(problem)); setProgress(null); currentScan.current = null; }
    });
    return () => { controller.abort(); if (currentScan.current === controller) currentScan.current = null; };
  }, [period, refresh, state.prefs.activeHost, state.connection.phase]);

  const byDay = new Map(report?.days.map(day => [day.day, day.total]) ?? []);
  const barCount = period === "7d" ? 7 : 30;
  const bars = report ? Array.from({ length: barCount }, (_, index) => {
    const date = new Date(report.generatedAt);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (barCount - index - 1));
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { day, total: byDay.get(day) ?? 0 };
  }) : [];
  const max = Math.max(1, ...bars.map(day => day.total));
  return <div className="usage-settings">
    <p className="settings-intro">Статистика по ответам OpenCode и Pi.</p>
    <div className="usage-toolbar">
      <div className="usage-periods" role="group" aria-label="Период использования">
        {([ ["7d", "7 дней"], ["30d", "30 дней"], ["all", "Всё время"] ] as const).map(([key, title]) => <button key={key} className="btn" aria-pressed={period === key} onClick={() => setPeriod(key)}>{title}</button>)}
      </div>
      {progress ? <button className="btn" onClick={() => { currentScan.current?.abort(); currentScan.current = null; setProgress(null); setError("Расчёт отменён."); }}>Отменить</button> : <button className="btn" onClick={() => setRefresh(value => value + 1)}><Icon name="refresh" size={15}/>Обновить</button>}
    </div>
    {progress && <p className="usage-status" role="status">{progress.found ? `Считаю историю: ${progress.done} из ${progress.found} сессий…` : "Загружаю список сессий…"}</p>}
    {error && <p className="settings-inline-error" role="alert">{error}</p>}
    {unavailable.length > 0 && <p className="usage-warning" role="status">{unavailable.join(". ")}.</p>}
    {report && <>
      {report.failures.length > 0 && <details className="usage-warning"><summary>Данные неполные: {report.failures.length} {report.failures.length === 1 ? "ошибка" : "ошибок"} при чтении истории</summary><ul>{report.failures.slice(0, 10).map((failure, index) => <li key={index}>{failure}</li>)}</ul>{report.failures.length > 10 && <small>И ещё {report.failures.length - 10} ошибок.</small>}</details>}
      <div className="usage-summary">
        <div className="usage-total"><small>Всего токенов</small><strong>{fmt(report.totals.total)}</strong><span>{fmt(report.totals.replies)} сообщений модели · {fmt(report.sessionsScanned)} сессий</span><span>{report.totals.total ? `${Math.round(report.totals.cacheRead / report.totals.total * 100)}% — повторное чтение кэша` : ""}</span></div>
        <div className="usage-breakdown">
          <div><span>Вход</span><strong>{fmt(report.totals.input)}</strong></div>
          <div><span>Чтение кэша</span><strong>{fmt(report.totals.cacheRead)}</strong></div>
          <div><span>Запись кэша</span><strong>{fmt(report.totals.cacheWrite)}</strong></div>
          <div><span>Выход</span><strong>{fmt(report.totals.output)}</strong></div>
          {report.totals.other > 0 && <div><span>Без категории</span><strong>{fmt(report.totals.other)}</strong></div>}
        </div>
      </div>
      <section className="setting-group" aria-label="По моделям"><h2>По моделям</h2>
        {report.models.length ? <div className="usage-models">{report.models.map(row => <div className="usage-model" key={row.key}>
          <div className="usage-model-head"><div><strong>{row.model}</strong><small>{row.engine} · {row.provider} · {fmt(row.sessions)} сессий</small></div><b>{fmt(row.total)}</b></div>
          <div className="usage-track"><span style={{ width: `${Math.max(1, row.total / Math.max(1, report.totals.total) * 100)}%` }}/></div>
          <small>Вход {fmt(row.input)} · кэш {fmt(row.cacheRead + row.cacheWrite)} · выход {fmt(row.output)}{row.other ? ` · прочее ${fmt(row.other)}` : ""}</small>
        </div>)}</div> : <div className="usage-empty">За выбранный период ответов со счётчиками токенов нет.</div>}
      </section>
      {bars.length > 0 && <section className="setting-group" aria-label="По дням"><h2>{period === "all" ? "Последние 30 дней" : "По дням"}</h2><div className="usage-days">{bars.map(day => <div key={day.day} className="usage-day" title={`${day.day}: ${fmt(day.total)} токенов`}><span style={{ height: day.total ? `${Math.max(4, day.total / max * 100)}%` : "0%" }}/><small>{day.day.slice(5)}</small></div>)}</div></section>}
      <p className="usage-note">Счётчики показывают обработанные токены, включая повторные чтения кэша, а не объём уникального текста или длину текущего контекста. Reasoning входит в выход и повторно не суммируется. Расход относится ко времени ответа; удалённые сессии и история других серверов недоступны. Обновлено {new Date(report.generatedAt).toLocaleString("ru-RU")}.</p>
    </>}
  </div>;
}
