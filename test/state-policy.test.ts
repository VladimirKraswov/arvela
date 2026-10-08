import { expect, it } from 'vitest';
import { initialState } from '../src/state/initial';
import { DEFAULT_PREFS } from '../src/state/prefs';
import { chooseOpenCodeModel, choosePiModel, piModelInfo } from '../src/state/modelChoice';
import { modelScope } from '../src/state/engines';

const fresh = () => initialState(structuredClone(DEFAULT_PREFS));
const context = { projectless:false, agentName:null, defaultVariant:()=> 'medium' };
it('restores the selected folder/session without sharing transient state between stores', () => {
 const prefs={...structuredClone(DEFAULT_PREFS),selectedDirectory:'/one',lastSessionByDir:{'/one':'s1'}};
 const a=initialState(prefs),b=initialState(prefs);
 expect(a.directory).toBe('/one');expect(a.activeSessionId).toBe('s1');
 expect(a.connection.endpoint).toBe(prefs.endpoint);
 a.chat.sessions['s1']={} as any;a.statuses['s1']={type:'busy'};a.projects.push({id:'one'} as any);a.ui.sending=true;
 expect(b.chat.sessions).toEqual({});expect(b.statuses).toEqual({});expect(b.projects).toEqual([]);expect(b.ui.sending).toBe(false);
 expect(b.prefs).toBe(prefs); // Loading/migration belongs to prefs.ts, not this constructor.
});
it('keeps OpenCode session override, server session model, folder, agent and defaults in order', () => {
 const s=fresh();s.directory='/one';s.activeSessionId='s1';s.connectedProviderIds=['local'];
 const choice=(modelID:string)=>({providerID:'local',modelID,variant:'low'});
 s.prefs.modelChoice={'session:s1':choice('session'),'/one':choice('folder')};
 const activeModel={providerID:'local',id:'runtime',variant:'high'};
 expect(chooseOpenCodeModel(s,{...context,activeModel})).toEqual(choice('session'));
 delete s.prefs.modelChoice['session:s1'];
 expect(chooseOpenCodeModel(s,{...context,activeModel})).toEqual({...choice('runtime'),variant:'high'});
 expect(chooseOpenCodeModel(s,context)).toEqual(choice('folder'));
 s.prefs.modelChoice={};s.agents=[{name:'build',model:choice('agent'),variant:'low'} as any];
 expect(chooseOpenCodeModel(s,{...context,agentName:'build'})).toEqual(choice('agent'));
 s.configModel='local/family/model';expect(chooseOpenCodeModel(s,context)?.modelID).toBe('family/model');
 s.configModel=null;s.providerDefaults={local:'default'};expect(chooseOpenCodeModel(s,context)?.modelID).toBe('default');
});
it('projectless policy and disconnected providers cannot select another engine or a stale saved model', () => {
 const s=fresh();s.directory='/one';s.connectedProviderIds=['local'];s.prefs.modelChoice={'/one':{providerID:'gone',modelID:'old'},'@chats':{providerID:'local',modelID:'chat'},'*':{providerID:'local',modelID:'global'}};
 expect(chooseOpenCodeModel(s,{...context,projectless:true})?.modelID).toBe('chat');
 expect(chooseOpenCodeModel(s,context)).toBeNull(); // Per-folder unusable entry preserves existing priority; provider defaults may follow.
 s.providerDefaults={local:'usable'};expect(chooseOpenCodeModel(s,context)?.modelID).toBe('usable');
});
it('Pi requires its own verified access and never inherits OpenCode choices', () => {
 const s=fresh();s.activeSessionId='s1';s.connectedProviderIds=['local'];s.providerDefaults={local:'oc'};s.prefs.modelChoice={'*':{providerID:'local',modelID:'oc'}};
 s.prefs.pi={customModel:'local/pi',thinking:'medium'};
 expect(choosePiModel(s,'/one')).toBeNull();
 s.prefs.pi.verifiedModels={'local/pi':1};expect(choosePiModel(s,'/one')).toEqual({providerID:'local',modelID:'pi',variant:'medium'});
 const scoped=modelScope('pi','session:s1');s.prefs.modelChoice[scoped]={providerID:'local',modelID:'session',variant:'high'};
 expect(choosePiModel(s,'/one')?.modelID).toBe('pi');
 s.prefs.pi.verifiedModels['local/session']=1;expect(choosePiModel(s,'/one')?.modelID).toBe('session');
 expect(piModelInfo(null,{providerID:'local',modelID:'custom'})?.input).toEqual(['text']);
});
