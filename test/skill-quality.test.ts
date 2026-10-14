import {describe,it,expect} from 'vitest';
import {captureTrial,trialPrompt,type Experiment} from '../src/capabilities/quality';
import {emptySessionChat} from '../src/state/chatReducer';
const e:Experiment={id:'trial-1',name:'sample',scope:'global',directory:null,path:'/skills/sample/SKILL.md',baseline:'a',candidate:'b',baselinePath:'/trials/baseline/SKILL.md',candidatePath:'/trials/candidate/SKILL.md',trials:[],state:'candidate'};
function chat(){
 const c=emptySessionChat();c.messageOrder=['u','a'];
 c.messages.u={id:'u',role:'user',sessionID:'s',time:{created:100}};
 c.messages.a={id:'a',role:'assistant',sessionID:'s',parentID:'u',providerID:'fixture',modelID:'model',time:{created:200,completed:1000},finish:'stop',tokens:{input:100,output:20}};
 c.partsByMessage={u:['prompt'],a:['read','answer']};
 c.parts.prompt={id:'prompt',messageID:'u',sessionID:'s',type:'text',text:trialPrompt(e,'candidate','Summarize fixture')};
 c.parts.read={id:'read',messageID:'a',sessionID:'s',type:'tool',tool:'read',state:{status:'completed',input:{path:e.candidatePath}}};
 c.parts.answer={id:'answer',messageID:'a',sessionID:'s',type:'text',text:'I successfully read the skill.'};return c;
}
describe('skill evidence',()=>{
 it('captures actual model, timing, usage and immutable candidate identity',()=>{
  expect(captureTrial(e,chat(),'pi',true)).toMatchObject({revision:'b',phase:'candidate',model:'fixture/model',wallMs:900,tokens:120,passed:true,caseId:'Summarize fixture'});
 });
 it('does not accept a narrative claim, failed read, another package or missing usage',()=>{
  const c=chat();c.parts.read.state!.status='error';expect(()=>captureTrial(e,c,'pi',true)).toThrow('чтения');
  c.parts.read.state!.status='completed';c.parts.read.state!.input={path:e.baselinePath};expect(()=>captureTrial(e,c,'pi',true)).toThrow('чтения');
  c.parts.read.state!.input={path:e.candidatePath};if(c.messages.a.role==='assistant')delete c.messages.a.tokens;
  expect(()=>captureTrial(e,c,'pi',true)).toThrow('токенов');
 });
 it('never attributes an earlier skill read to the latest request or a foreign experiment',()=>{
  const c=chat();expect(()=>captureTrial({...e,id:'other'},c,'opencode',true)).toThrow('Другой'.toLowerCase());
  c.messageOrder.push('later');c.messages.later={id:'later',role:'user',sessionID:'s',time:{created:2000}};
  expect(()=>captureTrial(e,c,'opencode',true)).toThrow('нет испытания');
 });
});
