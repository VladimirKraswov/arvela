// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import {File as NodeFile,Blob as NodeBlob} from 'node:buffer';
import {act,createElement} from 'react';import {createRoot,type Root} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('../src/api/events',()=>({globalEventStreamUrl:()=>'',eventStreamUrl:()=>'',runEventStream:vi.fn(async()=>{})}));
vi.mock('../src/components/ContextMeter',()=>({ContextMeter:()=>null}));
vi.mock('../src/components/WorkspacePicker',()=>({HostPicker:()=>null}));
vi.mock('../src/components/VoiceInput',()=>({VoiceInput:()=>null}));
let root:Root|undefined;
afterEach(()=>{if(root)act(()=>root!.unmount());root=undefined;vi.restoreAllMocks();vi.unstubAllGlobals();document.body.innerHTML='';});
it('the actual running composer accepts files into the queue instead of blocking them',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}}));vi.stubGlobal('File',NodeFile);vi.stubGlobal('Blob',NodeBlob);
 const {store}=await import('../src/state/store');const {Composer}=await import('../src/components/Composer');
 const {attachmentDrafts,attachmentScope}=await import('../src/attachments/drafts');
 store.state={...store.state,directory:'/composer-'+crypto.randomUUID(),activeSessionId:'ses_ui',connection:{...store.state.connection,phase:'connected',streamState:'open'},statuses:{ses_ui:{type:'busy'}},connectedProviderIds:['p']};
 vi.spyOn(store,'activeSession').mockReturnValue({id:'ses_ui'} as any);vi.spyOn(store,'modelInfo').mockReturnValue({id:'m',capabilities:{input:{image:true}}} as any);
 store.setModelChoice('p','m','medium');store.setDraft('follow up with files');
 const scope=attachmentScope(store.state.prefs.workspaceKey??store.state.prefs.endpoint,store.state.directory,'ses_ui');
 await attachmentDrafts.add(scope,[new NodeFile(['contents'],'note.txt',{type:'text/plain'}) as unknown as File]);
 const node=document.createElement('div');document.body.append(node);root=createRoot(node);
 await act(async()=>root!.render(createElement(Composer)));
 expect(document.querySelector('[aria-label="Приложить файлы"]')?.hasAttribute('disabled')).toBe(false);
 await act(async()=>{document.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await vi.waitFor(()=>expect(store.state.ui.sending).toBe(false), {timeout:3000});});
 expect(store.getQueue()).toHaveLength(1);expect(store.getQueue()[0].attachments?.files[0].name).toBe('note.txt');
 expect(document.querySelector('[aria-label="Вложения в очереди"]')?.getAttribute('title')).toBe('note.txt');expect(document.body.textContent).not.toContain('Вложения можно отправить после');
 expect(attachmentDrafts.snapshot(scope)).toHaveLength(0);
});

it('five queued prompts stay as single-line summaries and edit/apply uses the composer',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}}));
 const {store}=await import('../src/state/store');const {Composer}=await import('../src/components/Composer');
 const sid='ses_edit_ui';store.state={...store.state,directory:'/queue-ui-'+crypto.randomUUID(),activeSessionId:sid,connection:{...store.state.connection,phase:'connected',streamState:'open'},statuses:{[sid]:{type:'busy'}}};
 vi.spyOn(store,'activeSession').mockReturnValue({id:sid} as any);vi.spyOn(store,'engineReady').mockReturnValue(true);store.setModelChoice('p','m','medium');store.setDraft('');
 for(let i=0;i<5;i++)store.enqueuePrompt('Задача '+i+'\nПодробное описание '.repeat(20));
 const original=store.getQueue().map(q=>q.id);
 const node=document.createElement('div');document.body.append(node);root=createRoot(node);await act(async()=>root!.render(createElement(Composer)));
 expect(document.querySelectorAll('.queued-summary')).toHaveLength(5);
 expect(document.querySelector('.queued-summary')!.textContent).not.toContain('\n');
 const edit=Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Изменить')!;
 await act(async()=>{edit.click();await vi.waitFor(()=>expect(store.getQueueEdit()?.id).toBe(original[0]));});
 expect(document.querySelector('textarea')!.value).toContain('Задача 0\n');expect(document.activeElement).toBe(document.querySelector('textarea'));
 expect(store.getQueue().map(q=>q.id)).toEqual(original);
 await act(async()=>store.setDraft('Уточнённая задача'));
 await act(async()=>{(document.querySelector('[aria-label="Применить изменения"]') as HTMLButtonElement).click();await vi.waitFor(()=>expect(store.getQueueEdit()).toBeUndefined());});
 expect(store.getQueue().map(q=>q.id)).toEqual(original);expect(store.getQueue()[0].text).toBe('Уточнённая задача');expect(document.querySelector('textarea')!.value).toBe('');
});
