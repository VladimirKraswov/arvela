import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {store} from '../src/state/store';
import {scheduleCommand} from '../src/schedules/control';
import {taskScheduler} from '../src/schedules/tasks';
const args={action:'create',directory:'/p',session_id:'s',mode:'repeat',minutes:5,title:'CI',prompt:'Check CI',request_key:'ci',provider_id:'p',model_id:'m'};
beforeEach(()=>{
 const s=taskScheduler();for(const t of s.snapshot())s.remove(t.id);
 vi.spyOn(store,'engineIdFor').mockReturnValue('opencode');
 vi.spyOn(store,'engine').mockReturnValue({getSession:vi.fn(async()=>({id:'s',directory:'/p',time:{created:1,updated:1}}))} as never);
});
afterEach(()=>vi.restoreAllMocks());
it('creates/lists/cancels without selecting or interrupting the visible chat',async()=>{
 const selected=store.state.activeSessionId,dir=store.state.directory;
 const select=vi.spyOn(store,'selectSession'),stop=vi.spyOn(store,'stopSession'),prompt=vi.spyOn(store,'sendPrompt');
 const result=await scheduleCommand(args);expect(result.task?.title).toBe('CI');expect((await scheduleCommand(args)).task?.id).toBe(result.task?.id);
 const id=result.task!.id;expect((await scheduleCommand({...args,action:'list'})).tasks).toHaveLength(1);
 await expect(scheduleCommand({...args,session_id:'foreign',action:'remove',id})).rejects.toThrow();
 await scheduleCommand({...args,action:'pause',id});expect(taskScheduler().snapshot()[0].enabled).toBe(false);
 await scheduleCommand({...args,action:'resume',id});expect(taskScheduler().snapshot()[0].enabled).toBe(true);
 await scheduleCommand({...args,action:'remove',id});expect(taskScheduler().snapshot()).toHaveLength(0);
 expect(store.state.activeSessionId).toBe(selected);expect(store.state.directory).toBe(dir);expect(select).not.toHaveBeenCalled();expect(stop).not.toHaveBeenCalled();expect(prompt).not.toHaveBeenCalled();
});
it('refuses archived, moved and invalid scope/dates before saving',async()=>{
 await expect(scheduleCommand({...args,run_at:1})).rejects.toThrow('Время');
 await expect(scheduleCommand({...args,minutes:0})).rejects.toThrow('Интервал');
 vi.mocked(store.engine).mockReturnValue({getSession:async()=>({directory:'/other',time:{}})} as never);
 await expect(scheduleCommand(args)).rejects.toThrow('перенесён');expect(taskScheduler().snapshot()).toHaveLength(0);
});
it('captures the background Pi session model rather than the visible chat selection',async()=>{
 const old=store.state;store.state={...old,activeSessionId:'visible_other',prefs:{...old.prefs,modelChoice:{...old.prefs.modelChoice,'pi::session:s':{providerID:'p',modelID:'own',variant:'medium'}},pi:{...old.prefs.pi,verifiedModel:'p/own'}}};
 vi.mocked(store.engineIdFor).mockReturnValue('pi');
 const {provider_id:_provider,model_id:_model,...scoped}=args;
 try{const result=await scheduleCommand(scoped);expect(result.task).toMatchObject({engine:'pi',sessionID:'s',model:{providerID:'p',modelID:'own',variant:'medium'}});expect(store.state.activeSessionId).toBe('visible_other');}
 finally{store.state=old;}
});
