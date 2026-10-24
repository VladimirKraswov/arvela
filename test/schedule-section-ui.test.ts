// @vitest-environment jsdom
import {it,expect,vi,afterEach} from 'vitest';
import {createElement,act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {ScheduleSection} from '../src/components/ScheduleSection';
import {TaskScheduler,type NewScheduledTask} from '../src/schedules/tasks';
vi.mock('../src/state/store',()=>({store:{engineIdFor:()=> 'opencode',getModelChoice:()=>({providerID:'p',modelID:'m'}),getAgentChoice:()=>null}}));
let root:Root|undefined;
afterEach(()=>{act(()=>root?.unmount());document.body.innerHTML='';vi.unstubAllGlobals();});
it('lists timers across chats and pauses/deletes the exact row without dispatching work',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const values=new Map<string,string>(),scheduler=new TaskScheduler({getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);}});
 const input:NewScheduledTask={server:'local',directory:'/p',sessionID:'s',engine:'opencode',title:'Проверить CI',prompt:'Проверь CI',minutes:5,model:{providerID:'p',modelID:'m'}};
 const a=scheduler.add(input);scheduler.add({...input,sessionID:'other',title:'Напомнить через час',mode:'once',minutes:60});
 const node=document.createElement('div');document.body.append(node);root=createRoot(node);
 await act(async()=>root!.render(createElement(ScheduleSection,{scheduler,server:'local',directory:'/p',sessionID:'s',showAll:true})));
 expect(node.querySelectorAll('.context-task')).toHaveLength(2);expect(node.textContent).toContain('Один раз');expect(node.textContent).toContain('Каждые 5 мин');
 const row=node.querySelector('.context-task')!;
 await act(async()=>{(row.querySelector('.context-task-actions button') as HTMLButtonElement).click()});expect(scheduler.snapshot().find(t=>t.id===a.id)?.enabled).toBe(false);expect(row.textContent).toContain('Приостановлено вручную');
 await act(async()=>{(row.querySelectorAll('.context-task-actions button')[1] as HTMLButtonElement).click()});expect(scheduler.snapshot()).toHaveLength(1);expect(node.textContent).not.toContain('Проверить CI');
});
