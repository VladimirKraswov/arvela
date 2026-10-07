import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  emptyRegistry,
  sharedOpenCodeConfig,
  piServerState,
  validateServer,
  signature,
  type Catalog,
  type SharedServer,
} from "../src/capabilities/registry";
import {
  configureShared,
  invalidateCapabilities,
  synchronizeSources,
} from "../src/capabilities/integration";
import {
  readRegistry,
  remoteUrl,
  toolName,
  signature as runtimeSignature,
} from "../src-tauri/resources/shared/registry.mjs";
const server: SharedServer = {
  id: "project-search",
  name: "Search",
  enabled: true,
  kind: "stdio",
  command: "/usr/bin/node",
  args: ["/tmp/server.mjs"],
  url: "",
  envKeys: [],
  bearer: false,
};
const catalog = (): Catalog => ({
  key: "global",
  content: "original",
  registry: {
    ...emptyRegistry(),
    sources: [{ id: "common", path: "/shared/skills", enabled: true }],
    servers: [server],
  },
  inherited: emptyRegistry(),
  runtimeReady: true,
  command:
    "/Applications/AgentMesh Desktop.app/Contents/MacOS/opencode-desktop",
  skills: [],
  scopeDirectory: null,
});
afterEach(() => {
  invalidateCapabilities();
  vi.restoreAllMocks();
});
it("keeps JSONC, foreign MCPs, permission rules and plugins intact", () => {
  const source =
    '{//keep\n"permission":{"bash":"ask"},"plugin":["own"],"mcp":{"foreign":{"type":"remote","url":"https://service/mcp"}},"skills":{"paths":["/owner"]}}';
  const next = sharedOpenCodeConfig(source, catalog());
  expect(next.content).toContain("//keep");
  const parsed = JSON.parse(next.content.replace("//keep", ""));
  expect(parsed.permission).toEqual({ bash: "ask" });
  expect(parsed.plugin).toEqual(["own"]);
  expect(parsed.mcp.foreign.url).toBe("https://service/mcp");
  expect(parsed.skills.paths).toEqual(["/owner", "/shared/skills"]);
  expect(next.appliedPaths).toEqual(["/shared/skills"]);
});
it("refuses a reserved-name collision instead of adopting another MCP", () => {
  expect(() =>
    sharedOpenCodeConfig(
      '{"mcp":{"mesh_project_search":{"type":"remote","url":"https://foreign/mcp"}}}',
      catalog(),
    ),
  ).toThrow(/занято/);
});
it("only removes app-added skill paths and retains paths that predated adoption", () => {
  const c = catalog();
  c.registry.sources[0].enabled = false;
  c.registry.appliedPaths = ["/managed"];
  const next = sharedOpenCodeConfig(
    '{"skills":{"paths":["/managed","/owner","/shared/skills"]}}',
    c,
  );
  expect(JSON.parse(next.content).skills.paths).toEqual([
    "/owner",
    "/shared/skills",
  ]);
  expect(next.appliedPaths).toEqual([]);
});
it("a moved app refreshes only its own wrapper and disable persists", () => {
  const c = catalog();
  c.registry.servers[0] = { ...server, enabled: false };
  const old = JSON.stringify({
    mcp: {
      mesh_project_search: {
        type: "local",
        command: ["/old/opencode-desktop", "--shared-mcp", "global", server.id],
      },
    },
  });
  const next = sharedOpenCodeConfig(old, c);
  expect(JSON.parse(next.content).mcp.mesh_project_search).toMatchObject({
    enabled: false,
    command: [c.command, "--shared-mcp", "global", server.id],
  });
});
it("schema, environment names, absolute executables and secret URL policy match", () => {
  expect(validateServer(server)).toBeNull();
  expect(validateServer({ ...server, command: "node" })).toBeTruthy();
  expect(validateServer({ ...server, command: "C:\\npm.cmd" })).toBeTruthy();
  expect(validateServer({ ...server, envKeys: ["KEY=secret"] })).toBeTruthy();
  for (const url of [
    "http://remote/mcp",
    "https://user:secret@host/mcp",
    "https://host/mcp?token=secret",
  ])
    expect(() => remoteUrl(url)).toThrow();
  expect(remoteUrl("http://127.0.0.1:18901/mcp").hostname).toBe("127.0.0.1");
  expect(toolName("project-search", "find_symbol")).toBe(
    "mesh_project_search_find_symbol",
  );
});
it("Pi reports stale registrations honestly and shares the exact revision token", () => {
  expect(signature(server)).toBe(runtimeSignature(server));
  expect(piServerState(server, [], false)).toMatch(/Откройте/);
  expect(
    piServerState(
      server,
      [{ id: server.id, signature: "old", state: "connected", tools: ["x"] }],
      true,
    ),
  ).toMatch(/Переоткройте/);
  expect(
    piServerState(
      server,
      [
        {
          id: server.id,
          signature: signature(server),
          state: "connected",
          tools: ["x"],
        },
      ],
      true,
    ),
  ).toMatch(/Подключено/);
});
it("registry reads are bounded and reject traversal/symlinks; project merges preserve globals", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mesh-registry-"));
  try {
    await writeFile(
      path.join(root, "global.json"),
      JSON.stringify({ ...emptyRegistry(), servers: [server] }),
    );
    await writeFile(
      path.join(root, "project-0123456789abcdef.json"),
      JSON.stringify({
        ...emptyRegistry(),
        sources: [{ id: "extra", path: "/extra", enabled: true }],
      }),
    );
    expect(
      (await readRegistry(root, "project-0123456789abcdef")).servers,
    ).toHaveLength(1);
    await expect(readRegistry(root, "../other")).rejects.toThrow();
    await writeFile(path.join(root, "global.json"), "x".repeat(262145));
    await expect(readRegistry(root, "global")).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true });
  }
});
it("sync uses CAS and refuses to mark configuration saved after a failed write", async () => {
  const invoke = vi.fn(async (name: string) => {
    if (name === "read_opencode_config") return { content: "{}" };
    if (name === "write_opencode_config") throw Error("stale");
    return catalog();
  });
  await expect(
    synchronizeSources(catalog(), "global", null, invoke as any),
  ).rejects.toThrow("stale");
  expect(invoke.mock.calls.some((c) => c[0] === "shared_save")).toBe(false);
});
it("live attachment is scoped, confirmed once and changed specs reconnect", async () => {
  let c = catalog();
  c.registry.sources = [];
  const invoke = vi.fn(async (name: string, args: any) => {
    if (name === "shared_catalog")
      return args.scope === "global"
        ? c
        : { ...c, key: "project-0123456789abcdef", registry: emptyRegistry() };
    if (name === "read_opencode_config") return { content: "{}" };
    return c;
  });
  const request = vi.fn(async (method: string, _path: string, opts: any) => {
    expect(opts.query.directory).toBe("/work");
    return {
      mesh_project_search: {
        status: method === "POST" ? "connected" : "connected",
      },
    };
  });
  const o = {
    endpoint: "http://localhost",
    directory: "/work",
    current: () => true,
    request: request as any,
  };
  await configureShared(o, invoke as any);
  await configureShared(o, invoke as any);
  expect(request.mock.calls.filter((c) => c[0] === "POST")).toHaveLength(1);
  c = {
    ...c,
    registry: {
      ...c.registry,
      servers: [{ ...server, args: ["/tmp/new-server.mjs"] }],
    },
  };
  await configureShared(o, invoke as any);
  expect(request.mock.calls.filter((c) => c[0] === "POST")).toHaveLength(2);
});
it("missing runtime and unconfirmed connection never become ready", async () => {
  const c = catalog();
  c.registry.sources = [];
  c.runtimeReady = false;
  const invoke = vi.fn(async (name: string, args: any) =>
    name === "shared_catalog"
      ? args.scope === "global"
        ? c
        : { ...c, registry: emptyRegistry() }
      : name === "read_opencode_config"
        ? { content: "{}" }
        : c,
  );
  const request = vi.fn(async () => ({}));
  await expect(
    configureShared(
      { endpoint: "local", directory: "/work", current: () => true, request },
      invoke as any,
    ),
  ).rejects.toThrow(/Установите/);
  expect(request).not.toHaveBeenCalled();
});

it("Pi revision ignores presentation metadata and property order", () => {
  const spec = {
    id: "revision",
    name: "Revision",
    enabled: true,
    kind: "stdio" as const,
    command: "/usr/bin/node",
    args: [],
    url: "",
    envKeys: [],
    bearer: false,
  };
  const displayed = { inherited: true, ...spec };
  expect(
    piServerState(
      displayed,
      [
        {
          id: spec.id,
          signature: signature(spec),
          state: "connected",
          tools: ["mesh_revision_echo"],
        },
      ],
      true,
    ),
  ).toContain("Подключено");
  expect(signature({ ...spec, args: ["changed"] })).not.toBe(signature(spec));
});

it("rotating authentication invalidates a loaded Pi service without exposing its token", () => {
  const s = { ...server, authRevision: "old-public-revision" };
  expect(
    piServerState(
      { ...s, authRevision: "new-public-revision" },
      [{ id: s.id, signature: signature(s), state: "connected", tools: [] }],
      true,
    ),
  ).toContain("Переоткройте");
});
