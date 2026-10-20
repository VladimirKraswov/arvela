import {beforeEach,expect,it,vi} from 'vitest';
import {resolveWorkshop,isWorkshopSession,WORKSHOP_TITLE} from '../src/workshop/workspace';
import {ApiError} from '../src/api/client';
import type {AgentBackend} from '../src/agent/backend';
const workspace={directory:'/workshop',sourceDirectory:'/repo'};
const session={id:'protected',directory:'/workshop',title:WORKSHOP_TITLE,projectID:'global',time:{created:1,updated:1}};
const backend=()=>({getSession:vi.fn().mockResolvedValue(session),listSessions:vi.fn().mockResolvedValue([]),createSession:vi.fn().mockResolvedValue(session),updateSession:vi.fn().mockResolvedValue(session)}) as unknown as AgentBackend;
it('reuses persisted identity, scopes protection and reconciles a lost create response',async()=>{
 const api=backend();const record=await resolveWorkshop(api,workspace,{...workspace,session});expect(api.createSession).not.toHaveBeenCalled();
 expect(isWorkshopSession(record,session)).toBe(true);expect(isWorkshopSession(record,{...session,directory:'/other'})).toBe(false);
 vi.mocked(api.getSession).mockRejectedValue(new ApiError(404,'missing'));
 vi.mocked(api.listSessions).mockResolvedValue([session]);
 expect((await resolveWorkshop(api,workspace,record)).session.id).toBe('protected');expect(api.createSession).not.toHaveBeenCalled();
});
it('never recreates on outage and restores an externally archived original',async()=>{
 const api=backend();vi.mocked(api.getSession).mockRejectedValue(new ApiError(500,'offline'));
 await expect(resolveWorkshop(api,workspace,{...workspace,session})).rejects.toThrow();expect(api.createSession).not.toHaveBeenCalled();
 vi.mocked(api.getSession).mockResolvedValue({...session,time:{...session.time,archived:3}});
 await resolveWorkshop(api,workspace,{...workspace,session});expect(api.updateSession).toHaveBeenCalledWith('protected',{time:{archived:0}},'/workshop');
});
it('creates no agent prompt and never binds a session returned for another directory',async()=>{
 const api=backend();await resolveWorkshop(api,workspace);expect(api.createSession).toHaveBeenCalledWith({directory:'/workshop',title:WORKSHOP_TITLE});
 vi.mocked(api.createSession).mockResolvedValue({...session,directory:'/other'});await expect(resolveWorkshop(api,workspace)).rejects.toThrow('другой каталог');
});
let store:typeof import('../src/state/store').store;
beforeEach(async()=>{
 vi.resetModules();vi.restoreAllMocks();
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});
 store=(await import('../src/state/store')).store;
 store.state.prefs.workshop={...workspace,session};
});
it('store guards deletion, archive, rename and project removal even outside the sidebar',async()=>{
 const remove=vi.spyOn(store.backend,'deleteSession'),update=vi.spyOn(store.backend,'updateSession');
 await store.deleteSession(session);await store.archiveSession(session);await store.renameSession(session,'changed');store.removeProject('/workshop');
 expect(remove).not.toHaveBeenCalled();expect(update).not.toHaveBeenCalled();expect(store.state.prefs.workshop?.session.id).toBe('protected');expect(store.state.prefs.hiddenProjects??[]).not.toContain('/workshop');
 store.state.projects=[{id:'workshop',worktree:'/workshop',time:{created:0,updated:0}},{id:'normal',worktree:'/normal',time:{created:0,updated:0}}];
 expect(store.projectDirectories()).toEqual(['/normal']);
});
it('endpoint switching isolates protected identities instead of protecting a remote chat with the same id',async()=>{
 const {switchEndpointPrefs}=await import('../src/state/prefs');
 const remote=switchEndpointPrefs(store.state.prefs,'http://127.0.0.1:6000','ssh:other');expect(remote.workshop).toBeUndefined();
 const restored=switchEndpointPrefs(remote,store.state.prefs.endpoint);expect(restored.workshop?.session.id).toBe('protected');
});
it('a timed-out create is reconciled on the next open without a second POST',async()=>{
 const api=backend();vi.mocked(api.createSession).mockRejectedValue(new Error('acknowledgement lost'));
 await expect(resolveWorkshop(api,workspace)).rejects.toThrow('acknowledgement lost');
 vi.mocked(api.listSessions).mockResolvedValue([session]);
 expect((await resolveWorkshop(api,workspace)).session.id).toBe('protected');expect(api.createSession).toHaveBeenCalledOnce();
});
it('coalesces startup and click, then stores a late result under its original endpoint',async()=>{
 const native=await import('../src/native/platform');vi.spyOn(native,'isNative').mockReturnValue(true);
 const module=await import('../src/workshop/workspace');let finish!:(v:typeof workspace)=>void;
 const prepare=vi.spyOn(module,'prepareWorkshop').mockImplementation(()=>new Promise(r=>{finish=r;}));
 vi.spyOn(store.backend,'getSession').mockResolvedValue(session);
 store.state.connection.phase='connected';
 const key=store.state.prefs.workspaceKey??store.state.prefs.endpoint;
 vi.spyOn(store.backend,'paths').mockResolvedValue({home:'/home/test',directory:'/home/test',worktree:'/home/test'});
 const first=store.ensureWorkshop(),second=store.ensureWorkshop();await Promise.resolve();await Promise.resolve();expect(prepare).toHaveBeenCalledOnce();
 const {switchEndpointPrefs}=await import('../src/state/prefs');store.state.prefs=switchEndpointPrefs(store.state.prefs,'http://127.0.0.1:6001','ssh:other');
 finish(workspace);await Promise.all([first,second]);
 expect(store.state.prefs.workshop).toBeUndefined();expect(store.state.prefs.endpointState?.[key].workshop?.session.id).toBe('protected');
});
it('does not jump back to an old workshop click after the user changes chat',async()=>{
 let finish!:(v:any)=>void;vi.spyOn(store,'ensureWorkshop').mockImplementation(()=>new Promise(r=>{finish=r;}));
 const open=vi.spyOn(store,'openChat').mockResolvedValue(undefined);const pending=store.openWorkshop();
 store.state.activeSessionId='newer-selection';finish({...workspace,session});await pending;expect(open).not.toHaveBeenCalled();
});

it('renames the legacy workshop without duplicating or changing its identity',async()=>{
 const api=backend();const old={...session,title:'Мастерская Arvela'};
 vi.mocked(api.listSessions).mockResolvedValue([old]);
 vi.mocked(api.updateSession).mockResolvedValue({...old,title:'Мастерская'});
 const record=await resolveWorkshop(api,workspace);
 expect(api.createSession).not.toHaveBeenCalled();expect(api.updateSession).toHaveBeenCalledWith('protected',{title:'Мастерская'},'/workshop');
 expect(record.session.id).toBe('protected');expect(record.session.title).toBe('Мастерская');
});
