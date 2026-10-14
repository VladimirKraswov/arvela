import { useEffect } from 'react';
import { store } from '../state/store';
import { isNative } from '../native/platform';
import { config, disable, drain, idle, install, request, spool, type HubItem } from './client';
import { assessmentIndex } from '../outcomes/sharing';
import { collectHubRecords } from './collection';
import { hubOrigin } from './identity';

export function HubRuntime() {
  useEffect(() => {
    if (!isNative()) return;
    let disposed = false, busy = false, lastCatalog = 0, failures = 0, next = 0;
    let collectionScope = '';
    const observed = new Map<string, string>();
    async function tick() {
      if (disposed || busy || Date.now() < next) return;
      busy = true;
      try {
        const settings = await config();
        if (disposed || !settings.enabled) return;
        const [assessments, origin] = await Promise.all([assessmentIndex(), hubOrigin(settings)]);
        if (disposed) return;
        const state = store.state;
        const scope = JSON.stringify([origin, state.prefs.workspaceKey ?? state.prefs.endpoint]);
        if (scope !== collectionScope) { observed.clear(); lastCatalog = 0; collectionScope = scope; }
        const key = (record: { engine: string; sessionId: string; id: string }) => JSON.stringify([record.engine, record.sessionId, record.id]);
        const records = collectHubRecords(state, assessments, settings.shareText)
          .filter(record => observed.get(key(record)) !== JSON.stringify(record));
        if (observed.size > 5000) observed.clear();
        for (let i = 0; i < records.length; i += 50) {
          if (disposed) return;
          const batch = records.slice(i, i + 50);
          // The native boundary rejects this batch if the Hub changed during collection.
          await spool('enqueue', batch, undefined, origin);
          for (const record of batch) observed.set(key(record), JSON.stringify(record));
        }
        if (disposed) return;
        await drain();
        failures = 0;
        next = Date.now() + 10000;
        if (!disposed && idle() && !store.state.ui.settingsOpen && Date.now() - lastCatalog > 300000) {
          const items = (await request<{ items: HubItem[] }>('catalog', undefined, origin)).items;
          for (const item of items) {
            if (disposed) return;
            if (settings.installed[item.id] && !item.enabled) await disable(item, origin);
            else if (item.enabled && settings.installed[item.id] && settings.installed[item.id] !== item.revision && item.kind !== 'tool')
              await install(item, true, origin);
          }
          lastCatalog = Date.now();
        }
      } catch {
        failures++;
        next = Date.now() + Math.min(60000, 2000 * 2 ** Math.min(5, failures));
      } finally { busy = false; }
    }
    const timer = setInterval(() => void tick(), 10000);
    void tick();
    return () => { disposed = true; clearInterval(timer); };
  }, []);
  return null;
}
