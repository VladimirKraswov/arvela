import 'fake-indexeddb/auto';
import {it,expect} from 'vitest';
import {attachmentDrafts} from '../src/attachments/drafts';
import {makeBackup,restoreBackup} from '../src/operations/backups';
import {DEFAULT_PREFS,loadPrefs} from '../src/state/prefs';
import {maintenance} from '../src/operations/maintenance';
import {OperationJournal} from '../src/operations/journal';
it('restores ZIP bytes and drafts but never arms a restored queue',async()=>{
 const scope='backup-test-'+crypto.randomUUID();
 const files=await attachmentDrafts.add(scope,[new File(['zip fixture'],'fixture.zip',{type:'application/zip'})]);
 const prefs={...DEFAULT_PREFS,drafts:{s:'keep draft'},queues:{s:[{id:'q',sessionID:'s',state:'ready',text:'queued'}]}} as any;
 const data=JSON.parse(await makeBackup(prefs));await attachmentDrafts.remove(scope,files.map(f=>f.id));
 await restoreBackup(data);await attachmentDrafts.ensure(scope);
 expect(await attachmentDrafts.snapshot(scope)[0].blob.text()).toBe('zip fixture');
 expect(loadPrefs().drafts.s).toBe('keep draft');expect(loadPrefs().queues!.s[0].state).toBe('uncertain');
 const broken=structuredClone(data);broken.attachments[0].size+=1;
 await expect(restoreBackup(broken)).rejects.toThrow('Размер');
 expect(loadPrefs().drafts.s).toBe('keep draft');
});
it('maintenance blocks dispatch without touching disk or the engine and releases on failure',async()=>{
 let writes=0,posts=0;const journal=new OperationJournal(()=>({list:async()=>[],write:async()=>{writes++;}}));
 await maintenance.run(async()=>{await expect(journal.dispatch({} as any,()=>true,async()=>{posts++;})).rejects.toThrow('обновляется');});
 expect(writes).toBe(0);expect(posts).toBe(0);expect(maintenance.active()).toBe(false);
 await expect(maintenance.run(async()=>{throw Error('backup failed');})).rejects.toThrow('backup failed');expect(maintenance.active()).toBe(false);
});
