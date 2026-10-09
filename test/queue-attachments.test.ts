import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../src/api/events', () => ({ globalEventStreamUrl: () => 'http://localhost/global/event', eventStreamUrl: () => '', runEventStream: vi.fn(async () => {}) }));
let store: any, drafts: typeof import('../src/attachments/drafts').attachmentDrafts, scope: string;
const settle = async () => { for(let i=0;i<20;i++) await new Promise(r => setTimeout(r, 5)); };
beforeEach(async () => {
  vi.restoreAllMocks(); vi.resetModules();
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k:string) => values.get(k) ?? null, setItem: vi.fn((k:string,v:string) => values.set(k,v)) });
  store = (await import('../src/state/store')).store;
  const mod = await import('../src/attachments/drafts'); drafts = mod.attachmentDrafts;
  store.state = { ...store.state, directory:'/test-'+crypto.randomUUID(), activeSessionId:'ses_a', connection:{...store.state.connection,phase:'connected',streamState:'open'}, statuses:{ses_a:{type:'busy'}}, connectedProviderIds:['p'] };
  store.setModelChoice('p','m','medium');
  vi.spyOn(store,'modelInfo').mockReturnValue({id:'m', name:'Fixture', capabilities:{input:{image:true}}});
  vi.spyOn(store.client,'prompt').mockResolvedValue(undefined);
  scope = mod.attachmentScope(store.state.prefs.workspaceKey ?? store.state.prefs.endpoint, store.state.directory,'ses_a');
  await drafts.add(scope,[new File(['hello'],'fixture.txt',{type:'text/plain'})]);
});
const idle = () => store.handleEvent({type:'session.status',properties:{sessionID:'ses_a',status:{type:'idle'}}});
it('queues independent persisted files, sends them once after idle and keeps later draft files',async()=>{
  store.setDraft('first');
  expect(await store.enqueueWithAttachments('first',drafts.snapshot(scope))).toBe(true);
  const queued=store.getQueue()[0];
  expect(drafts.snapshot(scope)).toHaveLength(0);
  expect(JSON.stringify(store.state.prefs.queues)).not.toMatch(/blob|base64|hello/);
  await drafts.add(scope,[new File(['next'],'later.txt',{type:'text/plain'})]);
  idle(); idle(); await settle();
  expect(store.client.prompt).toHaveBeenCalledTimes(1);
  expect(store.client.prompt.mock.calls[0][2].parts).toEqual([{type:'text',text:'first'},{type:'file',filename:'fixture.txt',mime:'text/plain',url:'data:text/plain;base64,aGVsbG8='}]);
  expect(drafts.snapshot(scope).map(f=>f.name)).toEqual(['later.txt']);
  expect(drafts.snapshot(queued.attachments.scope)).toHaveLength(0);
});
it('file-only entries and multiple batches retain their own files and captured model',async()=>{
  expect(await store.enqueueWithAttachments('',drafts.snapshot(scope))).toBe(true);
  store.setModelChoice('p','other');
  await drafts.add(scope,[new File(['second'],'second.txt',{type:'text/plain'})]);
  expect(await store.enqueueWithAttachments('second',drafts.snapshot(scope))).toBe(true);
  expect(store.getQueue().map((q:any)=>q.attachments.files[0].name)).toEqual(['fixture.txt','second.txt']);
  idle(); await settle(); idle(); await settle();
  expect(store.client.prompt.mock.calls.map((call:any)=>call[2].model.modelID)).toEqual(['m','other']);
  expect(store.getQueue()).toHaveLength(0);
});
it('editing restores text and files; removing deletes only that queue copy',async()=>{
  await store.enqueueWithAttachments('edit me',drafts.snapshot(scope));
  const queued=store.getQueue()[0];
  await store.editQueued(queued.id);
  expect(store.getDraft()).toBe('edit me'); expect(drafts.snapshot(scope)[0].name).toBe('fixture.txt');
  await store.enqueueWithAttachments('edit me',drafts.snapshot(scope));
  await store.removeQueued(store.getQueue()[0].id);
  expect(store.getQueue()).toHaveLength(0);
});
it('retains files on an uncertain POST and never replays automatically',async()=>{
  await store.enqueueWithAttachments('maybe',drafts.snapshot(scope));
  const queued=store.getQueue()[0];
  vi.mocked(store.client.prompt).mockRejectedValue(new Error('timeout'));
  idle(); await settle();
  expect(store.getQueue()[0].state).toBe('uncertain'); expect(drafts.snapshot(queued.attachments.scope)).toHaveLength(1);
  idle(); store.resumeQueue(); await settle(); expect(store.client.prompt).toHaveBeenCalledTimes(1);
});
it('a missing file pauses before POST and remains editable',async()=>{
  await store.enqueueWithAttachments('missing',drafts.snapshot(scope));
  const queued=store.getQueue()[0];
  await drafts.remove(queued.attachments.scope,queued.attachments.files.map((f:any)=>f.id));
  idle(); await settle();
  expect(store.client.prompt).not.toHaveBeenCalled(); expect(store.getQueue()[0].state).toBe('ready'); expect(store.isQueueArmed()).toBe(false);
});
it('storage failure keeps the original draft and does not send',async()=>{
  store.setDraft('keep');
  vi.mocked(localStorage.setItem).mockImplementation(()=>{throw new Error('quota');});
  expect(await store.enqueueWithAttachments('keep',drafts.snapshot(scope))).toBe(false);
  expect(store.getDraft()).toBe('keep'); expect(drafts.snapshot(scope)).toHaveLength(1); expect(store.getQueue()).toHaveLength(0);
});
it('late draft-copy failure cannot appear in another chat',async()=>{
  let reject!: (e:Error)=>void;
  vi.spyOn(drafts,'copy').mockImplementation(()=>new Promise((_,r)=>{reject=r;}));
  const operation=store.enqueueWithAttachments('first',drafts.snapshot(scope));
  store.state.activeSessionId='ses_b'; reject(new Error('old attachment error')); await operation;
  expect(store.state.ui.sendError).toBeNull(); expect(drafts.snapshot(scope)).toHaveLength(1);
});

it('queued attachment data survives a module reload and interrupted sends stay uncertain',async()=>{
 await store.enqueueWithAttachments('durable',drafts.snapshot(scope));
 const queued=store.getQueue()[0];const directory=store.state.directory;
 vi.resetModules();const restored=await import('../src/attachments/drafts');
 await restored.attachmentDrafts.ensure(queued.attachments.scope);
 expect(await restored.attachmentDrafts.snapshot(queued.attachments.scope)[0].blob.text()).toBe('hello');
 const reloaded=(await import('../src/state/prefs')).loadPrefs();expect(reloaded.queues.ses_a[0].attachments.files[0].name).toBe('fixture.txt');
 expect(reloaded.queues.ses_a[0].directory).toBe(directory);
});
it('edit persistence failure leaves the queue copy recoverable',async()=>{
 await store.enqueueWithAttachments('keep queue',drafts.snapshot(scope));const queued=store.getQueue()[0];
 vi.mocked(localStorage.setItem).mockImplementation(()=>{throw new Error('quota');});
 await store.editQueued(queued.id);
 expect(store.getQueue()[0].id).toBe(queued.id);expect(drafts.snapshot(scope)).toHaveLength(0);
 expect(drafts.snapshot(queued.attachments.scope)).toHaveLength(1);expect(store.getDraft()).toBe('');
});
