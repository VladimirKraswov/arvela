import {store} from '../state/store';
import {taskScheduler,MAX_MINUTES} from './tasks';
import {chooseOpenCodeModel,choosePiModel} from '../state/modelChoice';
/** Explicit scope; never selects a chat or changes the user's draft/model. */
export async function scheduleCommand(p:Record<string,unknown>) {
 const required=(key:string)=>{const v=p[key];if(typeof v!=='string'||!v.trim())throw Error(`Укажите ${key}`);return v.trim();};
 const directory=required('directory'),sid=required('session_id'),action=required('action');
 const server=store.state.prefs.workspaceKey??store.state.prefs.endpoint,scheduler=taskScheduler();scheduler.refresh();
 const scoped=()=>scheduler.snapshot().filter(t=>t.server===server&&t.directory===directory&&t.sessionID===sid);
 if(action==='list')return {tasks:scoped(),storage:scheduler.status().storage};
 if(['remove','pause','resume'].includes(action)) {
  const id=required('id'),task=scoped().find(t=>t.id===id);if(!task)throw Error('Таймер не найден в этом чате');
  if(action==='remove')scheduler.remove(id);else if(task.enabled!==(action==='resume'))scheduler.toggle(id);
  return {tasks:scoped(),pending:scheduler.status().pending[id]??null};
 }
 if(action!=='create')throw Error('Неизвестное действие расписания');
 const engine=store.engineIdFor(sid,directory),backend=store.engine(engine);
 const session=await backend.getSession(sid,directory);
 if(session.directory!==directory||session.time.archived)throw Error('Чат удалён, архивирован или перенесён');
 const current=()=>server===(store.state.prefs.workspaceKey??store.state.prefs.endpoint)&&store.engineIdFor(sid,directory)===engine;
 if(!current())throw Error('Подключение изменилось, таймер не сохранён');
 const mode=p.mode??'repeat',minutes=p.minutes??15;
 if(!['once','repeat'].includes(String(mode))||!Number.isInteger(minutes)||(minutes as number)<1||(minutes as number)>MAX_MINUTES)throw Error('Интервал: от 1 минуты до 7 дней');
 const existing=scoped().find(t=>t.requestKey===p.request_key);
 if(p.run_at!==undefined&&(typeof p.run_at!=='number'||!Number.isFinite(p.run_at)||(p.run_at<Date.now()&&existing?.runAt!==p.run_at)||p.run_at>Date.now()+MAX_MINUTES*60000))throw Error('Время запуска должно быть в пределах следующих 7 дней');
 const agent=store.state.prefs.agentChoice[`session:${sid}`]??session.agent;
 const targetState={...store.state,directory,activeSessionId:sid};
 const model=p.provider_id!==undefined||p.model_id!==undefined?{providerID:required('provider_id'),modelID:required('model_id')}:
  sid===store.state.activeSessionId&&directory===store.state.directory?store.getModelChoice(engine,directory):
  engine==='opencode'?chooseOpenCodeModel({...store.state,directory,activeSessionId:sid},{projectless:store.isProjectlessDirectory(directory),activeModel:session.model,agentName:agent??null,defaultVariant:()=>null}):
  choosePiModel(targetState,directory);
 if(!model)throw Error('Не удалось определить модель этого чата. Укажите provider_id и model_id');
 const task=scheduler.add({server,directory,sessionID:sid,engine,title:required('title'),prompt:required('prompt'),minutes:minutes as number,mode:mode as 'once'|'repeat',...(p.run_at!==undefined?{runAt:p.run_at as number}:{}),requestKey:required('request_key'),model,agent});
 return {task,notice:'Таймер сохранён на этом устройстве. Работает, пока Enki запущена, в том числе в трее. Полный выход останавливает пробуждения.'};
}
