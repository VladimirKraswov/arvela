import {afterEach,expect,it,vi} from 'vitest';
import {HubRequestError,decodeHubError} from '../src/hub/errors';
import {retryHub} from '../src/hub/retry';
afterEach(()=>vi.useRealTimers());
it('recovers a temporary failure with the same operation and stops after three attempts',async()=>{
 vi.useFakeTimers();const call=vi.fn().mockRejectedValueOnce(new HubRequestError('network')).mockResolvedValue('ready'),progress=vi.fn();
 const result=retryHub(call,{safe:true,onRetry:progress});await vi.advanceTimersByTimeAsync(750);
 expect(await result).toBe('ready');expect(call).toHaveBeenCalledTimes(2);expect(progress).toHaveBeenCalledWith(2,3,750);
 const offline=vi.fn().mockImplementation(()=>Promise.reject(new HubRequestError('timeout')));
 const pending=retryHub(offline,{safe:true});const rejected=expect(pending).rejects.toThrow('после 3 попыток');await vi.advanceTimersByTimeAsync(3000);await rejected;expect(offline).toHaveBeenCalledTimes(3);
});
it('never retries TLS, credentials, invalid requests, ambiguous legacy failures or unsafe writes',async()=>{
 for(const error of [new HubRequestError('tls'),new HubRequestError('http',401),new HubRequestError('http',403),new HubRequestError('http',400),'Библиотека недоступна или сертификат не совпадает']){
  const call=vi.fn().mockRejectedValue(error);await expect(retryHub(call,{safe:true})).rejects.toBe(error);expect(call).toHaveBeenCalledOnce();
 }
 const call=vi.fn().mockRejectedValue(new HubRequestError('network'));await expect(retryHub(call,{safe:false})).rejects.toThrow('соединение');expect(call).toHaveBeenCalledOnce();
});
it('cancel and profile changes prevent the next request during backoff',async()=>{
 vi.useFakeTimers();const cancel=new AbortController(),call=vi.fn().mockRejectedValue(new HubRequestError('network'));
 const pending=retryHub(call,{safe:true,signal:cancel.signal});const rejected=expect(pending).rejects.toThrow();await vi.advanceTimersByTimeAsync(0);cancel.abort();await rejected;expect(call).toHaveBeenCalledOnce();
 let changed=false;const current=()=>{if(changed)throw Error('profile changed');};
 const next=retryHub(call,{safe:true,current});const rejectedNext=expect(next).rejects.toThrow('profile changed');await vi.advanceTimersByTimeAsync(0);changed=true;await vi.advanceTimersByTimeAsync(750);await rejectedNext;expect(call).toHaveBeenCalledTimes(2);
});
it('decodes only controlled native codes and never displays arbitrary backend detail',()=>{
 const error=decodeHubError('ENKI_HUB_ERROR:{"code":"tls","status":null,"detail":"private-secret-url"}') as HubRequestError;
 expect(error).toBeInstanceOf(HubRequestError);expect(error.message).toContain('TLS-сертификат');expect(error.message).not.toContain('private-secret');expect(error.retryable).toBe(false);
 expect(new HubRequestError('http',503).retryable).toBe(true);expect(new HubRequestError('http',429).retryable).toBe(true);
});
