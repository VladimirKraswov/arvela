import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('../src/api/events',()=>({runEventStream:vi.fn(),eventStreamUrl:()=>'',globalEventStreamUrl:()=>''}));
let store:any, source:any;
beforeEach(async()=>{
 vi.resetModules(); store=(await import('../src/state/store')).store;
 source={id:'source',directory:'/test',projectID:'test',title:'Original',time:{created:1,updated:1},permission:[{permission:'*',pattern:'*',action:'deny'}]};
 store.state.connection.phase='connected';store.state.directory='/test';store.state.activeSessionId='source';
 store.state.sessions=[source];store.state.chat.sessions.source={messages:{msg:{id:'msg',sessionID:'source',role:'user',time:{created:2}}},partsByMessage:{msg:[]},parts:{},messageOrder:['msg'],status:{type:'idle'}};
 store.state.connectedProviderIds=['local'];store.state.providers=[{id:'local',models:{chosen:{id:'chosen',variants:{medium:{}}}}}];
 store.setModelChoice('local','chosen','medium');store.setAgentOverride('/test','custom');store.setDraft('existing source draft');
 vi.spyOn(store.client,'getSession').mockResolvedValue(source);
 vi.spyOn(store.client,'sessionStatuses').mockResolvedValue({});
 vi.spyOn(store.client,'pendingPermissions').mockResolvedValue([]);vi.spyOn(store.client,'pendingQuestions').mockResolvedValue([]);
 vi.spyOn(store.client,'forkSession').mockResolvedValue({...source,id:'branch',permission:undefined});
 vi.spyOn(store.client,'updateSession').mockImplementation(async(id:any,patch:any)=>({...source,id,...patch}));
 vi.spyOn(store.client,'messages').mockResolvedValue({messages:[]});vi.spyOn(store.client,'prompt').mockResolvedValue(undefined);
});
it('forks before the edited message, preserves access/profile and original draft, without auto execution',async()=>{
 await store.prepareEditedBranch('msg','corrected');
 expect(store.client.forkSession).toHaveBeenCalledWith('source','/test','msg');
 expect(store.client.updateSession).toHaveBeenCalledWith('branch',{title:'Original · правка',permission:source.permission},'/test');
 expect(store.state.activeSessionId).toBe('branch');expect(store.getDraft()).toBe('corrected');
 expect(store.getModelChoice()).toMatchObject({providerID:'local',modelID:'chosen',variant:'medium'});expect(store.getAgentChoice()).toBe('custom');
 expect(store.state.prefs.drafts.source).toBe('existing source draft');expect(store.client.prompt).not.toHaveBeenCalled();
});
it('blocks busy and pending-interaction sources before forking',async()=>{
 store.client.sessionStatuses.mockResolvedValue({source:{type:'busy'}});
 await expect(store.prepareEditedBranch('msg','change')).rejects.toThrow('Дождитесь');expect(store.client.forkSession).not.toHaveBeenCalled();
});
it('retains the editor on failed permission restoration and never sends',async()=>{
 store.client.updateSession.mockRejectedValue(new Error('save failed'));
 await expect(store.prepareEditedBranch('msg','change')).rejects.toThrow('save failed');
 expect(store.state.activeSessionId).toBe('source');expect(store.getDraft()).toBe('existing source draft');expect(store.client.prompt).not.toHaveBeenCalled();
});
it('does not change the visible chat if the user navigated during fork creation',async()=>{
 let resolve!:(v:any)=>void;store.client.forkSession.mockReturnValue(new Promise(r=>resolve=r));
 const pending=store.prepareEditedBranch('msg','change');await vi.waitFor(()=>expect(store.client.forkSession).toHaveBeenCalled());
 store.state.activeSessionId='other';store.state.directory='/other';store.state.sessions=[];resolve({...source,id:'branch'});await pending;
 expect(store.state.activeSessionId).toBe('other');expect(store.state.sessions).toEqual([]);expect(store.state.prefs.drafts.branch).toBe('change');expect(store.client.prompt).not.toHaveBeenCalled();
});
