import {applyEdits,modify} from 'jsonc-parser';
import {parseConfig} from '../state/configEditor';
import {isAbsoluteLocalPath} from '../util/paths';
import {managedPlugins,type ManagedPluginPaths} from '../util/managedPlugins';
export type PolicyRequest=(method:'GET',path:string,options:{query:{directory:string;limit?:number;archived?:boolean};timeoutMs:number})=>Promise<unknown>;
type Invoke=<T>(command:string,args?:Record<string,unknown>)=>Promise<T>;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function plugins(v:unknown):string[]{if(!Array.isArray(v)||!v.every(p=>typeof p==='string'))throw Error('Не удалось проверить расширения OpenCode.');return v;}
const busy=()=>Error('Обновление политики доступа ожидает завершения задач в OpenCode. Сообщение сохранено; повторите отправку после завершения задач.');
/** Legacy status is per directory; v2 active drains alone do not cover v1 agents.
 * Enumerate bounded metadata, then check every known directory. Unknown or incomplete
 * inventory fails closed rather than disposing another project's active instance. */
export async function assertEngineIdle(request:PolicyRequest,directory:string,current:()=>boolean){
 const check=()=>{if(!current())throw Error('Рабочее пространство изменилось.');};
 const dirs=new Set([directory]);
 for(const archived of [false,true]){
  check();const rows=await request('GET','/experimental/session',{query:{directory,limit:1000,archived},timeoutMs:10000});
  if(!Array.isArray(rows)||rows.length>=1000)throw Error('Не удалось полностью проверить задачи OpenCode. Перезагрузите настройки, когда все задачи завершатся.');
  for(const row of rows){if(!object(row)||typeof row.id!=='string'||typeof row.directory!=='string'||!isAbsoluteLocalPath(row.directory))throw Error('Некорректный список задач OpenCode.');dirs.add(row.directory);}
 }
 const active=async()=>{check();const value=await request('GET','/api/session/active',{query:{directory},timeoutMs:10000});if(!object(value)||!object(value.data))throw Error('OpenCode не поддерживает проверку активных задач.');if(Object.keys(value.data).length)throw busy();};
 await active();
 const list=[...dirs];
 for(let i=0;i<list.length;i+=4){check();await Promise.all(list.slice(i,i+4).map(async directory=>{
  const statuses=await request('GET','/session/status',{query:{directory},timeoutMs:10000});
  if(!object(statuses))throw Error('Не удалось проверить состояние задач OpenCode.');
  if(Object.values(statuses).some(s=>!object(s)||(s.type??s.status)!=='idle'))throw busy();
 }));}
 await active();check();
}
const flights=new Map<string,Promise<boolean>>();
/** OpenCode caches global configuration beyond scoped instance disposal. Its
 * official PATCH invalidates it but disposes ALL instances, so require whole-engine
 * idle and a completion event. Native CAS staging preserves unrelated JSONC fields. */
export async function refreshGlobalPolicy(o:{endpoint:string;directory:string;paths:ManagedPluginPaths;current:()=>boolean;request:PolicyRequest;invoke:Invoke;apply:(plugins:string[])=>Promise<void>}){
 if(flights.has(o.endpoint))return flights.get(o.endpoint)!;
 const work=(async()=>{
  const value=await o.request('GET','/global/config',{query:{directory:o.directory},timeoutMs:10000});
  if(!object(value))throw Error('Не удалось прочитать настройки OpenCode.');
  const cached=plugins(value.plugin??[]),expected=managedPlugins(cached,o.paths,{access:true,browser:false});
  if(JSON.stringify(cached)===JSON.stringify(expected))return false;
  await assertEngineIdle(o.request,o.directory,o.current);
  const doc=await o.invoke<{content:string}>('read_opencode_config',{scope:'global',directory:null});
  const parsed=parseConfig(doc.content),next=managedPlugins(plugins(parsed.plugin??[]),o.paths,{access:true,browser:false});
  // A semantically unchanged PATCH does not invalidate the engine cache. Stage only
  // the owned plugin field using different whitespace so the official API performs
  // one real write/invalidation even after an earlier native file migration.
  const staged=applyEdits(doc.content,modify(doc.content,['plugin'],next,{formattingOptions:{insertSpaces:true,tabSize:1,eol:'\n'}}));
  if(!o.current())throw Error('Рабочее пространство изменилось.');
  if(staged!==doc.content)await o.invoke('write_opencode_config',{scope:'global',directory:null,expected:doc.content,content:staged});
  if(!o.current())throw Error('Рабочее пространство изменилось.');
  await o.apply(next);
  return true;
 })();
 flights.set(o.endpoint,work);
 try{return await work;}finally{if(flights.get(o.endpoint)===work)flights.delete(o.endpoint);}
}
