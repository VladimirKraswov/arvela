import {useEffect,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {store,useAppState} from '../state/store';
import {makeBackup,restoreBackup,type BackupData} from '../operations/backups';
import {maintenance} from '../operations/maintenance';
import {version} from '../../package.json';
interface Release {available:boolean;version?:string;notes?:string}
export function UpdateSettings(){
  const app=useAppState(),[channel,setChannel]=useState(()=>localStorage.getItem('arvela.update.channel')==='preview'?'preview':'stable');
  const [release,setRelease]=useState<Release|null>(null),[downloaded,setDownloaded]=useState(false),[busy,setBusy]=useState(''),[notice,setNotice]=useState(''),[progress,setProgress]=useState(''),[auto,setAuto]=useState(false);
  const [backups,setBackups]=useState<{id:string;version:string}[]>([]),[selected,setSelected]=useState('');
  const running=app.ui.sending||app.ui.workspacePreparing||Object.values({...app.statuses,...app.activityStatuses}).some(s=>s.type!=='idle')
    || Object.keys(app.chat.permissions).length>0||Object.keys(app.chat.questions).length>0||!!app.ui.piDialog;
  const call=<T,>(action:string,extra:Record<string,unknown>={})=>invoke<T>('app_update',{action,channel,data:null,backupId:null,...extra});
  const refresh=()=>call<typeof backups>('backups').then(setBackups);
  useEffect(()=>{void refresh().catch(e=>setNotice(String(e)));let active=true,stop:(()=>void)|undefined;
    void listen<{received:number;total:number|null}>('app-update-progress',e=>{if(active)setProgress(e.payload.total?`${Math.round(e.payload.received/e.payload.total*100)}%`:`${(e.payload.received/1048576).toFixed(1)} МБ`);}).then(fn=>{if(active)stop=fn;else fn();}).catch(()=>{});
    return()=>{active=false;stop?.();};},[]);
  const run=async(action:string,fn:()=>Promise<void>)=>{setBusy(action);setNotice('');try{await fn();}catch(e){setNotice(String(e));setAuto(false);}finally{setBusy('');}};
  const maintain=(action:'install'|'backup'|'restore')=>run(action,()=>maintenance.run(async()=>{
    const s=store.getSnapshot();
    if(s.ui.sending||Object.values({...s.statuses,...s.activityStatuses}).some(s=>s.type!=='idle'))throw Error('Дождитесь завершения агентов.');
    const data=await makeBackup(s.prefs);
    if(action==='restore'){
      const result=await call<{data:BackupData}>('restore',{data,backupId:selected});await restoreBackup(result.data);window.location.reload();
    }else{await call(action,{data});await refresh();setNotice(action==='backup'?'Резервная копия создана.':'Обновление установлено.');}
  }));
  useEffect(()=>{if(auto&&downloaded&&!running&&!busy){setAuto(false);void maintain('install');}},[auto,downloaded,running,busy]);
  return <section className="setting-group quality-settings"><h2>Arvela {version}</h2><label>Канал<select value={channel} disabled={!!busy||auto} onChange={e=>{setChannel(e.target.value);localStorage.setItem('arvela.update.channel',e.target.value);setRelease(null);setDownloaded(false);}}><option value="stable">Стабильный</option><option value="preview">Предварительный</option></select></label>
    <div className="btn-row"><button className="btn" disabled={!!busy} onClick={()=>void run('check',async()=>{setDownloaded(false);const r=await call<Release>('check');setRelease(r);setNotice(r.available?`Доступна версия ${r.version}`:'Установлена актуальная версия.');})}>Проверить обновления</button>
    {release?.available&&!downloaded&&<button className="btn" disabled={!!busy} onClick={()=>void run('download',async()=>{await call('download');setDownloaded(true);setNotice('Подпись пакета проверена.');})}>Скачать {release.version}</button>}
    {downloaded&&<button className="btn primary" disabled={!!busy||auto} onClick={()=>running?setAuto(true):void maintain('install')}>{auto?'Ожидаем завершения агентов':running?'Установить после завершения задач':'Установить и перезапустить'}</button>}
    {auto&&<button className="btn" onClick={()=>setAuto(false)}>Отменить ожидание</button>}</div>
    {busy==='download'&&<p role="status">Загрузка {progress}</p>}{release?.notes&&<p>{release.notes}</p>}
    <h2>Резервные копии</h2><p className="muted">Настройки, очереди и вложения. Истории остаются у агентов. При установке также сохраняется предыдущая версия приложения.</p>
    <button className="btn" disabled={!!busy||running} onClick={()=>void maintain('backup')}>Создать резервную копию</button>
    <label>Копия<select value={selected} onChange={e=>setSelected(e.target.value)} disabled={!!busy}><option value="">Выберите копию</option>{backups.map(b=><option key={b.id} value={b.id}>{new Date(Number(b.id.slice(7))).toLocaleString()} · {b.version}</option>)}</select></label>
    <button className="btn" disabled={!!busy||running||!selected} onClick={()=>void maintain('restore')}>Восстановить и перезапустить</button>
    {notice&&<p role="status">{notice}</p>}
  </section>;
}
