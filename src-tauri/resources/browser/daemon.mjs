// A private lifecycle/transport bridge. Browser behavior is implemented by
// Microsoft's unmodified Playwright MCP; no page scripts/selectors live here.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { createConnection } from '@playwright/mcp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

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
let closing = false;
let queue = Promise.resolve();
const serial = action => {
  const result = queue.then(action);
  queue = result.catch(() => {});
  return result;
};
async function getContext() {
  if (!context) {
    const opened = await chromium.launchPersistentContext(path.join(root, 'profile'), {
      headless: false, viewport: null, chromiumSandbox: true,
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
      if (request.method === 'desktop/reveal') {
        const browser = await getContext();
        const page = browser.pages().at(-1) || await browser.newPage();
        await page.bringToFront();
        return { revealed: true };
      }
      const client = await connection(request.workspace);
      if (request.method === 'tools/list') return client.listTools();
      if (request.method === 'tools/call') {
        const result = await client.callTool(request.params, undefined, { signal: cancellation.signal });
        if (request.reveal && !result.isError && context) {
          const pages = context.pages();
          const page = pages.find(page => page.url() === request.params?.arguments?.url) || pages.at(-1);
          await page?.bringToFront();
        }
        return result;
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
