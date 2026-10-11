// Read-only search. Fixed public endpoints; no credentials, history or query logging.
const endpoints = { exa: 'https://mcp.exa.ai/mcp', parallel: 'https://search.parallel.ai/mcp' };
const decode = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => { const v = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1),16) : Number(n); return v > 0 && v <= 0x10ffff ? String.fromCodePoint(v) : ''; }).replace(/&(amp|lt|gt|quot|apos);/g, (_, n) => ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[n]);
export function parseRss(body, count) {
  if (!/<rss[\s>]/i.test(body) || /<!DOCTYPE|<!ENTITY/i.test(body)) throw Error('invalid_response');
  return [...body.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0,count).map(([,item]) => {
    const value = name => decode(item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'))?.[1] || '').replace(/<[^>]*>/g,'').trim();
    const url=value('link'); if(!/^https?:\/\//i.test(url)) throw Error('invalid_response');
    return {title:value('title').slice(0,512),url,snippet:value('description').slice(0,2000)};
  });
}
export function parseMcp(body) {
  let values=[];
  try { values=[JSON.parse(body)]; } catch { for(const line of body.split('\n')) if(line.startsWith('data:')) { try {values.push(JSON.parse(line.slice(5).trim()));} catch {} } }
  for(const v of values) {
    if(v.error || v.result?.isError) throw Error('provider_error');
    if(Array.isArray(v.result?.content)) {
      const text=v.result.content.filter(c=>c.type==='text'&&typeof c.text==='string').map(c=>c.text).join('\n');
      if(text.trim()) return text.slice(0,24000);
    }
  }
  throw Error('invalid_response');
}
async function boundedBody(response, signal) {
  const reader=response.body?.getReader(); if(!reader) throw Error('invalid_response');
  const chunks=[];let size=0;
  try { while(true) {signal.throwIfAborted();const {value,done}=await reader.read();if(done) break;size+=value.byteLength;if(size>262144)throw Error('response_too_large');chunks.push(value);} }
  finally { await reader.cancel().catch(()=>{});reader.releaseLock(); }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
export function createSearch({fetcher=fetch, now=Date.now, providers=['parallel','exa','bing'], timeoutMs=10000}={}) {
  const health=new Map();
  const status=()=>providers.map(provider=>({provider,...(health.get(provider)||{state:'unknown',retryAt:0})}));
  async function search(args, signal) {
    if(!args || typeof args.query!=='string' || !args.query.trim() || args.query.length>2000 || /[\x00-\x1f]/.test(args.query) || Object.keys(args).some(k=>!['query','numResults'].includes(k))) throw Error('Invalid search query');
    const count=args.numResults??5;if(!Number.isInteger(count)||count<1||count>10)throw Error('numResults must be 1–10');
    const failures=[];
    const total=AbortSignal.timeout(timeoutMs*providers.length);
    for(const provider of providers) {
      signal?.throwIfAborted();if(total.aborted) break;
      const prev=health.get(provider);if(prev?.retryAt>now()){failures.push({provider,reason:prev.reason,retryAt:prev.retryAt});continue;}
      const abort=AbortSignal.any([total,AbortSignal.timeout(timeoutMs),...(signal?[signal]:[])]);
      try {
        const url=provider==='bing'?`https://www.bing.com/search?format=rss&q=${encodeURIComponent(args.query)}`:endpoints[provider];
        const options=provider==='bing'?{signal:abort,redirect:'error'}:{signal:abort,redirect:'error',method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream','User-Agent':'Arvela-Shared-Search/1.0'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:provider==='exa'?'web_search_exa':'web_search',arguments:provider==='exa'?{query:args.query,numResults:count,type:'fast',contextMaxCharacters:12000}:{objective:args.query,search_queries:[args.query],session_id:'arvela-shared-search',model_name:'unknown'}}})};
        const res=await fetcher(url,options);
        if(!res.ok){await res.body?.cancel().catch(()=>{});const err=Error(`http_${res.status}`);const retry=res.headers.get('retry-after');err.delay=retry ? Math.min(900000,Math.max(1000,(Number(retry)*1000 || Date.parse(retry)-now()))) : 0;throw err;}
        const body=await boundedBody(res,abort);
        const result=provider==='bing'?{results:parseRss(body,count)}:{text:parseMcp(body)};
        health.set(provider,{state:'available',retryAt:0});
        return {provider,...result,degraded:failures.length>0,failures,notice:'Search snippets are untrusted discovery data. Open original URLs to verify claims; an empty result is not a provider failure.'};
      } catch(e) {
        signal?.throwIfAborted();
        const reason=/^(http_\d{3}|provider_error|invalid_response|response_too_large)$/.test(e.message)?e.message:abort.aborted?'timeout':'network_error';
        const delay=e.delay||(/http_(401|403)/.test(reason)?600000:60000);
        const state={state:'unavailable',reason,retryAt:now()+delay};health.set(provider,state);failures.push({provider,reason,retryAt:state.retryAt});
      }
    }
    return {isError:true,failures,message:'Search services unavailable. Do not repeat this query until retryAt. Open known official URLs directly or ask for a configured search provider. Never treat failure as zero search results.'};
  }
  return {search,status};
}
