import {describe,it,expect,vi} from 'vitest';
import {UpdateController,type NativeStatus,type Transport} from '../src/updates/controller';
const native:NativeStatus={nativeVersion:'1.0.0',nativeFingerprint:'a'.repeat(64),hot:{uiVersion:'1.0.0',activeDigest:null,pending:false,lastError:null},build:{stage:'ready'}};
function fixture(kind:'hot'|'source'='hot'){
 const call=vi.fn(async(action:string)=>action==='check'?{available:true,version:'1.0.1',kind}:action==='status'?native:{});
 const apply=vi.fn(async()=>{}),controller=new UpdateController(call as Transport,apply);
 return{controller,call,apply};
}
describe('Hub updater control',()=>{
 it('hot update is available during active work; native update waits until idle',async()=>{
  const hot=fixture();await hot.controller.check();await hot.controller.download();await hot.controller.install(true);expect(hot.apply).toHaveBeenCalledWith('hot');
  const source=fixture('source');await source.controller.check();await source.controller.download();await source.controller.install(true);expect(source.apply).not.toHaveBeenCalled();expect(source.controller.snapshot().waiting).toBe(true);
  await source.controller.tick(true);expect(source.apply).not.toHaveBeenCalled();await source.controller.tick(false);expect(source.apply).toHaveBeenCalledExactlyOnceWith('source');await source.controller.tick(false);expect(source.apply).toHaveBeenCalledTimes(1);
 });
 it('never retries failed installs automatically and cancellation preserves the release',async()=>{
  const f=fixture('source');await f.controller.check();await f.controller.download();await f.controller.install(true);f.apply.mockRejectedValueOnce(Error('new work started'));await f.controller.tick(false);expect(f.controller.snapshot().waiting).toBe(false);expect(f.controller.snapshot().error).toContain('new work started');await f.controller.tick(false);expect(f.apply).toHaveBeenCalledTimes(1);expect(f.controller.snapshot().downloaded).toBe(true);
 });
 it('channel changes invalidate downloaded state; concurrent checks do not race',async()=>{
  const f=fixture();let finish!:(value:unknown)=>void;f.call.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const p=f.controller.check();await f.controller.check();f.controller.setChannel('preview');expect(f.controller.snapshot().channel).toBe('stable');finish({available:true,version:'1.0.1',kind:'hot'});await p;await f.controller.download();f.controller.setChannel('preview');expect(f.controller.snapshot().release).toBeNull();expect(f.controller.snapshot().downloaded).toBe(false);
 });
 it('health acknowledgement names the exact active UI, not the available download',async()=>{
  const f=fixture();await f.controller.ready();expect(f.call).toHaveBeenLastCalledWith('ready',{digest:null});
 });
});
it('a previous channel cannot be restored into the newly selected channel',async()=>{
 const call=vi.fn(async()=>({...native,release:{available:true,version:'1.0.1',kind:'source',channel:'stable'},downloaded:true}));const c=new UpdateController(call as Transport,async()=>{});
 c.setChannel('preview');await c.refresh();expect(c.snapshot().release).toBeNull();expect(c.snapshot().downloaded).toBe(false);
 c.setChannel('stable');await c.refresh();expect(c.snapshot().release?.version).toBe('1.0.1');expect(c.snapshot().downloaded).toBe(true);
});
