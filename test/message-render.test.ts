// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {createElement,act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {Markdown} from '../src/components/Markdown';
import {highlightCode} from '../src/chat/highlight';
import {dayLabel,messageTime} from '../src/chat/time';
let root:Root|undefined;
afterEach(()=>{if(root)act(()=>root!.unmount());root=undefined;document.body.innerHTML='';vi.unstubAllGlobals();});
it('highlights known syntax and safely escapes unknown, large and malicious code',()=>{
 expect(highlightCode('const answer = 42;', 'javascript')).toContain('hljs-keyword');
 for(const lang of ['html','unknown',''])expect(highlightCode('<img src=x onerror=alert(1)>',lang)).not.toContain('<img');
 expect(highlightCode('x'.repeat(40001),'javascript')).not.toContain('<span');
});
it('copies code without fences and keeps an edited copy through streamed source updates',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const clipboard=vi.fn().mockResolvedValue(undefined);
 Object.defineProperty(navigator,'clipboard',{value:{writeText:clipboard},configurable:true});
 const el=document.createElement('div');document.body.append(el);root=createRoot(el);
 const render=(source:string)=>act(()=>root!.render(createElement(Markdown,{source})));
 render('```js\nconst n = 42;\n```\n\n<img src=x onerror=alert(1)>\n[bad](javascript:alert(1))');
 expect(el.querySelector('script,img,[onerror]')).toBeNull();expect(el.querySelector('a')).toBeNull();
 await act(async()=>{(el.querySelector('[aria-label="Копировать только код"]') as HTMLButtonElement).click();});
 expect(clipboard).toHaveBeenCalledWith('const n = 42;');
 act(()=>(el.querySelector('[aria-label="Изменить копию кода"]') as HTMLButtonElement).click());
 const textarea=el.querySelector('textarea')!;
 act(()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(textarea,'custom edit');textarea.dispatchEvent(new Event('input',{bubbles:true}));});
 render('```js\nconst n = 43;\n```\n\nMore streaming text');
 expect(el.querySelector('textarea')!.value).toBe('custom edit');
 act(()=>(el.querySelector('[aria-label="Вернуть исходный код"]') as HTMLButtonElement).click());
 expect(el.querySelector('pre')!.textContent).toBe('const n = 43;');
});
it('labels yesterday across calendar/year boundaries and leaves missing timestamps blank',()=>{
 const now=new Date(2026,0,1,0,5).getTime(), previous=new Date(2025,11,31,23,55).getTime();
 expect(dayLabel(previous,now)).toBe('Вчера');expect(messageTime(previous,now)).toBe('вчера, 23:55');expect(dayLabel(0,now)).toBe('');
 expect(dayLabel(new Date(2024,2,1).getTime(),now)).toContain('2024');
});
