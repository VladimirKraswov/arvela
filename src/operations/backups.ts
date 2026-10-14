import {attachmentDrafts} from '../attachments/drafts';
import {flushPrefs,savePrefs,type Prefs} from '../state/prefs';
export interface BackupData {schema:1; prefs:Prefs; attachments:Awaited<ReturnType<typeof attachmentDrafts.exportBackup>>}
export async function makeBackup(prefs:Prefs):Promise<string>{
  savePrefs(prefs);if(!flushPrefs())throw Error('Не удалось сохранить настройки.');
  return JSON.stringify({schema:1,prefs,attachments:await attachmentDrafts.exportBackup()} satisfies BackupData);
}
export async function restoreBackup(data:BackupData):Promise<void>{
  if(data?.schema!==1||!data.prefs||typeof data.prefs.endpoint!=='string'||!data.prefs.drafts||!Array.isArray(data.attachments))throw Error('Повреждена резервная копия.');
  // Merge blobs atomically first. Never delete files added after the snapshot.
  await attachmentDrafts.importBackup(data.attachments);
  const prefs={...data.prefs,queues:Object.fromEntries(Object.entries(data.prefs.queues??{}).map(([id,items])=>[id,items.map(q=>({...q,state:'uncertain' as const,error:'Восстановлено из резервной копии. Проверьте историю перед отправкой.'}))]))};
  savePrefs(prefs);if(!flushPrefs())throw Error('Не удалось восстановить настройки.');
}
