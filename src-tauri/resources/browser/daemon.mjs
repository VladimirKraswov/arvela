// A private lifecycle/transport bridge. Browser behavior is implemented by
// Microsoft's unmodified Playwright MCP; the trusted panel projects pixels.
import fs from 'node:fs/promises';
import { realpath } from 'node:fs';
import { promisify } from 'node:util';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { createConnection } from '@playwright/mcp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createView } from './view.mjs';

const root = process.argv[2];
if (!root || !path.isAbsolute(root)) throw new Error('An absolute managed runtime directory is required');
const readyFile = path.join(root, 'ready.json');
const token = crypto.randomBytes(32).toString('hex');
const instanceId = crypto.randomUUID();
const workspace = path.join(root, 'workspace');
await fs.mkdir(workspace, { recursive: true, mode: 0o700 });
await fs.mkdir(path.join(root, 'profile'), { recursive: true, mode: 0o700 });
const connections = new Map();
let context;
const view = createView(getContext);
try { view.setMode(JSON.parse(await fs.readFile(path.join(root, 'interaction.json'), 'utf8')).mode); } catch { /* default fast */ }
let closing = false;
let queue = Promise.resolve();
const serial = action => {
  const result = queue.then(action);
  queue = result.catch(() => {});
  return result;
};
async function getContext() {
  if (!context) {
    // MSIX callers can see a virtual AppData alias. Windows' SxS loader cannot
    // resolve Chromium's sibling assembly through that alias (spawn UNKNOWN).
    // The native handle-based realpath resolves package redirection/junctions;
    // JS realpath does not. Keep the managed profile and official packages intact.
    const executablePath = process.platform === 'win32'
      ? await promisify(realpath.native)(chromium.executablePath()) : undefined;
    const opened = await chromium.launchPersistentContext(path.join(root, 'profile'), {
      headless: true, viewport: { width: 1280, height: 800 }, chromiumSandbox: true, executablePath,
    });
    context = opened;
    opened.on('close', () => { if (context === opened) context = undefined; });
  }
  return context;
}
const config = {
  browser: { browserName: 'chromium', userDataDir: path.join(root, 'profile') },
  sharedBrowserContext: true, capabilities: ['core', 'vision', 'pdf'],
  webmcp: false, saveSession: false, codegen: 'none',
  outputDir: workspace, outputMaxSize: 100 * 1024 * 1024,
  console: { level: 'error' }, timeouts: { action: 10000, navigation: 60000, idle: 0 },
};
async function connection(candidate = workspace) {
  if (!path.isAbsolute(candidate) || !(await fs.stat(candidate)).isDirectory()) throw new Error('Workspace must be an existing absolute directory');
  candidate = await fs.realpath(candidate);
  const existing = connections.get(candidate);
  if (existing) return existing.client;
  // Each official backend captures its workspace at initialization. Do not
  // mutate roots on an initialized backend: that would leak file permissions
  // between projects. All backends use one shared browser and one tool queue.
  if (connections.size >= 32) throw new Error('Restart the browser service to release older workspace connections');
  const outputDir = path.join(workspace, crypto.createHash('sha256').update(candidate).digest('hex').slice(0, 24));
  await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
  const official = await createConnection({ ...config, outputDir }, getContext);
  const client = new Client({ name: 'opencode-desktop-browser-owner', version: '1.0.0' }, { capabilities: { roots: {} } });
  client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: [{ uri: pathToFileURL(candidate).href, name: 'Approved current workspace' }] }));
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await official.connect(serverTransport);
  await client.connect(clientTransport);
  connections.set(candidate, { client, official });
  return client;
}

