/**
 * Stop waiting for `promise` once `signal` aborts. The underlying operation is not
 * cancelled (it may not support cancellation); its late result is ignored. Use it
 * only for read-only waits — never to abandon a request that may have been delivered
 * and then act as if it was not.
 */
export function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  const reason = () => signal.reason ?? new DOMException("Aborted", "AbortError");
  if (signal.aborted) {
    promise.catch(() => {}); // the abandoned operation must not surface as unhandled
    return Promise.reject(reason());
  }
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(reason());
    signal.addEventListener("abort", stop, { once: true });
    promise.then(
      value => { signal.removeEventListener("abort", stop); resolve(value); },
      error => { signal.removeEventListener("abort", stop); reject(error); },
    );
  });
}
