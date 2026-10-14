import type { AssistantMessage } from '../api/types';
import type { SessionChatState } from '../state/chatReducer';
import { taskDiagnostics } from '../diagnostics/tasks';
export interface Trial {
  phase:'baseline'|'candidate'; revision:string; caseId:string; engine:string; model:string;
  sessionId:string; messageId:string; skillRead:boolean; passed:boolean; wallMs:number; tokens:number; errors:number;
}
export interface Experiment {
  id:string; scope:string; directory:string|null; path:string; name:string;
  baseline:string; candidate:string; baselinePath:string; candidatePath:string; trials:Trial[]; state:string;
}
const prefix='[Arvela skill trial] ';
export function trialPrompt(e:Experiment, phase:Trial['phase'], scenario:string):string {
  const path=phase==='baseline'?e.baselinePath:e.candidatePath;
  return `${prefix}${JSON.stringify({id:e.id,phase,scenario:scenario.trim()})}\nПрочитай навык ${JSON.stringify(path)} и используй именно эту версию для задачи ниже. Не изменяй пакет навыка.\n\n${scenario.trim()}`;
}
/** Derive evidence only from the current finished turn, never from the agent's claims. */
export function captureTrial(e:Experiment,chat:SessionChatState,engine:string,passed:boolean):Trial {
  const id=[...chat.messageOrder].reverse().find(id=>chat.messages[id]?.role==='user');
  if(!id||chat.status.type!=='idle')throw Error('Выберите завершённый чат испытания.');
  const text=(chat.partsByMessage[id]??[]).map(p=>chat.parts[p]).filter(p=>p?.type==='text').map(p=>p.text??'').join('\n');
  if(!text.startsWith(prefix))throw Error('В этом запросе нет испытания навыка.');
  let meta:{id:string;phase:Trial['phase'];scenario:string};
  try{meta=JSON.parse(text.slice(prefix.length).split('\n')[0]);}catch{throw Error('Повреждена метка испытания.');}
  if(meta.id!==e.id||!['baseline','candidate'].includes(meta.phase)||!meta.scenario?.trim())throw Error('Выбран другой эксперимент.');
  const path=meta.phase==='baseline'?e.baselinePath:e.candidatePath;
  const after=chat.messageOrder.slice(chat.messageOrder.indexOf(id)+1);
  const assistants=after.map(m=>chat.messages[m]).filter((m):m is AssistantMessage=>m?.role==='assistant'&&!m.summary&&(!m.parentID||m.parentID===id));
  const skillRead=assistants.some(m=>(chat.partsByMessage[m.id]??[]).some(pid=>{
    const p=chat.parts[pid],input=p?.state?.input as Record<string,unknown>|undefined;
    return p?.type==='tool'&&['read','read_file'].includes(p.tool??'')&&p.state?.status==='completed'
      && [input?.path,input?.filePath,input?.file_path].includes(path);
  }));
  const d=taskDiagnostics(chat,id),models=[...new Set(assistants.map(m=>`${m.providerID??''}/${m.modelID??''}`))];
  if(!skillRead)throw Error('В ходе работы нет успешного чтения проверяемого SKILL.md.');
  if(!d||!['ended','error'].includes(d.state)||!d.wallMs||!d.usageComplete||d.input==null||d.output==null)
    throw Error('Нет полного измерения времени и токенов. Проведите испытание в открытом приложении.');
  if(models.length!==1||models[0].startsWith('/')||models[0].endsWith('/'))throw Error('Модель испытания не подтверждена или менялась.');
  // Full scenario identity, so differently worded tasks can never form a pair.
  const caseId=meta.scenario.trim();
  if(caseId.length>160)throw Error('Сценарий испытания должен быть короче 160 символов.');
  return {phase:meta.phase,revision:meta.phase==='baseline'?e.baseline:e.candidate,caseId,engine,model:models[0],
    sessionId:chat.messages[id].sessionID,messageId:id,skillRead,passed:passed&&d.state==='ended',wallMs:d.wallMs,
    tokens:d.input+d.output,errors:d.failed+(d.state==='error'?1:0)};
}
