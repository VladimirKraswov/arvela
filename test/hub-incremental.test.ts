import {expect,it,vi} from 'vitest';
import {enqueueChangedRecords} from '../src/hub/incremental';
import type {Message} from '../src/api/types';
import type {HubRecord} from '../src/hub/records';
const fixtures=(n:number)=>Array.from({length:n},(_,n)=>({message:{id:String(n)} as Message,record:{id:String(n),text:'text'} as HubRecord}));
it('yields and bounds native batches, with compact receipts that never clear and resend 5000+ messages',async()=>{
 const items=fixtures(5050),observed=new WeakMap<Message,string>(),enqueue=vi.fn(async()=>{}),yieldUi=vi.fn(async()=>{});
 const hash=async(record:HubRecord)=>record.id+record.text;
 await enqueueChangedRecords(items,observed,enqueue,()=>true,hash,yieldUi);
 expect(enqueue.mock.calls).toHaveLength(202);expect(yieldUi).toHaveBeenCalledTimes(202);
 expect(enqueue.mock.calls.every(args=>(args as any)[0].length<=25)).toBe(true);
 enqueue.mockClear();await enqueueChangedRecords(items,observed,enqueue,()=>true,hash,yieldUi);expect(enqueue).not.toHaveBeenCalled();
 items[0].record.text='changed';await enqueueChangedRecords(items,observed,enqueue,()=>true,hash,yieldUi);expect(enqueue).toHaveBeenCalledOnce();
});
it('retries only an unacknowledged batch and respects disposal between records',async()=>{
 const items=fixtures(26),observed=new WeakMap<Message,string>();let current=true;
 await expect(enqueueChangedRecords(items,observed,async()=>{throw Error('disk');},()=>current,async r=>r.id,async()=>{})).rejects.toThrow('disk');
 expect(observed.has(items[0].message)).toBe(false);
 const enqueue=vi.fn(async()=>{current=false;});await enqueueChangedRecords(items,observed,enqueue,()=>current,async r=>r.id,async()=>{});
 expect(enqueue).toHaveBeenCalledOnce();expect(observed.has(items[24].message)).toBe(true);expect(observed.has(items[25].message)).toBe(false);
});
it('stores a fixed-size cryptographic receipt with the production hasher',async()=>{
 const [item]=fixtures(1),observed=new WeakMap<Message,string>(),enqueue=vi.fn(async()=>{});
 await enqueueChangedRecords([item],observed,enqueue,()=>true);
 expect(observed.get(item.message)).toMatch(/^[a-f0-9]{64}$/);
 await enqueueChangedRecords([item],observed,enqueue,()=>true);expect(enqueue).toHaveBeenCalledOnce();
});
