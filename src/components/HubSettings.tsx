import { useEffect, useRef, useState } from "react";
import { config, drain, emptyConfig, install, request, spool, type HubConfig, type HubItem, type Spool } from "../hub/client";
import { assessmentIndex, attachAssessment } from "../outcomes/sharing";
import { record } from "../hub/records";
import { usageSources } from "../usage/sources";
import { store } from "../state/store";
import { openUrl } from "@tauri-apps/plugin-opener";
export function HubSettings({onDirtyChange}:{onDirtyChange?:(v:boolean)=>void}){
 const [value,setValue]=useState<HubConfig>(emptyConfig),[saved,setSaved]=useState<HubConfig>(emptyConfig),[key,setKey]=useState("");
 const [items,setItems]=useState<HubItem[]>([]),[status,setStatus]=useState<Spool|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(""),[error,setError]=useState(""),[ready,setReady]=useState(false);
 const cancel=useRef<AbortController|null>(null),mounted=useRef(true);
 const dirty=ready&&(JSON.stringify(value)!==JSON.stringify(saved)||!!key);
 useEffect(()=>{mounted.current=true;void config().then(c=>{if(mounted.current){setValue(c);setSaved(c);setReady(true);}}).catch(e=>setError(String(e)));return()=>{mounted.current=false;cancel.current?.abort();};},[]);
 useEffect(()=>{onDirtyChange?.(dirty);return()=>onDirtyChange?.(false);},[dirty,onDirtyChange]);
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError("");setNotice("");try{await fn();}catch(e){if(mounted.current)setError(String(e));}finally{if(mounted.current)setBusy(false);}};
 async function refresh(){const d=await request<{items:HubItem[]}>("catalog");if(mounted.current){setItems(d.items);setStatus(await spool("read"));}}
 async function backfill(){const controller=new AbortController();cancel.current=controller;let count=0,failures=0;
  try{const assessments=await assessmentIndex(),server=store.state.prefs.workspaceKey??store.state.prefs.endpoint;for(const source of usageSources()){
   const sessions=(await source.sessions(controller.signal)).filter(s=>s.time.updated>Date.now()-30*86400000).slice(0,500);
   for(const session of sessions){controller.signal.throwIfAborted();let before:string|undefined;const seen=new Set<string>();
    try{for(let page=0;page<20;page++){controller.signal.throwIfAborted();const d=await source.messages(session,before,controller.signal),batch=d.messages.map(m=>attachAssessment(record(source.engine==="Pi"?"pi":"opencode",session,m.info,m.parts,saved.shareText),assessments,server,session.directory??"",saved.shareText)).filter(x=>x!==null);
     for(let i=0;i<batch.length;i+=50)await spool("enqueue",batch.slice(i,i+50));
     for(let i=0;i<Math.ceil(batch.length/20);i++)await drain();count+=batch.length;if(mounted.current)setNotice(`Обработано сообщений: ${count}; ошибок чтения: ${failures}`);
     if(!d.before||seen.has(d.before))break;before=d.before;seen.add(before);
    }}catch(e){if(controller.signal.aborted)throw e;failures++;}
   }
  }if(mounted.current){const queued=await spool("read");setStatus(queued);setNotice(`Обработано ${count} сообщений; ${failures} сессий с ошибкой; в очереди: ${queued.pending}. Предел: 500 сессий / 20 страниц на агент.`);}
  }finally{cancel.current=null;}
 }
 return <div className="hub-settings"><p className="settings-intro">Общая библиотека и история для ваших устройств. OpenCode и Pi используют существующие адаптеры навыков и MCP; облако хранит пакеты и опыт работы.</p>
 <section className="settings-group"><h2>Подключение</h2><div className="settings-card hub-card">
 <label>Адрес сервиса HTTPS<input aria-label="Адрес библиотеки" placeholder="https://arvela-hub.local:8443" value={value.endpoint} onChange={e=>setValue({...value,endpoint:e.target.value})}/></label>
 <label>Публичный сертификат PEM<textarea aria-label="Сертификат библиотеки" spellCheck={false} placeholder="-----BEGIN CERTIFICATE-----" value={value.certificate} onChange={e=>setValue({...value,certificate:e.target.value})}/></label>
 <p className="settings-muted">Проверка сертификата действует только для этого сервиса. Общесистемное доверие не меняется. Импортируйте публичный сертификат, полученный от администратора.</p>
 <label>Ключ этого устройства<input aria-label="Ключ библиотеки" type="password" autoComplete="off" value={key} placeholder="Пусто — сохранить существующий ключ" onChange={e=>setKey(e.target.value)}/></label>
 <p className="settings-muted">Ключ хранится в системной связке ключей. Каждое устройство получает отдельный ключ через Web UI сервиса.</p>
 <label className="hub-toggle"><input type="checkbox" checked={value.enabled} onChange={e=>setValue({...value,enabled:e.target.checked})}/>Подключить библиотеку и передавать метрики</label>
 <label className="hub-toggle"><input type="checkbox" checked={value.shareText} onChange={e=>setValue({...value,shareText:e.target.checked})}/>Передавать тексты запросов и итоговых ответов</label>
 <p className="settings-muted">Перед передачей удаляются известные форматы ключей и паролей. Фильтрация не гарантирует удаления всех секретов. Файлы, скриншоты, рассуждения и полные выводы инструментов не передаются. Тексты ограничены 16 000 символами. Отключение передачи текстов очищает текущую очередь.</p>
 <div className="settings-actions"><button className="btn" disabled={!dirty||busy} onClick={()=>{setValue(saved);setKey("");}}>Отменить</button><button className="btn primary" disabled={!ready||busy||!dirty} onClick={()=>void run(async()=>{const c=await config(value,key||undefined,saved);setValue(c);setSaved(c);setKey("");if(c.enabled){const me=await request<{name:string}>("me");await refresh();setNotice(`Подключено: ${me.name}`);}else setNotice("Передача отключена.");})}>Сохранить и проверить</button></div>
 </div></section>
 <section className="settings-group"><h2>Библиотека</h2><div className="settings-actions"><button className="btn" disabled={!saved.enabled||dirty||busy} onClick={()=>void run(refresh)}>Обновить каталог</button><button className="btn" disabled={!saved.endpoint||dirty} onClick={()=>void run(()=>openUrl(saved.endpoint))}>Открыть Web UI</button></div>
 {!items.length&&<p className="settings-muted">Загрузите каталог, чтобы выбрать пакеты для этого устройства. Выбранные навыки, промпты и шаблоны обновляются в фоне, когда агенты не работают. MCP добавляется выключенным; его секреты и включение настраиваются отдельно.</p>}
 {items.filter(x=>x.enabled).map(item=><article className="capability-skill" key={item.id}><div className="capability-item"><div><strong>{item.title}</strong><p>{item.description}</p><small>{item.kind} · {item.revision.slice(0,12)} {saved.installed[item.id]===item.revision?"· установлено":""}</small></div><button className="btn" disabled={busy||dirty} onClick={()=>void run(async()=>{const pkg=await install(item);const c=await config();setSaved(c);setValue(c);setNotice(`Пакет сохранён: ${pkg.path}. Навыки доступны обоим агентам при следующей отправке.`);})}>Скачать / применить</button></div>
 {(item.kind==="prompt"||item.kind==="runbook")&&<button className="btn" disabled={busy||dirty} onClick={()=>void run(async()=>{const pkg=await install(item),text=Object.values(pkg.manifest.files).join("\n\n");store.setDraft([store.getDraft(),text].filter(Boolean).join("\n\n"));setNotice("Добавлено в черновик текущего чата. Сообщение не отправлено.");})}>Добавить в черновик</button>}</article>)}
 </section><section className="settings-group"><h2>Передача истории</h2><p className="settings-muted">Новые и открытые сообщения передаются автоматически. Очередь на диске ограничена 1 200 сообщениями / 12 МиБ; при переполнении удаляются самые старые. Недоступность облака не блокирует чат. Повторная передача не увеличивает токены.</p>
 <div className="settings-actions"><button className="btn" disabled={!saved.enabled||dirty||busy} onClick={()=>void run(async()=>setStatus(await drain()))}>Передать очередь</button><button className="btn" disabled={!saved.enabled||dirty||busy} onClick={()=>void run(backfill)}>Импортировать историю за 30 дней</button>{busy&&cancel.current&&<button className="btn" onClick={()=>cancel.current?.abort()}>Остановить импорт</button>}<button className="btn" disabled={busy} onClick={()=>void run(async()=>setStatus(await spool("clear")))}>Очистить очередь</button></div>
 {status&&<p className="settings-muted">В очереди: {status.pending} · Удалено при переполнении: {status.dropped}</p>}
 <p className="settings-muted">Токены относятся к фактической модели ответа. Рассуждения уже входят в выход. Устройство в отчёте — первое, загрузившее сообщение; повторный просмотр с другого компьютера не добавляет токены. Дни в облачных графиках — UTC.</p></section>
 {notice&&<p role="status" className="settings-notice">{notice}</p>}{error&&<p role="alert" className="settings-error">{error}</p>}
 </div>;
}
