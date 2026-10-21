import type { MessagePart } from '../api/types';
import type { AppState } from '../state/types';

/** Reducer slots are mutable; compare the actual immutable part values, not slot identity. */
export function partsPresentation(
  sessionId: string, messageIds: readonly string[],
  status: () => string | undefined, connected: (s: AppState) => boolean,
) {
  let parts: MessagePart[] = [];
  return (s: AppState) => {
    const slot = s.chat.sessions[sessionId];
    const next = messageIds.flatMap(id => (slot?.partsByMessage[id] ?? [])
      .map(key => slot!.parts[key]).filter(Boolean));
    if (next.length !== parts.length || next.some((part, i) => part !== parts[i])) parts = next;
    return { parts, status: status(), connected: connected(s) };
  };
}
