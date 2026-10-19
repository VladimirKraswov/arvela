import { useState } from 'react';
import type { AssistantMessage, MessagePart } from '../api/types';
import { repetitiveOutput } from '../chat/outputLimit';
import { store, useAppState } from '../state/store';
export default function OutputLimitNotice({sessionId, message, parts}: {sessionId: string; message: AssistantMessage; parts: MessagePart[]}) {
  const s = useAppState(), [busy, setBusy] = useState(false);
  const slot = s.chat.sessions[sessionId];
  const latest = slot?.messageOrder[slot.messageOrder.length - 1] === message.id;
  const canCompact = latest && s.activeSessionId === sessionId && !store.isRunning(sessionId)
    && !s.ui.sending && store.conversation().capabilities.compaction;
  return <div className="msg-meta finish-note" role="status">
    <span>{repetitiveOutput(message, parts)
      ? 'Похоже, модель зациклилась на повторении и исчерпала лимит ответа. Сожмите контекст перед продолжением.'
      : 'Достигнут лимит ответа модели. Работа остановлена; можно сжать контекст перед продолжением.'}</span>
    {canCompact && <button className="btn small" disabled={busy} onClick={async () => {
      setBusy(true);
      try { await store.compactSession(sessionId); } finally { setBusy(false); }
    }}>{busy ? 'Сжимаю контекст…' : 'Сжать контекст'}</button>}
  </div>;
}
