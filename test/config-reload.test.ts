import {afterEach,expect,it,vi} from 'vitest';
const transport=vi.hoisted(()=>({options:null as any}));
vi.mock('../src/api/events',()=>({globalEventStreamUrl:(base:string)=>base+'/global/event',runEventStream:vi.fn(async(opts:any)=>{transport.options=opts;opts.onState('open');opts.onEvent({payload:{type:'server.connected'}});await new Promise<void>(resolve=>opts.signal.addEventListener('abort',()=>resolve(),{once:true}));})}));
import {applyGlobalPlugins} from '../src/api/configReload';
afterEach(()=>{vi.useRealTimers();transport.options=null;});
it('waits for completed global disposal rather than only the PATCH response, and releases the stream',async()=>{
 const request=vi.fn(async()=>({})),client={baseUrl:'http://127.0.0.1:4096',headers:{},request} as any;
 let finished=false;const pending=applyGlobalPlugins(client,['current'],()=>true).then(()=>{finished=true;});
 await vi.waitFor(()=>expect(request).toHaveBeenCalledOnce());expect(finished).toBe(false);
 transport.options.onEvent({directory:'/other',payload:{type:'global.disposed'}});expect(finished).toBe(false);
 transport.options.onEvent({directory:'global',payload:{type:'global.disposed'}});await pending;
 expect(finished).toBe(true);expect(transport.options.signal.aborted).toBe(true);
});
it('does not send the PATCH after connection change and never retries an unacknowledged reload',async()=>{
 const request=vi.fn(async()=>({})),client={baseUrl:'http://127.0.0.1:4096',headers:{},request} as any;
 await expect(applyGlobalPlugins(client,['current'],()=>false)).rejects.toThrow('изменилось');expect(request).not.toHaveBeenCalled();
 vi.useFakeTimers();const pending=applyGlobalPlugins(client,['current'],()=>true);const assertion=expect(pending).rejects.toThrow('не подтвердил');await vi.advanceTimersByTimeAsync(20000);await assertion;
 expect(request).toHaveBeenCalledOnce();expect(transport.options.signal.aborted).toBe(true);
});
