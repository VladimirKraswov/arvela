import { useEffect } from 'react';
import { isNative } from '../native/platform';
import { subscribeOutcomes } from '../outcomes/store';
import { synchronizeMemorySources } from './client';
export function MemoryRuntime() {
  useEffect(() => {
    if (!isNative()) return;
    let disposed = false, running = false, again = false;
    const sync = async () => {
      if (disposed) return; if (running) { again = true; return; }
      running = true;
      try { await synchronizeMemorySources(); } catch { /* Durable source cards remain; next bounded tick retries. */ }
      finally { running = false; if (again && !disposed) { again = false; void sync(); } }
    };
    const off = subscribeOutcomes(() => void sync()), timer = setInterval(() => void sync(), 60000);
    void sync(); return () => { disposed = true; off(); clearInterval(timer); };
  }, []);
  return null;
}
