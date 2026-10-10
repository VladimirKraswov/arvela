import {useEffect,useRef,useState} from 'react';
import {isNative} from '../native/platform';
import {retrievalAvailable} from '../memory/retrieval';
import {connectMap,readMapConnection,previewMap,type ProjectMap} from '../project/map';
export function ProjectMapSection({server,directory}:{server:string;directory:string|null}){
  const [map,setMap]=useState<ProjectMap|null>(null),[query,setQuery]=useState(''),[connection,setConnection]=useState<{ready:boolean;enabled:boolean}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const live=useRef(true),serial=useRef(0);const available=isNative()&&!!directory&&retrievalAvailable(server);
  useEffect(()=>{live.current=true;setMap(null);setConnection(null);setError('');const n=++serial.current;if(available)void readMapConnection(directory!).then(c=>{if(live.current&&n===serial.current)setConnection(c);}).catch(e=>{if(live.current&&n===serial.current)setError(String(e));});return()=>{live.current=false;serial.current++;};},[server,directory,available]);
  const run=async(fn:()=>Promise<void>)=>{const n=++serial.current;setBusy(true);setError('');try{await fn();}catch(e){if(live.current&&n===serial.current)setError(String(e));}finally{if(live.current&&n===serial.current)setBusy(false);}};
  return <section className="outcome-section"><details><summary>Карта проекта</summary>
    {!available?<p className="context-note">{!isNative()?'Карта доступна в установленном Arvela.':!directory?'Откройте папку проекта.':'Карта пока доступна для локальных проектов.'}</p>:<>

      <label className="project-map-query">Поиск<input maxLength={256} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Файл или символ"/></label>
      <div className="outcome-actions"><button className="btn small" disabled={busy||!connection?.ready} onClick={()=>void run(async()=>{const n=serial.current;const value=await previewMap(directory!,query);if(live.current&&n===serial.current)setMap(value);})}>{busy?'Чтение…':map?'Обновить карту':'Показать карту'}</button>
        <button className="btn small ghost" disabled={busy||!connection?.ready} onClick={()=>void run(async()=>{const n=serial.current;const value=await connectMap(directory!,!connection?.enabled);if(live.current&&n===serial.current)setConnection(value);})}>{connection?.enabled?'Отключить для агентов':'Подключить для агентов'}</button></div>
      {connection&&!connection.ready&&<p className="context-note">Установите общие MCP-инструменты в настройках.</p>}
      {connection?.enabled&&<p className="context-note">Агенты получают имена файлов и символов.</p>}
      {map&&<><p className="context-note">Снимок {new Date(map.observedAt).toLocaleTimeString()} · {map.coverage.indexedFiles} файлов · {map.limited?'частичный':'в пределах лимитов'}. После изменений обновите. Символы найдены эвристикой.</p>
        <ul className="context-list project-map-list">{map.entries.map(e=><li key={e.path}><strong>{e.path}</strong>{e.authority&&<small>Инструкции проекта — прочитайте файл</small>}{e.symbols.length>0&&<small>{e.symbols.slice(0,8).map(s=>`${s.name}:${s.line}`).join(' · ')}</small>}{e.truncated&&<small>Прочитан только фрагмент</small>}</li>)}</ul>
        {map.checks.length>0&&<p className="context-note">Проверки ({map.checks[0].path}): {map.checks.map(c=>c.name).join(', ')}. Команды не выполнялись.</p>}
        {!map.entries.length&&<p className="context-note">Совпадений в прочитанной части проекта нет.</p>}</>}
    </>}{error&&<p role="alert" className="context-error">{error}</p>}
  </details></section>;
}
