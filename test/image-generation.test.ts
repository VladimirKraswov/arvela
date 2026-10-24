import {expect,it} from 'vitest';
// @ts-expect-error Shared Node module intentionally runs outside the WebView.
import {createImages,validateConfig} from '../src-tauri/resources/shared/image-generation-core.mjs';
import {imageResult,turnImageResults} from '../src/images/results';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
it('rejects public HTTP, credential URLs and malicious image references',()=>{
 for(const endpoint of ['http://example.com','http://192.168.1.2.evil.test','https://key@example.com','https://a/?key=x','file:///tmp'])expect(()=>validateConfig({enabled:true,provider:'enki',model:'m',endpoint})).toThrow();
 expect(validateConfig({enabled:true,provider:'enki',model:'m',endpoint:'http://192.168.1.2/api/'}).endpoint).toBe('http://192.168.1.2/api');
 expect(imageResult(JSON.stringify({enkiImages:1,status:'completed',images:[{name:'image-01.png',url:'https://evil.test/x'}]}))).toBeNull();
 expect(imageResult(JSON.stringify({enkiImages:1,status:'completed',images:[{name:'image-01.png',url:'file:///tmp/.enki/generated-images/01234567-1234-1234-1234-123456789abc/image-01.png'}]}))?.images).toHaveLength(1);
});
it('creates bounded idempotent jobs with auth and never replays a failed POST',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'enki-images-'));try{
 const config=path.join(dir,'settings.json');await fs.writeFile(config,JSON.stringify({enabled:true,provider:'enki',model:'m',endpoint:'http://127.0.0.1/api'}));
 const calls:any[]=[];const run=createImages({configFile:config,cwd:dir,token:()=> 'private-token',fetcher:async(url:string,options:any)=>{calls.push({url,options});return new Response(url.endsWith('/health')?'{"status":"ready"}':'{"id":"job","status":"queued"}',{status:202})}});
 expect(await run('generate_icon_pack',{prompt:'flat blue icons',items:['sword','shield'],request_key:'stable'})).toEqual({id:'job',status:'queued'});
 expect(calls).toHaveLength(2);expect(calls[1].options.headers.Authorization).toBe('Bearer private-token');expect(calls[1].options.headers['Idempotency-Key']).toBe('stable');expect(JSON.parse(calls[1].options.body).items).toEqual(['sword','shield']);
 await expect(run('generate_image',{prompt:'x',request_key:'k',width:801})).rejects.toThrow();expect(calls).toHaveLength(2);
 let attempts=0;const failed=createImages({configFile:config,fetcher:async(url:string)=>{if(url.endsWith('/health'))return new Response('{"status":"ready"}');attempts++;throw Error('lost acknowledgement')}});
 await expect(failed('generate_image',{prompt:'x',request_key:'same'})).rejects.toThrow('lost acknowledgement');expect(attempts).toBe(1);
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
it('preserves existing files and refuses symlink destinations',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'enki-images-'));try{
 const config=path.join(dir,'settings.json');await fs.writeFile(config,JSON.stringify({enabled:true,provider:'openai',model:'m',endpoint:'https://example.com/v1'}));await fs.symlink(os.tmpdir(),path.join(dir,'.enki'),'junction');
 const run=createImages({configFile:config,cwd:dir,fetcher:async()=>new Response(JSON.stringify({data:[{b64_json:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4l8AAAAASUVORK5CYII='}]}))});
 await expect(run('generate_image',{prompt:'x',request_key:'k'})).rejects.toThrow('ссылкой');
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});

it('keeps one visible set of generated images after repeated tool retrievals',()=>{
 const output=JSON.stringify({enkiImages:1,status:'completed',images:[{name:'image-01.png',url:'file:///tmp/.enki/generated-images/01234567-1234-1234-1234-123456789abc/image-01.png'}]});
 expect(turnImageResults([{state:{output}},{state:{output}},{state:{output:'unrelated'}}])).toHaveLength(1);
});

it('accepts only the bounded material map names and keeps their previews visible',()=>{
 const base='file:///tmp/.enki/generated-images/01234567-1234-1234-1234-123456789abc/';
 expect(imageResult(JSON.stringify({enkiImages:1,status:'completed',images:[{name:'normal.png',url:base+'normal.png',previewUrl:base+'preview-normal.png'}]}))?.images[0].name).toBe('normal.png');
 expect(imageResult(JSON.stringify({enkiImages:1,status:'completed',images:[{name:'private.png',url:base+'private.png'}]}))).toBeNull();
});
it('recovers a temporary read-only outage before submitting one generation',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'enki-images-'));try{
  const config=path.join(dir,'settings.json');await fs.writeFile(config,JSON.stringify({enabled:true,provider:'enki',model:'m',endpoint:'http://127.0.0.1/api'}));
  let reads=0,posts=0;const run=createImages({configFile:config,fetcher:async(_url:string,options:any)=>{if(options.method==='POST'){posts++;return new Response('{"id":"j","status":"queued"}',{status:202})}reads++;return reads===1?new Response('temporary',{status:502}):new Response('{"status":"ready"}')}});
  expect(await run('generate_image',{prompt:'stone',request_key:'one'})).toEqual({id:'j',status:'queued'});expect(reads).toBe(2);expect(posts).toBe(1);
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
