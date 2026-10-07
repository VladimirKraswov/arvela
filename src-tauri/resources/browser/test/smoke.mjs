// Opt-in real in-app projected Chromium acceptance. Run against an installed,
// test-owned /tmp/oc-browser-* runtime; never against a user's browser profile.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const root = await fs.realpath(process.argv[2]);
const temporaryRoot = await fs.realpath(os.tmpdir());
const allowedTemporaryRoots = [temporaryRoot];
if (process.platform !== 'win32') allowedTemporaryRoots.push(await fs.realpath('/tmp'));
assert(allowedTemporaryRoots.includes(path.dirname(root)) && path.basename(root).startsWith('oc-browser-'), 'Use a test-owned temporary runtime');
const runtime = path.join(root, 'current');
// Optional read-only binary location to exercise Windows AppData/MSIX aliases.
// Profile, uploads and all writes still belong to the temporary test runtime.
const browserPath = process.argv[3] || path.join(root, 'browsers');
assert(path.isAbsolute(browserPath), 'Use an absolute browser binary directory');
const { Client } = await import(pathToFileURL(path.join(runtime, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js')));
const { StdioClientTransport } = await import(pathToFileURL(path.join(runtime, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js')));
const workspace = path.join(root, 'project-workspace');
await fs.mkdir(workspace, { recursive: true });
let child; let ready; let client; let fixture;
const pause = ms => new Promise(r => setTimeout(r, ms));
async function start() {
  child = spawn(process.execPath, [path.join(runtime, 'daemon.mjs'), root], { stdio: ['pipe', 'ignore', 'pipe'], env: { ...process.env, OCDESKTOP_BROWSER_OWNER_PIPE: '1', PLAYWRIGHT_BROWSERS_PATH: browserPath } });
  let stderr = ''; child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-2048); });
  for (let count = 0; count < 300; count++) {
    try {
      const value = JSON.parse(await fs.readFile(path.join(root, 'ready.json')));
      const response = await fetch(`http://127.0.0.1:${value.port}/health`, { headers: { Authorization: `Bearer ${value.token}` }, signal: AbortSignal.timeout(500) });
      if (response.ok && (await response.json()).instanceId === value.instanceId) { ready = value; return; }
    } catch {}
    if (child.exitCode !== null) throw new Error('Test daemon exited');
    await pause(100);
  }
  throw new Error('Test daemon startup timed out' + (stderr ? ': ' + stderr : ''));
}
async function stop() {
  if (ready) {
    await fetch(`http://127.0.0.1:${ready.port}/stop`, { method: 'POST', headers: { Authorization: `Bearer ${ready.token}`, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(3000) }).catch(() => {});
  }
  for (let count = 0; child?.exitCode === null && count < 50; count++) await pause(100);
  if (child?.exitCode === null) child.kill('SIGKILL');
  ready = undefined;
}
async function connect(cwd = workspace) {
  const value = new Client({ name: 'desktop-browser-mac-acceptance', version: '1.0.0' });
  await value.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(runtime, 'proxy.mjs'), root], cwd, stderr: 'pipe' }));
  return value;
}
async function call(name, args = {}, active = client) {
  const result = await active.callTool({ name, arguments: args });
  assert(!result.isError, `Official tool failed: ${name}`);
  return result;
}
function text(result) { return result.content.filter(c => c.type === 'text').map(c => c.text).join('\n'); }
function target(snapshot, label) {
  const line = snapshot.split('\n').find(l => l.includes(`"${label}"`) && l.includes('[ref='));
  const match = line?.match(/\[ref=([^\]]+)\]/); assert(match, `Missing current snapshot target: ${label}`); return match[1];
}
try {
  try {
    const stale = JSON.parse(await fs.readFile(path.join(root, 'ready.json')));
    const alive = await fetch(`http://127.0.0.1:${stale.port}/health`, { headers: { Authorization: `Bearer ${stale.token}` }, signal: AbortSignal.timeout(1000) });
    assert(!alive.ok, 'Stop the existing test daemon before this test');
  } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ECONNREFUSED' && error.name === 'AssertionError') throw error; }
  fixture = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><title>Desktop Browser Acceptance</title><label>Name<input id="name" aria-label="Name"></label><label>Password<input id="password" type="password" aria-label="Password"></label><button onclick="document.querySelector('#result').textContent = document.querySelector('#name').value && document.querySelector('#password').value ? 'FORM_OK' : 'FORM_BAD';localStorage.setItem('fixture-session','PERSIST_OK')">Save fixture login</button><button onclick="document.querySelector('#upload').click()">Upload fixture</button><input id="upload" type="file" hidden onchange="document.querySelector('#result').textContent=this.files.length?'UPLOAD_OK':'UPLOAD_BAD'"><button style="position:fixed;right:16px;top:100px;width:100px;height:40px" aria-label="Responsive target" onclick="document.querySelector('#result').textContent='RESPONSIVE_CLICK_OK'">Responsive target</button><div id="result">WAITING</div><div id="persist"></div><script>document.querySelector('#persist').textContent=localStorage.getItem('fixture-session')||'NO_SESSION'</script>`);
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const fixtureUrl = `http://127.0.0.1:${fixture.address().port}`;
  await fs.writeFile(path.join(workspace, 'upload.txt'), 'Test-owned fixture upload');
  await start();
  const endpoint = `http://127.0.0.1:${ready.port}`;
  const headers = { Authorization: `Bearer ${ready.token}` };
  assert.equal((await fetch(`${endpoint}/health`)).status, 403);
  assert.equal((await fetch(`${endpoint}/health`, { headers: { ...headers, Origin: 'https://example.com' } })).status, 403);
  assert.equal((await (await fetch(`${endpoint}/health`, { headers })).json()).browserOpen, false);
  const frame = async () => {
    const response = await fetch(`${endpoint}/view`, { headers, signal: AbortSignal.timeout(4000) });
    assert(response.ok, 'Live frame failed'); return response.json();
  };
  assert.equal((await fetch(`${endpoint}/view`)).status, 403);
  assert.equal((await fetch(`${endpoint}/view`, { headers: { ...headers, Origin: 'https://example.com' } })).status, 403);
  assert.equal((await frame()).browserOpen, false);
  client = await connect();
  const tools = await client.listTools(); assert(tools.tools.some(t => t.name === 'browser_snapshot'));
  assert.equal((await (await fetch(`${endpoint}/health`, { headers })).json()).browserOpen, false);
  await call('browser_navigate', { url: fixtureUrl });
  let projected = await frame();
  assert.equal(projected.url, fixtureUrl + '/');
  assert.equal(projected.width, 1280); assert.equal(projected.height, 800);
  assert.equal(Buffer.from(projected.image, 'base64').subarray(0, 2).toString('hex'), 'ffd8');
  assert(projected.tabs.some(tab => tab.active && tab.url === projected.url));
  const staleFrame = { pageId: projected.pageId, revision: projected.revision, url: projected.url };
  await call('browser_press_key', { key: 'Escape' });
  const staleInput = await fetch(`${endpoint}/rpc`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'desktop/type', text: 'MUST_NOT_APPEAR', expected: staleFrame }) });
  assert.equal(staleInput.status, 400, 'Old frame input must fail closed after an agent action');
  const revealed = await fetch(`${endpoint}/rpc`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'desktop/reveal' }) });
  assert(revealed.ok, 'Existing browser window reveal failed');
  let snapshot = text(await call('browser_snapshot'));
  assert(snapshot.includes(fixtureUrl), 'Window reveal must preserve the current page');
  await call('browser_fill_form', { fields: [
    { target: target(snapshot, 'Name'), name: 'Name', type: 'textbox', value: 'Acceptance' },
    { target: target(snapshot, 'Password'), name: 'Password', type: 'textbox', value: 'fixture-only-password-never-logged' },
  ] });
  snapshot = text(await call('browser_snapshot'));
  await call('browser_click', { target: target(snapshot, 'Save fixture login') });
  projected = await frame();
  assert.equal(projected.cursor.owner, 'agent'); assert.equal(projected.cursor.action, 'browser_click');
  assert(projected.cursor.x >= 0 && projected.cursor.y >= 0, 'Cursor derives from actual DOM bounds');
  snapshot = text(await call('browser_snapshot')); assert(snapshot.includes('FORM_OK'));
  await call('browser_click', { target: target(snapshot, 'Upload fixture') });
  const rejected = await client.callTool({ name: 'browser_file_upload', arguments: { paths: [path.join(root, 'current/package.json')] } });
  assert(rejected.isError, 'Out-of-workspace upload must be rejected');
  await call('browser_file_upload', { paths: [path.join(workspace, 'upload.txt')] });
  snapshot = text(await call('browser_snapshot')); assert(snapshot.includes('UPLOAD_OK'));
  const screenshot = await call('browser_take_screenshot', { scale: 'css', type: 'png' });
  assert(screenshot.content.some(c => c.type === 'image' && c.data.length > 100));
  const panel = async (method, params = {}) => {
    const response = await fetch(`${endpoint}/rpc`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, workspace, owner: 'user', ...params }) });
    assert(response.ok, `Panel action failed: ${method}`);
    const result = (await response.json()).result; assert(!result.isError); return result;
  };
  await panel('tools/call', { params: { name: 'browser_mouse_click_xy', arguments: { x: 100, y: 18 } } });
  assert.equal((await frame()).cursor.owner, 'user');
  await panel('desktop/type', { text: 'PANEL_INPUT_OK' });
  assert(text(await call('browser_snapshot')).includes('PANEL_INPUT_OK'), 'Panel and agent must share actual DOM');
  await panel('tools/call', { params: { name: 'browser_tabs', arguments: { action: 'new' } } });
  projected = await frame(); assert.equal(projected.tabs.length, 2);
  await call('browser_navigate', { url: fixtureUrl + '/second' });
  assert.equal((await frame()).url, fixtureUrl + '/second');
  await panel('tools/call', { params: { name: 'browser_tabs', arguments: { action: 'select', index: 0 } } });
  assert.equal((await frame()).url, fixtureUrl + '/');
  assert(text(await call('browser_snapshot')).includes('PANEL_INPUT_OK'), 'Agent follows manually selected tab');
  await panel('desktop/reload');
  await call('browser_navigate', { url: fixtureUrl + '/history' });
  await call('browser_navigate_back');
  await panel('desktop/forward'); assert.equal((await frame()).url, fixtureUrl + '/history');
  await panel('tools/call', { params: { name: 'browser_tabs', arguments: { action: 'close', index: 1 } } });
  assert.equal((await frame()).tabs.length, 1);
  // Real responsive fixture: stale agent coordinates must never click; bridge
  // returns the resized screenshot, and the next explicit click can use it.
  await panel('desktop/mode', { mode: 'human' });
  const semantic = await client.callTool({ name: 'browser_click', arguments: { target: 'e1' } });
  assert(semantic.isError && semantic.structuredContent?.reason === 'mode');
  assert(semantic.content.some(c => c.type === 'image'));
  const code = await client.callTool({ name: 'browser_evaluate', arguments: { function: '() => 1' } });
  assert(code.isError && code.structuredContent?.reason === 'mode');
  await call('browser_take_screenshot', { scale: 'css', type: 'png' });
  const beforeResize = await frame();
  await panel('desktop/resize', { width: 640, height: 480 });
  const staleClick = await client.callTool({ name: 'browser_mouse_click_xy', arguments: { x: 100, y: 18 } });
  assert(staleClick.isError && staleClick.structuredContent?.reason === 'geometry');
  assert.deepEqual(staleClick.structuredContent.viewport, { width: 640, height: 480 });
  assert(staleClick.content.some(c => c.type === 'image'));
  projected = await frame(); assert.equal(projected.width, 640); assert.equal(projected.height, 480);
  if (process.env.BROWSER_SAVE_UI_FRAME === '1') await fs.writeFile(path.join(root, 'ui-frame.json'), JSON.stringify(projected));
  const oldManual = await fetch(`${endpoint}/rpc`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'desktop/type', text: 'MUST_NOT_APPEAR', expected: { pageId: beforeResize.pageId, revision: beforeResize.revision, url: beforeResize.url, width: beforeResize.width, height: beforeResize.height } }) });
  assert.equal(oldManual.status, 400);
  await call('browser_mouse_click_xy', { x: 100, y: 18 });
  await call('browser_keyboard_type', { text: 'HUMAN_INPUT_OK' });
  assert(text(await call('browser_snapshot')).includes('HUMAN_INPUT_OK'));
  await call('browser_take_screenshot', { scale: 'css', type: 'png' });
  const outsideClick = await client.callTool({ name: 'browser_mouse_click_xy', arguments: { x: 1200, y: 120 } });
  assert(outsideClick.isError && outsideClick.structuredContent?.reason === 'geometry');
  await call('browser_mouse_click_xy', { x: 640 - 66, y: 120 });
  assert(text(await call('browser_snapshot')).includes('RESPONSIVE_CLICK_OK'), 'Mouse must click the responsive target at its new position');
  // A shared manual interaction invalidates the agent's previous observation.
  await call('browser_take_screenshot', { scale: 'css', type: 'png' });
  await panel('desktop/type', { text: 'shared-input' });
  const staleShared = await client.callTool({ name: 'browser_mouse_click_xy', arguments: { x: 574, y: 120 } });
  assert(staleShared.isError && staleShared.structuredContent?.reason === 'geometry');
  await panel('desktop/mode', { mode: 'fast' });
  const otherWorkspace = path.join(root, 'other-workspace'); await fs.mkdir(otherWorkspace, { recursive: true });
  const other = await connect(otherWorkspace);
  try {
    await fs.writeFile(path.join(otherWorkspace, 'other.txt'), 'Other workspace');
    await call('browser_navigate', { url: fixtureUrl }, other);
    snapshot = text(await call('browser_snapshot', {}, other));
    await call('browser_click', { target: target(snapshot, 'Upload fixture') }, other);
    const forbidden = await other.callTool({ name: 'browser_file_upload', arguments: { paths: [path.join(workspace, 'upload.txt')] } });
    assert(forbidden.isError, 'A second workspace must not inherit the first workspace file access');
    await call('browser_file_upload', { paths: [path.join(otherWorkspace, 'other.txt')] }, other);
  } finally { await other.close(); }
  await stop(); await start();
  await call('browser_navigate', { url: fixtureUrl });
  snapshot = text(await call('browser_snapshot')); assert(snapshot.includes('PERSIST_OK'), 'Persistent fixture login must survive daemon restart');
  // Closing the owner pipe models a Desktop crash: no HTTP stop or signal.
  child.stdin.end();
  for (let count = 0; child.exitCode === null && count < 100; count++) await pause(100);
  assert.equal(child.exitCode, 0, 'Lost owner must close the daemon and headed browser');
  ready = undefined;
  await start();
  await call('browser_navigate', { url: fixtureUrl });
  snapshot = text(await call('browser_snapshot')); assert(snapshot.includes('PERSIST_OK'));
  console.log(JSON.stringify({ platform: process.platform, officialMcp: '0.0.83', tools: tools.tools.length, lazyStartup: true, revealPreservesPage: true, authentication: true, originRejected: true, dom: true, passwordForm: true, upload: true, workspaceIsolation: true, screenshot: true, liveProjection: true, agentCursor: true, manualInput: true, sharedTabs: true, history: true, persistentProfileAfterRestart: true, sameClientAfterRestart: true, ownerPipeCleanup: true, humanMode: true, resizeRecovery: true, keyboardTyping: true }));
} finally {
  await client?.close().catch(() => {});
  await stop();
  await new Promise(resolve => fixture ? fixture.close(resolve) : resolve());
}
