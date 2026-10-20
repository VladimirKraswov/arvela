import type { Session, PermissionRule } from "../api/types";
import type { AgentBackend } from "../agent/backend";
import { ApiError } from "../api/client";
export const WORKSHOP_TITLE = "Мастерская";
const legacyTitles = new Set(["Мастерская Arvela", "Мастерская Арвела"]);
export interface WorkshopWorkspace { directory: string; sourceDirectory: string | null; legacyDirectory?: string | null }
export interface WorkshopRecord extends WorkshopWorkspace { session: Session }
export async function prepareWorkshop(serverHome: string, sourceDirectory?: string): Promise<WorkshopWorkspace> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("workshop_prepare", { sourceDirectory: sourceDirectory ?? null, serverHome });
}
/** Reconcile ambiguous creates by directory/title before ever creating again. */
export async function resolveWorkshop(
  backend: AgentBackend, workspace: WorkshopWorkspace, previous?: WorkshopRecord, permission?: PermissionRule[],
): Promise<WorkshopRecord> {
  let session: Session | undefined;
  // The alias is supplied only after native canonical-path equality checks.
  const directories = [...new Set([workspace.directory, ...(workspace.legacyDirectory ? [workspace.legacyDirectory] : [])])];
  if (previous && directories.includes(previous.directory)) {
    try { session = await backend.getSession(previous.session.id, previous.directory); }
    catch (e) { if (!(e instanceof ApiError && e.status === 404)) throw e; }
  }
  if (!session) {
    const list = (await Promise.all(directories.map(directory => backend.listSessions(directory, {limit:100})))).flat();
    session = list.filter(s => directories.includes(s.directory) && (s.title === WORKSHOP_TITLE || legacyTitles.has(s.title)) && !s.parentID)
      .sort((a,b) => a.time.created - b.time.created || a.id.localeCompare(b.id))[0];
  }
  session ??= await backend.createSession({directory:workspace.directory,title:WORKSHOP_TITLE,...(permission ? {permission} : {})});
  if (!directories.includes(session.directory)) throw new Error("Агент вернул другой каталог мастерской.");
  if (session.time.archived || legacyTitles.has(session.title ?? "")) session = await backend.updateSession(session.id,{
    ...(session.time.archived ? {time:{archived:0}} : {}),
    ...(legacyTitles.has(session.title ?? "") ? {title:WORKSHOP_TITLE} : {}),
  },session.directory);
  return {...workspace,directory:session.directory,session};
}
export function isWorkshopSession(record: WorkshopRecord | undefined, session: Pick<Session,"id"|"directory">): boolean {
  return record?.session.id === session.id && record.directory === session.directory;
}
