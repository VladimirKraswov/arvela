/** Keep the document eligible for background work without spinning a timer.
 * Native agents are independent; the document still owns queues and SSE.
 */
export function keepRuntimeAwake(locks:LockManager|undefined=navigator.locks):()=>void {
  if(!locks)return()=>{};
  const abort=new AbortController();let alive=true,release=()=>{};
  void locks.request('arvela-runtime-active',{mode:'shared',signal:abort.signal},async()=>{
    if(!alive)return;await new Promise<void>(resolve=>{release=resolve;});
  }).catch(()=>{}); // Unsupported/denied Web Locks must never stop app startup.
  return()=>{alive=false;release();abort.abort();};
}
