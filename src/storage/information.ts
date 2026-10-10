import type {Session} from '../api/types';
export interface SessionStorage {path:string;bytes:number;messages?:number;kind:'file'|'payload'}
export interface InformationRow {session:Session;engine:'OpenCode'|'Pi';storage?:SessionStorage}
export function formatBytes(bytes:number):string {
 if(!Number.isFinite(bytes)||bytes<0)return 'Недоступно';
 const units=['Б','КБ','МБ','ГБ','ТБ'];let unit=0;while(bytes>=1024&&unit<units.length-1){bytes/=1024;unit++;}
 return `${bytes.toLocaleString('ru',{maximumFractionDigits:unit?1:0})} ${units[unit]}`;
}
export function informationTotals(rows:InformationRow[]){
 const known=rows.filter(row=>row.storage);return {bytes:known.reduce((sum,row)=>sum+row.storage!.bytes,0),known:known.length,total:rows.length};
}
export async function projectSessionIndex(directory:string,signal:AbortSignal,page:(archived:boolean,cursor:number|undefined,signal:AbortSignal,directory:string)=>Promise<{sessions:Session[];cursor:number|null}>):Promise<Session[]> {
 const rows=new Map<string,Session>();
 for(const archived of [false,true]){
  let cursor:number|undefined;const seen=new Set<number>();
  for(let count=0;count<100;count++){
   signal.throwIfAborted();const result=await page(archived,cursor,signal,directory);
   for(const session of result.sessions)if(session.directory===directory)rows.set(session.id,session);
   if(result.cursor===null)break;
   if(seen.has(result.cursor))throw new Error('Сервер повторил страницу списка сессий');
   seen.add(result.cursor);cursor=result.cursor;
   if(count===99)throw new Error('Список слишком большой. Откройте сведения отдельной сессии.');
  }
 }
 return [...rows.values()].sort((a,b)=>b.time.updated-a.time.updated);
}
