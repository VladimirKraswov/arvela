import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {attachmentBlob,imageThumbnail,previewKind,type AttachmentSource} from '../attachments/preview';
import {Icon} from './Icon';
import {safeLabel} from '../state/taskContext';
import {store,useAppState} from '../state/store';
import {PdfPreview} from './PdfPreview';
export function AttachmentThumbnail({file}:{file:AttachmentSource}){
 const [failed,setFailed]=useState(false),src=imageThumbnail(file);
 useEffect(()=>setFailed(false),[src]);
 return <span className="attachment-thumbnail">{src&&!failed?<img src={src} alt="" loading="lazy" onError={()=>setFailed(true)}/>:<Icon name="file" size={20}/>}</span>;
}
export function AttachmentViewer({files,initialKey,onClose,loadMore,loading,hasMore,historyError,loadAll,historyCursor}:{files:AttachmentSource[];initialKey?:string;onClose:()=>void;loadMore?:()=>void;loading?:boolean;hasMore?:boolean;historyError?:string|null;loadAll?:boolean;historyCursor?:string|null}){
 const state=useAppState();const scope=JSON.stringify([state.prefs.endpoint,state.directory,state.activeSessionId]);
 const firstScope=useRef(scope),dialog=useRef<HTMLDialogElement>(null),prior=useRef(document.activeElement as HTMLElement|null);
 const [selected,setSelected]=useState(initialKey??files[0]?.key),[query,setQuery]=useState('');
 const file=files.find(f=>f.key===selected)??files[0];const filtered=files.filter(f=>f.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
 useEffect(()=>{const d=dialog.current;d?.showModal();return()=>{d?.close();prior.current?.isConnected&&prior.current.focus();};},[]);
 useEffect(()=>{if(scope!==firstScope.current)onClose();},[scope,onClose]);
 const pages=useRef(0), lastCursor=useRef<string|null>(null);
 useEffect(()=>{if(loadAll&&hasMore&&historyCursor&&lastCursor.current!==historyCursor&&!loading&&!historyError&&pages.current<100){lastCursor.current=historyCursor;pages.current++;loadMore?.();}},[loadAll,hasMore,loading,historyError,historyCursor,loadMore]);
 useEffect(()=>{if(files.length&&!files.some(f=>f.key===selected))setSelected(files[0].key);},[files,selected]);
 const move=(delta:number)=>{const index=files.findIndex(f=>f.key===selected);const next=files[index+delta];if(next)setSelected(next.key);};
 if(scope!==firstScope.current)return null;
 return createPortal(<dialog ref={dialog} className="attachment-viewer" aria-label="Файлы сессии" onKeyDown={e=>{if(e.key==="Escape")e.stopPropagation();}} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===dialog.current){const r=dialog.current.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onClose();}}}>
  <header><strong>Источники · {files.length}{loading?" · Загрузка…":""}</strong><button className="icon-btn" aria-label="Закрыть просмотр файлов" onClick={onClose}><Icon name="close"/></button></header>
  <div className="attachment-viewer-body"><aside aria-label="Список файлов"><input type="search" aria-label="Найти файл" placeholder="Найти файл…" value={query} onChange={e=>setQuery(e.target.value)}/><div className="attachment-gallery">{filtered.map(f=><button key={f.key} className="attachment-gallery-item" aria-pressed={selected===f.key} onClick={()=>setSelected(f.key)}><AttachmentThumbnail file={f}/><span title={safeLabel(f.name)}>{safeLabel(f.name)}</span></button>)}</div>{!filtered.length&&<p>Файлов нет.</p>}{hasMore&&<button className="btn small" disabled={loading} onClick={loadMore}>{loading?'Загрузка…':'Загрузить более ранние вложения'}</button>}{historyError&&<p role="alert">{historyError}</p>}</aside>
  <section className="attachment-preview"><div className="attachment-preview-toolbar"><span title={file?.name}>{file?safeLabel(file.name):'Выберите файл'}</span><button className="icon-btn" aria-label="Предыдущий файл" disabled={files.findIndex(f=>f.key===selected)<=0} onClick={()=>move(-1)}><Icon name="chevron" style={{transform:'rotate(180deg)'}}/></button><button className="icon-btn" aria-label="Следующий файл" disabled={files.findIndex(f=>f.key===selected)>=files.length-1} onClick={()=>move(1)}><Icon name="chevron"/></button></div>{file&&<FilePreview key={file.key} file={file} remote={!!store.currentHost()}/>}</section></div>
 </dialog>,document.body);
}
function FilePreview({file,remote}:{file:AttachmentSource;remote:boolean}){
 const [data,setData]=useState<{blob:Blob;url:string;text?:string}|null>(null),[error,setError]=useState(''),[zoom,setZoom]=useState(1);const kind=previewKind(file.mime);
 useEffect(()=>{let active=true,url='';setData(null);setError('');void attachmentBlob(file,remote).then(async blob=>{let text:string|undefined;if(kind==='text')text=await blob.slice(0,200000).text();if(!active)return;url=URL.createObjectURL(blob);setData({blob,url,text});}).catch(()=>{if(active)setError('Не удалось открыть файл. Он может быть удалён или недоступен.');});return()=>{active=false;if(url)URL.revokeObjectURL(url);};},[file.url,file.mime,remote,kind]);
 if(error)return <p role="alert" className="attachment-preview-empty">{error}</p>;
 if(!data)return <p role="status" className="attachment-preview-empty">Загрузка…</p>;
 return <><div className="attachment-preview-meta"><span>{(data.blob.size/1024).toLocaleString('ru',{maximumFractionDigits:1})} КБ</span>{kind==='image'&&<><button className="btn small" disabled={zoom<=.5} onClick={()=>setZoom(v=>Math.max(.5,v-.25))}>−</button><button className="btn small" onClick={()=>setZoom(1)}>Вписать</button><button className="btn small" disabled={zoom>=4} onClick={()=>setZoom(v=>Math.min(4,v+.25))}>+</button></>}</div><div className={`attachment-preview-content ${kind}`}>
 {kind==='image'?<img src={data.url} alt={safeLabel(file.name)} style={{width:zoom===1?undefined:`${zoom*100}%`,maxWidth:zoom===1?'100%':'none',maxHeight:zoom===1?'100%':'none'}} onError={()=>setError('Изображение повреждено или не поддерживается.')}/>:kind==='pdf'?<PdfPreview blob={data.blob}/>:kind==='text'?<><pre>{data.text}</pre>{data.blob.size>200000&&<p>Показаны первые 200 КБ.</p>}</>:kind==='audio'?<audio controls src={data.url}/>:kind==='video'?<video controls src={data.url}/>:<p>Предпросмотр этого формата недоступен.</p>}
 </div></>;
}
