// Opt-in, real SDK + Pi loader acceptance. Disposable fixture, no model calls.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const [
  runtime,
  piRoot = "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent",
  openCodeEndpoint,
  desktopCommand,
  managedRoot,
] = process.argv.slice(2);
assert(runtime && path.isAbsolute(runtime));
const { Client } = await import(
  pathToFileURL(
    path.join(
      runtime,
      "node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js",
    ),
  )
);
const { StdioClientTransport } = await import(
  pathToFileURL(
    path.join(
      runtime,
      "node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js",
    ),
  )
);
const { loadExtensions } = await import(
  pathToFileURL(path.join(piRoot, "dist/core/extensions/loader.js"))
);
const { validateToolArguments } = await import(
  pathToFileURL(
    path.join(
      piRoot,
      "node_modules/@earendil-works/pi-ai/dist/utils/validation.js",
    ),
  )
);
const temp = await fs.mkdtemp(
  path.join(os.tmpdir(), "mesh-shared-acceptance-"),
);
const fixture = path.join(temp, "fixture.mjs"),
  wrapper = desktopCommand || path.join(temp, "mesh"),
  calls = path.join(temp, "calls.jsonl");
const sdk = pathToFileURL(
  path.join(runtime, "node_modules/@modelcontextprotocol/sdk/dist/esm"),
).href;
await fs.writeFile(
  fixture,
  `
import fs from 'node:fs/promises';
import {Server} from '${sdk}/server/index.js';
import {StdioServerTransport} from '${sdk}/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '${sdk}/types.js';
const server=new Server({name:'fixture',version:'1'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,()=>({tools:[{name:'echo-text',description:'Own acceptance only',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false}}]}));
server.setRequestHandler(CallToolRequestSchema,async r=>{await fs.appendFile(${JSON.stringify(calls)},JSON.stringify({cwd:process.cwd(),text:r.params.arguments.text})+'\\n');return {content:[{type:'text',text:'FIXTURE:'+r.params.arguments.text}],isError:r.params.arguments.text==='error'};});
await server.connect(new StdioServerTransport());
`,
);
if (!desktopCommand)
  await fs.writeFile(
    wrapper,
    `#!${process.execPath}\nprocess.argv=[process.execPath,'proxy',${JSON.stringify(temp)},...process.argv.slice(3)];await import(${JSON.stringify(pathToFileURL(path.join(runtime, "proxy.mjs")).href)});\n`,
    { mode: 0o700 },
  );
const spec = {
  id: "acceptance",
  name: "Acceptance",
  enabled: true,
  kind: "stdio",
  command: process.execPath,
  args: [fixture],
  url: "",
  envKeys: [],
  bearer: false,
};
const canonicalWorkspace = await fs.realpath(temp);
let scopeKey = "global";
const registryRoot = managedRoot || temp;
if (desktopCommand) {
  assert(
    managedRoot &&
      path.isAbsolute(desktopCommand) &&
      path.isAbsolute(managedRoot),
  );
  const global = await fs
    .readFile(path.join(managedRoot, "global.json"), "utf8")
    .then(JSON.parse, (e) =>
      e.code === "ENOENT" ? { servers: [] } : Promise.reject(e),
    );
  assert(
    !global.servers.some((s) => s.enabled),
    "Installed acceptance must not start existing owner MCPs",
  );
  let hash = 0xcbf29ce484222325n;
  for (const b of new TextEncoder().encode(canonicalWorkspace))
    hash = BigInt.asUintN(64, (hash ^ BigInt(b)) * 0x100000001b3n);
  scopeKey = "project-" + hash.toString(16).padStart(16, "0");
}
const registryFile = path.join(registryRoot, `${scopeKey}.json`);
const registry = (enabled) =>
  JSON.stringify({
    version: 1,
    directory: desktopCommand ? canonicalWorkspace : null,
    sources: [],
    servers: [{ ...spec, enabled }],
    appliedPaths: [],
  });
