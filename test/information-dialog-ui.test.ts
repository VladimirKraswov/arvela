// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,createElement} from 'react';import {createRoot,type Root} from 'react-dom/client';
const fake=vi.hoisted(()=>({state:{prefs:{endpoint:'local',activeHost:'local'}} as any,backend:{},page:vi.fn(),pi:vi.fn(),files:vi.fn(),invoke:vi.fn()}));
vi.mock('../src/state/store',()=>({useAppState:()=>fake.state,store:{get backend(){return fake.backend;},isPiSession:()=>false,client:{usageSessionsPage:fake.page},engine:()=>({listSessions:fake.pi})}}));
vi.mock('../src/agent/pi/native',()=>({isNativeHost:()=>true,piBridge:()=>({sessions:fake.files})}));
vi.mock('@tauri-apps/api/core',()=>({invoke:fake.invoke}));
import {InformationDialog} from '../src/components/InformationDialog';
let root:Root;const session={id:'a',directory:'/p',title:'Test',projectID:'p',time:{created:1,updated:2}};
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);fake.state={prefs:{endpoint:'local',activeHost:'local'}};HTMLDialogElement.prototype.showModal=function(){this.open=true;};HTMLDialogElement.prototype.close=function(){this.open=false;};const node=document.createElement('div');document.body.append(node);root=createRoot(node);fake.page.mockImplementation(async archived=>({sessions:archived?[]:[session],cursor:null}));fake.pi.mockResolvedValue([]);fake.files.mockResolvedValue([]);fake.invoke.mockResolvedValue({path:'/data/opencode.db',sessions:[{id:'a',bytes:2048,messages:3}]});});
afterEach(()=>{act(()=>root.unmount());document.body.innerHTML='';vi.unstubAllGlobals();});
const mount=async(props:any)=>{await act(async()=>root.render(createElement(InformationDialog,props)));await act(async()=>{await new Promise(r=>setTimeout(r,0));});};
it('project presents real database accounting and a copyable storage path',async()=>{await mount({directory:'/p',onClose:vi.fn()});expect(document.body.textContent).toContain('2 КБ');expect(document.body.textContent).toContain('/data/opencode.db');expect(document.body.textContent).toContain('без индексов');expect(document.querySelector('[aria-label="Копировать путь истории"]')).not.toBeNull();expect(fake.invoke).toHaveBeenCalledWith('session_storage',{directory:'/p',ids:['a']});});
it('remote project never reads local storage or Pi',async()=>{fake.state.prefs.activeHost='remote';await mount({directory:'/p',onClose:vi.fn()});expect(fake.invoke).not.toHaveBeenCalled();expect(fake.pi).not.toHaveBeenCalled();expect(document.body.textContent).toContain('Размер недоступен');});
it('single Pi session uses its own file and does not query OpenCode',async()=>{fake.files.mockResolvedValue([{id:'a',cwd:'/p',file:'/pi/a.jsonl',bytes:1024}]);await mount({directory:'/p',session:{...session,projectID:'pi'},onClose:vi.fn()});expect(document.body.textContent).toContain('/pi/a.jsonl');expect(fake.page).not.toHaveBeenCalled();expect(fake.invoke).not.toHaveBeenCalled();});
it('host changes immediately hide previous data and close the modal',async()=>{const close=vi.fn();await mount({directory:'/p',session,onClose:close});fake.state={prefs:{endpoint:'other',activeHost:'remote'}};await mount({directory:'/p',session,onClose:close});expect(close).toHaveBeenCalled();expect(document.querySelector('dialog')).toBeNull();});

it('a backend reconnect rejects stale sizes and offers refresh instead of an endless loader',async()=>{
 let resolve!:(value:any)=>void;fake.invoke.mockReturnValue(new Promise(r=>{resolve=r;}));
 await mount({directory:'/p',session,onClose:vi.fn()});
 fake.backend={};await act(async()=>resolve({path:'/stale.db',sessions:[{id:'a',bytes:123,messages:1}]}));
 expect(document.body.textContent).not.toContain('/stale.db');expect(document.body.textContent).toContain('Подключение изменилось');expect(document.body.textContent).not.toContain('Загрузка сведений');expect(Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Обновить')).toBe(true);
});
