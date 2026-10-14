import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';

let drafts: typeof import('../src/attachments/drafts').attachmentDrafts;
let a: string, b: string;
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  drafts = (await import('../src/attachments/drafts')).attachmentDrafts;
  a = crypto.randomUUID(); b = crypto.randomUUID();
});
const file = (name: string) => new File([name], name, { type: 'text/plain' });

it('can retry opening storage after a transient IndexedDB failure', async () => {
  vi.spyOn(indexedDB, 'open').mockImplementationOnce(() => { throw new DOMException('Temporary failure', 'UnknownError'); });
  await expect(drafts.add(a, [file('first')])).rejects.toThrow('Temporary failure');
  await drafts.add(a, [file('retry')]);
  expect(drafts.snapshot(a).map(f => f.name)).toEqual(['retry']);
});

it('serializes opposite-direction copies without a lock cycle', async () => {
  const [aa, bb] = await Promise.all([drafts.add(a, [file('a')]), drafts.add(b, [file('b')])]);
  const operation = Promise.all([drafts.copy(a, b, [aa[0].id]), drafts.copy(b, a, [bb[0].id])]);
  let timer: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('copy deadlock')), 300); })]);
  } finally { clearTimeout(timer!); }
  expect(drafts.snapshot(a).map(f => f.name).sort()).toEqual(['a', 'b']);
  expect(drafts.snapshot(b).map(f => f.name).sort()).toEqual(['a', 'b']);
});

it('keeps a move and a concurrent destination add consistent with durable storage', async () => {
  await drafts.add(a, [file('a')]);
  await drafts.ensure(b);
  await Promise.all([drafts.move(a, b), drafts.add(b, [file('b')])]);
  expect(drafts.snapshot(a)).toEqual([]);
  expect(drafts.snapshot(b).map(f => f.name).sort()).toEqual(['a', 'b']);
  vi.resetModules();
  const reloaded = (await import('../src/attachments/drafts')).attachmentDrafts;
  await Promise.all([reloaded.ensure(a), reloaded.ensure(b)]);
  expect(reloaded.snapshot(a)).toEqual([]);
  expect(reloaded.snapshot(b).map(f => f.name).sort()).toEqual(['a', 'b']);
});

it('refuses a move that would exceed attachment limits without losing the source', async () => {
  await drafts.add(a, [file('source')]);
  await drafts.add(b, Array.from({ length: 12 }, (_, i) => file(`dest-${i}`)));
  await expect(drafts.move(a, b)).rejects.toThrow();
  expect(drafts.snapshot(a)).toHaveLength(1);
  expect(drafts.snapshot(b)).toHaveLength(12);
});
