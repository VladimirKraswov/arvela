import {afterEach,expect,it,vi} from 'vitest';
import {conversationWindow} from '../src/chat/window';
afterEach(()=>vi.restoreAllMocks());
it('keeps a following tail bounded after thousands of live messages and a cached return',()=>{
 const order=Array.from({length:20000},(_,n)=>'m'+n);
 const range=conversationWindow(order,'m10',true);
 expect(range).toEqual({start:19940,end:20000});
});
it('keeps the reader anchored with a bounded window while newer messages accumulate',()=>{
 const order=Array.from({length:20000},(_,n)=>'m'+n);
 expect(conversationWindow(order,'m500',false)).toEqual({start:500,end:620});
 expect(conversationWindow([...order,'next'],'m500',false)).toEqual({start:500,end:620});
 expect(conversationWindow([],undefined,false)).toEqual({start:0,end:0});
});
it('reuses the finite ICU formatter set across thousands of streamed timestamps',async()=>{
 vi.resetModules();const original=Intl.DateTimeFormat;
 const factory=vi.spyOn(Intl,'DateTimeFormat').mockImplementation(function(locales,options){return new original(locales,options);});
 const {messageTime,exactTime,dayLabel}=await import('../src/chat/time');
 const now=new Date(2026,9,21,12).getTime();
 for(let n=0;n<2000;n++){messageTime(now-n*86400000,now);exactTime(now-n*86400000);dayLabel(now-n*86400000,now);}
 expect(factory).toHaveBeenCalledTimes(4);
});
it('does not scan and copy the full history on every live event to find the latest request',async()=>{
 const {observeTask}=await import('../src/diagnostics/tasks');
 let reads=0;const order=Array.from({length:20000},(_,n)=>'m'+n);
 const messages=new Proxy(Object.fromEntries(order.map((id,n)=>[id,{id,role:n===19999?'user':'assistant'}])),{get(target,key){reads++;return Reflect.get(target,key);}});
 const chat={messageOrder:order,messages,taskObservations:{}} as any;
 for(let n=0;n<100;n++)observeTask(chat,{type:'message.part.delta',properties:{sessionID:'s',messageID:'m19998',partID:'p',delta:'x'}},100);
 expect(reads).toBe(100);
});
