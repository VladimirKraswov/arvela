import type { AppState } from '../state/types';
import type { Outcome } from '../outcomes/store';
import type { Message, Session } from '../api/types';
import { engineForSession } from '../state/engines';
import { attachAssessment } from '../outcomes/sharing';
import { taskDiagnostics } from '../diagnostics/tasks';
import { record, type HubRecord } from './records';

/** Read one consistent snapshot; never guess a background chat's directory. */
export function* iterateHubRecords(state: AppState, assessments: Map<string, Outcome>, shareText: boolean): Generator<{message:Message;record:HubRecord}> {
  const sessions = new Map<string, Pick<Session, 'id' | 'title' | 'directory'>>();
  for (const session of [
    ...(state.prefs.projectlessSessions ?? []), ...state.recentSessionList.sessions,
    ...Object.values(state.projectSessionLists).flatMap(list => list.sessions),
    ...state.archivedSessions, ...state.sessions,
  ]) if (session.directory) sessions.set(session.id, session);
  for (const meta of Object.values(state.prefs.piSessions ?? {})) sessions.set(meta.id, meta);
  const server = state.prefs.workspaceKey ?? state.prefs.endpoint;
  for (const [sessionID, chat] of Object.entries(state.chat.sessions)) {
    const session = sessions.get(sessionID);
    if (!session) continue; // Metadata will be collected once it is known.
    const engine = engineForSession(state.prefs, sessionID, session.directory) === 'pi' ? 'pi' : 'opencode';
    for (const messageID of [...chat.messageOrder]) {
      const message = chat.messages[messageID];
      if (!message) continue;
      const parts = (chat.partsByMessage[messageID] ?? []).map(id => chat.parts[id]).filter(Boolean);
      const item = attachAssessment(record(engine, session, message, parts, shareText), assessments, server, session.directory ?? '', shareText);
      if (!item) continue;
      if (message.role === 'user') {
        const diagnostics = taskDiagnostics(chat, messageID);
        if (diagnostics) item.diagnostics = diagnostics;
      }
      yield {message,record:item};
    }
  }
}
export function collectHubRecords(state: AppState, assessments: Map<string, Outcome>, shareText: boolean): HubRecord[] {
  return [...iterateHubRecords(state,assessments,shareText)].map(item=>item.record);
}
