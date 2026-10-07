// Opt-in Streamable HTTP acceptance. Loopback fixture only, no agent/model calls.
import http from "node:http";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
const [runtime] = process.argv.slice(2);
assert(path.isAbsolute(runtime));
const sdk = path.join(
  runtime,
  "node_modules/@modelcontextprotocol/sdk/dist/esm",
);
const { Server } = await import(
  pathToFileURL(path.join(sdk, "server/index.js"))
);
const { StreamableHTTPServerTransport } = await import(
  pathToFileURL(path.join(sdk, "server/streamableHttp.js"))
);
const { ListToolsRequestSchema, CallToolRequestSchema } = await import(
  pathToFileURL(path.join(sdk, "types.js"))
);
const { connectServer } = await import(
  pathToFileURL(path.join(runtime, "client.mjs"))
);
let calls = 0,
  requests = 0;
const server = new Server(
  { name: "own-http-fixture", version: "1" },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: [
    {
      name: "read_project",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, () => {
  calls++;
  return { content: [{ type: "text", text: "HTTP_FIXTURE_OK" }] };
});
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
  enableJsonResponse: true,
});
await server.connect(transport);
const listener = http.createServer(async (req, res) => {
  requests++;
  if (req.headers.authorization !== "Bearer own-test-token") {
    res.writeHead(401);
    res.end();
    return;
  }
  try {
    let text = "";
    for await (const chunk of req) {
      text += chunk;
      if (text.length > 65536) throw new Error("body");
    }
    await transport.handleRequest(
      req,
      res,
      text ? JSON.parse(text) : undefined,
    );
  } catch {
    if (!res.headersSent) res.writeHead(400);
    res.end();
  }
});
await new Promise((r) => listener.listen(0, "127.0.0.1", r));
let connection;
try {
  const spec = {
    id: "http-test",
    kind: "http",
    url: `http://127.0.0.1:${listener.address().port}/mcp`,
  };
  connection = await connectServer(spec, process.cwd(), "own-test-token");
  assert.equal(connection.tools[0].name, "read_project");
  assert.equal(calls, 0);
  assert.equal(
    (await connection.client.callTool({ name: "read_project", arguments: {} }))
      .content[0].text,
    "HTTP_FIXTURE_OK",
  );
  assert.equal(calls, 1);
  console.log(
    JSON.stringify({
      streamableHTTP: true,
      explicitBearer: true,
      discoveryNoCalls: true,
      toolResult: true,
      requests,
      noModelRequests: true,
    }),
  );
} finally {
  await connection?.close();
  await server.close();
  listener.closeAllConnections();
  await new Promise((r) => listener.close(r));
}
