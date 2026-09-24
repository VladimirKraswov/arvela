import { platform } from "../native/platform";
import {useEffect,useState} from "react";
import {store,useAppState} from "../state/store";
import {COMPUTER_MCP,computerConfig,computerReadinessError,isLocalComputer,type ComputerStatus} from "../state/computer";
type Document={path:string;content:string};
const err=(e:unknown)=>e instanceof Error?e.message:String(e);
async function invoke<T>(command:string,args?:Record<string,unknown>):Promise<T>{return(await import("@tauri-apps/api/core")).invoke<T>(command,args);}
export function ComputerSettings(){
  const s=useAppState();
  const [status,setStatus]=useState<ComputerStatus|null>(null),[connection,setConnection]=useState("");
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const native="__TAURI_INTERNALS__" in window,local=isLocalComputer(s.prefs.endpoint,!!store.currentHost());
  const running=[...Object.values(s.activityStatuses),...Object.values(s.statuses)].some(x=>x.type!=="idle");
  const refresh=async()=>{
    if(!native)return;
    setStatus(await invoke<ComputerStatus>("computer_status"));
    if(local){try{const m=await store.client.request<Record<string,{status:string}>>("GET","/mcp",{query:{directory:s.directory}});setConnection(m[COMPUTER_MCP]?.status??"not_configured");}catch{setConnection("unavailable");}}
  };
  useEffect(()=>{void refresh().catch(e=>setError(err(e)));},[s.prefs.endpoint,s.directory]);
  const action=async(name:"permissions"|"stop")=>{
    setBusy(true);setError("");setNotice("");
    try{const text=await invoke<string>("computer_action",{action:name});setNotice(name==="stop"?"Управление выключено. Текущие сеансы Cua Driver отозваны; новые действия заблокированы до подключения.":text);await refresh();}
    catch(e){setError(err(e));await refresh().catch(()=>{});}finally{setBusy(false);}
  };
  const apply=async(enabled:boolean)=>{
    if(!status||!local||running||busy)return;
    const client=store.client,directory=s.directory,workspace=s.prefs.workspaceKey??s.prefs.endpoint;
    setBusy(true);setError("");setNotice("");let written=false;
    try{
      const doc=await invoke<Document>("read_opencode_config",{scope:"global",directory:null});
      if(client!==store.client||workspace!==(store.state.prefs.workspaceKey??store.state.prefs.endpoint))throw new Error("Подключение изменилось. Откройте настройки заново.");
      const next=computerConfig(doc.content,status,enabled);
      if(enabled)await invoke("computer_action",{action:"resume"});
      await invoke("computer_set_enabled",{enabled});
      try{await invoke("write_opencode_config",{scope:"global",directory:null,expected:doc.content,content:next.content});written=true;}
      catch(e){if(enabled)await invoke("computer_set_enabled",{enabled:false});throw e;}
      if(enabled){
        const m=await client.request<Record<string,{status:string;error?:string}>>("POST","/mcp",{query:{directory},body:{name:COMPUTER_MCP,config:next.config},timeoutMs:45000});
        if(m[COMPUTER_MCP]?.status!=="connected")throw new Error(m[COMPUTER_MCP]?.error??"MCP не подтвердил подключение");
        const ready=await invoke<ComputerStatus>("computer_status");
        const problem=computerReadinessError(ready);if(problem)throw new Error(problem);
        setNotice("Инструменты подключены к текущему проекту, конфигурация сохранена. Работающий сервер может хранить прежние настройки в памяти: если в другом проекте инструментов нет, нажмите «Подключить» после перехода в него. Навык появится после штатной перезагрузки конфигурации сервера.");
      }else{
        try{await client.request("POST",`/mcp/${COMPUTER_MCP}/disconnect`,{query:{directory}});}catch{/* Native gate already blocks existing connections. */}
        setNotice("Управление выключено для всех подключений Desktop. Остальные инструменты OpenCode сохранены.");
      }
      await refresh();
    }catch(e){if(enabled)await invoke("computer_set_enabled",{enabled:false}).catch(()=>{});setError(`${written?"Конфигурация сохранена с резервной копией, но подключение не завершилось. ":""}${err(e)}`);await refresh().catch(()=>{});}
    finally{setBusy(false);}
  };
  const p=status?.permissions;
  return <section className="computer-settings" aria-label="Управление компьютером">
    <h4>Отдельный курсор агента</h4>
    <p>OpenCode читает интерфейс выбранного окна, видит его снимок, нажимает и вводит текст через Cua Driver. Ваш указатель остаётся свободным. Снимки и текст окон получает выбранная модель.</p>
    {platform()!=="macos"?<p role="status">Cua Driver управляет окнами только на macOS. На этом компьютере интеграция недоступна; остальные инструменты OpenCode работают как обычно.</p>
      :!native?<p>Откройте установленное приложение на Mac.</p>:<>
      <div className="kv"><span>Драйвер</span><b>{status?status.installed?status.version:"Не установлен":"Проверка…"}</b></div>
      <div className="kv"><span>Управление</span><b>{status?.enabled?computerReadinessError(status)?"Не готово":"Включено":"Выключено"}</b></div>
      <div className="kv"><span>OpenCode · текущий проект</span><b>{connection==="connected"?"Подключён":connection==="not_configured"?"Не подключён":connection||"—"}</b></div>
      <div className="kv"><span>Доступность macOS</span><b>{p?.accessibility===true?"Разрешена":p?.accessibility===false?"Нужен доступ":"Не проверена"}</b></div>
      <div className="kv"><span>Запись экрана</span><b>{p?.screen_recording===true?"Разрешена":p?.screen_recording===false?"Нужен доступ":"Не проверена"}</b></div>
      {p?.status==="refused"&&status&&<p role="status">{computerReadinessError(status)}</p>}
      <p className="handoff-note">Окно должно быть на текущем рабочем столе macOS. Фоновые действия поддерживаются не всеми приложениями: если окно требует переднего плана, агент сообщит об этом. Захват вашей мыши, управление всем рабочим столом и скрытая выдача разрешений отключены.</p>
      {!local&&<p role="status">Эта интеграция управляет Mac, на котором открыт Desktop. Для настройки выберите «Этот компьютер» и локальный сервер OpenCode.</p>}
      {running&&<p role="status">Подключение можно менять после завершения агента. Экстренная остановка доступна сейчас.</p>}
      <div className="btn-row computer-actions">
        <button className="btn" disabled={busy} onClick={()=>void refresh().catch(e=>setError(err(e)))}>Проверить</button>
        {status?.installed?<button className="btn" disabled={busy} onClick={()=>void action("permissions")}>Разрешения macOS…</button>:<button className="btn" onClick={()=>void import("@tauri-apps/plugin-opener").then(x=>x.openUrl("https://cua.ai/docs/cua-driver"))}>Установка Cua Driver</button>}
        <button className="btn primary" disabled={busy||running||!local||!status?.installed} onClick={()=>void apply(true)}>Подключить</button>
        <button className="btn" disabled={busy||running||!local||!status?.enabled} onClick={()=>void apply(false)}>Выключить</button>
      </div>
      <div className="computer-stop"><button className="btn" disabled={busy||!status?.installed} onClick={()=>void action("stop")}>Остановить управление Mac</button><small>Выключает новые действия Desktop и отзывает все текущие сеансы Cua Driver на этом Mac. Следующее нажатие «Подключить» заново запускает отозванный драйвер.</small></div>
    </>}
    {error&&<p className="composer-error" role="alert">{error}</p>}{notice&&<p className="settings-notice" role="status">{notice}</p>}
  </section>;
}
