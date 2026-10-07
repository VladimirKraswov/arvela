import type { Session } from "../api/types";
import type { OpenCodeClient } from "../api/client";
import { store } from "../state/store";
import type { UsageSource } from "./metrics";
async function openCodeSessions(client: OpenCodeClient, signal: AbortSignal): Promise<Session[]> {
  const sessions = new Map<string, Session>();
  for (const archived of [false, true]) {
    let cursor: number | undefined;
    const cursors = new Set<number>();
    do {
      signal.throwIfAborted();
      const page = await client.usageSessionsPage(archived, cursor, signal);
      for (const session of page.sessions) sessions.set(session.id, session);
      if (page.cursor === null || cursors.has(page.cursor)) break;
      cursor = page.cursor;
      cursors.add(cursor);
    } while (true);
  }
  return [...sessions.values()];
}

export function usageSources(): UsageSource[] {
  const result: UsageSource[] = [];
  if (store.state.connection.phase === "connected") {
    const client = store.client;
    result.push({
      engine: "OpenCode",
      sessions: signal => openCodeSessions(client, signal),
      messages: (session, before, signal) => client.messages(session.id, { directory: session.directory, before, limit: 200, signal }),
    });
  }
  if (store.piInstalled) {
    const pi = store.pi();
    result.push({
      engine: "Pi",
      sessions: async () => {
        const [active, archived] = await Promise.all([pi.recentSessions(false), pi.recentSessions(true)]);
        return [...active.sessions, ...archived.sessions];
      },
      messages: (session, before) => pi.messages(session.id, { directory: session.directory, before, limit: 200 }),
    });
  }
  return result;
}

