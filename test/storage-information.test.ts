import {expect,it,vi} from 'vitest';
import {formatBytes,informationTotals,projectSessionIndex} from '../src/storage/information';
import type {Session} from '../src/api/types';
const sess=(id:string,directory='/p'):Session=>({id,directory,title:id,projectID:'p',time:{created:1,updated:2}});
it('counts only known chat bytes and keeps unavailable different from zero',()=>{
 expect(informationTotals([{session:sess('a'),engine:'Pi',storage:{kind:'file',path:'/a',bytes:0}},{session:sess('b'),engine:'OpenCode'}])).toEqual({bytes:0,known:1,total:2});
 expect(formatBytes(1024)).toBe('1 КБ');expect(formatBytes(NaN)).toBe('Недоступно');
});
it('loads all scoped pages, archived and children, without cross-project leakage or duplicates',async()=>{
 const page=vi.fn(async(archived:boolean,cursor?:number)=>({sessions:archived?[sess('archive')]:cursor?[sess('child'),sess('a')]:[sess('a'),sess('foreign','/other')],cursor:!archived&&!cursor?7:null}));
 const result=await projectSessionIndex('/p',new AbortController().signal,page);
 expect(result.map(s=>s.id)).toEqual(['a','child','archive']);expect(page).toHaveBeenCalledTimes(3);expect(page.mock.calls[1][1]).toBe(7);
});
it('rejects repeated pagination and cancelled loads instead of displaying partial totals as complete',async()=>{
 await expect(projectSessionIndex('/p',new AbortController().signal,async()=>({sessions:[],cursor:7}))).rejects.toThrow('повторил');
 const controller=new AbortController();controller.abort();const page=vi.fn();await expect(projectSessionIndex('/p',controller.signal,page)).rejects.toThrow();expect(page).not.toHaveBeenCalled();
});
