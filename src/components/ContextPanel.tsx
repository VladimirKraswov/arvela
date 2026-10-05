import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { store, useAppState } from "../state/store";
import { sessionContext } from "../state/taskContext";
import { taskScheduler } from "../schedules/tasks";
import type { Session, SessionStatus } from "../api/types";
import { Icon } from "./Icon";

const time = (n: number) => new Date(n).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export function ContextPanel() {
  const s = useAppState(), scheduler = taskScheduler();
  const server = s.prefs.workspaceKey ?? s.prefs.endpoint, sid = s.activeSessionId, directory = s.directory;
  const scope = JSON.stringify([server, directory, sid, store.engineIdFor()]);
  return <ContextContents key={scope} scheduler={scheduler} server={server} sid={sid} directory={directory} />;
}
function ContextContents({ scheduler, server, sid, directory }: { scheduler: ReturnType<typeof taskScheduler>; server: string; sid: string | null; directory: string | null }) {
  const s = useAppState(), panel = useRef<HTMLElement>(null);
  const tasks = useSyncExternalStore(scheduler.subscribe, scheduler.snapshot).filter(t => t.server === server && t.sessionID === sid && t.directory === directory);
  const chat = sid ? s.chat.sessions[sid] : undefined, context = sessionContext(chat);
  const [form, setForm] = useState(false), [title, setTitle] = useState(""), [prompt, setPrompt] = useState(""), [minutes, setMinutes] = useState(15);
  const [error, setError] = useState(""), [childError, setChildError] = useState(""), [children, setChildren] = useState<Session[]>([]);
  const [statuses, setStatuses] = useState<Record<string, SessionStatus>>({}), [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const opencode = store.engineIdFor() === "opencode";
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => { if (prior?.isConnected) prior.focus(); };
  }, []);
  useEffect(() => {
    if (!opencode || !sid || !directory || s.connection.phase !== "connected") return;
    const client = store.client, abort = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      setLoading(true);
      try {
        const [list, status] = await Promise.all([client.sessionChildren(sid, directory, abort.signal), client.sessionStatuses(directory, abort.signal)]);
        if (!abort.signal.aborted) { setChildren(list.filter(c => c.parentID === sid && c.directory === directory && !c.time.archived)); setStatuses(status); setChildError(""); }
      } catch { if (!abort.signal.aborted) setChildError("Не удалось прочитать дочерние сессии. Следующая проверка через 10 секунд."); }
      finally { if (!abort.signal.aborted) { setLoading(false); timer = setTimeout(() => void read(), 10000); } }
    };
    void read(); return () => { abort.abort(); clearTimeout(timer); };
  }, [opencode, sid, directory, s.connection.phase]);
  const jump = (messageID: string) => { if (sid) store.setUi({ revealMessage: { server, directory, sessionID: sid, messageID }, contextOpen: false }); };
  const addTask = () => {
    const model = store.getModelChoice();
    try {
      if (!sid || !directory || !model) throw new Error("Откройте чат и выберите модель.");
      scheduler.add({ server, directory, sessionID: sid, engine: store.engineIdFor(), title: title.trim(), prompt: prompt.trim(), minutes, model: { ...model }, agent: store.getAgentChoice() ?? undefined });
      setForm(false); setTitle(""); setPrompt(""); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось сохранить задание."); }
  };
  const mutateTask = (action: () => void) => { try { action(); setError(""); } catch { setError("Не удалось сохранить расписание. Проверьте доступ к хранилищу приложения."); } };
  const taskIds = new Set<string>();
  for (const part of Object.values(chat?.parts ?? {})) if (part.type === "tool" && part.tool === "task") {
    const metadata = part.state?.metadata as Record<string, unknown> | undefined;
    const id = metadata?.sessionId ?? metadata?.sessionID;
    if (typeof id === "string") taskIds.add(id);
  }
  return <aside className="context-panel" ref={panel} tabIndex={-1} aria-label="Контекст задачи" onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); store.setUi({ contextOpen: false }); } }}>
    <div className="context-panel-header"><strong>Контекст задачи</strong><button className="icon-btn" aria-label="Закрыть контекст задачи" onClick={() => store.setUi({ contextOpen: false })}><Icon name="close" size={16}/></button></div>
    {!sid && <p className="context-note">Создайте или откройте чат, чтобы увидеть его контекст и добавить расписание.</p>}
    <section><div className="context-section-title"><span>Запланировано</span><button className="icon-btn" aria-label="Добавить повторяющееся задание" disabled={!sid || !directory} onClick={() => { setForm(!form); setError(""); }}><Icon name="plus" size={16}/></button></div>
      {!tasks.length && !form && <p className="context-note">Повторяющихся заданий пока нет</p>}
      {tasks.map(t => <div className="context-task" key={t.id}>
        <div className="context-row"><Icon name="clock" size={16}/><strong title={t.prompt}>{t.title}</strong><span>Каждые {t.minutes} мин</span></div>
        <small>{!t.enabled ? "Приостановлено" : t.state === "waiting" ? t.detail : t.state === "dispatching" ? "Проверка и отправка…" : `Следующий запуск: ${time(t.nextAt)}`}</small>
        {t.lastAt && <small>Запрос отправлен: {time(t.lastAt)}</small>}
        {t.state === "error" && <p className="context-error" role="alert">{t.detail}</p>}
        <div className="context-task-actions"><button className="btn small ghost" disabled={t.state === "dispatching"} onClick={() => mutateTask(() => scheduler.toggle(t.id))}>{t.enabled ? "Пауза" : "Возобновить"}</button><button className="btn small ghost" disabled={t.state === "dispatching"} onClick={() => mutateTask(() => scheduler.remove(t.id))}>Удалить</button></div>
      </div>)}
      {form && <form className="context-task-form" onSubmit={e => { e.preventDefault(); addTask(); }}>
        <label>Название<input autoFocus required maxLength={120} value={title} onChange={e => setTitle(e.target.value)} placeholder="Например, проверить CI"/></label>
        <label>Задание агенту<textarea required maxLength={20000} rows={4} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Что нужно проверять или выполнять?"/></label>
        <label>Интервал, минут<input type="number" required min={1} max={10080} value={minutes} onChange={e => setMinutes(Number(e.target.value))}/></label>
        <p className="context-note">Работает, пока Desktop открыт и подключён к этому серверу. Модель и агент сохраняются при создании; обычные разрешения действуют. Занятый чат ждёт; пропущенные запуски не накапливаются.</p>
        <button className="btn small" type="submit">Сохранить расписание</button>
      </form>}
      {error && <p className="context-error" role="alert">{error}</p>}
    </section>
    <section><div className="context-section-title"><span>Результаты · {context.results.length}</span><button className="icon-btn" disabled={!sid} aria-label="Подготовить запрос на создание результата" onClick={() => { const draft = store.getDraft(); store.setDraft(`${draft}${draft.trim() ? "\n\n" : ""}Создай файл с результатом: `); store.setUi({ contextOpen: false }); document.querySelector<HTMLTextAreaElement>(".composer-wrap textarea")?.focus(); }}><Icon name="plus" size={16}/></button></div>
      {!context.results.length && <p className="context-note">Здесь появятся файлы из ответов и выполненных изменений.</p>}
      {(showAll ? context.results : context.results.slice(0, 5)).map(f => <button className="context-file" key={f.key} title={`${f.path}\nПерейти к сообщению`} onClick={() => jump(f.messageID)}><Icon name="file" size={16}/><span>{f.name}</span></button>)}
    </section>
    <section><div className="context-section-title"><span>Субагенты и ветки · {children.length}</span>{loading && <span className="tool-spinner" aria-label="Загрузка"/>}</div>
      {!opencode ? <p className="context-note">Pi не предоставляет список дочерних сессий.</p> : childError ? <p className="context-error" role="alert">{childError}</p> : !children.length && <p className="context-note">Дочерних сессий пока нет</p>}
      {(showAll ? children : children.slice(0, 5)).map(child => <button className="context-file" key={child.id} title={child.title} onClick={() => { store.setUi({ contextOpen: false }); void store.openChat(child); }}><Icon name="branch" size={16}/><span>{child.title}<small>{taskIds.has(child.id) ? "Субагент" : "Дочерняя сессия"} · {statuses[child.id]?.type === "busy" ? "Работает" : statuses[child.id]?.type === "retry" ? "Повтор подключения" : statuses[child.id]?.type === "waiting" ? "Ждёт ответа" : "Неактивен"}</small></span></button>)}
    </section>
    <section><div className="context-section-title"><span>Источники · {context.sources.length}</span><button className="icon-btn" aria-label="Добавить источник в черновик" disabled={s.ui.sending} onClick={() => { window.dispatchEvent(new Event("composer-add-files")); }}><Icon name="plus" size={16}/></button></div>
      {!context.sources.length && <p className="context-note">Файлы, приложенные к сообщениям этого чата</p>}
      {(showAll ? context.sources : context.sources.slice(0, 5)).map(f => <button className="context-file" key={f.key} title={`${f.name}\nПерейти к сообщению`} onClick={() => jump(f.messageID)}><Icon name="folder" size={16}/><span>{f.name}</span></button>)}
    </section>
    {(context.sources.length > 5 || context.results.length > 5 || children.length > 5) && <button className="btn small ghost" onClick={() => setShowAll(!showAll)}>{showAll ? "Свернуть списки" : "Показать все"}</button>}
    {sid && <p className="context-note">Файлы из загруженной истории.{s.historyCursors[sid] && !s.olderExhausted[sid] && <button className="btn small ghost" disabled={s.ui.historyLoading} onClick={() => void store.loadOlderMessages(sid)}>Загрузить более раннюю историю</button>}</p>}
  </aside>;
}
