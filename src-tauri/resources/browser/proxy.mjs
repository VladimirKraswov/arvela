import fs from 'node:fs/promises';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const root = process.argv[2];
if (!root || !path.isAbsolute(root)) throw new Error('Invalid managed runtime directory');
async function connection() {
  let ready;
  try { ready = JSON.parse(await fs.readFile(path.join(root, 'ready.json'), 'utf8')); }
  catch { throw new Error('OpenCode Desktop browser is stopped. Open Desktop → Settings → Browser and start it.'); }
  if (!Number.isInteger(ready.port) || ready.port < 1 || ready.port > 65535 || !/^[a-f0-9]{64}$/.test(ready.token) || ready.version !== '0.0.83') throw new Error('Invalid browser readiness record; reconnect its MCP integration.');
  const endpoint = `http://127.0.0.1:${ready.port}`;
  const health = await fetch(`${endpoint}/health`, { headers: { Authorization: `Bearer ${ready.token}` }, redirect: 'error', signal: AbortSignal.timeout(3000) });
  if (!health.ok || (await health.json()).instanceId !== ready.instanceId) throw new Error('Desktop browser has restarted. Reconnect its MCP integration.');
  return { ready, endpoint };
}
// Initialization fails closed while Desktop is stopped. Before each subsequent
// RPC read the private record again: a deliberate Desktop stop/start rotates
// the endpoint/token without requiring every engine session to be recreated.
await connection();
async function rpc(method, params, signal) {
  const { ready, endpoint } = await connection();
  const response = await fetch(`${endpoint}/rpc`, {
    method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${ready.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params, workspace: process.cwd() }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Browser unavailable');
  return value.result;
}
const server = new Server({ name: 'opencode-desktop-browser', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, () => rpc('tools/list'));
server.setRequestHandler(CallToolRequestSchema, (request, extra) => rpc('tools/call', request.params, extra.signal));
const transport = new StdioServerTransport();
transport.onclose = () => { void server.close(); };
await server.connect(transport);
