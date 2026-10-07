// Installed app CLI + live panel acceptance. Use only while the shared browser
// is idle: this navigates it to a test-owned, non-sensitive local fixture.
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
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-browser-installed-panel-'));
const fixture = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!doctype html><meta charset="utf-8"><title>Embedded browser verification</title><style>body{font:32px sans-serif;margin:40px}input,button{font:32px sans-serif}body{height:2000px}</style><h1>Встроенный браузер</h1><label>Тестовый ввод: <input aria-label="Panel input" id="input"></label><p><button onclick="document.getElementById(\'result\').textContent=document.getElementById(\'input\').value">Проверить ввод</button></p><p id="result">Ожидаю ввод</p><p>Прокрутка: нижняя часть страницы</p>');
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const client = new Client({ name: 'installed-panel-acceptance', version: '1' });
const text = result => result.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
const ready = JSON.parse(await fs.readFile(path.join(path.dirname(runtime), 'ready.json')));
const frame = async () => {
  const response = await fetch(`http://127.0.0.1:${ready.port}/view`, { headers: { Authorization: `Bearer ${ready.token}` } });
  assert(response.ok); return response.json();
};
const lines = readline.createInterface({ input: process.stdin });
try {
  await client.connect(new StdioClientTransport({ command, args: ['--browser-mcp'], cwd: workspace, stderr: 'pipe' }));
  const tools = await client.listTools(); assert.equal(tools.tools.length, 33);
  assert(tools.tools.some(tool => tool.name === 'browser_keyboard_type'));
  const result = await client.callTool({ name: 'browser_navigate', arguments: { url: `http://127.0.0.1:${fixture.address().port}` } });
  assert(!result.isError);
  const projected = await frame(); assert(projected.image.length > 100); assert.equal(projected.title, 'Embedded browser verification');
  console.log('PANEL_FIXTURE_READY: type PANEL_UI_OK in the visible panel, click Проверить ввод, then send verify to this runner.');
  for await (const line of lines) {
    if (line.trim() !== 'verify') continue;
    const snapshot = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    assert(!snapshot.isError && text(snapshot).includes('PANEL_UI_OK'));
    const dom = await client.callTool({ name: 'browser_evaluate', arguments: { function: "() => ({ input: document.querySelector('#input').value, result: document.querySelector('#result').textContent, scrollY: window.scrollY })" } });
    assert(!dom.isError);
    const evaluated = JSON.parse(text(dom).split('### Result\n')[1].split('\n###')[0]);
    assert.equal(evaluated.input, 'PANEL_UI_OK', 'Real input must match exactly');
    assert.equal(evaluated.result, 'PANEL_UI_OK', 'Button must submit the exact real input');
    console.log(JSON.stringify({ installedAppCli: true, tools: tools.tools.length, liveProjection: true, panelManualInputAndClick: true, realDomEvaluation: true }));
    break;
  }
} finally {
  lines.close(); await client.close().catch(() => {}); fixture.closeAllConnections();
  await new Promise(resolve => fixture.close(resolve)); await fs.rm(workspace, { recursive: true, force: true });
}
