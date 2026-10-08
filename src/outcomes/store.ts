import {redact} from '../hub/records';
export interface OutcomeScope {server:string;directory:string;engine:'opencode'|'pi';sessionID:string}
export type Verdict='unreviewed'|'accepted'|'needs_work';
export interface ReportedCheck {name:string;status:'not_run'|'passed'|'failed';evidence:string}
export interface Assessment {revision:number;goal:string;criteria:string;notes:string;checks:ReportedCheck[];verdict:Verdict}
export interface Outcome extends Assessment {schemaVersion:1;scope:OutcomeScope;messageID:string;id:string;share:boolean;updated:number}
const DATABASE='arvela.task-results.v1',EVENT='arvela-task-results-changed';
const ERROR='Хранилище результатов недоступно. Черновик не сохранён.';
export const scopeKey=(s:OutcomeScope)=>JSON.stringify([s.server,s.directory,s.engine,s.sessionID]);
const identity=(s:OutcomeScope,messageID:string)=>JSON.stringify([scopeKey(s),messageID]);
const facts=(a:Assessment)=>JSON.stringify([a.goal,a.criteria,a.checks,a.notes]);
export function blankOutcome(scope:OutcomeScope,messageID:string,goal:string):Outcome{return {schemaVersion:1,scope,messageID,id:identity(scope,messageID),revision:0,goal:goal.slice(0,4000),criteria:'',notes:'',checks:[],verdict:'unreviewed',share:false,updated:0};}
export function changeOutcome(t:Outcome,patch:Partial<Pick<Outcome,'goal'|'criteria'|'notes'|'checks'|'share'>>):Outcome {
 const next={...t,...patch};return {...next,verdict:facts(next)!==facts(t)?'unreviewed':t.verdict};
}
export function reviewOutcome(t:Outcome,verdict:Verdict):Outcome {
 if(verdict==='accepted'&&(!t.goal.trim()||!t.criteria.trim()))throw Error('Укажите цель и критерии приёмки перед оценкой.');
 return {...t,verdict};
}
function normalize(v:unknown):Outcome {
 const t=v as Outcome;
 const str=(x:unknown,max:number)=>typeof x==='string'&&x.length<=max;
 if(!t||t.schemaVersion!==1||!t.scope||!str(t.scope.server,4096)||!t.scope.server||!str(t.scope.directory,4096)||!['opencode','pi'].includes(t.scope.engine)||!str(t.scope.sessionID,512)||!t.scope.sessionID||!str(t.messageID,512)||!t.messageID||t.id!==identity(t.scope,t.messageID)||!Number.isSafeInteger(t.revision)||t.revision<0||!Number.isSafeInteger(t.updated)||t.updated<0||typeof t.share!=='boolean'||!str(t.goal,4000)||!str(t.criteria,4000)||!str(t.notes,2000)||!['unreviewed','accepted','needs_work'].includes(t.verdict)||!Array.isArray(t.checks)||t.checks.length>8||t.checks.some(c=>!c||!str(c.name,160)||!c.name.trim()||!str(c.evidence,1500)||!['not_run','passed','failed'].includes(c.status)))throw Error('Карточка результата повреждена или превышает лимит. Исходные данные сохранены.');
 return {schemaVersion:1,scope:{server:t.scope.server,directory:t.scope.directory,engine:t.scope.engine,sessionID:t.scope.sessionID},id:t.id,messageID:t.messageID,revision:t.revision,updated:t.updated,share:t.share,goal:t.goal,criteria:t.criteria,notes:t.notes,checks:t.checks.map(c=>({name:c.name,status:c.status,evidence:c.evidence})),verdict:t.verdict};
}
/** Atomic IndexedDB transactions serialize competing windows. No eviction or agent actions. */
export class OutcomeStore {
 private db?:Promise<IDBDatabase>;private factory:IDBFactory|undefined;
 constructor(private name=DATABASE,factory?:IDBFactory){this.factory=arguments.length>1?factory:globalThis.indexedDB;}
 close(){void this.db?.then(d=>d.close()).catch(()=>{});this.db=undefined;}
 private open(){
  if(!this.factory)return Promise.reject<IDBDatabase>(Error(ERROR));
  if(!this.db)this.db=new Promise<IDBDatabase>((resolve,reject)=>{
   const q=this.factory!.open(this.name,1);let settled=false;
   const timer=setTimeout(()=>{settled=true;reject(Error(ERROR));},5000);
   q.onupgradeneeded=()=>{const s=q.result.createObjectStore('cards',{keyPath:'id'});s.createIndex('scope','scopeKey');};
   q.onsuccess=()=>{clearTimeout(timer);if(settled){q.result.close();return;}settled=true;q.result.onversionchange=()=>{q.result.close();this.db=undefined;};resolve(q.result);};
   q.onerror=()=>{clearTimeout(timer);settled=true;reject(Error(ERROR));};
   q.onblocked=()=>{clearTimeout(timer);settled=true;reject(Error('Закройте другое окно Arvela для обновления хранилища.'));};
  }).catch(e=>{this.db=undefined;throw e;});return this.db;
 }
 async list(scope?:OutcomeScope):Promise<Outcome[]> {
  const db=await this.open();return new Promise((resolve,reject)=>{
   const tx=db.transaction('cards','readonly'),s=tx.objectStore('cards'),q=scope?s.index('scope').getAll(scopeKey(scope)):s.getAll();let rows:Outcome[]=[];
   q.onsuccess=()=>{try{if(q.result.length>500)throw Error('Лимит хранилища результатов превышен.');rows=q.result.map(normalize);}catch(e){reject(e);tx.abort();}};
   tx.oncomplete=()=>resolve(rows.sort((a,b)=>b.updated-a.updated));tx.onabort=tx.onerror=()=>reject(Error(ERROR));
  });
 }
 async save(value:Outcome,expected:number|null):Promise<Outcome> {
  const input=normalize(value),db=await this.open();return new Promise((resolve,reject)=>{
   const tx=db.transaction('cards','readwrite'),s=tx.objectStore('cards');let saved:Outcome|undefined,issue:Error|undefined;
   const fail=(e:unknown)=>{issue=e instanceof Error?e:Error(ERROR);tx.abort();};
   const read=s.get(input.id),count=s.count();let old:Outcome|undefined,got=false,total:number|undefined;
   const apply=()=>{if(!got||total===undefined)return;try{
    if((old?.revision??null)!==expected)throw Error('Карточка уже изменена в другом окне. Перечитайте её; ваш черновик сохранён в форме.');
    if(!old&&total>=500)throw Error('Достигнут предел 500 карточек. Существующие карточки сохранены.');
    const next={...input,verdict:old&&facts(old)!==facts(input)?'unreviewed' as const:input.verdict,revision:(old?.revision??0)+1,updated:Date.now()};
    saved=normalize(reviewOutcome(next,next.verdict));s.put({...saved,scopeKey:scopeKey(saved.scope)});
   }catch(e){fail(e);}};
   read.onsuccess=()=>{try{old=read.result?normalize(read.result):undefined;got=true;apply();}catch(e){fail(e);}};count.onsuccess=()=>{total=count.result;apply();};
   tx.oncomplete=()=>{if(!saved){reject(Error(ERROR));return;}globalThis.window?.dispatchEvent(new Event(EVENT));resolve(saved);};
   tx.onabort=tx.onerror=()=>reject(issue??Error(ERROR));
  });
 }
}
export const outcomes=new OutcomeStore();
export function subscribeOutcomes(fn:()=>void){window.addEventListener(EVENT,fn);window.addEventListener('focus',fn);return()=>{window.removeEventListener(EVENT,fn);window.removeEventListener('focus',fn);};}
/** A reported check remains a user report; never invent a verified command/exit code. */
export function sharedAssessment(t:Outcome,textsEnabled:boolean):Assessment|undefined {
 if(!t.share||!textsEnabled)return undefined;
 return {revision:t.revision,verdict:t.verdict,goal:redact(t.goal,4000),criteria:redact(t.criteria,4000),notes:redact(t.notes,2000),checks:t.checks.map(c=>({name:redact(c.name,160),status:c.status,evidence:redact(c.evidence,1500)}))};
}
