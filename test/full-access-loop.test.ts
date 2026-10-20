import {expect, it, vi} from 'vitest';
import {OpenCodeClient} from '../src/api/client';
import {FullAccessLoop} from '../src/agent/fullAccessLoop';
import {accessRules} from '../src/state/access';
import {runEventStream} from '../src/api/events';
vi.mock('../src/api/events',()=>({runEventStream:vi.fn(async()=>{}),eventStreamUrl:()=>'/event',globalEventStreamUrl:()=>'/global/event'}));
import type {PermissionRequest, Session} from '../src/api/types';
function fixture() {
  const client = new OpenCodeClient('http://127.0.0.1:4096');
  const root = {id:'root',directory:'/project',permission:accessRules('full')} as Session;
  const get = vi.spyOn(client,'getSession').mockImplementation(async id => id === 'child'
    ? {...root,id:'child',parentID:'root'} : {...root,id});
  const reply = vi.spyOn(client,'replyPermission').mockResolvedValue();
  const resolver = new FullAccessLoop(client);
  const request = {id:'permission1',sessionID:'child',permission:'doom_loop'} as PermissionRequest;
  return {client,root,get,reply,resolver,request};
}
it('uses the actual root full policy and responds once across event/snapshot duplicates',async()=>{
  const f=fixture();
  expect(await Promise.all([f.resolver.resolve(f.request,'/project'),f.resolver.resolve(f.request,'/project')])).toEqual([true,true]);
  expect(f.reply).toHaveBeenCalledExactlyOnceWith('permission1','once','/project');
  expect(f.get.mock.calls.map(c=>c.slice(0,2))).toEqual([['child','/project'],['root','/project']]);
});
it('keeps ordinary prompts, non-full sessions and foreign or cyclic context manual',async()=>{
  const f=fixture();
  for (const mode of ['ask','read','inherit'] as const) {
    f.root.permission=accessRules(mode);
    expect(await f.resolver.resolve({...f.request,id:mode},'/project')).toBe(false);
  }
  f.root.permission=accessRules('full');
  expect(await f.resolver.resolve({...f.request,id:'bash',permission:'bash'},'/project')).toBe(false);
  expect(await f.resolver.resolve({...f.request,id:'foreign'},'/other')).toBe(false);
  f.root.parentID='child';
  expect(await f.resolver.resolve({...f.request,id:'cycle'},'/project')).toBe(false);
  expect(f.reply).not.toHaveBeenCalled();
});
it('fails closed on auth changes, cancellation and unknown policy',async()=>{
  for (const failure of ['auth','abort','api','identity']) {
    const f=fixture(), controller=new AbortController();
    f.get.mockImplementation(async id=>{
      if(failure==='auth') f.client.headers={Authorization:'changed-test'};
      if(failure==='abort') controller.abort();
      if(failure==='api') throw Error('unavailable');
      return {...f.root,id:failure==='identity'?'foreign':id};
    });
    expect(await f.resolver.resolve(f.request,'/project',controller.signal)).toBe(false);
    expect(f.reply).not.toHaveBeenCalled();
  }
});
it('does not retry an ambiguous reply and preserves legacy full policies',async()=>{
  const f=fixture();
  f.root.permission=[{permission:'*',pattern:'*',action:'allow'},{permission:'doom_loop',pattern:'*',action:'ask'}];
  f.reply.mockRejectedValue(Error('timeout'));
  expect(await f.resolver.resolve(f.request,'/project')).toBe(false);
  expect(await f.resolver.resolve(f.request,'/project')).toBe(false);
  expect(f.reply).toHaveBeenCalledTimes(1);
});

it('rechecks a pending request when the user later grants full access',async()=>{
  const f=fixture(); f.root.permission=accessRules('read');
  expect(await f.resolver.resolve(f.request,'/project')).toBe(false);
  f.root.permission=accessRules('full');
  expect(await f.resolver.resolve(f.request,'/project')).toBe(true);
  expect(f.reply).toHaveBeenCalledTimes(1);
});
it('integrates with event subscriptions and reconnect snapshots without duplicate replies',async()=>{
  const {OpenCodeBackend}=await import('../src/agent/opencode');
  const backend=new OpenCodeBackend('http://127.0.0.1:4096');
  const request={id:'snapshot',sessionID:'root',permission:'doom_loop'} as PermissionRequest;
  vi.spyOn(backend.client,'getSession').mockResolvedValue({id:'root',directory:'/project',permission:accessRules('full')} as Session);
  vi.spyOn(backend.client,'pendingPermissions').mockResolvedValue([request,{...request,id:'manual',permission:'bash'}]);
  const reply=vi.spyOn(backend.client,'replyPermission').mockResolvedValue();
  const controller=new AbortController();
  backend.subscribeDirectory('/project',{signal:controller.signal,onEvent:()=>{},onState:()=>{}});
  const stream=vi.mocked(runEventStream).mock.calls.at(-1)![0];
  stream.onEvent({type:'permission.asked',properties:request});
  await vi.waitFor(()=>expect(reply).toHaveBeenCalledTimes(1));
  expect((await backend.pendingPermissions('/project')).map(r=>r.id)).toEqual(['manual']);
  expect((await backend.pendingPermissions('/project')).map(r=>r.id)).toEqual(['manual']);
  controller.abort();
  expect(reply).toHaveBeenCalledExactlyOnceWith('snapshot','once','/project');
});
