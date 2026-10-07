// Real installed-app acceptance with CUA-operated panel/monitor controls.
// Run only when the shared browser is idle and has no open pages. Does not
// touch model inference, owner sessions or Chromium profile settings.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
const [command, runtime] = process.argv.slice(2);
assert(command && runtime && path.isAbsolute(command) && path.isAbsolute(runtime));
const { Client } = await import(pathToFileURL(path.join(runtime, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js')));
const { StdioClientTransport } = await import(pathToFileURL(path.join(runtime, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js')));
const ready = JSON.parse(await fs.readFile(path.join(path.dirname(runtime), 'ready.json')));
const frame = async () => {
  const response = await fetch(`http://127.0.0.1:${ready.port}/view`, { headers: { Authorization: `Bearer ${ready.token}` } });
  assert(response.ok); return response.json();
};
const before = await frame();
assert(!before.busy && before.tabs.length === 0, 'Acceptance requires an idle browser with no owner pages');
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'arvela-monitor-'));
const fixture = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<!doctype html><meta charset="utf-8"><title>Arvela monitor verification</title><style>body{font:24px sans-serif;margin:32px;height:2000px}input,button{font:22px sans-serif}</style><h1>Наблюдение за браузером</h1><p>Кадр <span id="clock">0</span></p><input id="input" aria-label="Monitor input"><p><button onclick="window.clicks++;document.querySelector('#result').textContent=document.querySelector('#input').value">Проверить ввод</button></p><p id="result">Ожидаю ввод</p><script>window.clicks=0;let tick=0;setInterval(()=>document.querySelector('#clock').textContent=++tick,1000)</script>`);
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const client = new Client({ name: 'browser-monitor-acceptance', version: '1' });
const lines = readline.createInterface({ input: process.stdin });
const closeLines=()=>lines.close();
process.once('SIGTERM',closeLines);process.once('SIGINT',closeLines);
let opened = false, baseline;
const evaluate = async () => {
  const r = await client.callTool({name:'browser_evaluate',arguments:{function:"() => ({input:document.querySelector('#input').value,result:document.querySelector('#result').textContent,clicks:window.clicks,scrollY:window.scrollY,tick:Number(document.querySelector('#clock').textContent)})"}});
  assert(!r.isError);
  const text=r.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
  return JSON.parse(text.split('### Result\n')[1].split('\n###')[0].split('\nDesktop browser state:')[0]);
};
try {
  await client.connect(new StdioClientTransport({ command, args: ['--browser-mcp'], cwd: workspace, stderr: 'pipe' }));
  const tools = await client.listTools(); assert.equal(tools.tools.length,36);
  const r=await client.callTool({name:'browser_navigate',arguments:{url:`http://127.0.0.1:${fixture.address().port}`}});
  assert(!r.isError);opened=true;
  console.log('FIXTURE_READY');
  for await(const line of lines){
    const step=line.trim();
    if(step==='baseline'){
      const v=await frame(), d=await evaluate();
      baseline={pageId:v.pageId,width:v.width,height:v.height,tabs:v.tabs.length,scrollY:d.scrollY};
      assert(v.image?.length>100 && d.input==='' && d.clicks===0);
      console.log(JSON.stringify({step,...baseline}));
    }else if(step==='preserved'){
      assert(baseline);const v=await frame(),d=await evaluate();
      for(const k of ['pageId','width','height'])assert.equal(v[k],baseline[k],k);
      assert.equal(v.tabs.length,baseline.tabs);assert.equal(d.scrollY,baseline.scrollY);
      assert.equal(d.input,'');assert.equal(d.clicks,0);
      console.log(JSON.stringify({step,noPageInput:true,viewportPreserved:true,liveTick:d.tick}));
    }else if(step==='restored'){
      assert(baseline);const v=await frame();assert.equal(v.pageId,baseline.pageId);assert.equal(v.tabs.length,baseline.tabs);
      console.log(JSON.stringify({step,samePage:true,width:v.width,height:v.height}));
    }else if(step==='manual'){
      const d=await evaluate();assert.equal(d.input,'MONITOR_PANEL_OK');assert.equal(d.result,'MONITOR_PANEL_OK');assert.equal(d.clicks,1);
      console.log(JSON.stringify({step,manualInputAndClick:true}));
    }else if(step==='done')break;
  }
}finally{
  lines.close();process.off('SIGTERM',closeLines);process.off('SIGINT',closeLines);
  if(opened){
    const v=await frame().catch(()=>undefined);
    if(v?.tabs.length===1 && v.title==='Arvela monitor verification'){
      const r=await client.callTool({name:'browser_tabs',arguments:{action:'close',index:0}});
      assert(!r.isError);console.log('FIXTURE_CLOSED');
    }
  }
  await client.close().catch(()=>{});fixture.closeAllConnections();
  await new Promise(resolve=>fixture.close(resolve));await fs.rm(workspace,{recursive:true,force:true});
}
