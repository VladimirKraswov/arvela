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
it("missing runtime reports tools unavailable without claiming a connection or blocking chat", async () => {
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
  const report=await configureShared(
    { endpoint: "local", directory: "/work", current: () => true, request },
    invoke as any,
  );
  expect(report.unavailable).toEqual([{id:server.id,name:server.name}]);
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
it("installs session access inheritance independently of browser and preserves foreign config",()=>{
 const c={...catalog(),accessPluginPath:'/shared/runtime/access-policy.mjs'};
 const before='{"plugin":["owner-plugin"],"permission":{"edit":"ask"}}';
 const next=sharedOpenCodeConfig(before,c).content, parsed=JSON.parse(next);
 expect(parsed.plugin).toEqual(['owner-plugin','file:///shared/runtime/access-policy.mjs']);
 expect(parsed.permission).toEqual({edit:'ask'});
 expect(sharedOpenCodeConfig(next,c).content).toBe(next);
 expect(JSON.parse(sharedOpenCodeConfig(before,{...c,key:'project-123'}).content).plugin).toEqual(parsed.plugin);
});
it('refreshes only an idle project to load access policy and never interrupts busy work', async () => {
  for (const busy of [false, true]) {
    const c = {...catalog(), accessPluginPath:'/shared/access-policy.mjs', registry:emptyRegistry()};
    let refreshed = false;
    const invoke = vi.fn(async (name:string) => name === 'read_opencode_config' ? {content:'{}'} : c);
    const request = vi.fn(async (_method:string, path:string, opts:any) => {
      expect(opts.query.directory).toBe('/policy-test');
      if (path === '/config') return {plugin:refreshed ? ['file:///shared/access-policy.mjs'] : []};
      if (path === '/session/status') return busy ? {child:{type:'busy'}} : {};
      if (path === '/instance/dispose') {refreshed = true;return {};}
      throw new Error(`Unexpected ${path}`);
    });
    const pending = configureShared({endpoint:'policy-test',directory:'/policy-test',current:()=>true,request:request as any},invoke as any);
    if (busy) await expect(pending).rejects.toThrow(/завершения/); else await pending;
    expect(request.mock.calls.filter(c=>c[1]==='/instance/dispose')).toHaveLength(busy ? 0 : 1);
  }
});
it('migrates legacy shared wrappers to Enki only with the exact scope and server identity',()=>{
 const c={...catalog(),command:'/Applications/Enki.app/Contents/MacOS/enki'};
 const entry=(key:string,id:string,program='/Applications/Arvela.app/Contents/MacOS/opencode-desktop')=>JSON.stringify({mcp:{mesh_project_search:{type:'local',command:[program,'--shared-mcp',key,id]}}});
 const updated=sharedOpenCodeConfig(entry(c.key,server.id),c);
 expect(JSON.parse(updated.content).mcp.mesh_project_search.command).toEqual([c.command,'--shared-mcp',c.key,server.id]);
 expect(()=>sharedOpenCodeConfig(entry('foreign-scope',server.id),c)).toThrow('занято');
 expect(()=>sharedOpenCodeConfig(entry(c.key,'foreign-server'),c)).toThrow('занято');
 expect(()=>sharedOpenCodeConfig(entry(c.key,server.id,'/foreign/other'),c)).toThrow('занято');
});
it('reports an unavailable optional MCP, continues attaching others and bounds reconnect attempts',async()=>{
 const c=catalog();c.registry.sources=[];
 c.registry.servers=[{...server,id:'failing',name:'Unavailable service'},{...server,id:'working',name:'Working service'}];
 const invoke=vi.fn(async(name:string,args:any)=>name==='shared_catalog'?(args.scope==='global'?c:{...c,registry:emptyRegistry()}):name==='read_opencode_config'?{content:'{}'}:c);
 let recovered=false;
 const request=vi.fn(async(method:string,_route:string,opts:any)=>method==='POST'?{[opts.body.name]:{status:opts.body.name==='mesh_failing'&&!recovered?'failed':'connected'}}:{});
 const options={endpoint:'optional-fixture',directory:'/work',current:()=>true,request:request as any};
 const first=await configureShared(options,invoke as any);
 expect(first?.unavailable).toEqual([{id:'failing',name:'Unavailable service'}]);
 expect(request.mock.calls.filter(call=>call[0]==='POST').map(call=>(call[2] as any).body.name)).toEqual(['mesh_failing','mesh_working']);
 await configureShared(options,invoke as any);
 expect(request.mock.calls.filter(call=>call[0]==='POST')).toHaveLength(2);
 c.registry.servers[0]={...c.registry.servers[0],args:['/changed-script.mjs']};recovered=true;
 expect((await configureShared(options,invoke as any)).unavailable).toEqual([]);
 expect(request.mock.calls.filter(call=>call[0]==='POST')).toHaveLength(3);
 invalidateCapabilities();await configureShared(options,invoke as any);
 expect(request.mock.calls.filter(call=>call[0]==='POST')).toHaveLength(5);
});

it('still blocks unsafe config writes and never softens a changed workspace into optional failure',async()=>{
 const c=catalog();c.registry.sources=[];
 let current=true;
 const invoke=vi.fn(async(name:string,args:any)=>{
  if(name==='shared_catalog')return args.scope==='global'?c:{...c,registry:emptyRegistry()};
  if(name==='read_opencode_config')return {content:'{}'};
  if(name==='write_opencode_config')throw Error('stale config');return c;
 });
 const request=vi.fn(async()=>({}));
 await expect(configureShared({endpoint:'critical-write',directory:'/work',current:()=>true,request},invoke as any)).rejects.toThrow('stale config');
 expect(request).not.toHaveBeenCalled();
 invoke.mockImplementation(async(name:string,args:any)=>name==='shared_catalog'?(args.scope==='global'?c:{...c,registry:emptyRegistry()}):name==='read_opencode_config'?{content:'{}'}:c);
 request.mockImplementation(async(method:string)=>{if(method==='POST'){current=false;throw Error('transport');}return {};});
 await expect(configureShared({endpoint:'changed-workspace',directory:'/work',current:()=>current,request},invoke as any)).rejects.toThrow('Рабочее пространство изменилось');
});
it('migrates both config layers before refreshing a cached old module and leaves busy scopes alone',async()=>{
 for(const busy of [false,true]){
  const c={...catalog(),registry:emptyRegistry(),accessPluginPath:'/immutable/access-policy.mjs',retiredAccessPluginPaths:['/legacy/access-policy.mjs']};
  const writes=new Set<string>();let disposed=false;
  const invoke=vi.fn(async(name:string,args:any)=>{
   if(name==='shared_catalog')return c;
   if(name==='read_opencode_config')return {content:'{"plugin":["file:///legacy/access-policy.mjs"]}'};
   if(name==='write_opencode_config'){writes.add(args.scope);return {};}
   return c;
  });
  const request=vi.fn(async(_method:string,path:string)=>{
   if(path==='/config'){expect([...writes].sort()).toEqual(['global','project']);return {plugin:disposed?['file:///immutable/access-policy.mjs']:['file:///immutable/access-policy.mjs','file:///legacy/access-policy.mjs']};}
   if(path==='/session/status')return busy?{running:{type:'busy'}}:{};
   if(path==='/instance/dispose'){disposed=true;return {};}
   throw Error('Unexpected '+path);
  });
  const pending=configureShared({endpoint:'layer-'+busy,directory:'/project',current:()=>true,request:request as any},invoke as any);
  if(busy)await expect(pending).rejects.toThrow('завершения');else await pending;
  expect(disposed).toBe(!busy);
 }
});
