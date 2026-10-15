import {it,expect} from 'vitest';
import {OperationJournal,type Operation,type OperationInput} from '../src/operations/journal';
import {maintenance} from '../src/operations/maintenance';
it('interface reload waits for the durable acknowledgement and prevents a new POST',async()=>{
 const records=new Map<string,Operation>();
 const journal=new OperationJournal(()=>({list:async()=>[...records.values()],write:async(r)=>{records.set(r.id,r);}}));
 const input:OperationInput={id:'first',workspace:'fixture',engine:'pi',sessionId:'s',directory:'/fixture',source:'manual',sourceId:null,text:'fixture',attachments:null,model:'fixture'};
 let acknowledge!:()=>void,start!:()=>void;const started=new Promise<void>(r=>{start=r;});let drained=false;
 const delivery=journal.dispatch(input,()=>true,async()=>{start();await new Promise<void>(r=>{acknowledge=r;});});await started;
 const reload=maintenance.run(async()=>{await journal.drain();drained=true;});
 await expect(journal.dispatch({...input,id:'second'},()=>true,async()=>{throw Error('must not send');})).rejects.toThrow('обновляется');
 await Promise.resolve();expect(drained).toBe(false);acknowledge();await delivery;await reload;
 expect(records.get('first')?.state).toBe('accepted');expect(drained).toBe(true);expect(records.has('second')).toBe(false);
});
