// npm ci verifies the committed integrity lock. No global installation and no
// lifecycle scripts are run; Playwright's browser download is explicit.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const [root, npmCli] = process.argv.slice(2);
if (!root || !npmCli || !path.isAbsolute(root) || !path.isAbsolute(npmCli)) throw new Error('Absolute setup paths required');
const runtime = path.dirname(fileURLToPath(import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, 'browsers');
async function run(script, args, timeout) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: runtime, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true, env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(root, 'browsers') } });
    const timer = setTimeout(() => {
      if (process.platform !== 'win32') { try { process.kill(-process.pid, 'SIGTERM'); } catch { child.kill(); } }
      else child.kill();
      reject(new Error('Managed browser installation timed out. Retry setup.'));
    }, timeout);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Managed browser installation failed (${code}). Check network, disk space, Node/npm and Linux browser libraries.`)); });
  });
}
await run(npmCli, ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', runtime], 600000);
const require = createRequire(import.meta.url);
if (require('@playwright/mcp/package.json').version !== '0.0.83' || JSON.parse(await fs.readFile(path.join(runtime, 'node_modules/@modelcontextprotocol/sdk/package.json'), 'utf8')).version !== '1.32.0') throw new Error('Managed dependency version verification failed');
const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
await run(cli, ['install', 'chromium'], 600000);
const { chromium } = await import('playwright');
await fs.access(chromium.executablePath());
const manifest = { version: '0.0.83', browserExecutable: chromium.executablePath(), nodeProgram: process.execPath, installedAt: new Date().toISOString() };
await fs.writeFile(path.join(runtime, 'installed.json'), JSON.stringify(manifest), { mode: 0o600 });
