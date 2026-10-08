import { config, request, type HubConfig } from '../hub/client';
import { redact } from '../hub/records';
import { outcomes, type Outcome } from '../outcomes/store';
import { projects, projectKey, type ProjectScope } from './projects';
export interface MemorySource { anchor: string; revision: number; digest: string; accepted: boolean; engine: 'opencode' | 'pi' }
export interface EntryInput { id: string; project: string; kind: 'fact' | 'runbook'; title: string; text: string; source: MemorySource; expiresAt: number }
export interface MemoryEntry extends EntryInput { revision: number; updated: number; sourceDevice: string; state: 'candidate' | 'approved' | 'stale' | 'expired' }
export interface MemoryPage { projects: Array<{ id: string; title: string; created: number }>; entries: MemoryEntry[] }
export async function digest(value: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join(''); }
export const hubIdentity = (c: HubConfig) => digest(JSON.stringify([c.endpoint, c.certificate]));
/** Source keys are opaque hashes; local directory/server strings never leave this device. */
export async function sourceOf(card: Outcome): Promise<MemorySource> {
  return { anchor: await digest(card.id), revision: card.revision, digest: await digest(JSON.stringify([card.goal, card.criteria, card.checks, card.notes])), accepted: card.verdict === 'accepted', engine: card.scope.engine };
}
export function portableText(text: string, limit: number) {
  return redact(text, limit).replace(/https?:\/\/[^\s]+|(?:[A-Za-z]:[\\/]|\/)[^\s]+/g, value => /^https?:\/\//.test(value) ? value : '[LOCAL PATH]').slice(0, limit);
}
export function proposal(card: Outcome) {
  if (card.verdict !== 'accepted' || card.revision < 1) throw Error('Сначала сохраните и примите результат задачи.');
  return { title: portableText(card.goal, 120), text: portableText(card.notes || card.criteria, 4000) };
}
export async function memoryPage(scope: ProjectScope, project?: string) {
  return request<MemoryPage>(project ? `memory?project=${project}` : 'memory', undefined, scope.hub);
}
export const memoryWrite = <T>(scope: ProjectScope, body: unknown) => request<T>('memory', body, scope.hub);
/** Deterministic source invalidation, metadata only; never approves, proposes or runs an agent.
 * Each explicit caller reads a fresh snapshot; an older concurrent upload cannot roll Hub back.
 * The background runtime separately coalesces events and ticks.
 */
export async function synchronizeMemorySources() {
  const c = await config(); if (!c.enabled) return;
  const hub = await hubIdentity(c), bindings = new Set((await projects.list()).map(b => b.key));
  const cards = (await outcomes.list()).filter(t => bindings.has(projectKey({ hub, server: t.scope.server, directory: t.scope.directory })));
  const sources = await Promise.all(cards.map(sourceOf));
  if (sources.length) await request('memory', { action: 'sources', sources }, hub);
}
