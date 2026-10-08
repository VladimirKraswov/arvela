// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {OutcomeSection} from '../src/components/OutcomeSection';
import {outcomes,changeOutcome,type OutcomeScope} from '../src/outcomes/store';
let root:Root,scope:OutcomeScope,node:HTMLDivElement;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);scope={server:'ui',directory:'/fixture',engine:'pi',sessionID:crypto.randomUUID()};node=document.createElement('div');document.body.append(node);root=createRoot(node);});
afterEach(()=>{act(()=>root.unmount());node.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
const mount=()=>act(async()=>{root.render(createElement(OutcomeSection,{scope,requests:[{id:'u',label:'Task'},{id:'v',label:'Other task'}],onOpen:()=>{}}));});
async function until(check:()=>void){await vi.waitFor(async()=>{await act(async()=>{await new Promise(r=>setTimeout(r,10));});check();});}
async function waitReady(){await until(()=>expect(node.querySelector('select')?.disabled).toBe(false));}
const button=(label:string)=>Array.from(node.querySelectorAll('button')).find(b=>b.textContent===label)!;
const click=(label:string)=>act(async()=>{button(label).click();});
const fill=(label:string,value:string)=>act(async()=>{const el=node.querySelector<HTMLTextAreaElement>(`[aria-label="${label}"]`)!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));});
async function createCard(){await mount();await waitReady();await click('Добавить карточку');await fill('Цель задачи','Fix save');await fill('Критерии приёмки','Reopen preserves value');await click('Сохранить карточку');await until(()=>expect(button('Принять результат').disabled).toBe(false));}
it('requires explicit acceptance, invalidates it after changes and restores persisted evidence after remount',async()=>{
 await createCard();expect((await outcomes.list(scope))[0].verdict).toBe('unreviewed');
 await click('Принять результат');await until(()=>expect(node.querySelector('summary')?.textContent).toContain('Принято вами'));
 await fill('Замечания к результату','Also preserve undo');expect(button('Принять результат').disabled).toBe(true);await click('Сохранить карточку');
 await until(()=>expect(node.querySelector('summary')?.textContent).toContain('Не проверено'));await act(async()=>{root.unmount();root=createRoot(node);});
 await mount();await waitReady();expect(node.querySelector<HTMLTextAreaElement>('[aria-label="Замечания к результату"]')?.value).toBe('Also preserve undo');
});
it('keeps the draft across panel close and refuses stale writes without reporting success',async()=>{
 await createCard();await fill('Замечания к результату','Owner draft');
 await act(async()=>{root.unmount();root=createRoot(node);});await mount();await waitReady();expect(node.querySelector<HTMLTextAreaElement>('[aria-label="Замечания к результату"]')?.value).toBe('Owner draft');
 const saved=(await outcomes.list(scope))[0];await act(async()=>{await outcomes.save(changeOutcome(saved,{notes:'Other window'}),saved.revision);});
 await click('Сохранить карточку');await until(()=>expect(node.querySelector('[role="alert"]')?.textContent).toContain('другом окне'));
 expect(node.querySelector<HTMLTextAreaElement>('[aria-label="Замечания к результату"]')?.value).toBe('Owner draft');expect(node.querySelector('[role="status"]')).toBeNull();
 expect((await outcomes.list(scope))[0].notes).toBe('Other window');await click('Перечитать сохранённую');await until(()=>expect(node.querySelector<HTMLTextAreaElement>('[aria-label="Замечания к результату"]')?.value).toBe('Other window'));
});
it('does not discard an edited task on request selection',async()=>{
 await createCard();await fill('Цель задачи','Unsaved goal');await act(async()=>{const select=node.querySelector('select')!;select.value='u';select.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(node.querySelector('[role="alert"]')?.textContent).toContain('Сначала сохраните');expect(node.querySelector<HTMLTextAreaElement>('[aria-label="Цель задачи"]')?.value).toBe('Unsaved goal');
});
it('keeps unsaved evidence and reports a failed storage write without success',async()=>{
 await createCard();await fill('Замечания к результату','Keep this unsaved evidence');
 vi.spyOn(outcomes,'save').mockRejectedValueOnce(Error('Storage quota exhausted'));
 await click('Сохранить карточку');await until(()=>expect(node.querySelector('[role="alert"]')?.textContent).toContain('quota'));
 expect(node.querySelector('[role="status"]')).toBeNull();expect((await outcomes.list(scope))[0].notes).toBe('');
 await act(async()=>{root.unmount();root=createRoot(node);});await mount();await waitReady();
 expect(node.querySelector<HTMLTextAreaElement>('[aria-label="Замечания к результату"]')?.value).toBe('Keep this unsaved evidence');
});
