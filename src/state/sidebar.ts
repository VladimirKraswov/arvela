import type { Session } from "../api/types";

export interface SidebarList {
  sessions: Session[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  limit: number;
  hasMore: boolean;
}
export interface RecentList extends SidebarList {
  archived: boolean;
  cursor: number | null;
}
export const emptySidebarList = (): SidebarList => ({
  sessions: [], loading: false, loaded: false, error: null, limit: 50, hasMore: false,
});
export const emptyRecentList = (): RecentList => ({
  ...emptySidebarList(), archived: false, cursor: null,
});

/** Replay changes received during a list request, including deletions. */
export function mergeSidebarSessions(
  snapshot: Session[], changes: Map<string, Session | null> = new Map(),
): Session[] {
  const index = new Map(snapshot.map((s) => [s.id, s]));
  for (const [id, session] of changes) {
    if (session) index.set(id, session);
    else index.delete(id);
  }
  return [...index.values()].filter((s) => !s.parentID)
    .sort((a, b) => b.time.updated - a.time.updated || a.id.localeCompare(b.id));
}
