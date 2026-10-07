// Real CLI regression: different AppData views, one explicit shared home.
// Disposable runtime/profile only; no inference, credentials or global config.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const [command, prepared] = process.argv.slice(2);
assert.equal(process.platform, 'win32');
assert(path.isAbsolute(command) && path.isAbsolute(prepared));
const temporary = await fs.realpath(os.tmpdir());
const source = await fs.realpath(prepared);
assert.equal(path.dirname(source), temporary);
assert(path.basename(source).startsWith('oc-browser-'));
const home = await fs.mkdtemp(path.join(temporary, 'oc-browser-shared-home-'));
const root = path.join(home, '.opencode-desktop/browser-runtime');
const current = path.join(root, 'current');
const clients = []; let daemon;
try {
  await fs.mkdir(root, { recursive: true });
  await fs.cp(path.join(source, 'current'), current, { recursive: true });
  const resources = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const name of ['daemon.mjs', 'view.mjs', 'proxy.mjs', 'setup.mjs', 'pi-extension.ts', 'package.json', 'package-lock.json']) {
    await fs.copyFile(path.join(resources, name), path.join(current, name));
  }
  await fs.mkdir(path.join(current, 'skills/desktop-browser'), { recursive: true });
  await fs.copyFile(path.join(resources, 'SKILL.md'), path.join(current, 'skills/desktop-browser/SKILL.md'));
  // Read-only binary cache alias; all profile/output writes stay disposable.
  await fs.symlink(path.join(source, 'browsers'), path.join(root, 'browsers'), 'junction');
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, 'browsers');
  const load = file => import(pathToFileURL(path.join(current, 'node_modules', file)));
  const { chromium } = await load('playwright/index.mjs');
  const manifest = JSON.parse(await fs.readFile(path.join(current, 'installed.json')));
  manifest.browserExecutable = chromium.executablePath();
  await fs.writeFile(path.join(current, 'installed.json'), JSON.stringify(manifest));
  const { Client } = await load('@modelcontextprotocol/sdk/dist/esm/client/index.js');
  const { StdioClientTransport } = await load('@modelcontextprotocol/sdk/dist/esm/client/stdio.js');
  daemon = spawn(process.execPath, [path.join(current, 'daemon.mjs'), root], {
    stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true,
    env: { ...process.env, OCDESKTOP_BROWSER_OWNER_PIPE: '1' },
  });
  let ready;
  for (let i = 0; i < 150; i++) {
    try {
      ready = JSON.parse(await fs.readFile(path.join(root, 'ready.json')));
      const response = await fetch(`http://127.0.0.1:${ready.port}/health`, {
        headers: { Authorization: `Bearer ${ready.token}` }, signal: AbortSignal.timeout(500),
      });
      if (response.ok) break; ready = undefined;
    } catch { ready = undefined; }
    await new Promise(r => setTimeout(r, 100));
  }
  assert(ready, 'Disposable daemon must be ready');
  for (const label of ['desktop-appdata', 'engine-appdata']) {
    const appData = path.join(home, label);
    await fs.mkdir(appData);
    const client = new Client({ name: label, version: '1' }); clients.push(client);
    const transport = new StdioClientTransport({ command, args: ['--browser-mcp'],
      cwd: home, stderr: 'pipe', env: { ...process.env, USERPROFILE: home, LOCALAPPDATA: appData } });
    let diagnostic = '';
    transport.stderr?.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-1024); });
    try { await client.connect(transport); }
    catch (error) { throw new Error(`CLI ${label}: ${error.message}; ${diagnostic.trim()}`); }
    assert.equal((await client.listTools()).tools.length, 33);
  }
  const navigation = await clients[0].callTool({ name: 'browser_navigate', arguments: { url: 'about:blank' } });
  assert(!navigation.isError);
  const evaluation = await clients[1].callTool({ name: 'browser_evaluate', arguments: { function: '() => location.href' } });
  assert(!evaluation.isError && evaluation.content.some(c => c.type === 'text' && c.text.includes('about:blank')));
  console.log(JSON.stringify({ windowsSharedRuntime: true, differentAppDataViews: true,
    realDesktopCli: true, tools: 33, sameBrowser: true, noModelRequests: true }));
} finally {
  for (const client of clients) await client.close().catch(() => {});
  daemon?.stdin.end();
  for (let i = 0; daemon && daemon.exitCode === null && i < 100; i++) await new Promise(r => setTimeout(r, 100));
  if (daemon && daemon.exitCode === null) { daemon.kill(); await new Promise(r => daemon.once('exit', r)); }
  await fs.rm(home, { recursive: true, force: true });
}
