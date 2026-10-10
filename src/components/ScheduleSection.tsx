import { useState, useSyncExternalStore } from "react";
import { store } from "../state/store";
import { MAX_MINUTES, STORAGE_FAILED, type ScheduledTask, type TaskScheduler } from "../schedules/tasks";
import { PI_BACKEND_ID } from "../agent/pi/backend";
import { Icon } from "./Icon";

const time = (n: number) => new Date(n).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const UNITS = [{ id: "min", label: "минут", factor: 1 }, { id: "hour", label: "часов", factor: 60 }, { id: "day", label: "дней", factor: 1440 }] as const;
export function intervalLabel(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} дн`;
  if (minutes % 60 === 0) return `${minutes / 60} ч`;
  return `${minutes} мин`;
}
const modelLabel = (t: Pick<ScheduledTask, "model" | "agent">) =>
  [`${t.model.providerID}/${t.model.modelID}`, t.model.variant, t.agent && `агент ${t.agent}`].filter(Boolean).join(" · ");

function statusLine(t: ScheduledTask, pending: "pause" | "remove" | undefined): string {
  if (pending) return pending === "remove" ? "Будет удалено после текущей проверки" : "Будет приостановлено после текущей проверки";
  if (t.state === "dispatching") return "Проверка чата и отправка…";
  if (!t.enabled) return t.state === "error" ? "Приостановлено" : "Приостановлено вручную";
  if (t.state === "waiting") return `${t.detail ?? "Ожидает"} · проверка повторяется`;
  return `Следующий запуск: ${time(t.nextAt)}`;
}

/** Recurring prompts of one chat. A schedule is an explicit user action; nothing is sent on save. */
export function ScheduleSection({ scheduler, server, directory, sessionID }: {
  scheduler: TaskScheduler; server: string; directory: string | null; sessionID: string | null;
}) {
  const all = useSyncExternalStore(scheduler.subscribe, scheduler.snapshot);
  const status = useSyncExternalStore(scheduler.subscribe, scheduler.status);
  const tasks = all.filter(t => t.server === server && t.sessionID === sessionID && t.directory === directory);
  const elsewhere = all.filter(t => t.enabled && t.server === server && t.sessionID !== sessionID).length;
  const [form, setForm] = useState(false), [title, setTitle] = useState(""), [prompt, setPrompt] = useState("");
  const [amount, setAmount] = useState(15), [unit, setUnit] = useState<(typeof UNITS)[number]["id"]>("min");
  const [error, setError] = useState("");
  const engine = store.engineIdFor();
  const model = store.getModelChoice();
  const agent = engine === PI_BACKEND_ID ? undefined : store.getAgentChoice() ?? undefined;
  const minutes = amount * (UNITS.find(u => u.id === unit)?.factor ?? 1);
  const intervalValid = Number.isInteger(amount) && amount >= 1 && minutes <= MAX_MINUTES;
  const unavailable = status.storage !== "ok";

  const addTask = () => {
    try {
      if (!sessionID || !directory || !model) throw new Error("Откройте чат и выберите модель.");
      if (!intervalValid) throw new Error("Интервал — целое число от 1 минуты до 7 дней.");
      scheduler.add({ server, directory, sessionID, engine, title: title.trim(), prompt: prompt.trim(), minutes, model: { ...model }, agent });
      setForm(false); setTitle(""); setPrompt(""); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось сохранить задание."); }
  };
  const mutate = (action: () => void) => {
    try { action(); setError(""); }
    catch (e) { setError(e instanceof Error && e.message === STORAGE_FAILED ? STORAGE_FAILED : "Не удалось сохранить расписание. Проверьте доступ к хранилищу приложения."); }
  };

  return <section aria-labelledby="context-schedule-title">
    <div className="context-section-title">
      <h3 id="context-schedule-title">Запланировано</h3>
      <button className="icon-btn" aria-label="Добавить повторяющееся задание" aria-expanded={form} aria-controls="context-schedule-form"
        disabled={!sessionID || !directory || unavailable} onClick={() => { setForm(!form); setError(""); }}><Icon name="plus" size={16}/></button>
    </div>
    {unavailable && <p className="context-error" role="alert">{STORAGE_FAILED}</p>}
    {status.skipped > 0 && <p className="context-note" role="status">Не удалось прочитать сохранённых записей: {status.skipped}. Они отключены; исходные данные сохранены в резервной копии профиля Desktop.</p>}
    {!tasks.length && !form && <p className="context-note">Повторяющихся заданий в этом чате нет</p>}
    {tasks.length > 0 && <ul className="context-list">{tasks.map(t => {
      const pending = status.pending[t.id];
      // This window can withdraw its own attempt; another window's send must settle there.
      const foreign = t.state === "dispatching" && status.flight !== t.id;
      return <li className="context-task" key={t.id}>
        <div className="context-row"><Icon name="clock" size={16}/><strong title={t.prompt}>{t.title}</strong><span>Каждые {intervalLabel(t.minutes)}</span></div>
        <small>{modelLabel(t)}</small>
        <small>{statusLine(t, pending)}</small>
        {t.lastAt && <small>Последний запрос принят агентом: {time(t.lastAt)}. Результат — в истории чата.</small>}
        {t.state === "error" && t.detail && <p className="context-error">{t.detail}</p>}
        <div className="context-task-actions">
          <button className="btn small ghost" disabled={!!pending || unavailable || foreign}
            onClick={() => mutate(() => scheduler.toggle(t.id))}>{t.enabled ? "Пауза" : "Возобновить"}</button>
          <button className="btn small ghost" disabled={pending === "remove" || unavailable || foreign}
            onClick={() => mutate(() => scheduler.remove(t.id))}>Удалить</button>
        </div>
      </li>;
    })}</ul>}
    {form && <form id="context-schedule-form" className="context-task-form" onSubmit={e => { e.preventDefault(); addTask(); }}
      onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); setForm(false); } }}>
      <label>Название<input autoFocus required maxLength={120} value={title} onChange={e => setTitle(e.target.value)} placeholder="Например, проверить CI"/></label>
      <label>Задание агенту<textarea required maxLength={20000} rows={4} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Что нужно проверять или выполнять?"/></label>
      <div className="context-interval">
        <label>Интервал<input type="number" required min={1} max={MAX_MINUTES} step={1} value={Number.isFinite(amount) ? amount : ""} onChange={e => setAmount(e.target.valueAsNumber)}/></label>
        <label>Единица<select value={unit} onChange={e => setUnit(e.target.value as typeof unit)}>{UNITS.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}</select></label>
      </div>
      <p className="context-note">
        Модель: {model ? modelLabel({ model, agent }) : "не выбрана"}. Выполняется, пока приложение открыто.</p>
      <button className="btn small" type="submit" disabled={!model || !intervalValid}>Сохранить расписание</button>
    </form>}
    {error && <p className="context-error" role="alert">{error}</p>}
    {elsewhere > 0 && <p className="context-note">Ещё активных заданий в других чатах этого сервера: {elsewhere}. Они выполняются в фоне.</p>}
  </section>;
}
