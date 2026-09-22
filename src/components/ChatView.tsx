import { WorkspacePicker } from "./WorkspacePicker";
import { useEffect, useMemo, useRef } from "react";
import { store, useAppState } from "../state/store";
import {
  AssistantMessageView,
  PermissionCard,
  QuestionCard,
  UserMessageView,
} from "./render";

export function ChatView() {
  const s = useAppState();
  const sessionId = s.activeSessionId;
  const slot = sessionId ? s.chat.sessions[sessionId] : undefined;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);

  const pending = sessionId
    ? store.pendingInteraction(sessionId)
    : { permissions: [], questions: [] };
  const lastPending = pending.permissions[0] ?? null;
  const lastQuestion = pending.questions[0] ?? null;

  const messages = useMemo(() => {
    if (!slot) return [];
    return slot.messageOrder.map((id) => slot.messages[id]).filter(Boolean);
  }, [slot, s.rev]);

  const lastEventAt = slot?.lastEventAt ?? 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, lastEventAt, lastPending, lastQuestion]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const streamBroken =
    s.connection.streamState === "reconnecting" ||
    s.connection.streamState === "error" ||
    s.connection.streamState === "closed";

  return (
    <div
      className="chat-scroll"
      ref={scrollRef}
      onScroll={onScroll}
      tabIndex={-1}
      aria-label="Conversation"
    >
      <div className="chat-inner">
        {!sessionId && !s.ui.historyLoading && (
          <div className="welcome">
            <div className="welcome-mark">
              <span>⌁</span>
            </div>
            <h1>С чего начнём?</h1>
            <WorkspacePicker />
            <p className="welcome-context">
              {store.isProjectless()
                ? "Задайте вопрос или поручите любую задачу"
                : "Работа с файлами выбранного проекта"}
            </p>
          </div>
        )}
        {sessionId && s.ui.historyLoading && !slot && (
          <div className="empty-hint">Loading history…</div>
        )}
        {sessionId && s.ui.historyError && (
          <div className="msg-error" role="alert">
            {s.ui.historyError}{" "}
            <button
              className="btn small ghost"
              onClick={() => void store.loadHistory(sessionId, s.directory!)}
            >
              Retry
            </button>
          </div>
        )}
        {sessionId &&
          slot &&
          slot.messageOrder.length > 0 &&
          !!s.historyCursors[sessionId] &&
          !s.olderExhausted[sessionId] && (
            <button
              className="btn small ghost"
              style={{ marginBottom: 8 }}
              disabled={s.ui.historyLoading}
              onClick={() => void store.loadOlderMessages(sessionId)}
            >
              {s.ui.historyLoading ? "Loading…" : "Load older messages"}
            </button>
          )}
        {messages.map((m) =>
          m.role === "user" ? (
            <UserMessageView key={m.id} message={m} />
          ) : (
            <AssistantMessageView
              key={m.id}
              sessionId={sessionId!}
              message={m}
            />
          ),
        )}
        {slot?.lastError && (
          <div className="msg-error" role="alert">
            {slot.lastError}
          </div>
        )}
        {slot?.status.type === "busy" && (
          <div className="status-line" role="status">
            <span className="tool-spinner" aria-hidden />
            Agent is working — reasoning, tools and text updates will appear
            above.
          </div>
        )}
        {slot?.status.type === "retry" && (
          <div className="status-line" role="status">
            <span className="tool-spinner" aria-hidden />
            {(slot.status as { message?: string }).message ??
              "Retrying request…"}
          </div>
        )}
        {lastPending && (
          <PermissionCard
            req={lastPending}
            onReply={(r) => void store.replyPermission(lastPending, r)}
          />
        )}
        {lastQuestion && (
          <QuestionCard
            key={lastQuestion.id}
            req={lastQuestion}
            onReply={(a) => void store.replyQuestion(lastQuestion, a)}
            onReject={() => void store.rejectQuestion(lastQuestion)}
          />
        )}
        {streamBroken && s.connection.phase === "connected" && (
          <div className="status-line" role="status">
            Event stream is reconnecting — history is preserved and will resync
            automatically.
          </div>
        )}
      </div>
    </div>
  );
}
