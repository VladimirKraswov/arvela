// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
vi.hoisted(() => { Object.defineProperty(window,'matchMedia',{configurable:true,value:()=>({matches:false,addEventListener(){},removeEventListener(){}})}); });
import {Sidebar} from '../src/components/Sidebar';
import {store} from '../src/state/store';
import {WORKSHOP_TITLE} from '../src/workshop/workspace';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();document.body.innerHTML='';});
it('renders one protected entry before projects without destructive actions or duplicate recent row',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const session={id:'workshop-ui',directory:'/workshop',title:WORKSHOP_TITLE,projectID:'global',time:{created:1,updated:1}};
 store.state={...store.state,connection:{...store.state.connection,phase:'disconnected'},projects:[],sessions:[],activeSessionId:null,directory:null,
  prefs:{...store.state.prefs,workshop:{directory:'/workshop',sourceDirectory:'/repo',session},pinnedProjects:['/workshop','/repo']},
  recentSessionList:{...store.state.recentSessionList,loaded:true,sessions:[session]},projectSessionLists:{}};
 const open=vi.spyOn(store,'openWorkshop').mockResolvedValue(undefined);
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try {
  await act(async()=>root.render(createElement(Sidebar)));
  const entry=host.querySelector<HTMLButtonElement>('[aria-label="Мастерская Arvela"]')!;
  expect(entry).not.toBeNull();expect(host.querySelectorAll('[aria-label="Мастерская Arvela"]')).toHaveLength(1);
  expect(entry.compareDocumentPosition(host.querySelector('.sidebar-scroll')!)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(entry.parentElement!.querySelectorAll('button')).toHaveLength(1);
  expect(host.querySelector('[aria-label="Действия: Мастерская Arvela"]')).toBeNull();
  expect(host.querySelector('[aria-label="Проект workshop"]')).toBeNull();
  await act(async()=>entry.click());expect(open).toHaveBeenCalledOnce();
 }finally{act(()=>root.unmount());}
});
