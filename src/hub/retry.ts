import {decodeHubError, HubRequestError} from './errors';
export interface HubRetryOptions {
  safe: boolean;
  signal?: AbortSignal;
  current?: () => void;
  onRetry?: (attempt: number, total: number, delayMs: number) => void;
}
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve,reject) => {
    signal?.throwIfAborted();
    const finish = () => { signal?.removeEventListener('abort',cancel); resolve(); };
    const timer = setTimeout(finish, ms);
    const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort',cancel); reject(signal?.reason ?? new DOMException('Отменено','AbortError')); };
    signal?.addEventListener('abort',cancel,{once:true});
  });
}
/** Three attempts, each with the native 20-second request deadline. Never replay
 * inference or an unkeyed write. Abort/profile changes stop the next attempt. */
export async function retryHub<T>(operation: () => Promise<T>, options: HubRetryOptions): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    options.signal?.throwIfAborted(); options.current?.();
    try { return await operation(); }
    catch (raw) {
      const error = decodeHubError(raw);
      options.signal?.throwIfAborted(); options.current?.();
      if (!options.safe || !(error instanceof HubRequestError) || !error.retryable) throw error;
      if (attempt >= 3) {
        error.message += ' Связь не восстановлена после 3 попыток. Запрос агенту автоматически не повторялся.';
        throw error;
      }
      const delay = attempt * 750;
      options.onRetry?.(attempt + 1, 3, delay);
      await pause(delay, options.signal);
    }
  }
}
