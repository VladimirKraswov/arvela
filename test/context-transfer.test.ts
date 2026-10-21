import {expect,it,vi} from 'vitest';
import {inputBudget,transferSource,verifiedSummary,waitForSummary} from '../src/state/contextTransfer';
import type {AssistantMessage,MessageResponse,ModelInfo} from '../src/api/types';
const target:ModelInfo={id:'small',providerID:'local',limit:{context:262144,input:229376,output:32768}};
const source:AssistantMessage={id:'big',sessionID:'s',role:'assistant',providerID:'remote',modelID:'large',tokens:{total:415589},time:{created:1,completed:2}};
it('uses the last measured source across zero-usage failures and never sums billing history',()=>{
 const failed={...source,id:'failed',summary:true,tokens:{input:0},error:{name:'ContextOverflowError'}};
 expect(transferSource([source,failed],target)?.id).toBe('big');
 expect(transferSource([{...source,tokens:{total:1000}},{...source,tokens:{total:1000}}],target)).toBeUndefined();
 expect(transferSource([{...source,providerID:'local',modelID:'small'}],target)).toBeUndefined();
 expect(inputBudget(target)).toBe(204800);
});
it('treats completed summary output as a boundary rather than its old large input',()=>{
 const summary={...source,id:'summary',summary:true,finish:'stop',tokens:{total:416589,input:415589,output:1000}};
 expect(transferSource([source,summary],target)).toBeUndefined();
 expect(transferSource([source,{...summary,tokens:{output:250000}}],target)?.id).toBe('summary');
});
it('requires a new completed nonempty nontruncated summary that fits with the preserved tail',()=>{
 const row:MessageResponse={info:{...source,id:'summary',summary:true,finish:'stop',tokens:{input:415589,output:1000}},parts:[{id:'text',sessionID:'s',messageID:'summary',type:'text',text:'Задача и следующий шаг.'}]};
 expect(()=>verifiedSummary([row],new Set(['big']),target)).not.toThrow();
 expect(()=>verifiedSummary([row],new Set(['summary']),target)).toThrow('не завершилось');
 expect(()=>verifiedSummary([{...row,parts:[]}],new Set(),target)).toThrow('пустую');
 expect(()=>verifiedSummary([{...row,info:{...row.info,role:'assistant',finish:'length'}}],new Set(),target)).toThrow('не завершилось');
 expect(()=>verifiedSummary([row],new Set(),target,300000)).toThrow('всё ещё велика');
});

it('waits for an acknowledged but unfinished summary and never requests a second compaction',async()=>{
 vi.useFakeTimers();try {
  const pending:MessageResponse={info:{...source,id:'new',summary:true,time:{created:3}},parts:[]};
  const done:MessageResponse={info:{...pending.info,role:'assistant',finish:'stop',time:{created:3,completed:4},tokens:{output:100}},parts:[{type:'text',id:'text',sessionID:'s',messageID:'new',text:'Следующий шаг.'}]};
  const load=vi.fn().mockResolvedValueOnce([pending]).mockResolvedValue([done]);
  const result=waitForSummary(load,new Set(['big']),target,16000,Date.now()+5000);
  await vi.advanceTimersByTimeAsync(1000);expect((await result).info.id).toBe('new');expect(load).toHaveBeenCalledTimes(2);
  const deadline=Date.now()+1000;const timed=waitForSummary(async()=>[pending],new Set(),target,16000,deadline);
  const failed=expect(timed).rejects.toThrow('автоматически не отправлен');await vi.advanceTimersByTimeAsync(1000);await failed;
 }finally{vi.useRealTimers();}
});
