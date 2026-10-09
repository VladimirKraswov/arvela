import { AsyncLocalStorage } from 'node:async_hooks';
import { sessionKey } from './session.mjs';
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
import { actionTools, createActions, createMetrics } from './actions.mjs';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';

const root = process.argv[2];
if (!root || !path.isAbsolute(root)) throw new Error('An absolute managed runtime directory is required');
const readyFile = path.join(root, 'ready.json');
const token = crypto.randomBytes(32).toString('hex');
const instanceId = crypto.randomUUID();
const workspace = path.join(root, 'workspace');
await fs.mkdir(workspace, { recursive: true, mode: 0o700 });
await fs.mkdir(path.join(root, 'profile'), { recursive: true, mode: 0o700 });
const sessions = new Map();
const sessionContext = new AsyncLocalStorage();
let selectedKey = 'legacy'; // Older CLI clients are isolated once Desktop selects a chat.
let selectedScope = null;
let selectionRevision = 0;
let defaultMode = 'fast';
try { const mode = JSON.parse(await fs.readFile(path.join(root, 'interaction.json'), 'utf8')).mode; if (['fast', 'human'].includes(mode)) defaultMode = mode; } catch {}
function ownedSession(key, scope = null) {
  if (!sessions.has(key)) {
    if (sessions.size >= 32) throw new Error('Restart browser service to release older sessions');
    const owned = { key, scope, context: undefined, connections: new Map(), frameFlight: undefined, composition: undefined };
    owned.view = createView(() => getContext(owned));
    owned.view.setMode(defaultMode);
    sessions.set(key, owned);
  }
  return sessions.get(key);
}
const currentSession = () => sessionContext.getStore();
const metrics = createMetrics();
const validator = new AjvJsonSchemaValidator();
const validators = new WeakMap();
let closing = false;
let queue = Promise.resolve();

const serial = action => {
  const result = queue.then(action);
  queue = result.catch(() => {});
  return result;
};
async function getContext(owned = currentSession()) {
  if (!owned.context) {
    const profile = owned.key === 'legacy' ? path.join(root, 'profile')
      : path.join(root, 'sessions', crypto.createHash('sha256').update(owned.key).digest('hex'), 'profile');
    await fs.mkdir(profile, { recursive: true, mode: 0o700 });
    const executablePath = process.platform === 'win32'
      ? await promisify(realpath.native)(chromium.executablePath()) : undefined;
    const opened = await chromium.launchPersistentContext(profile, {
      headless: true, viewport: { width: 1280, height: 800 }, chromiumSandbox: true, executablePath,
    });
    owned.context = opened;
    opened.on('close', () => { if (owned.context === opened) owned.context = undefined; });
  }
  return owned.context;
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
  const owned = currentSession();
  const existing = owned.connections.get(candidate);
  if (existing) return existing.client;
  // Each official backend captures its workspace at initialization. Do not
  // mutate roots on an initialized backend: that would leak file permissions
  // between projects. Backends within a session share its browser; tool calls
  // across sessions still use one serialized queue.
  if (owned.connections.size >= 32) throw new Error('Restart the browser service to release older workspace connections');
  const outputDir = path.join(workspace, crypto.createHash('sha256').update(owned.key + candidate).digest('hex').slice(0, 24));
  await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
  const official = await createConnection({ ...config, outputDir }, () => getContext(owned));
  const client = new Client({ name: 'arvela-browser-owner', version: '1.0.0' }, { capabilities: { roots: {} } });
  client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: [{ uri: pathToFileURL(candidate).href, name: 'Approved current workspace' }] }));
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await official.connect(serverTransport);
  await client.connect(clientTransport);
  owned.connections.set(candidate, { client, official });
  return client;
}

