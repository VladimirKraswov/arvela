// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_PREFS } from '../src/state/prefs';
const fake=vi.hoisted(()=>({state:{} as any,refreshPiHealth:vi.fn(),getModelChoice:vi.fn(),setPiSettings:vi.fn()}));
vi.mock('../src/state/store',()=>({useAppState:()=>fake.state,store:fake}));
import { PiSettings } from '../src/components/PiSettings';
let root:Root;const dirty=vi.fn();
beforeEach(()=>{
 vi.clearAllMocks();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 fake.state={prefs:structuredClone(DEFAULT_PREFS),piHealth:{install:{installed:true,version:'0.85.1',path:'/opt/homebrew/bin/pi'},models:[],commands:[]}};
 const node=document.createElement('div');document.body.append(node);root=createRoot(node);
 act(()=>root.render(createElement(PiSettings,{onDirtyChange:dirty})));
});
afterEach(()=>{act(()=>root.unmount());document.body.innerHTML='';vi.unstubAllGlobals();});
function click(text:string){act(()=>[...document.querySelectorAll('button')].find(x=>x.textContent===text)!.click());}
function input(label:string,value:string){const el=document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));});}
it('owns Pi navigation, retains path drafts and reports unsaved changes without probing models',()=>{
 expect([...document.querySelectorAll('.setting-group:not([hidden])')].map(x=>x.getAttribute('aria-label'))).toEqual(['Установка','Подключение']);
 expect(dirty).toHaveBeenLastCalledWith(false);input('Путь к исполняемому файлу Pi','/own/pi');expect(dirty).toHaveBeenLastCalledWith(true);
 click('Модели');expect(document.querySelector('.setting-group:not([hidden])')?.getAttribute('aria-label')).toBe('Модели');
 click('Подключение');expect(document.querySelector<HTMLInputElement>('[aria-label="Путь к исполняемому файлу Pi"]')!.value).toBe('/own/pi');
 input('Путь к исполняемому файлу Pi','');expect(dirty).toHaveBeenLastCalledWith(false);expect(fake.refreshPiHealth).not.toHaveBeenCalled();expect(fake.setPiSettings).not.toHaveBeenCalled();
});
it('keeps extension drafts across tabs and marks clearing as clean',()=>{
 click('Расширения и LSP');input('Путь к расширению Pi','/own/extension.ts');expect(dirty).toHaveBeenLastCalledWith(true);
 click('Возможности');click('Расширения и LSP');expect(document.querySelector<HTMLInputElement>('[aria-label="Путь к расширению Pi"]')!.value).toBe('/own/extension.ts');
 input('Путь к расширению Pi','');expect(dirty).toHaveBeenLastCalledWith(false);
});