await fs.writeFile(registryFile, registry(true), { flag: "wx", mode: 0o600 });
const saved = Object.fromEntries(
  [
    "MESH_CAPABILITIES_ROOT",
    "MESH_CAPABILITIES_KEY",
    "MESH_CAPABILITIES_COMMAND",
  ].map((n) => [n, process.env[n]]),
);
Object.assign(process.env, {
  MESH_CAPABILITIES_ROOT: registryRoot,
  MESH_CAPABILITIES_KEY: scopeKey,
  MESH_CAPABILITIES_COMMAND: wrapper,
});
let extension, client;
let attached = false;
const requestOpenCode = async (method, route, body) => {
  const u = new URL(route, openCodeEndpoint);
  u.searchParams.set("directory", temp);
  const response = await fetch(u, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  assert(response.ok, "OpenCode metadata call failed");
  return response.json();
};
try {
  client = new Client(
    { name: "own-sdk-acceptance", version: "1" },
    { capabilities: {} },
  );
  await client.connect(
    new StdioClientTransport({
      command: wrapper,
      args: ["--shared-mcp", scopeKey, "acceptance"],
      cwd: temp,
      stderr: "ignore",
    }),
    { timeout: 10000 },
  );
  assert.equal((await client.listTools()).tools[0].name, "echo_text");
  assert.equal(
    await fs.stat(calls).then(
      () => true,
      () => false,
    ),
    false,
    "Discovery invoked a tool",
  );
  const result = await client.callTool({
    name: "echo_text",
    arguments: { text: "sdk" },
  });
  assert.equal(result.content[0].text, "FIXTURE:sdk");
  await client.close();
  client = null;
  const loaded = await loadExtensions(
    [path.join(runtime, "pi-extension.ts")],
    temp,
  );
  assert.equal(loaded.errors.length, 0, JSON.stringify(loaded.errors));
  extension = loaded.extensions[0];
  assert(extension);
  assert.equal(extension.tools.size, 0);
  const warnings = [];
  const ctx = { cwd: temp, ui: { notify: (m) => warnings.push(m) } };
  for (const h of extension.handlers.get("session_start") || [])
    await h({ type: "session_start" }, ctx);
  assert.equal(warnings.length, 0);
  assert.equal(extension.tools.size, 1);
  const tool = extension.tools.get("mesh_acceptance_echo_text");
  assert(tool);
  assert.throws(() =>
    validateToolArguments(tool.definition, {
      name: tool.definition.name,
      arguments: {},
    }),
  );
  const args = validateToolArguments(tool.definition, {
    name: tool.definition.name,
    arguments: { text: "pi" },
  });
  assert.equal(
    (await tool.definition.execute("own", args, undefined, undefined, ctx))
      .content[0].text,
    "FIXTURE:pi",
  );
  await assert.rejects(
    tool.definition.execute(
      "error",
      { text: "error" },
      undefined,
      undefined,
      ctx,
    ),
    /не повторяйте/,
  );
  const before = (await fs.readFile(calls, "utf8")).trim().split("\n");
  assert.equal(before.length, 3, "A call was retried");
  await fs.writeFile(registryFile, registry(false));
  await assert.rejects(
    tool.definition.execute(
      "disabled",
      { text: "forbidden" },
      undefined,
      undefined,
      ctx,
    ),
    /Переоткройте/,
  );
  assert.equal((await fs.readFile(calls, "utf8")).trim().split("\n").length, 3);
  const canonical = await fs.realpath(temp);
  assert(
    before.every((line) => JSON.parse(line).cwd === canonical),
    "Tools escaped the fixture workspace",
  );
  if (openCodeEndpoint) {
    const origin = new URL(openCodeEndpoint);
    assert(
      ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) &&
        !origin.username &&
        !origin.password,
    );
    await fs.writeFile(registryFile, registry(true));
    const name = "mesh_acceptance";
    const connected = await requestOpenCode("POST", "/mcp", {
      name,
      config: {
        type: "local",
        command: [wrapper, "--shared-mcp", scopeKey, "acceptance"],
        enabled: true,
        timeout: 10000,
      },
    });
    attached = true;
    assert.equal(connected[name]?.status, "connected");
    assert.equal(
      (await requestOpenCode("GET", "/mcp"))[name]?.status,
      "connected",
    );
    assert.equal(
      (await fs.readFile(calls, "utf8")).trim().split("\n").length,
      3,
      "OpenCode discovery executed an upstream tool",
    );
  }
  console.log(
    JSON.stringify({
      realSDK: true,
      installedDesktopCLI: !!desktopCommand,
      realPiLoader: true,
      piVersion: JSON.parse(
        await fs.readFile(path.join(piRoot, "package.json")),
      ).version,
      realPiValidator: true,
      sharedAlias: true,
      discoveryNoCalls: true,
      workspaceScoped: true,
      errorNoReplay: true,
      disableFailClosed: true,
      noModelRequests: true,
      realOpenCodeAttachment: attached,
    }),
  );
} finally {
  if (attached)
    await requestOpenCode("POST", "/mcp/mesh_acceptance/disconnect", {});
  for (const h of extension?.handlers.get("session_shutdown") || [])
    await h({ type: "session_shutdown" }, {});
  await client?.close().catch(() => {});
  for (const [n, v] of Object.entries(saved))
    if (v === undefined) delete process.env[n];
    else process.env[n] = v;
  if (desktopCommand) await fs.unlink(registryFile);
  await fs.rm(temp, { recursive: true, force: true });
}