// One execution boundary for ordinary and composed tools: identical geometry,
// mode, cancellation, tab ownership and keyboard limits on every path.
async function invokeTool(client, params, signal, owner = 'agent') {
  try {
    if (signal?.aborted) throw new Error('Cancelled before browser input');
    await currentSession().view.before(client, params, owner);
    if (signal?.aborted) throw new Error('Cancelled before browser input');
    let result;
    if (params.name === 'browser_keyboard_type') {
      const args = params.arguments || {};
      if (typeof args.text !== 'string' || Buffer.byteLength(args.text) > 16384 || (args.submit !== undefined && typeof args.submit !== 'boolean')) throw new Error('Invalid keyboard input');
      const page = await currentSession().view.page();
      if (signal?.aborted) throw new Error('Cancelled before browser input');
      await page.keyboard.insertText(args.text);
      if (args.submit) { if (signal?.aborted) throw new Error('Cancelled before submit'); await page.keyboard.press('Enter'); }
      result = { content: [{ type: 'text', text: 'Keyboard input sent to the focused field. Inspect the result before another action.' }] };
    } else result = await client.callTool(params, undefined, { signal });
    if (params.name !== 'browser_close') await currentSession().view.after(client, params, result);
    return result;
  } finally { currentSession().view.failed(); }
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
  if (req.method === 'GET' && req.url === '/health') return reply(res, 200, { instanceId, version: '0.0.83', running: !closing, browserOpen: !!sessions.get(selectedKey)?.context, scope: selectedScope, scopeKey: selectedKey, performance: metrics.snapshot() });
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
    if (request.method === 'desktop/default-mode') {
      if (!['fast', 'human'].includes(request.mode)) throw new Error('Invalid browser mode');
      await serial(async () => {
        await fs.writeFile(path.join(root, 'interaction.json'), JSON.stringify({ mode: request.mode }), { mode: 0o600 });
        defaultMode = request.mode;
        sessions.get(selectedKey)?.view.setMode(defaultMode);
      });
      return reply(res, 200, { result: { mode: defaultMode } });
    }
    if (request.method === 'desktop/session') {
      if (!Number.isSafeInteger(request.revision) || request.revision < 1) throw new Error('Invalid selection revision');
      let key = null, scope = null;
      if (request.session !== null) {
        if (!path.isAbsolute(request.workspace) || !(await fs.stat(request.workspace)).isDirectory()) throw new Error('Invalid session workspace');
        const directory = await fs.realpath(request.workspace);
        key = sessionKey(directory, request.session); scope = { directory, ...request.session };
      }
      // A slower realpath from an older selection cannot overwrite a newer one.
      if (request.revision > selectionRevision) {
        selectionRevision = request.revision; selectedKey = key; selectedScope = scope;
      }
      return reply(res, 200, { result: { scope: selectedScope, scopeKey: selectedKey } });
    }
    const manual = request.owner === 'user' || request.method.startsWith('desktop/');
    let key, scope;
    if (manual) {
      if (!selectedKey) throw new Error('Select a chat before opening its browser');
      key = selectedKey; scope = selectedScope;
      if (scope) request.workspace = scope.directory;
      if (request.scopeKey !== undefined && request.scopeKey !== key) throw new Error('Selected chat changed; no input sent');
    } else if (request.session) {
      const directory = await fs.realpath(request.workspace);
      key = sessionKey(directory, request.session); scope = { directory, ...request.session };
    } else key = 'legacy';
    const owned = ownedSession(key, scope);
    return await sessionContext.run(owned, async () => {
    // Signal interruption immediately, even if the manual request waits in the queue.
    if (request.owner === 'user' || ['desktop/mode', 'desktop/resize', 'desktop/type', 'desktop/reload', 'desktop/forward'].includes(request.method)) currentSession().view.interrupt(false);
    else if (request.method === 'tools/call') currentSession().view.interrupt(false);
    if (request.method === 'tools/call' || request.owner === 'user' || request.method.startsWith('desktop/') && request.method !== 'desktop/reveal') currentSession().composition?.abort('interrupted');
    const queuedAt = performance.now();
    const result = await serial(async () => {
      const queueMs = performance.now() - queuedAt;
      if (cancellation.signal.aborted) throw new Error('Cancelled');
      if (manual && key !== selectedKey) throw new Error('Selected chat changed; no input sent');
      if (request.expected) currentSession().view.assertCurrent(request.expected);
      if (request.method === 'desktop/mode') {
        currentSession().view.setMode(request.mode);
        await fs.writeFile(path.join(root, 'interaction.json'), JSON.stringify({ mode: request.mode }), { mode: 0o600 });
        return currentSession().view.state();
      }
      if (request.method === 'desktop/resize') {
        await currentSession().view.resize(request.width, request.height);
        return currentSession().view.state();
      }
      if (request.method === 'desktop/reveal') {
        await currentSession().view.page();
        return { revealed: true };
      }
      if (request.method === 'desktop/type') {
        if (typeof request.text !== 'string' || Buffer.byteLength(request.text) > 16384) throw new Error('Invalid text');
        currentSession().view.changed();
        await (await currentSession().view.page()).keyboard.insertText(request.text);
        return { typed: true };
      }
      if (request.method === 'desktop/reload' || request.method === 'desktop/forward') {
        const page = await currentSession().view.page();
        currentSession().view.changed();
        if (request.method === 'desktop/reload') await page.reload({ timeout: 60000 });
        else await page.goForward({ timeout: 60000 });
        return { navigated: true };
      }
      const client = await connection(request.workspace);
      if (request.method === 'tools/list') {
        const inventory = await client.listTools();
        const base = [...inventory.tools, { name: 'browser_keyboard_type', description: 'Type or paste text with the keyboard into the currently focused field. Click the field with the mouse first. No DOM selectors or implicit focus changes.',
          inputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 16384 }, submit: { type: 'boolean' } }, required: ['text'], additionalProperties: false } }];
        const custom = actionTools(base);
        validators.set(client, new Map([...base, ...custom].map(tool => [tool.name, validator.getValidator(tool.inputSchema)])));
        return { ...inventory, tools: [...base, ...custom].map(tool => ({ ...tool,
          description: `${tool.description || ''}${/^browser_mouse_/.test(tool.name) ? ' XY input requires a fresh CSS viewport screenshot; resize/scroll/shared input invalidates old coordinates. A rejected action returns a fresh image and never replays.' : ['browser_click', 'browser_fill_form', 'browser_type', 'browser_select_option', 'browser_evaluate', 'browser_run_code'].includes(tool.name) ? ' Fast mode only; human mode requires mouse XY and browser_keyboard_type.' : tool.name === 'browser_take_screenshot' ? ' For XY input use scale=css, fullPage=false and no element target. Desktop mode and viewport are reported with results.' : ''}` })) };
      }
      if (request.method === 'tools/call' && ['browser_observe', 'browser_action', 'browser_sequence'].includes(request.params?.name)) {
        if (!validators.has(client)) {
          const inventory = await client.listTools();
          const keyboard = { name: 'browser_keyboard_type', inputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 16384 }, submit: { type: 'boolean' } }, required: ['text'], additionalProperties: false } };
          const base = [...inventory.tools, keyboard];
          validators.set(client, new Map([...base, ...actionTools(base)].map(tool => [tool.name, validator.getValidator(tool.inputSchema)])));
        }
        let actionMs = 0, observeMs = 0;
        const actions = createActions({ identity: currentSession().view.identity, validate: (name, args) => {
          if (!validators.get(client).get(name)?.(args).valid) throw new Error('Invalid browser composition');
          if (Buffer.byteLength(JSON.stringify(args)) > 32768) throw new Error('Composition too large');
          // Keyboard limits are bytes, not just the schema's character count.
          for (const step of args.steps || (args.step ? [args.step] : [])) {
            if (!validators.get(client).get(step.tool)?.(step.arguments).valid) throw new Error('Invalid nested browser arguments');
            if (step.tool === 'browser_keyboard_type' && Buffer.byteLength(step.arguments.text) > 16384) throw new Error('Keyboard input too large');
          }
        }, call: async (params, signal) => {
          const began = performance.now();
          try { return await invokeTool(client, params, signal);
          } finally {
            if (['browser_snapshot', 'browser_take_screenshot'].includes(params.name)) observeMs += performance.now() - began;
            else actionMs += performance.now() - began;
          }
        } });
        let value;
        const owned = new AbortController(); currentSession().composition = owned;
        try { value = await actions.run(request.params.name, request.params.arguments || {}, AbortSignal.any([cancellation.signal, owned.signal])); return { ...value, content: [...value.content, { type: 'text', text: `Desktop browser state: ${JSON.stringify(currentSession().view.state())}` }] }; }
        finally { if (currentSession().composition === owned) currentSession().composition = undefined; metrics.record({ failed: !value || value.isError, queueMs, actionMs, observeMs, completedSteps: value?.structuredContent?.completed }); }
      }
      if (request.method === 'tools/call') {
        const began = performance.now();
        let failed = true;
        try {
          // Listing stays lazy; only actual actions create the browser.
          let result;
          try { result = await invokeTool(client, request.params, cancellation.signal, request.owner === 'user' ? 'user' : 'agent'); }
          catch (error) {
            if (!['mode', 'geometry'].includes(error.recovery)) throw error;
            const fresh = await invokeTool(client, { name: 'browser_take_screenshot', arguments: { scale: 'css', type: 'png' } }, cancellation.signal);
            return { isError: true, content: [{ type: 'text', text: `${error.message}\nDesktop browser state: ${JSON.stringify(currentSession().view.state())}` }, ...(fresh?.content || [])],
              structuredContent: { desktopBrowserRecovery: true, reason: error.recovery, ...currentSession().view.state() } };
          }
        if (request.reveal && !result.isError && currentSession().context) {
          const pages = currentSession().context.pages();
          const page = pages.find(page => page.url() === request.params?.arguments?.url) || pages.at(-1);
          await page?.bringToFront();
        }
        failed = !!result.isError;
        return { ...result, content: [...(result.content || []), { type: 'text', text: `Desktop browser state: ${JSON.stringify(currentSession().view.state())}` }] };
        } finally { const elapsed = performance.now() - began; const read = ['browser_snapshot', 'browser_take_screenshot', 'browser_console_messages', 'browser_network_requests'].includes(request.params?.name); metrics.record({ failed, queueMs, actionMs: read ? 0 : elapsed, observeMs: read ? elapsed : 0 }); }
      }
      throw new Error('Only official browser tool methods are supported');
    });
    reply(res, 200, { result });
    });
  } catch {
    // Tool payloads and error details can contain passwords/page content. Never
    // write them to process logs or native errors. MCP tool errors stay in results.
    reply(res, 400, { error: 'Browser request failed; check its tool arguments, workspace and browser state' });
  }
});
async function captureFrame() {
  const key = selectedKey, scope = selectedScope, owned = sessions.get(key);
  if (!owned?.context) return { browserOpen: false, busy: false, tabs: [], scope };
  if (!owned.frameFlight) owned.frameFlight = (async () => {
    try { return await owned.view.frame(owned.context); }
    catch (error) { if (!error.frameChanged) throw error; return owned.view.frame(owned.context); }
  })().finally(() => { owned.frameFlight = undefined; });
  const frame = await owned.frameFlight;
  if (selectedKey !== key) return { browserOpen: false, busy: false, tabs: [], scope: selectedScope };
  return { ...frame, scope, scopeKey: key };
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
  for (const owned of sessions.values()) {
    for (const { client, official } of owned.connections.values()) {
      await client.close().catch(() => {}); await official.close().catch(() => {});
    }
    await owned.context?.close().catch(() => {});
  }
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
