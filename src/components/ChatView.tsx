import { WorkspacePicker } from './WorkspacePicker';
import { useLayoutEffect, useRef, useState } from 'react';
import { store, useAppState } from '../state/store';
import { AssistantTurnView, PermissionCard, QuestionCard, UserMessageView } from './render';
import { ChatScrollController, type ReadingPosition } from '../chat/scroll';
import { groupConversation } from '../chat/turns';
import { dayKey, dayLabel } from '../chat/time';
import { Icon } from './Icon';
import { platform } from '../native/platform';

const positions = new Map<string, { position: ReadingPosition; first?: string; progress?: Record<string, boolean> }>();
export function ChatView() {
  const s = useAppState();
  const key = JSON.stringify([s.prefs.workspaceKey ?? s.prefs.endpoint, s.directory, s.activeSessionId]);
  return <Conversation key={key} cacheKey={key} />;
}
function Conversation({ cacheKey }: { cacheKey: string }) {
  const s = useAppState(), sessionId = s.activeSessionId;
  const slot = sessionId ? s.chat.sessions[sessionId] : undefined;
  const scrollRef = useRef<HTMLDivElement>(null), contentRef = useRef<HTMLDivElement>(null);
  const progressState = useRef<Record<string, boolean>>(positions.get(cacheKey)?.progress ?? {});
  const controller = useRef<ChatScrollController | null>(null);
  const [away, setAway] = useState(false);
  const first = useRef<string | undefined>(positions.get(cacheKey)?.first);
  const [, redraw] = useState(0);
  const order = slot?.messageOrder ?? [];
  // Keep the same first visible message as new messages arrive. Never evict what is being read.
  if (!first.current && order.length) first.current = order[Math.max(0, order.length - 60)];
  const reveal = s.ui.revealMessage?.sessionID === sessionId && s.ui.revealMessage.directory === s.directory
    && s.ui.revealMessage.server === (s.prefs.workspaceKey ?? s.prefs.endpoint) ? s.ui.revealMessage : null;
  if (reveal && order.includes(reveal.messageID) && order.indexOf(reveal.messageID) < order.indexOf(first.current ?? "")) first.current = reveal.messageID;
  const start = Math.max(0, order.indexOf(first.current ?? ''));
  const messages = order.slice(start).map(id => slot!.messages[id]).filter(Boolean);
  const rows = groupConversation(order.map(id => slot!.messages[id]).filter(Boolean));
  const visibleIds = new Set(messages.map(m => m.id));
  const visibleRows = rows.filter(row => row.kind === 'user' ? visibleIds.has(row.message.id) : row.messages.some(m=>visibleIds.has(m.id)));
  const pending = sessionId ? store.pendingInteraction(sessionId) : { permissions: [], questions: [] };
  const permission = pending.permissions[0], question = pending.questions[0];
  const more = !!sessionId && !!s.historyCursors[sessionId] && !s.olderExhausted[sessionId];

  useLayoutEffect(() => {
    const el = scrollRef.current!, content = contentRef.current!;
    const view = new ChatScrollController(el, (following, offBottom) => {
      setAway(offBottom);
      store.setConversationAtBottom(following && !offBottom);
    }, positions.get(cacheKey)?.position);
    controller.current = view;
    const resize = new ResizeObserver(() => view.schedule());
    resize.observe(el); resize.observe(content);
    const wheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || !event.deltaY) return;
      // Scrolling inside an expanded tool card should not move the conversation.
      let node = event.target as HTMLElement | null;
      while (node && node !== el) {
        if (node.scrollHeight > node.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(node).overflowY)
          && (event.deltaY < 0 ? node.scrollTop > 0 : node.scrollTop + node.clientHeight < node.scrollHeight - 1)) return;
        node = node.parentElement;
      }
      view.intent(event.deltaY < 0 ? 'up' : 'down');
    };
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('textarea,input,[contenteditable="true"]')) return;
      if (['ArrowUp','PageUp','Home'].includes(e.key) || (e.key === ' ' && e.shiftKey)) view.intent('up');
      if (['ArrowDown','PageDown','End'].includes(e.key) || (e.key === ' ' && !e.shiftKey)) view.intent('down');
    };
    let touchY = 0;
    const touchStart = (e: TouchEvent) => { touchY = e.touches[0]?.clientY ?? 0; };
    const touchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? touchY;
      if (y !== touchY) view.intent(y > touchY ? 'up' : 'down');
      touchY = y;
    };
    const disclosure = () => view.pause();
    el.addEventListener('conversation-disclosure', disclosure);
    const pointer = (e: PointerEvent) => {
      if (e.target === el && e.clientX >= el.getBoundingClientRect().left + el.clientWidth - 14) {
        view.pause(); view.intent('down');
      }
    };
    el.addEventListener('wheel', wheel, { passive: true }); el.addEventListener('keydown', key);
    el.addEventListener('touchstart', touchStart, { passive: true }); el.addEventListener('touchmove', touchMove, { passive: true });
    el.addEventListener('pointerdown', pointer);
    return () => {
      positions.set(cacheKey, { position: view.snapshot(), first: first.current, progress: progressState.current });
      if (positions.size > 80) positions.delete(positions.keys().next().value!);
      resize.disconnect(); view.dispose(); controller.current = null;
      el.removeEventListener('conversation-disclosure', disclosure);
      el.removeEventListener('wheel', wheel); el.removeEventListener('keydown', key);
      el.removeEventListener('touchstart', touchStart); el.removeEventListener('touchmove', touchMove); el.removeEventListener('pointerdown', pointer);
    };
  }, [cacheKey]);
  // Before paint, preserve anchors for React updates; ResizeObserver handles async height changes.
  useLayoutEffect(() => { controller.current?.layout(); });

  useLayoutEffect(() => {
    if (!reveal || !scrollRef.current) return;
    const row = Array.from(scrollRef.current.querySelectorAll<HTMLElement>("[data-message-ids]")).find(el => el.dataset.messageIds?.split(" ").includes(reveal.messageID));
    if (row) {
      controller.current?.pause(); controller.current?.intent("up");
      const scroll = scrollRef.current; scroll.scrollTop += row.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 24;
      controller.current?.onScroll();
      // Keyboard and screen-reader users land on the revealed message, not back on the toolbar.
      row.tabIndex = -1; row.focus({ preventScroll: true });
      store.setUi({ revealMessage: null });
    } else if (slot && !s.ui.historyLoading && !order.includes(reveal.messageID)) {
      // The message left the loaded history (reload, deletion): drop the stale request
      // instead of jumping unexpectedly when it reappears later.
      store.setUi({ revealMessage: null });
    }
  }, [reveal]);

  const older = async () => {
    controller.current?.pause();
    if (start) { first.current = order[Math.max(0, start - 60)]; redraw(n => n + 1); }
    else if (sessionId) {
      const previous = first.current;
      await store.loadOlderMessages(sessionId);
      if (!controller.current) return;
      const next = store.state.chat.sessions[sessionId]?.messageOrder ?? [];
      const index = next.indexOf(previous ?? '');
      if (index > 0) first.current = next[Math.max(0, index - 60)];
      redraw(n => n + 1);
    }
  };
  const broken = store.engineIdFor() !== 'pi' && ['reconnecting','error','closed'].includes(s.connection.streamState);
  // Provenance must be visible: a handed-over chat never pretends the earlier
  // turns were its own.
  const origin = store.handoffOrigin(sessionId);
  return <div className="chat-viewport">
    <div className="chat-scroll" ref={scrollRef} onScroll={() => controller.current?.onScroll()} tabIndex={0} aria-label="История чата">
      <div className="chat-inner" ref={contentRef}>
        {!sessionId && !s.ui.historyLoading && <div className="welcome">
          <div className="welcome-mark"><span>⌁</span></div><h1>С чего начнём?</h1><WorkspacePicker />
          <p className="welcome-context">{store.isProjectless() ? 'Задайте вопрос или поручите любую задачу' : 'Работа с файлами выбранного проекта'}</p>
        </div>}
        {origin && <div className="handoff-provenance" role="note">
          <Icon name="handoff" size={15} />
          <span>Продолжение чата {origin.engine === 'pi' ? 'Pi' : 'OpenCode'} «{origin.title}». Расшифровка той переписки передана сюда как контекст; сами сообщения остались в исходном чате.
            {origin.omitted > 0 && ` Ранние ${origin.omitted} реплик(и) не поместились и были опущены.`}{' '}
            {origin.session && <button className="btn small ghost" onClick={() => void store.openChat(origin.session!)}>Открыть исходный чат</button>}
          </span>
        </div>}
        {sessionId && s.ui.historyLoading && !slot && <div className="empty-hint">Загрузка истории…</div>}
        {sessionId && s.ui.historyError && <div className="msg-error" role="alert">{s.ui.historyError}{' '}
          <button className="btn small ghost" onClick={() => void store.loadHistory(sessionId, s.directory!)}>Повторить</button></div>}
        {(start > 0 || more) && <button className="history-more" disabled={s.ui.historyLoading} onClick={() => void older()}>
          {s.ui.historyLoading ? 'Загрузка…' : start ? `${start} предыдущих сообщений` : 'Загрузить более ранние сообщения'}<Icon name="chevron" size={16} />
        </button>}
        {visibleRows.map((row, index) => {
          const shown = row.kind === 'assistant' ? row.messages.filter(m=>visibleIds.has(m.id)) : [];
          const firstMessage = row.kind === 'user' ? row.message : shown[0];
          const previous = visibleRows[index - 1];
          const previousTime = previous ? previous.kind === 'user' ? previous.message.time.created : previous.messages[previous.messages.length - 1].time.created : 0;
          return <div className="history-message" key={row.key} data-message-ids={row.kind === "user" ? row.message.id : shown.map(m => m.id).join(" ")}>
            {dayKey(firstMessage.time.created) && (index === 0 || dayKey(previousTime) !== dayKey(firstMessage.time.created)) &&
              <div className="history-date">{dayLabel(firstMessage.time.created)}</div>}
            {row.kind === 'user' ? <UserMessageView message={row.message} /> : <AssistantTurnView sessionId={sessionId!} messages={shown} progressState={progressState.current} progressKey={row.key}
              partial={shown.length < row.messages.length || (index === 0 && (more || start > 0))}
              active={index === visibleRows.length - 1 && !!slot && ['busy', 'retry'].includes(slot.status.type)} />}
          </div>;
        })}
        {slot?.lastError && <div className="msg-error" role="alert">{slot.lastError}</div>}
        {slot?.status.type === 'busy' && <div className="status-line" role="status"><span className="tool-spinner" aria-hidden />Агент работает…</div>}
        {slot?.status.type === 'retry' && <div className="status-line" role="status"><span className="tool-spinner" aria-hidden />{slot.status.message ?? 'Повтор подключения…'}</div>}
        {permission && <PermissionCard req={permission} onReply={r => void store.replyPermission(permission, r)} />}
        {question && <QuestionCard key={question.id} req={question} onReply={a => void store.replyQuestion(question, a)} onReject={() => void store.rejectQuestion(question)} />}
        {(broken || s.connection.statusError) && !store.isPiSession(sessionId ?? "") && <div className="status-line" role="alert">
          {s.connection.statusError ? `Не удалось проверить состояние чата: ${s.connection.statusError}` : "Нет свежих событий. Выполнение не подтверждено; история сохранена."}
          <button className="btn" onClick={() => void (s.connection.statusError ? store.retryProjectAccess() : store.retryConnection())}>{s.connection.statusError ? "Проверить доступ к проекту" : "Проверить соединение"}</button>
          {s.connection.statusError && platform() === "macos" && <a className="btn" href="https://support.apple.com/guide/mac-help/control-access-to-files-and-folders-on-mac-mchld5a35146/mac" target="_blank" rel="noreferrer">Восстановление доступа</a>}
        </div>}
      </div>
    </div>
    {away && sessionId && <button className="jump-latest" title="Перейти к последнему сообщению" aria-label="К последнему сообщению" onClick={() => controller.current?.latest()}><Icon name="arrowDown" size={18} /><span>Вниз</span></button>}
  </div>;
}
