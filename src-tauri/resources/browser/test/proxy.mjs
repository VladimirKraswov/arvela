// Real SDK/proxy transport regression checks against a test-owned HTTP gateway.
// No model requests, browser profile, user configuration or external services.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const runtime = process.argv[2];
assert(runtime && path.isAbsolute(runtime), 'Supply a prepared test runtime');
const { Client } = await import(pathToFileURL(path.join(runtime, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js')));
const { StdioClientTransport } = await import(pathToFileURL(path.join(runtime, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js')));

async function fixture(mode, run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-browser-proxy-'));
  let token = 'a'.repeat(64), instanceId = 'first', denied = 0, deliveries = 0;
  let client;
  const writeReady = () => fs.writeFile(path.join(root, 'ready.json'), JSON.stringify({
    port: server.address().port, token, instanceId, version: '0.0.83',
  }), { mode: 0o600 });
  const server = http.createServer(async (req, res) => {
    const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.headers.authorization !== `Bearer ${token}`) return reply(403, {});
    if (req.url === '/health') return reply(200, { instanceId, running: true });
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (body.method === 'tools/list') return reply(200, { result: { tools: [] } });
    assert.equal(body.method, 'tools/call');
    if (mode === 'rotate' && denied === 0) {
      denied++; token = 'b'.repeat(64); instanceId = 'second';
      await writeReady(); return reply(403, {});
    }
    deliveries++;
    if (mode === 'drop') { req.socket.destroy(); return; }
    reply(200, { result: { content: [{ type: 'text', text: 'DELIVERED_ONCE' }] } });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await writeReady();
  try {
    client = new Client({ name: 'proxy-regression', version: '1.0.0' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(runtime, 'proxy.mjs'), root], cwd: root, stderr: 'pipe' });
    await client.connect(transport);
    await run(client, () => ({ deliveries, denied }), transport);
  } finally {
    await client?.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('a delivered mutation is never replayed after its response connection is lost', async () => {
  await fixture('drop', async (client, counts) => {
    await assert.rejects(client.callTool({ name: 'fixture_mutation', arguments: {} }), /interrupted/i);
    assert.equal(counts().deliveries, 1);
  });
});

test('rotated authentication before delivery reconnects and delivers exactly once', async () => {
  await fixture('rotate', async (client, counts) => {
    const result = await client.callTool({ name: 'fixture_mutation', arguments: {} });
    assert.equal(result.content[0].text, 'DELIVERED_ONCE');
    assert.deepEqual(counts(), { denied: 1, deliveries: 1 });
  });
});
