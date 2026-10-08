// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
vi.mock('../src/hub/client', () => ({config: vi.fn(), request: vi.fn()}));
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectBindings, projectKey } from '../src/memory/projects';
import { proposal, sourceOf, portableText } from '../src/memory/client';
import { blankOutcome, reviewOutcome } from '../src/outcomes/store';
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());
const scope = { hub: 'hub-a', server: 'local', directory: '/Users/private/repo' };
describe('portable project identity', () => {
 it('requires explicit binding and never matches directory basename', async () => {
  const s = new ProjectBindings('memory-' + crypto.randomUUID());
  try { const id = crypto.randomUUID(); await s.bind(scope, id, 'Same name', null);
   expect(await s.get({ ...scope, directory: '/other/repo' })).toBeNull();
   expect(await s.get({ ...scope, server: 'remote' })).toBeNull();
   expect(await s.get({ ...scope, hub: 'hub-b' })).toBeNull();
   expect(projectKey({ ...scope, engine: 'pi' } as typeof scope)).toBe(projectKey(scope));
   await s.bind({ ...scope, directory: 'C:\\Work\\repo' }, id, 'Same name', null);
   expect((await s.list()).map(x => x.projectID)).toEqual([id,id]);
  } finally { s.close(); }
 });
 it('refuses competing binders and preserves the committed binding after reopen', async () => {
  const name = 'memory-' + crypto.randomUUID(), a = new ProjectBindings(name), b = new ProjectBindings(name);
  try { const r = await Promise.allSettled([a.bind(scope, crypto.randomUUID(), 'A', null), b.bind(scope, crypto.randomUUID(), 'B', null)]);
   expect(r.filter(x => x.status === 'fulfilled')).toHaveLength(1); const saved = await a.get(scope); a.close();
   expect(await a.get(scope)).toEqual(saved);
   await expect(b.bind(scope, crypto.randomUUID(), 'stale', null)).rejects.toThrow(/изменена/);
  } finally { a.close(); b.close(); }
 });
 it('fails rather than showing successful binding when storage is absent', async () => {
  await expect(new ProjectBindings('missing', null as unknown as IDBFactory).bind(scope, crypto.randomUUID(), 'P', null)).rejects.toThrow(/недоступно/);
 });
 it('proposes only owner accepted persisted results and hashes the local identity', async () => {
  const raw = { ...blankOutcome({ ...scope, sessionID: 's', engine: 'pi' }, 'u', 'Build'), criteria: 'Build succeeds' };
  expect(() => proposal(raw)).toThrow(/примите/); const accepted = { ...reviewOutcome(raw, 'accepted'), revision: 2 };
  const source = await sourceOf(accepted); expect(source.anchor).toMatch(/^[a-f0-9]{64}$/); expect(JSON.stringify(source)).not.toContain('private');
  expect((await sourceOf({ ...accepted, revision: 3 })).revision).toBe(3); expect((await sourceOf({ ...accepted, notes: 'new' })).digest).not.toBe(source.digest);
  expect(source.accepted).toBe(true); expect(proposal(accepted).text).toBe('Build succeeds');
 });
 it('removes local paths and known credentials from portable proposals', () => {
  const text = portableText('Use /private/repo/main.py or D:\\Work\\repo.py password=secretstuff https://person:secretstuff@host/doc', 4000);
  expect(text).not.toContain('secretstuff'); expect(text).not.toContain('/private'); expect(text).not.toContain('D:\\Work'); expect(text).toContain('[LOCAL PATH]');
 });
});