function authorized(req) {
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(String(req.headers.authorization || ''));
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
    && !req.headers.origin && /^127\.0\.0\.1:\d+$/.test(req.headers.host || '');
}
function reply(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
async function body(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024 * 1024) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const server = http.createServer(async (req, res) => {
  if (!authorized(req)) return reply(res, 403, { error: 'Unauthorized browser connection' });
  if (req.method === 'GET' && req.url === '/health') return reply(res, 200, { instanceId, version: '0.0.83', running: !closing, browserOpen: !!context });
  // Frames do not wait behind a long navigation/tool call, so the panel stays
  // live while the agent acts. Bound to one capture at a time below.
  if (req.method === 'GET' && req.url === '/view') {
    try { return reply(res, 200, await captureFrame()); }
    catch { return reply(res, 503, { error: 'Browser frame unavailable' }); }
  }
  if (req.method !== 'POST') return reply(res, 404, { error: 'Unknown endpoint' });
  try {
    const request = await body(req);
    const cancellation = new AbortController();
    res.on('close', () => { if (!res.writableEnded) cancellation.abort(); });
    if (req.url === '/stop') {
      reply(res, 200, { stopped: true });
      void close(); return;
    }
    if (req.url !== '/rpc') return reply(res, 404, { error: 'Unknown endpoint' });
    const result = await serial(async () => {
      if (cancellation.signal.aborted) throw new Error('Cancelled');
      if (request.expected) view.assertCurrent(request.expected);
      if (request.method === 'desktop/mode') {
        view.setMode(request.mode);
        await fs.writeFile(path.join(root, 'interaction.json'), JSON.stringify({ mode: request.mode }), { mode: 0o600 });
        return view.state();
      }
      if (request.method === 'desktop/resize') {
        await view.resize(request.width, request.height);
        return view.state();
      }
      if (request.method === 'desktop/reveal') {
        await view.page();
        return { revealed: true };
      }
      if (request.method === 'desktop/type') {
        if (typeof request.text !== 'string' || Buffer.byteLength(request.text) > 16384) throw new Error('Invalid text');
        view.changed();
        await (await view.page()).keyboard.insertText(request.text);
        return { typed: true };
      }
      if (request.method === 'desktop/reload' || request.method === 'desktop/forward') {
        const page = await view.page();
        view.changed();
        if (request.method === 'desktop/reload') await page.reload({ timeout: 60000 });
        else await page.goForward({ timeout: 60000 });
        return { navigated: true };
      }
      const client = await connection(request.workspace);
      if (request.method === 'tools/list') {
        const inventory = await client.listTools();
        return { ...inventory, tools: [...inventory.tools, { name: 'browser_keyboard_type', description: 'Type or paste text with the keyboard into the currently focused field. Click the field with the mouse first. No DOM selectors or implicit focus changes.',
          inputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 16384 }, submit: { type: 'boolean' } }, required: ['text'], additionalProperties: false } }].map(tool => ({ ...tool,
          description: `${tool.description || ''}${/^browser_mouse_/.test(tool.name) ? ' XY input requires a fresh CSS viewport screenshot; resize/scroll/shared input invalidates old coordinates. A rejected action returns a fresh image and never replays.' : ['browser_click', 'browser_fill_form', 'browser_type', 'browser_select_option', 'browser_evaluate', 'browser_run_code'].includes(tool.name) ? ' Fast mode only; human mode requires mouse XY and browser_keyboard_type.' : tool.name === 'browser_take_screenshot' ? ' For XY input use scale=css, fullPage=false and no element target. Desktop mode and viewport are reported with results.' : ''}` })) };
      }
      if (request.method === 'tools/call') {
        // Listing tools stays lazy; only actual actions create the browser.
        try { await view.before(client, request.params, request.owner === 'user' ? 'user' : 'agent'); }
        catch (error) {
          if (!['mode', 'geometry'].includes(error.recovery)) throw error;
          // This action did not execute. Refresh observation, never replay the click.
          const fresh = { name: 'browser_take_screenshot', arguments: { scale: 'css', type: 'png' } };
          await view.before(client, fresh);
          let result;
          try { result = await client.callTool(fresh, undefined, { signal: cancellation.signal }); await view.after(client, fresh, result); }
          finally { view.failed(); }
          return { isError: true, content: [{ type: 'text', text: `${error.message}\nDesktop browser state: ${JSON.stringify(view.state())}` }, ...(result?.content || [])],
            structuredContent: { desktopBrowserRecovery: true, reason: error.recovery, ...view.state() } };
        }
        let result;
        try {
          if (request.params.name === 'browser_keyboard_type') {
            const args = request.params.arguments || {};
            if (typeof args.text !== 'string' || Buffer.byteLength(args.text) > 16384 || (args.submit !== undefined && typeof args.submit !== 'boolean')) throw new Error('Invalid keyboard input');
            const page = await view.page();
            await page.keyboard.insertText(args.text);
            if (args.submit) await page.keyboard.press('Enter');
            result = { content: [{ type: 'text', text: 'Keyboard input sent to the focused field. Inspect the result before another action.' }] };
          } else result = await client.callTool(request.params, undefined, { signal: cancellation.signal });
          if (request.params.name !== 'browser_close') await view.after(client, request.params, result);
        } finally { view.failed(); }
        if (request.reveal && !result.isError && context) {
          const pages = context.pages();
          const page = pages.find(page => page.url() === request.params?.arguments?.url) || pages.at(-1);
          await page?.bringToFront();
        }
        return { ...result, content: [...(result.content || []), { type: 'text', text: `Desktop browser state: ${JSON.stringify(view.state())}` }] };
      }
      throw new Error('Only official browser tool methods are supported');
    });
    reply(res, 200, { result });
  } catch {
    // Tool payloads and error details can contain passwords/page content. Never
    // write them to process logs or native errors. MCP tool errors stay in results.
    reply(res, 400, { error: 'Browser request failed; check its tool arguments, workspace and browser state' });
  }
});
let frameFlight;
function captureFrame() {
  if (!frameFlight) frameFlight = (async () => {
    try { return await view.frame(context); }
    catch (error) {
      // A resize/navigation raced a read-only capture. Refresh once, never retry
      // input and never turn routine reflow into a misleading connection error.
      if (!error.frameChanged) throw error;
      return view.frame(context);
    }
  })().finally(() => { frameFlight = undefined; });
  return frameFlight;
}
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const temporary = `${readyFile}.${instanceId}.tmp`;
await fs.writeFile(temporary, JSON.stringify({ port, token, pid: process.pid, instanceId, version: '0.0.83' }), { mode: 0o600 });
await fs.rename(temporary, readyFile);
async function close() {
  if (closing) return; closing = true;
  try {
    const ready = JSON.parse(await fs.readFile(readyFile, 'utf8'));
    if (ready.instanceId === instanceId) await fs.unlink(readyFile);
  } catch {}
  server.close();
  for (const { client, official } of connections.values()) {
    await client.close().catch(() => {});
    await official.close().catch(() => {});
  }
  await context?.close().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', () => void close());
process.on('SIGINT', () => void close());
// Desktop keeps the write end of this pipe for the daemon's whole lifetime.
// EOF means the owner exited or crashed: close the browser instead of leaving
// an orphaned service holding the profile. Manual smoke runs do not opt in.
if (process.env.OCDESKTOP_BROWSER_OWNER_PIPE === '1') {
  process.stdin.on('end', () => void close());
  process.stdin.on('error', () => void close());
  process.stdin.resume();
}
process.on('uncaughtException', () => { process.stderr.write('Browser runtime failed. Restart it from Desktop settings.\n'); void close(); });
process.on('unhandledRejection', () => { process.stderr.write('Browser runtime failed. Restart it from Desktop settings.\n'); void close(); });
