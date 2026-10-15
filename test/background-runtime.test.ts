import {it,expect,vi} from 'vitest';
import {keepRuntimeAwake} from '../src/updates/background';
it('holds a shared lock while mounted and releases it on UI reload',async()=>{
 let callback!:()=>Promise<void>;const request=vi.fn((_name,_options,fn)=>{callback=fn;return Promise.resolve();});
 const stop=keepRuntimeAwake({request} as unknown as LockManager);let released=false;const held=callback().then(()=>{released=true;});
 await Promise.resolve();expect(released).toBe(false);expect(request.mock.calls[0][1].mode).toBe('shared');stop();await held;expect(released).toBe(true);
});
it('early unmount does not leak a lock and unsupported hosts still start',async()=>{
 let callback!:()=>Promise<void>;const request=vi.fn((_name,_options,fn)=>{callback=fn;return Promise.resolve();});
 const stop=keepRuntimeAwake({request} as unknown as LockManager);stop();await callback();keepRuntimeAwake(undefined)();
});
