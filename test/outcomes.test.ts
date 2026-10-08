// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import {describe,it,expect} from 'vitest';
import {OutcomeStore, type OutcomeScope, blankOutcome, changeOutcome, reviewOutcome, sharedAssessment} from '../src/outcomes/store';
import {attachAssessment} from '../src/outcomes/sharing';
import {record} from '../src/hub/records';
const scope:OutcomeScope={server:'local',directory:'/project',engine:'pi',sessionID:'s'};
const task=()=>({...blankOutcome(scope,'u','Fix save'),criteria:'Save and reopen preserves state',checks:[{name:'save/reopen',status:'passed' as const,evidence:'Observed persisted value'}]});
describe('owner task outcomes',()=>{
 it('persists only after commit and refuses stale updates across two clients',async()=>{
  const name='outcomes-'+crypto.randomUUID(),a=new OutcomeStore(name),b=new OutcomeStore(name);
  try{const first=await a.save(task(),null);expect((await b.list(scope))[0]).toEqual(first);
   const next=await b.save(changeOutcome(first,{notes:'Reviewed'}),first.revision);
   await expect(a.save(changeOutcome(first,{notes:'stale'}),first.revision)).rejects.toThrow(/изменена/);
   expect((await a.list(scope))[0]).toEqual(next);
  }finally{a.close();b.close();}
 });
 it('isolates engines, directories, servers and sessions',async()=>{
  const a=new OutcomeStore('scope-'+crypto.randomUUID());try{await a.save(task(),null);
   for(const other of [{...scope,engine:'opencode' as const},{...scope,server:'remote'},{...scope,directory:'/other'},{...scope,sessionID:'other'}])expect(await a.list(other)).toEqual([]);
  }finally{a.close();}
 });
 it('allows only one concurrent creator of the same task',async()=>{
  const name='race-'+crypto.randomUUID(),a=new OutcomeStore(name),b=new OutcomeStore(name);
  try{const results=await Promise.allSettled([a.save(task(),null),b.save(task(),null)]);
   expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(results.filter(x=>x.status==='rejected')).toHaveLength(1);
   expect((await a.list(scope))[0].revision).toBe(1);
  }finally{a.close();b.close();}
 });
 it('never turns successful tool status or an agent completion marker into acceptance',()=>{
  const t=task();expect(t.verdict).toBe('unreviewed');
  const accepted=reviewOutcome(t,'accepted');expect(accepted.verdict).toBe('accepted');
  expect(changeOutcome(accepted,{criteria:'Also preserve undo'}).verdict).toBe('unreviewed');
  expect(changeOutcome(accepted,{checks:[{name:'save/reopen',status:'failed',evidence:'Lost value'}]}).verdict).toBe('unreviewed');
 });
 it('requires explicit goal and criteria before owner acceptance',()=>{
  expect(()=>reviewOutcome(blankOutcome(scope,'u',''),'accepted')).toThrow(/цель/);
  expect(()=>reviewOutcome(blankOutcome(scope,'u','Fix'),'accepted')).toThrow(/критерии/);
 });
 it('shares nothing by default and redacts only known task fields after opt-in',()=>{
  const t=task();expect(sharedAssessment(t,true)).toBeUndefined();
  const shared=sharedAssessment({...t,share:true,notes:'password=private'},true)!;
  expect(shared.notes).not.toContain('private');expect(shared).not.toHaveProperty('scope');
  expect(sharedAssessment({...t,share:true},false)).toBeUndefined();
 });
 it('reports storage unavailability rather than showing a saved task',async()=>{
  const s=new OutcomeStore('blocked',undefined);await expect(s.save(task(),null)).rejects.toThrow(/хранилище/i);
 });
 it('attaches only to the matching user anchor with exact engine/server/project scope',()=>{
  const t={...task(),share:true,revision:1},index=new Map([[t.id,t]]);
  const r=record('pi',{id:'s',directory:'/project',title:''},{id:'u',sessionID:'s',role:'user',time:{created:1}},[],true)!;
  expect(attachAssessment(r,index,'local','/project',true)?.assessment?.goal).toBe('Fix save');
  for(const [server,dir] of [['remote','/project'],['local','/other']])expect(attachAssessment(r,index,server,dir,true)).not.toHaveProperty('assessment');
  expect(attachAssessment({...r,engine:'opencode'},index,'local','/project',true)).not.toHaveProperty('assessment');
  expect(attachAssessment({...r,role:'assistant'},index,'local','/project',true)).not.toHaveProperty('assessment');
  expect(attachAssessment(r,index,'local','/project',false)).not.toHaveProperty('assessment');
 });
});
