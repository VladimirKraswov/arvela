// Direct official backend diagnostic/acceptance, disposable temporary profile.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { realpath } from 'node:fs';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createView } from '../view.mjs';
const root = await fs.realpath(process.argv[2]);
const temporaryRoots = [await fs.realpath(os.tmpdir())];
if (process.platform !== 'win32') temporaryRoots.push(await fs.realpath('/tmp'));
assert(temporaryRoots.includes(path.dirname(root)), 'Use a test-owned temporary runtime');
assert(path.basename(root).startsWith('oc-browser-'));
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, 'browsers');
const load = file => import(pathToFileURL(path.join(root, 'current/node_modules', file)));
const { chromium } = await load('playwright/index.mjs');
const { createConnection } = await load('@playwright/mcp/index.js');
const { Client } = await load('@modelcontextprotocol/sdk/dist/esm/client/index.js');
const { InMemoryTransport } = await load('@modelcontextprotocol/sdk/dist/esm/inMemory.js');
let context, official, client;
try {
  const executablePath = process.platform === 'win32' ? await promisify(realpath.native)(chromium.executablePath()) : undefined;
  context = await chromium.launchPersistentContext(path.join(root, 'view-test-profile'), { headless: true, chromiumSandbox: true, executablePath, viewport: { width: 1280, height: 800 } });
  const getContext = async () => context;
  official = await createConnection({ browser: { browserName: 'chromium' }, sharedBrowserContext: true, capabilities: ['core','vision'] }, getContext);
  client = new Client({ name: 'view-test', version: '1' });
  const [server, transport] = InMemoryTransport.createLinkedPair();
  await official.connect(server); await client.connect(transport);
  const view = createView(getContext);
  const params = { name: 'browser_snapshot', arguments: {} };
  await view.before(client, params);
  const result = await client.callTool(params); assert(!result.isError);
  await view.after(client, params, result);
  const frame = await view.frame(context); assert(frame.image.length > 100);
  console.log('DIRECT_VIEW_OK');
} finally { await client?.close(); await official?.close(); await context?.close(); }
