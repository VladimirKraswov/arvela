// @vitest-environment jsdom
import {act,createElement,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({state:null as any,listeners:new Set<()=>void>()}));
vi.mock('../src/state/store',()=>({
 useAppState:()=>useSyncExternalStore(cb=>{fixture.listeners.add(cb);return()=>fixture.listeners.delete(cb);},()=>fixture.state),
 store:{get state(){return fixture.state;},pendingInteraction:()=>({permissions:[],questions:[]}),setConversationAtBottom:()=>{},engineIdFor:()=> 'opencode',handoffOrigin:()=>null,isPiSession:()=>false,
 setUi:(patch:any)=>{fixture.state={...fixture.state,ui:{...fixture.state.ui,...patch}};for(const cb of fixture.listeners)cb();}},
}));
vi.mock('../src/components/WorkspacePicker',()=>({WorkspacePicker:()=>null}));
vi.mock('../src/components/render',()=>({
 UserMessageView:({message}:any)=>createElement('span',{'data-scroll-anchor':message.id},message.id),
 AssistantTurnView:({messages,active}:any)=>createElement('span',{'data-active':active},messages.map((m:any)=>m.id).join(' ')),
 PermissionCard:()=>null,QuestionCard:()=>null,
}));
import {ChatView} from '../src/components/ChatView';
function chat(prefix:string,n:number){const messageOrder=Array.from({length:n},(_,i)=>prefix+i);return{messageOrder,messages:Object.fromEntries(messageOrder.map(id=>[id,{id,role:'user',time:{created:1}}])),status:{type:'busy'}};}
let cleanup=()=>{};
afterEach(()=>{cleanup();vi.unstubAllGlobals();document.body.innerHTML='';fixture.listeners.clear();});
it('mounts bounded tails across live growth and repeated chat switches, and preserves reading/reveal/navigation',()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
 const a=chat('a',20000),b=chat('b',5000);
 fixture.state={prefs:{endpoint:'test'},directory:'fixture',activeSessionId:'a',chat:{sessions:{a,b}},ui:{},connection:{streamState:'open'},historyCursors:{},olderExhausted:{}};
 const el=document.createElement('div');document.body.append(el);const root=createRoot(el);cleanup=()=>act(()=>root.unmount());
 act(()=>root.render(createElement(ChatView)));
 const ids=()=>Array.from(el.querySelectorAll<HTMLElement>('[data-message-ids]'),x=>x.dataset.messageIds);
 const publish=(patch:any)=>act(()=>{fixture.state={...fixture.state,...patch};for(const cb of fixture.listeners)cb();});
 const click=(label:string)=>act(()=>{const button=Array.from(el.querySelectorAll('button')).find(x=>(x.textContent??'').includes(label));expect(button).toBeTruthy();button!.click();});
 expect(ids()).toHaveLength(60);expect(ids()[0]).toBe('a19940');
 for(let n=0;n<100;n++){const id='live'+n;a.messageOrder.push(id);a.messages[id]={id,role:'user',time:{created:1}};publish({});expect(ids()).toHaveLength(60);}
 for(let n=0;n<10;n++){publish({activeSessionId:'b'});expect(ids()).toHaveLength(60);publish({activeSessionId:'a'});expect(ids()).toHaveLength(60);}
 click('предыдущих');expect(ids()).toHaveLength(120);const first=ids()[0];
 const id='another';a.messageOrder.push(id);a.messages[id]={id,role:'user',time:{created:1}};publish({});expect(ids()[0]).toBe(first);expect(ids()).toHaveLength(120);
 publish({activeSessionId:'b'});publish({activeSessionId:'a'});expect(ids()[0]).toBe(first);expect(ids()).toHaveLength(120);
 publish({ui:{revealMessage:{sessionID:'a',directory:'fixture',server:'test',messageID:'a500'}}});expect(ids()[0]).toBe('a500');expect(document.activeElement?.getAttribute('data-message-ids')).toBe('a500');
 click('Следующие сообщения');expect(ids()[0]).toBe('a560');expect(ids()).toHaveLength(120);
 click('Вниз');expect(ids()).toHaveLength(60);expect(ids().at(-1)).toBe('another');
});
