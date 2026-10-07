// Opt-in installed app acceptance: real Pi loader + actual app CLI MCP bridge.
// No prompts, model calls, session history or global Pi configuration writes.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const [command, runtime, piRoot = '/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent', transportLabel = 'installed'] = process.argv.slice(2);
assert(command && runtime && path.isAbsolute(command) && path.isAbsolute(runtime), 'Supply absolute installed app binary and managed current runtime paths');
const packageInfo = JSON.parse(await fs.readFile(path.join(piRoot, 'package.json')));
assert.equal(packageInfo.version, '0.85.1', 'This acceptance targets the installed Pi 0.85.1');
const { loadExtensions } = await import(pathToFileURL(path.join(piRoot, 'dist/core/extensions/loader.js')));
const { validateToolArguments } = await import(pathToFileURL(path.join(piRoot, 'node_modules/@earendil-works/pi-ai/dist/utils/validation.js')));
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-browser-pi-packaged-'));
const fixture = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!doctype html><title>Packaged Pi browser acceptance</title><h1>PI_DESKTOP_BROWSER_FIXTURE</h1><label>Password<input type="password" aria-label="Password"></label><button>Fixture button</button>');
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const fixtureUrl = `http://127.0.0.1:${fixture.address().port}`;
const previous = process.env.OCDESKTOP_BROWSER_COMMAND;
process.env.OCDESKTOP_BROWSER_COMMAND = command;
let extension;
const warnings = [];
const context = { cwd: workspace, ui: { notify: message => warnings.push(message) } };
try {
  const loaded = await loadExtensions([path.join(runtime, 'pi-extension.ts')], workspace);
  assert.equal(loaded.errors.length, 0, 'Real Pi loader rejected the managed extension');
  assert.equal(loaded.extensions.length, 1); extension = loaded.extensions[0];
  assert.equal(extension.tools.size, 0, 'Metadata loading must not start/register browser tools');
  for (const handler of extension.handlers.get('session_start') || []) await handler({ type: 'session_start' }, context);
  const deadline = Date.now() + 30000;
  while (extension.tools.size !== 36 && !warnings.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(warnings.length, 0, 'Pi browser startup reported unavailable');
  assert.equal(extension.tools.size, 36, 'Real official browser tools were not registered');
  const navigate = extension.tools.get('desktop_browser_browser_navigate');
  const snapshot = extension.tools.get('desktop_browser_browser_snapshot');
  assert(navigate && snapshot);
  assert.throws(() => validateToolArguments(navigate.definition, { name: navigate.definition.name, arguments: {} }), 'Real Pi validator must enforce required URL');
  const navigationArgs = validateToolArguments(navigate.definition, { name: navigate.definition.name, arguments: { url: fixtureUrl } });
  await navigate.definition.execute('packaged-pi-navigation', navigationArgs, undefined, undefined, context);
  const snapshotArgs = validateToolArguments(snapshot.definition, { name: snapshot.definition.name, arguments: {} });
  const result = await snapshot.definition.execute('packaged-pi-snapshot', snapshotArgs, undefined, undefined, context);
  assert(result.content.some(block => block.type === 'text' && block.text.includes('PI_DESKTOP_BROWSER_FIXTURE')), 'Actual app MCP snapshot did not observe the fixture');
  const observe = extension.tools.get('desktop_browser_browser_observe');
  const action = extension.tools.get('desktop_browser_browser_action');
  const sequence = extension.tools.get('desktop_browser_browser_sequence'); assert(observe && action && sequence);
  const atomic = validateToolArguments(action.definition, {name:action.definition.name,arguments:{step:{tool:'browser_press_key',arguments:{key:'Escape'}}}});
  const atomicResult = await action.definition.execute('pi-browser-atomic',atomic,undefined,undefined,context);
  assert.equal(atomicResult.details.mcp.structuredContent.completed,1);
  assert(atomicResult.content.some(block => block.type === 'text' && block.text.includes('PI_DESKTOP_BROWSER_FIXTURE')));
  console.log(JSON.stringify({ platform: process.platform, installedAppCli: transportLabel === 'installed', testOwnedProxy: transportLabel === 'test-proxy', piVersion: packageInfo.version, realPiLoader: true, realPiArgumentValidation: true, officialBrowserTools: 32, desktopTools: extension.tools.size, navigate: true, snapshot: true, noModelRequests: true }));
} finally {
  for (const handler of extension?.handlers.get('session_shutdown') || []) await handler({ type: 'session_shutdown' }, context);
  if (previous === undefined) delete process.env.OCDESKTOP_BROWSER_COMMAND; else process.env.OCDESKTOP_BROWSER_COMMAND = previous;
  // The shared headed browser remains alive after this test, and may keep a
  // fixture socket open. Close only our HTTP connections before awaiting exit.
  fixture.closeAllConnections();
  await new Promise(resolve => fixture.close(resolve));
  await fs.rm(workspace, { recursive: true, force: true });
}
