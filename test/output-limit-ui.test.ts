// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
const fake = vi.hoisted(()=>({active:'s',last:'a',running:false,sending:false,compact:vi.fn(),prompt:vi.fn()}));
vi.mock('../src/state/store',()=>({useAppState:()=>({activeSessionId:fake.active,ui:{sending:fake.sending},chat:{sessions:{s:{messageOrder:[fake.last]}}}}),store:{isRunning:()=>fake.running,conversation:()=>({capabilities:{compaction:true}}),compactSession:fake.compact,sendPrompt:fake.prompt}}));
import Notice from '../src/components/OutputLimitNotice';
import type {AssistantMessage,MessagePart} from '../src/api/types';
let root:Root|undefined;
const message={id:'a',sessionID:'s',role:'assistant',time:{created:1,completed:2},finish:'length'} as AssistantMessage;
function mount(){vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);if(!root){const el=document.createElement('div');document.body.append(el);root=createRoot(el);}act(()=>root!.render(createElement(Notice,{sessionId:'s',message,parts:[{id:'p',type:'reasoning',text:'?!'.repeat(1000)} as MessagePart]})));}
afterEach(()=>{if(root)act(()=>root!.unmount());root=undefined;document.body.innerHTML='';fake.active='s';fake.last='a';fake.running=false;fake.sending=false;vi.clearAllMocks();vi.unstubAllGlobals();});
it('offers explicit compaction for the latest stopped turn and never sends a continuation itself',async()=>{
 let done!:()=>void;fake.compact.mockImplementation(()=>new Promise<void>(r=>done=r));mount();
 expect(document.body.textContent).toContain('зациклилась');
 await act(async()=>document.querySelector<HTMLButtonElement>('button')!.click());
 expect(fake.compact).toHaveBeenCalledExactlyOnceWith('s');expect(document.querySelector('button')?.disabled).toBe(true);
 await act(async()=>done());expect(document.querySelector('button')?.disabled).toBe(false);expect(fake.prompt).not.toHaveBeenCalled();
});
it('does not offer an old turn or another active session as a recovery target',()=>{
 fake.last='newer';mount();expect(document.querySelector('button')).toBeNull();
 fake.last='a';fake.active='other';mount();expect(document.querySelector('button')).toBeNull();
 fake.active='s';fake.running=true;mount();expect(document.querySelector('button')).toBeNull();
 fake.running=false;fake.sending=true;mount();expect(document.querySelector('button')).toBeNull();
});
