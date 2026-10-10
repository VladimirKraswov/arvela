// Real SDK/Chromium regression checks. Only temporary test-owned profiles,
// localhost fixtures and read-only managed dependencies; no owner sessions.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const [runtime,browsers]=process.argv.slice(2);
assert(runtime && browsers && path.isAbsolute(runtime) && path.isAbsolute(browsers));
const root=await fs.mkdtemp(path.join(os.tmpdir(),'oc-browser-recovery-'));
const {Client}=await import(pathToFileURL(path.join(runtime,'node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js')));
const {StdioClientTransport}=await import(pathToFileURL(path.join(runtime,'node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js')));
let child,ready,client,fixture;let clicks=0,entered,deadlineEntered;
const inputEntered=new Promise(resolve=>{entered=resolve;});
const deadlineStarted=new Promise(resolve=>{deadlineEntered=resolve;});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
try {
 fixture=http.createServer((req,res)=>{
  if(req.url==='/deadline-entered'){deadlineEntered();res.end('ok');return;}
  if(req.url==='/entered'){clicks++;entered();res.end('ok');return;}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Queue fixture</title><button onclick="fetch(\'/entered\')">Start fixture</button><p>Independent session ready</p>');
 });await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
 child=spawn(process.execPath,[path.join(runtime,'daemon.mjs'),root],{stdio:['pipe','ignore','ignore'],env:{...process.env,PLAYWRIGHT_BROWSERS_PATH:browsers}});
 for(let i=0;i<100;i++){try{ready=JSON.parse(await fs.readFile(path.join(root,'ready.json')));break;}catch{await pause(50);}}
 assert(ready,'test daemon readiness');
 const cwd=path.join(root,'project');await fs.mkdir(cwd);
 client=new Client({name:'recovery-acceptance',version:'1.0.0'});await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(runtime,'proxy.mjs'),root],cwd,stderr:'pipe'}));
 const call=(session,name,args={})=>client.callTool({name,arguments:{...args,__arvelaSession:{engine:'opencode',sessionID:session}}});
 const url=`http://127.0.0.1:${fixture.address().port}/`;
 for(const session of ['a','b'])assert(!(await call(session,'browser_navigate',{url})).isError);
 const small=await call('a','browser_observe',{maxChars:600});assert(!small.isError);
 const text=small.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');const ref=text.split('\n').find(l=>l.includes('Start fixture'))?.match(/\[ref=([^\]]+)\]/)?.[1];assert(ref);
 const malformed=await call('b','browser_sequence',{steps:'SECRET_INPUT',observation:{maxChars:600}});
 assert.equal(malformed.isError,true);assert.equal(malformed.structuredContent.reason,'arguments');assert.equal(malformed.structuredContent.completed,0);assert(!JSON.stringify(malformed).includes('SECRET_INPUT'));
 const pending=call('a','browser_action',{step:{tool:'browser_click',arguments:{target:ref}},waitFor:{text:'NEVER_APPEARS'},timeoutMs:5000,observation:{maxChars:900}});
 await Promise.race([inputEntered,pause(5000).then(()=>{throw Error('fixture input did not arrive');})]);
 const started=performance.now();const independent=await call('b','browser_observe',{maxChars:800});
 assert(!independent.isError);assert(performance.now()-started<2500,'other session must not wait behind A');
 const result=await pending;assert(result.isError);assert.equal(result.structuredContent.completed,1);assert.equal(result.structuredContent.noReplay,true);assert.equal(clicks,1);
 // A real slow backend call must return controlled uncertainty before MCP's
 // default60s timeout, while retaining A's barrier until the backend settles.
 const began=performance.now();
 const slow=call('a','browser_evaluate',{function:"async () => { await fetch('/deadline-entered'); await new Promise(r => setTimeout(r, 50000)); return 'TEST_BACKEND_SETTLED'; }"});
 await Promise.race([deadlineStarted,pause(5000).then(()=>{throw Error('slow fixture did not enter');})]);
 const other=await call('b','browser_observe',{maxChars:600});assert(!other.isError);
 const timed=await slow;assert(timed.isError);assert.equal(timed.structuredContent.reason,'deadline');assert.equal(timed.structuredContent.uncertainLastAction,true);assert.equal(timed.structuredContent.noReplay,true);
 assert(performance.now()-began>=44000 && performance.now()-began<58000,'return before outer MCP timeout');
 const barrier=performance.now();assert(!(await call('a','browser_observe',{maxChars:600})).isError);
 assert(performance.now()-barrier>=3000,'retain ordering while the backend settles');
 const health=await fetch(`http://127.0.0.1:${ready.port}/health`,{headers:{Authorization:`Bearer ${ready.token}`}}).then(r=>r.json());
 assert(health.performance.failed>=3,'retain reported validation/wait/outer timeout failures in numeric metrics');
 console.log('REAL_SDK_SMALL_OBSERVATION_VALUE_FREE_VALIDATION_INDEPENDENT_SESSION_QUEUE_DEADLINE_BARRIER_NO_REPLAY_PASS');
} finally {
 await client?.close().catch(()=>{});
 if(ready)await fetch(`http://127.0.0.1:${ready.port}/stop`,{method:'POST',headers:{Authorization:`Bearer ${ready.token}`,'Content-Type':'application/json'},body:'{}'}).catch(()=>{});
 if(child){for(let i=0;i<50&&child.exitCode===null;i++)await pause(50);if(child.exitCode===null)child.kill('SIGKILL');}
 if(fixture)await new Promise(resolve=>fixture.close(resolve));
 await fs.rm(root,{recursive:true,force:true});
}
