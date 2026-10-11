import {describe,it,expect} from 'vitest';
// @ts-expect-error App-owned Node module is exercised directly.
import {createSearch,parseMcp,parseRss} from '../src-tauri/resources/shared/web-search-core.mjs';
const rss='<rss><channel><item><title>Node &amp; JS</title><link>https://nodejs.org/</link><description>Docs</description></item></channel></rss>';
describe('shared resilient search',()=>{
 it('falls back on403 and skips denied services during cooldown',async()=>{
  const calls:string[]=[];let time=1000;
  const s=createSearch({now:()=>time,fetcher:async(url:string)=>{calls.push(url);return url.includes('bing')?new Response(rss):new Response('Denied',{status:403});}});
  const a=await s.search({query:'Node documentation'});expect(a.provider).toBe('bing');expect(a.failures).toHaveLength(2);expect(a.results[0].url).toBe('https://nodejs.org/');
  await s.search({query:'Node documentation'});expect(calls).toHaveLength(4);
  time+=600001;await s.search({query:'Node documentation'});expect(calls).toHaveLength(7);
 });
 it('honors rate limit and exposes explicit all-provider failure',async()=>{
  let count=0;const s=createSearch({providers:['exa'],now:()=>1000,fetcher:async()=>{count++;return new Response('',{status:429,headers:{'Retry-After':'120'}});}});
  expect((await s.search({query:'test'})).isError).toBe(true);expect(s.status()[0].retryAt).toBe(121000);
  await s.search({query:'different'});expect(count).toBe(1);
 });
 it('does not fall back after user cancellation',async()=>{
  const c=new AbortController();let count=0;const s=createSearch({fetcher:async()=>{count++;c.abort();throw Error('network');}});
  await expect(s.search({query:'test'},c.signal)).rejects.toThrow();expect(count).toBe(1);
 });
 it('rejects MCP errors, HTML challenges, XML entities and unsafe links',()=>{
  expect(()=>parseMcp('{"result":{"isError":true,"content":[{"type":"text","text":"error"}]}}')).toThrow();
  expect(()=>parseRss('<html>captcha</html>',5)).toThrow();expect(()=>parseRss('<!DOCTYPE rss>'+rss,5)).toThrow();
  expect(()=>parseRss(rss.replace('https://nodejs.org/','javascript:alert(1)'),5)).toThrow();
 });
 it('parses SSE and treats valid empty results as success',async()=>{
  expect(parseMcp('data: {"result":{"content":[{"type":"text","text":"verified"}]}}\n\n')).toBe('verified');
  const s=createSearch({providers:['bing'],fetcher:async()=>new Response('<rss><channel></channel></rss>')});expect((await s.search({query:'rare'})).results).toEqual([]);
 });
 it('falls back on a bounded timeout and HTTP200 MCP error',async()=>{
  const s=createSearch({timeoutMs:20,fetcher:async(url:string,options:{signal:AbortSignal})=>{
   if(url.includes('parallel')) return await new Promise<Response>((_,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));
   if(url.includes('exa')) return new Response('{"result":{"isError":true,"content":[]}}');
   return new Response(rss);
  }});
  const result=await s.search({query:'test'});expect(result.provider).toBe('bing');expect(result.failures.map((f:{reason:string})=>f.reason)).toEqual(['timeout','provider_error']);
 });
 it('bounds responses and validates before making requests',async()=>{
  let count=0;const s=createSearch({providers:['bing'],fetcher:async()=>{count++;return new Response('x'.repeat(262145));}});
  await expect(s.search({query:'test',numResults:100})).rejects.toThrow();expect(count).toBe(0);
  expect((await s.search({query:'test'})).failures[0].reason).toBe('response_too_large');
 });
});
