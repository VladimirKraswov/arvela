// Opt-in real daemon + Chromium test. Only reads an existing runtime's npm
// dependencies/browser binaries; all profiles and network fixtures are ours.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const dependencies = process.argv[2], browsers = process.argv[3];
assert(dependencies && path.isAbsolute(dependencies) && browsers && path.isAbsolute(browsers), 'Pass absolute current runtime and browser binary cache paths');
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'oc-browser-preferences-')));
const runtime = path.join(root, 'current'), workspace = path.join(root, 'workspace');
let child, fixture, ready;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  await fs.mkdir(runtime); await fs.mkdir(workspace);
  const source = fileURLToPath(new URL('../', import.meta.url));
  for (const name of await fs.readdir(source)) if (name.endsWith('.mjs')) await fs.copyFile(path.join(source, name), path.join(runtime, name));
  await fs.symlink(path.join(dependencies, 'node_modules'), path.join(runtime, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const start = async () => {
    ready = undefined;
    child = spawn(process.execPath, [path.join(runtime, 'daemon.mjs'), root], {stdio:['pipe','ignore','pipe'],env:{...process.env, OCDESKTOP_BROWSER_OWNER_PIPE:'1',PLAYWRIGHT_BROWSERS_PATH:browsers}});
    let errors = ''; child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-2000); });
    for (let i = 0; i < 150; i++) {
    try { ready = JSON.parse(await fs.readFile(path.join(root, 'ready.json'), 'utf8')); break; } catch {}
    if (child.exitCode !== null) throw Error(errors);
    await pause(100);
  }
    assert(ready, 'daemon ready');
  };
  const stop = async () => {
    child.stdin.end();
    for (let i=0;i<100 && child.exitCode === null;i++) await pause(100);
    assert.equal(child.exitCode,0,'owned daemon clean shutdown');
  };
  await start();
  const endpoint = () => `http://127.0.0.1:${ready.port}`;
  const headers = () => ({Authorization:`Bearer ${ready.token}`, 'Content-Type':'application/json'});
  const rpc = async payload => {
    const response = await fetch(`${endpoint()}/rpc`, {method:'POST',headers:headers(),body:JSON.stringify(payload),signal:AbortSignal.timeout(55000)});
    const value = await response.json();
    if (!response.ok || value.error) throw Error(value.error || 'RPC failed');
    return value.result;
  };
  const health = async () => (await fetch(`${endpoint()}/health`, {headers:headers()})).json();
  const tool = async (id, name, args = {}) => {
    const value = await rpc({method:'tools/call',workspace,session:{engine:'opencode',sessionID:id},params:{name,arguments:args}});
    assert(!value.isError, value.content?.filter(c=>c.type==='text').map(c=>c.text).join('\n'));
    return value.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
  };
  let lastHeaders, workerRequests = 0;
  fixture = http.createServer((req,res) => {
    lastHeaders = req.headers;
    if (req.url === '/worker.js') { workerRequests++; res.setHeader('Content-Type','application/javascript'); res.end('self.addEventListener("fetch", () => {});'); return; }
    res.setHeader('Content-Type','text/html');
    res.end('<!doctype html><title>Settings fixture</title><p>Settings fixture</p><input id="pace">');
  });
  await new Promise(resolve => fixture.listen(0,'127.0.0.1',resolve));
  const url = `http://127.0.0.1:${fixture.address().port}`;
  await tool('old', 'browser_navigate', {url});
  const evaluate = async (id, fn) => (await tool(id, 'browser_evaluate', {function:fn})).split('\nDesktop browser state:')[0];
  await evaluate('old', '() => {localStorage.setItem("persistent-probe","PERSIST_OK"); return true}');
  const original = await evaluate('old', '() => ({lang:navigator.language,zone:Intl.DateTimeFormat().resolvedOptions().timeZone})');
  const result = await rpc({method:'desktop/preferences',environment:{locale:'fr-FR',timezone:'Asia/Tokyo',colorScheme:'dark',reducedMotion:'reduce',doNotTrack:true,protectWebRTC:true,storage:'temporary',serviceWorkers:'block',reduceAutomationSignals:true,actionDelayMs:150}});
  assert.equal(result.pending,1);
  assert.equal(await evaluate('old', '() => ({lang:navigator.language,zone:Intl.DateTimeFormat().resolvedOptions().timeZone})'), original, 'open contexts remain unchanged');
  await assert.rejects(() => rpc({method:'desktop/preferences',environment:{args:['--no-sandbox']}}));
  assert.equal((await health()).environment.locale, 'fr-FR', 'invalid updates cannot replace valid config');
  await tool('private', 'browser_navigate', {url});
  const facts = await evaluate('private', `() => ({webdriver:navigator.webdriver,lang:navigator.language,zone:Intl.DateTimeFormat().resolvedOptions().timeZone,dark:matchMedia('(prefers-color-scheme:dark)').matches,motion:matchMedia('(prefers-reduced-motion:reduce)').matches})`);
  for (const expected of ['fr-FR','Asia/Tokyo','"dark": true','"motion": true','"webdriver": false']) assert(facts.includes(expected), facts);
  assert.equal(lastHeaders.dnt, '1'); assert.match(lastHeaders['accept-language'],/^fr-FR/);
  await evaluate('private', 'async () => {await navigator.serviceWorker.register("/worker.js");return (await navigator.serviceWorker.getRegistrations()).length}');
  assert.equal(workerRequests,0, 'blocked worker registration never fetches the script');
  await evaluate('old', 'async () => {await navigator.serviceWorker.register("/worker.js");return "registered"}');
  assert.equal(workerRequests,1, 'the same valid worker is requested when allowed');
  await evaluate('private', '() => {localStorage.setItem("private-probe","SECRET_FIXTURE");return "saved"}');
  const beforeRead = performance.now(); await tool('private','browser_snapshot'); const readMs = performance.now() - beforeRead;
  await evaluate('private', '() => document.getElementById("pace").focus()');
  const beforeAction = performance.now(); await tool('private','browser_keyboard_type',{text:'PACED_INPUT'}); const actionMs = performance.now() - beforeAction;
  assert((await evaluate('private','() => document.getElementById("pace").value')).includes('PACED_INPUT'));
  assert(actionMs >= 140, 'agent action pacing is applied');
  await stop();
  assert(!(await fs.readdir(root)).some(name=>name.startsWith('temporary-profile-')), 'temporary profile removed before daemon exit');
  await start();
  assert.equal((await health()).environment.locale,'fr-FR', 'daemon restart reloads saved environment');
  await tool('private', 'browser_navigate', {url});
  assert((await evaluate('private', '() => localStorage.getItem("private-probe")')).includes('null'), 'temporary authorization is not reused');
  await rpc({method:'desktop/preferences',environment:{storage:'persistent'}});
  await tool('old','browser_navigate',{url});
  assert((await evaluate('old','() => localStorage.getItem("persistent-probe")')).includes('PERSIST_OK'), 'persistent profile survives environment changes');
  if (process.argv.includes('--chrome')) {
    await rpc({method:'desktop/preferences',environment:{engine:'chrome',locale:'de-DE'}});
    await tool('chrome','browser_navigate',{url});
    assert((await evaluate('chrome','() => navigator.language')).includes('de-DE'));
  }
  const stored = JSON.parse(await fs.readFile(path.join(root,'preferences.json'),'utf8'));
  assert.equal(stored.engine,process.argv.includes('--chrome') ? 'chrome' : 'chromium');
  if (process.platform !== 'win32') assert.equal((await fs.stat(path.join(root,'preferences.json'))).mode & 0o777, 0o600);
  console.log(JSON.stringify({realChromium:true, chromeTested:process.argv.includes('--chrome'), reducedAutomationMarker:true, openContextPreserved:true, rejectedUnsafeOptions:true, locale:true, timezone:true, theme:true, reducedMotion:true, dnt:true, serviceWorkersBlocked:true, temporaryStorageNotReused:true, persistedPreferences:true, readMs:Math.round(readMs),actionMs:Math.round(actionMs)}));
} finally {
  if (child) {
    child.stdin.end();
    for (let i=0;i<60 && child.exitCode===null;i++) await pause(100);
    if(child.exitCode===null) { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit',resolve)); }
  }
  if (fixture) { fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve)); }
  await fs.rm(root,{recursive:true,force:true});
}
