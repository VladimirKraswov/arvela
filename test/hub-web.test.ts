import {describe,it,expect,vi} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
const html=readFileSync('services/hub/web/index.html','utf8');
const script=readFileSync('services/hub/web/app.js','utf8');
function fixture(){
 const dom=new JSDOM(html,{url:'https://hub.test',runScripts:'outside-only'}),w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){if(this.open){this.open=false;this.dispatchEvent(new w.Event('close'));}};
 const session={id:'safe-id',title:'Long task',engine:'pi',project:'project',updated:1,verdict:'unreviewed',notes:'Keep this note'};
 const record=(id:string,text:string)=>({id,role:'assistant',model:'local',variant:'medium',created:1,total:20,text,tools:[],error:'',truncated:false,assessments:id==='new'?[{deviceName:'Mac',revision:2,goal:'<script>unsafe()</script>',criteria:'Reopen preserves value',notes:'Owner note',verdict:'accepted',checks:[{name:'Reopen',status:'passed',evidence:'Observed restored value'}]}]:[]});
 const fetch=vi.fn(async(path:string)=>{
  const url=new URL(path,'https://hub.test');let data:any={};
  if(url.pathname==='/api/me')data={admin:true};
  else if(url.pathname==='/api/devices')data={devices:[]};
  else if(url.pathname==='/api/catalog')data={items:[{id:'private-package',title:'Private package',kind:'prompt',description:'Own catalog',enabled:true,revision:'1234567890abcdef'}]};
  else if(url.pathname==='/api/catalog/private-package')data={files:{'prompt.md':'PRIVATE_CATALOG_TEXT'}};
  else if(url.pathname==='/api/metrics')data={totals:{},counts:{},models:[],days:[],tools:[],attribution:'',reasoning:''};
  else if(url.pathname==='/api/sessions')data={sessions:url.searchParams.has('cursor')?[{...session,id:'older-id',title:'Older task'}]:[session],nextCursor:url.searchParams.has('cursor')?null:'next-index'};
  else if(url.pathname==='/api/sessions/safe-id')data={session,records:url.searchParams.has('cursor')?[record('old','Earlier text')]:[record('new','Latest answer')],nextCursor:url.searchParams.has('cursor')?null:'older-page',total:2};
  else if(url.pathname==='/api/diagnostics')data={records:2,sessions:1,tools:4,toolErrors:3,agentErrors:0,repliesWithNonzeroUsage:1,from:1,to:2,note:'Recorded status, not a quality score',groups:[{label:'Отказ доступа',review:false,count:1,sessionCount:1,advice:'Respect the refusal',tools:{bash:1},sessions:[]},{label:'Устаревший фрагмент файла',review:true,count:2,sessionCount:1,advice:'Read the file again',tools:{edit:2},sessions:[session]}]};
  return {ok:true,status:200,json:async()=>data};
 });
 Object.assign(w,{fetch});w.eval(script);
 const click=(text:string)=>{const b=[...w.document.querySelectorAll('button')].find(x=>x.textContent===text);if(!b)throw Error('Button unavailable: '+text);b.click();};
 return {w,dom,fetch,click};
}
describe('private Hub Web UI',()=>{
 it('loads latest records first, preserves notes across earlier pages and clears private detail on logout',async()=>{
  const f=fixture();try{
   await vi.waitFor(()=>expect(f.w.document.querySelector('#workspace')?.hasAttribute('hidden')).toBe(false));
   f.click('История');await vi.waitFor(()=>expect(f.w.document.querySelector('#view')?.textContent).toContain('Long task'));
   f.click('Показать ещё сессии');await vi.waitFor(()=>expect(f.w.document.querySelector('#view')?.textContent).toContain('Older task'));
   f.click('Открыть');await vi.waitFor(()=>expect(f.w.document.querySelector('#detail-body')?.textContent).toContain('Latest answer'));
   expect(f.fetch.mock.calls.some(([path])=>path.includes('direction=older'))).toBe(true);
   const note=f.w.document.querySelector('textarea[aria-label="Заметка для анализа"]') as HTMLTextAreaElement;note.value='Owner draft';
   f.click('Показать более ранние сообщения');await vi.waitFor(()=>expect(f.w.document.querySelector('#detail-body')?.textContent).toContain('Показано 2 из 2'));
   expect(note.value).toBe('Owner draft');expect(f.w.document.querySelector('#detail-body')?.textContent?.indexOf('Earlier text')).toBeLessThan(f.w.document.querySelector('#detail-body')?.textContent?.indexOf('Latest answer')!);
   f.click('Выйти');await vi.waitFor(()=>expect(f.w.document.querySelector('#detail-body')?.textContent).toBe(''));
   expect((f.w.document.querySelector('#detail') as HTMLDialogElement).open).toBe(false);
  }finally{f.dom.window.close();}
 });
 it('shows owner evidence as escaped text, separate from dataset approval',async()=>{
  const f=fixture();try{
   await vi.waitFor(()=>expect(f.w.document.querySelector('#workspace')?.hasAttribute('hidden')).toBe(false));f.click('История');await vi.waitFor(()=>expect(f.w.document.querySelector('#view')?.textContent).toContain('Long task'));f.click('Открыть');
   await vi.waitFor(()=>expect(f.w.document.querySelector('#detail-body')?.textContent).toContain('Оценка результата · Mac'));
   expect(f.w.document.querySelector('#detail-body')?.textContent).toContain('Принято пользователем');expect(f.w.document.querySelector('#detail-body')?.textContent).toContain('не одобряет сессию для датасета');
   expect(f.w.document.querySelector('#detail-body')?.textContent).toContain('<script>unsafe()</script>');expect(f.w.document.querySelector('#detail-body script')).toBeNull();
   expect(f.w.document.querySelector('#detail-body')?.textContent).toContain('Observed restored value');
  }finally{f.dom.window.close();}
 });
 it('filters expected refusals separately and links to the affected session',async()=>{
  const f=fixture();try{
   await vi.waitFor(()=>expect(f.w.document.querySelector('#workspace')?.hasAttribute('hidden')).toBe(false));f.click('Разбор работы');
   await vi.waitFor(()=>expect(f.w.document.querySelector('#view')?.textContent).toContain('Устаревший фрагмент файла'));
   const filter=f.w.document.querySelector('select[aria-label="Тип проблем"]') as HTMLSelectElement;filter.value='review';filter.dispatchEvent(new f.w.Event('change'));
   expect(f.w.document.querySelector('#view')?.textContent).not.toContain('Respect the refusal');
   expect(f.w.document.querySelector('#view')?.textContent).toContain('Read the file again');
   f.click('project · pi');await vi.waitFor(()=>expect(f.w.document.querySelector('#detail-body')?.textContent).toContain('Latest answer'));
  }finally{f.dom.window.close();}
 });
 it('does not reopen a closed dialog when a slow history request finishes',async()=>{
  const f=fixture();try{
   await vi.waitFor(()=>expect(f.w.document.querySelector('#workspace')?.hasAttribute('hidden')).toBe(false));f.click('История');
   await vi.waitFor(()=>expect(f.w.document.querySelector('#view')?.textContent).toContain('Long task'));
   const original=f.fetch.getMockImplementation()!;let resolve!:()=>void;
   f.fetch.mockImplementation(async(path:string)=>{if(path.includes('/sessions/safe-id'))await new Promise<void>(r=>{resolve=r;});return original(path);});
   f.click('Открыть');await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'));
   f.click('×');resolve();await new Promise(r=>setTimeout(r,0));expect((f.w.document.querySelector('#detail') as HTMLDialogElement).open).toBe(false);
   expect(f.w.document.querySelector('#detail-body')?.textContent).toBe('');
  }finally{f.dom.window.close();}
 });
 it('discards a late private catalog response after logout',async()=>{
  const f=fixture();try{
   await vi.waitFor(()=>expect(f.w.document.querySelector('#workspace')?.hasAttribute('hidden')).toBe(false));f.click('Библиотека');
   await vi.waitFor(()=>expect(f.w.document.querySelector('#view')?.textContent).toContain('Private package'));
   const original=f.fetch.getMockImplementation()!;let resolve!:()=>void;
   f.fetch.mockImplementation(async(path:string)=>{if(path==='/api/catalog/private-package')await new Promise<void>(r=>{resolve=r;});return original(path);});
   f.click('Посмотреть пакет');await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'));f.click('Выйти');
   await vi.waitFor(()=>expect(f.w.document.querySelector('#workspace')?.hasAttribute('hidden')).toBe(true));resolve();await new Promise(r=>setTimeout(r,0));
   expect((f.w.document.querySelector('#detail') as HTMLDialogElement).open).toBe(false);expect(f.w.document.body.textContent).not.toContain('PRIVATE_CATALOG_TEXT');
  }finally{f.dom.window.close();}
 });
});
