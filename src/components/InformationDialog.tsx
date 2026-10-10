import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {Session} from '../api/types';
import {store,useAppState} from '../state/store';
import {piBridge,isNativeHost} from '../agent/pi/native';
import {formatBytes,informationTotals,projectSessionIndex,type InformationRow} from '../storage/information';
import {CopyButton} from './CopyButton';
import {pathBasename} from '../util/paths';

export function InformationDialog({directory,session,onClose}:{directory:string;session?:Session;onClose:()=>void}){
 const state=useAppState(),scope=JSON.stringify([state.prefs.endpoint,state.prefs.activeHost,state.prefs.workspaceKey]);
 const original=useRef(scope),dialog=useRef<HTMLDialogElement>(null),focus=useRef(document.activeElement as HTMLElement|null);
 const [rows,setRows]=useState<InformationRow[]>([]),[errors,setErrors]=useState<string[]>([]),[loading,setLoading]=useState(true),[query,setQuery]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{dialog.current?.showModal();return()=>{dialog.current?.close();if(focus.current?.isConnected)focus.current.focus();};},[]);
 useEffect(()=>{if(scope!==original.current)onClose();},[scope,onClose]);
 useEffect(()=>{
  const controller=new AbortController(),backend=store.backend;let active=true;
  setRows([]);setErrors([]);setLoading(true);
  void (async()=>{
   const warnings:string[]=[];const remote=(state.prefs.activeHost??'local')!=='local';
   const result:InformationRow[]=[];
   const jobs:Promise<void>[]=[];
   if(!session||!(session.projectID==='pi'||store.isPiSession(session.id)))jobs.push((async()=>{
    try{
     const client=store.client;
     const sessions=session?[session]:await projectSessionIndex(directory,controller.signal,(...args)=>client.usageSessionsPage(...args));
     const items:InformationRow[]=sessions.map(session=>({session,engine:'OpenCode'}));
     if(!remote&&isNativeHost()&&items.length){
      try{
       const {invoke}=await import('@tauri-apps/api/core');
       const info=await invoke<{path:string;sessions:{id:string;bytes:number;messages:number}[]}>('session_storage',{directory,ids:items.map(row=>row.session.id)});
       for(const item of items){const size=info.sessions.find(s=>s.id===item.session.id);if(size)item.storage={path:info.path,bytes:size.bytes,messages:size.messages,kind:'payload'};}
      }catch{warnings.push('Размеры OpenCode недоступны: локальная база не найдена, занята или имеет другой формат.');}
     }
     if(remote)warnings.push('Размеры истории на удалённом компьютере недоступны.');
     result.push(...items);
    }catch{warnings.push('Не удалось получить список OpenCode.');}
   })());
   if(!remote&&(!session||(session.projectID==='pi'||store.isPiSession(session.id))))jobs.push((async()=>{
    try{
     const sessions=session?[session]:await store.engine('pi').listSessions(directory);
     const files=await piBridge().sessions(directory);
     for(const sess of sessions){const file=files.find(f=>f.id===sess.id&&f.cwd===directory);result.push({session:sess,engine:'Pi',storage:file&&file.bytes!==undefined?{path:file.file,bytes:file.bytes,kind:'file'}:undefined});}
    }catch{warnings.push('Не удалось получить сведения Pi.');}
   })());
   await Promise.all(jobs);
   if(active&&!controller.signal.aborted){
    if(backend!==store.backend){setErrors(['Подключение изменилось. Обновите сведения.']);setLoading(false);return;}
    setRows(result.sort((a,b)=>b.session.time.updated-a.session.time.updated));setErrors(warnings);setLoading(false);
   }
  })();return()=>{active=false;controller.abort();};
 },[directory,session,scope,revision]);
 if(scope!==original.current)return null;
 const totals=informationTotals(rows),filtered=rows.filter(row=>row.session.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
 const date=(value:number)=>new Date(value).toLocaleString('ru');
 return createPortal(<dialog ref={dialog} className="information-dialog" aria-label={session?'Сведения о сессии':'Сведения о проекте'} onCancel={event=>{event.preventDefault();onClose();}}>
  <header><h3>{session?'Сведения о сессии':'Сведения о проекте'}</h3><button className="btn small" onClick={onClose}>Закрыть</button></header>
  <div className="information-body"><h4>{session?.title??pathBasename(directory)}</h4>
   <div className="information-path"><span>{directory}</span><CopyButton text={directory} label="Копировать путь проекта" compact/></div>
   {!session&&<div className="information-summary"><span>Сессии: <b>{rows.length}</b></span><span>Данные чатов: <b>{loading?'…':totals.known?formatBytes(totals.bytes):'Недоступно'}</b>{totals.known<totals.total&&totals.known>0&&` (${totals.known} из ${totals.total})`}</span><span>В архиве: {rows.filter(r=>r.session.time.archived).length}</span></div>}
   {loading&&<p role="status">Загрузка сведений…</p>}
   {errors.map(error=><p key={error} role="alert" className="error-text">{error}</p>)}
   {!loading&&<button className="btn small" onClick={()=>setRevision(v=>v+1)}>Обновить</button>}
   {rows.some(row=>row.storage?.kind==='payload')&&<p className="information-note">OpenCode: размер записей сообщений и частей в общей базе, без индексов и свободного места. Pi: размер файла истории. Внешние вложения и файлы проекта не учитываются.</p>}
   {!session&&<input type="search" aria-label="Найти сессию" placeholder="Найти сессию" value={query} onChange={event=>setQuery(event.target.value)}/>}
   {!loading&&!filtered.length&&<p>Сессий не найдено.</p>}
   <div className="information-list">{filtered.map(row=><section key={`${row.engine}:${row.session.id}`}><h4>{row.session.title}</h4>
    <div className="information-summary"><span>{row.engine}{row.session.agent?` · ${row.session.agent}`:''}</span><b>{row.storage?formatBytes(row.storage.bytes):'Размер недоступен'}</b><span>{row.session.time.archived?'Архив':'Не в архиве'}</span></div>
    <dl><dt>Создана</dt><dd>{date(row.session.time.created)}</dd><dt>Изменена</dt><dd>{date(row.session.time.updated)}</dd>
    {row.storage?.messages!==undefined&&<><dt>Сообщений</dt><dd>{row.storage.messages}</dd></>}
    {row.session.model&&<><dt>Модель</dt><dd>{row.session.model.id}</dd></>}
    {row.session.tokens&&<><dt>Токены</dt><dd>Вход: {(row.session.tokens.input??0).toLocaleString('ru')} · Выход: {(row.session.tokens.output??0).toLocaleString('ru')} · Рассуждения: {(row.session.tokens.reasoning??0).toLocaleString('ru')}</dd></>}
    {row.session.parentID&&<><dt>Родительская сессия</dt><dd>{row.session.parentID}</dd></>}
    <dt>ID</dt><dd className="information-path"><span>{row.session.id}</span><CopyButton text={row.session.id} label="Копировать ID сессии" compact/></dd>
    {row.storage&&<><dt>{row.storage.kind==='file'?'Файл истории':'Общая база'}</dt><dd className="information-path"><span>{row.storage.path}</span><CopyButton text={row.storage.path} label="Копировать путь истории" compact/></dd></>}
    </dl>
   </section>)}</div>
  </div>
 </dialog>,document.body);
}
