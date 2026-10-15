// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {watchUpdateChecks,UPDATE_CHECK_INTERVAL} from '../src/updates/checks';
afterEach(()=>vi.useRealTimers());
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
it('discovers on startup, polling, focus/network recovery and Hub reconnect, without overlapping checks',async()=>{
 vi.useFakeTimers();const call=vi.fn(async()=>{}),events=new EventTarget();const watch=watchUpdateChecks(call,()=>true,events);
 watch.check();events.dispatchEvent(new Event('focus'));await flush();expect(call).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(60_000);events.dispatchEvent(new Event('online'));await flush();expect(call).toHaveBeenCalledTimes(2);
 events.dispatchEvent(new Event('arvela-hub-config-changed'));await flush();expect(call).toHaveBeenCalledTimes(3);
 await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL);expect(call).toHaveBeenCalledTimes(4);
 watch.stop();events.dispatchEvent(new Event('arvela-hub-config-changed'));await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL);watch.check();await flush();expect(call).toHaveBeenCalledTimes(4);
});
it('does not replace a downloaded/compiling update, retries failures only on another scheduled event',async()=>{
 vi.useFakeTimers();let allowed=false;const call=vi.fn(async()=>{throw Error('offline')}),watch=watchUpdateChecks(call,()=>allowed,new EventTarget());
 watch.check();await flush();expect(call).not.toHaveBeenCalled();allowed=true;watch.check();await flush();expect(call).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL);expect(call).toHaveBeenCalledTimes(2);watch.stop();
});

it('unmount before a queued metadata check prevents the transport call',async()=>{
 const call=vi.fn(async()=>{}),watch=watchUpdateChecks(call,()=>true,new EventTarget());watch.check();watch.stop();await flush();expect(call).not.toHaveBeenCalled();
});
