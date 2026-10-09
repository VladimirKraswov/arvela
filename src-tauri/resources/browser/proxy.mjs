import { stripSession } from './session.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const root = process.argv[2];
if (!root || !path.isAbsolute(root)) throw new Error('Invalid managed runtime directory');
const STOPPED = 'Arvela browser is stopped. Open Desktop → Settings → Browser and start it.';
const RESTARTED = 'Desktop browser has restarted. Reconnect its MCP integration.';
const TOOL_TIMEOUT_MS = 90000;
const RECONNECT_WAIT_MS = 5000;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
// The request never reached the daemon's handler, so repeating it cannot
// repeat a browser action. Every other failure is reported, never retried.
class NotDelivered extends Error {}
function combined(signal, timeout) {
  if (!signal) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout]);
  const controller = new AbortController();
  for (const source of [signal, timeout]) {
    if (source.aborted) controller.abort(source.reason);
    else source.addEventListener('abort', () => controller.abort(source.reason), { once: true });
  }
  return controller.signal;
}
async function connection() {
  let ready;
  try { ready = JSON.parse(await fs.readFile(path.join(root, 'ready.json'), 'utf8')); }
  catch { throw new NotDelivered(STOPPED); }
  if (!Number.isInteger(ready.port) || ready.port < 1 || ready.port > 65535 || !/^[a-f0-9]{64}$/.test(ready.token) || ready.version !== '0.0.83') throw new Error('Invalid browser readiness record; reconnect its MCP integration.');
  const endpoint = `http://127.0.0.1:${ready.port}`;
  let health;
  try { health = await fetch(`${endpoint}/health`, { headers: { Authorization: `Bearer ${ready.token}` }, redirect: 'error', signal: AbortSignal.timeout(3000) }); }
  catch { throw new NotDelivered(STOPPED); }
  if (!health.ok || (await health.json().catch(() => ({}))).instanceId !== ready.instanceId) throw new NotDelivered(RESTARTED);
  return { ready, endpoint };
}
// Initialization fails closed while Desktop is stopped. Before each subsequent
// RPC read the private record again: a deliberate Desktop stop/start rotates
// the endpoint/token without requiring every engine session to be recreated.
await connection().catch(error => { throw new Error(error.message); });
async function send(method, params, signal) {
  const { ready, endpoint } = await connection();
  const timeout = AbortSignal.timeout(TOOL_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${endpoint}/rpc`, {
      method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${ready.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, ...(method === "tools/call" ? stripSession(params) : { params }), workspace: process.cwd() }), signal: combined(signal, timeout),
    });
  } catch (error) {
    if (signal?.aborted) throw new Error('Browser request was cancelled.');
    if (timeout.aborted) throw new Error('Browser tool did not finish within 90 s. Inspect the current page before retrying.');
    if (error?.cause?.code === 'ECONNREFUSED') throw new NotDelivered(STOPPED);
    throw new Error('Desktop browser connection was interrupted. Inspect the current page before retrying.');
  }
  // 403 is decided before any request body is handled: the token had rotated.
  if (response.status === 403) throw new NotDelivered(RESTARTED);
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || 'Browser unavailable');
  return value.result;
}
async function rpc(method, params, signal) {
  try { return await send(method, params, signal); }
  catch (error) {
    if (!(error instanceof NotDelivered)) throw error;
    // Desktop may be restarting its daemon. Wait briefly for a fresh record,
    // then try exactly once more; a later failure is reported as is.
    const deadline = Date.now() + RECONNECT_WAIT_MS;
    while (Date.now() < deadline && !signal?.aborted) {
      try { await connection(); break; } catch { await pause(250); }
    }
    if (signal?.aborted) throw new Error('Browser request was cancelled.');
    try { return await send(method, params, signal); }
    catch (retry) { throw new Error(retry.message); }
  }
}
const server = new Server({ name: 'arvela-browser', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, () => rpc('tools/list'));
server.setRequestHandler(CallToolRequestSchema, (request, extra) => rpc('tools/call', request.params, extra.signal));
const transport = new StdioServerTransport();
transport.onclose = () => { void server.close(); };
// The engine closed its end: nothing can receive a response any more, so do
// not linger until an in-flight browser request times out.
process.stdin.on('end', () => process.exit(0));
await server.connect(transport);
