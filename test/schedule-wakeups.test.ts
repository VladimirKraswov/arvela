import {expect,it,vi,afterEach} from 'vitest';
import {TaskScheduler,parseTasks,type NewScheduledTask} from '../src/schedules/tasks';
import {scheduleWakeReminder,scheduleReminder,agentParts,visiblePromptText} from '../src/agent/promptPolicy';
const db=()=>{const m=new Map<string,string>();return {getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v);}};};
const input:NewScheduledTask={server:'local',directory:'/p',sessionID:'s',engine:'opencode',title:'Следить за CI',prompt:'Проверь CI. При завершении удали таймер.',minutes:1,model:{providerID:'p',modelID:'m'}};
afterEach(()=>vi.useRealTimers());
it('delivers an overdue one-shot once after relaunch, never loses or repeats it',async()=>{
 vi.useFakeTimers();vi.setSystemTime(1000000);const storage=db();const first=new TaskScheduler(storage);first.add({...input,mode:'once',runAt:1100000},1000000);
 vi.setSystemTime(2000000);const restored=new TaskScheduler(storage);expect(restored.snapshot()[0].nextAt).toBe(1100000);
 const dispatch=vi.fn(async()=>({kind:'sent' as const}));await restored.tick('local',dispatch,2000000);expect(restored.snapshot()[0]).toMatchObject({enabled:false,state:'sent'});
 await restored.tick('local',dispatch,3000000);await new TaskScheduler(storage).tick('local',dispatch,4000000);expect(dispatch).toHaveBeenCalledOnce();
});
it('keeps a busy one-shot due, then delivers when the chat can accept it',async()=>{
 const s=new TaskScheduler(db());s.add({...input,mode:'once'},0);
 await s.tick('local',async()=>({kind:'waiting',detail:'busy'}),60000);expect(s.snapshot()[0]).toMatchObject({enabled:true,nextAt:60000,state:'waiting'});
 const send=vi.fn(async()=>({kind:'sent' as const}));await s.tick('local',send,75000);expect(send).toHaveBeenCalledOnce();expect(s.snapshot()[0].enabled).toBe(false);
});
it('deduplicates a retried create but refuses a changed payload under the same request key',()=>{
 const s=new TaskScheduler(db()),t=s.add({...input,requestKey:'ci'});expect(s.add({...input,requestKey:'ci'}).id).toBe(t.id);expect(s.snapshot()).toHaveLength(1);
 expect(()=>s.add({...input,requestKey:'ci',prompt:'different'})).toThrow();
 s.add({...input,sessionID:'other',requestKey:'ci'});expect(s.snapshot()).toHaveLength(2);
});
it('retains old repeating schedules and rejects malformed new fields',()=>{
 const s=new TaskScheduler(db());s.add(input);expect(parseTasks(JSON.stringify(s.snapshot())).tasks).toHaveLength(1);
 for(const extra of [{mode:'forever'},{runAt:NaN},{requestKey:'x'.repeat(129)}])expect(()=>s.add({...input,...extra} as NewScheduledTask)).toThrow();
});
it('repeats exact scoped scheduling guidance and only hides the exact app block in Pi history',()=>{
 const parts=agentParts(undefined,'s','/a"b',[{type:'text',text:'watch'}]);const reminder=scheduleReminder('s','/a"b');expect(parts.some(p=>p.type==='text'&&p.text===reminder&&p.synthetic)).toBe(true);
 expect(visiblePromptText('watch\n\n'+reminder,'s')).toBe('watch');
 expect(visiblePromptText('watch\n\n'+reminder.replace('Не переключай','Изменено Не переключай'),'s')).toContain('Изменено');
 expect(visiblePromptText('watch\n\n'+reminder,'other')).toContain(reminder);
});

it('hides the exact wake context without changing scheduled prompt identity for durable delivery',()=>{
 const wake=scheduleWakeReminder('s','job');expect(visiblePromptText('check\n\n'+wake+'\n\n'+scheduleReminder('s','/p'),'s')).toBe('check');
 expect(visiblePromptText('check\n\n'+wake.replace('Это плановое','Изменено Это плановое'),'s')).toContain('Изменено');
});
