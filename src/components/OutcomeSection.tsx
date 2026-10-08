import {useEffect,useRef,useState} from 'react';
import {blankOutcome,changeOutcome,outcomes,reviewOutcome,scopeKey,subscribeOutcomes,type Outcome,type OutcomeScope,type ReportedCheck,type Verdict} from '../outcomes/store';
const labels:Record<Verdict,string>={unreviewed:'Не проверено',accepted:'Принято вами',needs_work:'Нужна доработка'};
// Uncommitted forms survive panel close/reopen in this app run. Persisted cards use IndexedDB.
const drafts=new Map<string,{value:Outcome;base:Outcome|null}>();
export function OutcomeSection({scope,requests,onOpen,onPropose}:{scope:OutcomeScope;requests:Array<{id:string;label:string}>;onOpen:(id:string)=>void;onPropose?:(card:Outcome)=>void}){
 const [cards,setCards]=useState<Outcome[]>([]),[selected,setSelected]=useState(''),[value,setValue]=useState<Outcome|null>(null),[base,setBase]=useState<Outcome|null>(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const mounted=useRef(true),current=useRef({selected,value,base});current.current={selected,value,base};
 const dirty=!!value&&JSON.stringify(value)!==JSON.stringify(base);
 const load=async()=>{try{const list=await outcomes.list(scope);if(!mounted.current)return;setCards(list);setReady(true);
  const c=current.current,id=c.selected||requests[requests.length-1]?.id||list[0]?.messageID||'';
  if(!c.selected&&id){const saved=list.find(x=>x.messageID===id)??null,seed=saved??blankOutcome(scope,id,''),draft=drafts.get(seed.id);setSelected(id);setBase(draft?.base??saved);setValue(draft?.value??saved);}
 }catch(e){if(mounted.current){setError(String(e));setReady(false);}}};
 useEffect(()=>{mounted.current=true;void load();const off=subscribeOutcomes(()=>void load());return()=>{mounted.current=false;off();};},[scopeKey(scope)]);
 useEffect(()=>{if(ready&&!selected&&requests.length)void load();},[ready,requests.length]);
 const edit=(patch:Parameters<typeof changeOutcome>[1])=>{if(!value)return;const next=changeOutcome(value,patch);if(!drafts.has(next.id)&&drafts.size>=100){setError('Сохраните или отмените другие черновики карточек (предел 100).');return;}drafts.set(next.id,{value:next,base});setValue(next);setNotice('');};
 const choose=(id:string)=>{if(dirty){setError('Сначала сохраните или отмените изменения текущей карточки.');return;}const saved=cards.find(x=>x.messageID===id)??null,seed=saved??blankOutcome(scope,id,''),draft=drafts.get(seed.id);setSelected(id);setBase(draft?.base??saved);setValue(draft?.value??saved);setError('');setNotice('');};
 const create=()=>{const seed=blankOutcome(scope,selected,'');if(drafts.size>=100&&!drafts.has(seed.id)){setError('Сохраните другие черновики карточек.');return;}drafts.set(seed.id,{value:seed,base:null});setValue(seed);setBase(null);};
 const save=async(verdict?:Verdict)=>{if(!value)return;setBusy(true);setError('');try{const submitted=verdict?reviewOutcome(value,verdict):value,saved=await outcomes.save(submitted,base?.revision??null);drafts.delete(value.id);if(mounted.current){setValue(saved);setBase(saved);setNotice(verdict?'Оценка сохранена.':'Карточка сохранена. Изменённые сведения требуют новой оценки.');await load();}}catch(e){if(mounted.current)setError(String(e));}finally{if(mounted.current)setBusy(false);}};
 const reset=async()=>{setBusy(true);try{const list=await outcomes.list(scope);if(!mounted.current)return;if(value)drafts.delete(value.id);const saved=list.find(x=>x.messageID===selected)??null;setCards(list);setBase(saved);setValue(saved);setError('');setNotice('Сохранённая версия перечитана.');}catch(e){if(mounted.current)setError(String(e));}finally{if(mounted.current)setBusy(false);}};
 const anchors=[...requests];for(const c of cards)if(!anchors.some(x=>x.id===c.messageID))anchors.push({id:c.messageID,label:'Сохранённая карточка · '+c.goal.slice(0,80)});
 const updateCheck=(i:number,patch:Partial<ReportedCheck>)=>edit({checks:value!.checks.map((c,n)=>n===i?{...c,...patch}:c)});
 return <section className="outcome-section" aria-labelledby="outcome-title"><details><summary id="outcome-title">Результат задачи{base?' · '+labels[base.verdict]:''}</summary>
 <p className="context-note">Ваша оценка результата. Ответ агента и успешный вызов инструмента не означают, что задача проверена.</p>
 {!anchors.length?<p className="context-note">Карточку можно добавить после отправки запроса в этом чате.</p>:<>
 <label>Запрос задачи<select aria-label="Запрос задачи" value={selected} disabled={!ready||busy} onChange={e=>choose(e.target.value)}>{anchors.map(x=><option key={x.id} value={x.id}>{x.label||'Запрос'}</option>)}</select></label>
 {selected&&<button className="btn small ghost" onClick={()=>onOpen(selected)}>Перейти к запросу</button>}
 {!value?<button className="btn small" disabled={!ready||busy||!selected} onClick={create}>Добавить карточку</button>:<>
 <label>Цель<textarea aria-label="Цель задачи" maxLength={4000} value={value.goal} disabled={busy} onChange={e=>edit({goal:e.target.value})}/></label>
 <label>Критерии приёмки<textarea aria-label="Критерии приёмки" maxLength={4000} value={value.criteria} disabled={busy} onChange={e=>edit({criteria:e.target.value})}/></label>
 <p className="context-note">Проверки ниже указаны вами; приложение не запускает команды и не подтверждает их исход самостоятельно.</p>
 {value.checks.map((c,i)=><fieldset key={i} disabled={busy}><legend>Проверка {i+1}</legend>
 <label>Название<input aria-label={`Название проверки ${i+1}`} maxLength={160} value={c.name} onChange={e=>updateCheck(i,{name:e.target.value})}/></label>
 <label>Указанный результат<select aria-label={`Результат проверки ${i+1}`} value={c.status} onChange={e=>updateCheck(i,{status:e.target.value as ReportedCheck['status']})}><option value="not_run">Не выполнена</option><option value="passed">Прошла</option><option value="failed">Не прошла</option></select></label>
 <label>Подтверждение / ссылка<textarea aria-label={`Подтверждение проверки ${i+1}`} maxLength={1500} value={c.evidence} onChange={e=>updateCheck(i,{evidence:e.target.value})}/></label>
 <button className="btn small ghost" onClick={()=>edit({checks:value.checks.filter((_,n)=>n!==i)})}>Убрать проверку {i+1}</button></fieldset>)}
 <button className="btn small" disabled={busy||value.checks.length>=8} onClick={()=>edit({checks:[...value.checks,{name:'',status:'not_run',evidence:''}]})}>Добавить проверку</button>
 <label>Итог / замечания<textarea aria-label="Замечания к результату" maxLength={2000} value={value.notes} disabled={busy} onChange={e=>edit({notes:e.target.value})}/></label>
 <label className="outcome-share"><input type="checkbox" checked={value.share} disabled={busy} onChange={e=>edit({share:e.target.checked})}/>Передавать эту карточку в Hub</label>
 <p className="context-note">Передача требует включённой библиотеки и передачи текстов; секреты фильтруются. Уже переданная оценка остаётся до срока хранения. Сохранённые карточки остаются на этом устройстве.</p>
 <div className="outcome-actions"><button className="btn small primary" disabled={!dirty||busy||!ready} onClick={()=>void save()}>Сохранить карточку</button><button className="btn small" disabled={busy} onClick={()=>void reset()}>Перечитать сохранённую</button></div>
 <div className="outcome-actions" aria-label="Оценка результата"><button className="btn small" disabled={!base||dirty||busy} onClick={()=>void save('accepted')}>Принять результат</button><button className="btn small" disabled={!base||dirty||busy} onClick={()=>void save('needs_work')}>Нужна доработка</button><button className="btn small ghost" disabled={!base||dirty||busy||base.verdict==='unreviewed'} onClick={()=>void save('unreviewed')}>Снять оценку</button></div>
 {onPropose&&base?.verdict==='accepted'&&<button className="btn small" disabled={dirty||busy} onClick={()=>onPropose(base)}>Предложить в память проекта</button>}
 {dirty&&<p className="context-note">Есть несохранённые изменения. Черновик сохраняется при закрытии панели до выхода из приложения; прежняя оценка изменённых сведений будет сброшена.</p>}
 </>}
 </>}
 {notice&&<p className="context-note" role="status">{notice}</p>}{error&&<p className="context-error" role="alert">{error}</p>}
 </details></section>;
}
