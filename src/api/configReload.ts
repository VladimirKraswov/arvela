import {runEventStream,globalEventStreamUrl,type GlobalEvent} from './events';
import type {OpenCodeClient} from './client';
/** A PATCH acknowledgement precedes engine disposal. Never dispatch a prompt until
 * the server confirms the asynchronous reload has finished. No prompt retry here. */
export async function applyGlobalPlugins(client:OpenCodeClient,plugins:string[],current:()=>boolean) {
 const controller=new AbortController();
 let armed=false;
 let open!:()=>void,done!:()=>void,fail!:(error:Error)=>void;
 const ready=new Promise<void>(resolve=>{open=resolve;});
 const disposed=new Promise<void>((resolve,reject)=>{done=resolve;fail=reject;});
 // Install a rejection handler before awaiting stream startup.
 void disposed.catch(()=>{});
 const timer=setTimeout(()=>{fail(Error('OpenCode не подтвердил перезагрузку настроек. Запрос агенту не отправлен.'));controller.abort();},20000);
 const stream=runEventStream<GlobalEvent>({url:globalEventStreamUrl(client.baseUrl),headers:client.headers,signal:controller.signal,
  onState:state=>{if(['error','reconnecting','closed'].includes(state)&&!controller.signal.aborted){fail(Error('Соединение с OpenCode изменилось при обновлении настроек.'));controller.abort();}},
  onEvent:event=>{if(event.payload?.type==='server.connected')open();if(armed&&event.directory==='global'&&event.payload?.type==='global.disposed')done();},
 });
 try{
  await Promise.race([ready,disposed]);
  if(!current())throw Error('Рабочее пространство изменилось.');
  armed=true;
  await client.request('PATCH','/global/config',{body:{plugin:plugins},timeoutMs:10000});
  await disposed;
  if(!current())throw Error('Рабочее пространство изменилось.');
 }finally{clearTimeout(timer);controller.abort();await stream;}
}
