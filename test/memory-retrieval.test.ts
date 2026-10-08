import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../src/capabilities/integration', () => ({ capabilityNative: vi.fn(), invalidateCapabilities: vi.fn() }));
vi.mock('../src/hub/client', () => ({ idle: vi.fn(() => true) }));
import { capabilityNative, invalidateCapabilities } from '../src/capabilities/integration';
import { idle } from '../src/hub/client';
import { connectRetrieval, isConnected, type Connection } from '../src/memory/retrieval';
import type { Catalog } from '../src/capabilities/registry';
const scope = { hub: 'a'.repeat(64), server: 'http://127.0.0.1:4096', directory: '/work', project: 'f699c7f4-a21c-4a3b-99f3-6beac4fe6a8f' };
let catalog: Catalog, connection: Connection;
beforeEach(() => {
 vi.clearAllMocks();vi.mocked(idle).mockReturnValue(true);
 catalog={ key:'project-0000000000000000',content:'old',command:'/app/opencode-desktop',registry:{version:1,directory:'/work',sources:[],servers:[],appliedPaths:[]},inherited:{version:1,directory:null,sources:[],servers:[],appliedPaths:[]},skills:[],runtimeReady:true,scopeDirectory:'/work' };
 connection={key:catalog.key,grant:null};
 vi.mocked(capabilityNative).mockImplementation(async (cmd,args) => {
  if(cmd==='shared_catalog')return structuredClone(catalog);
  if(cmd==='memory_retrieval') { if(args?.enabled!==null)connection={...connection,grant:{scope,enabled:!!args?.enabled,revision:(connection.grant?.revision??0)+1}};return structuredClone(connection); }
  return {};
 });
});
it('connects one shared read-only stdio MCP with opaque scope and no secrets',async()=>{
 const result=await connectRetrieval(scope,true);expect(isConnected(result,{project:scope.project,directory:scope.directory,server:scope.server,hub:scope.hub})).toBe(true);
 const save=vi.mocked(capabilityNative).mock.calls.find(([cmd])=>cmd==='shared_save')![1]!;
 expect(save.scope).toBe('project');expect(save.expected).toBe('old');const spec=(save.registry as Catalog['registry']).servers[0];expect(spec.args).toEqual(['--memory-mcp',catalog.key,'1']);expect(spec.envKeys).toEqual([]);expect(invalidateCapabilities).toHaveBeenCalled();
 expect(isConnected(result,{...scope,project:'other'})).toBe(false);expect(isConnected(result,{...scope,server:'http://127.0.0.1:4097'})).toBe(false);
});
it('revokes a grant on registry CAS failure; never masks the failure as enabled',async()=>{
 const base=vi.mocked(capabilityNative).getMockImplementation()!;
 vi.mocked(capabilityNative).mockImplementation(async(cmd,args)=>{if(cmd==='shared_save')throw Error('conflict');return base(cmd,args);});
 await expect(connectRetrieval(scope,true)).rejects.toThrow('conflict');expect(connection.grant?.enabled).toBe(false);
 expect(vi.mocked(capabilityNative).mock.calls.filter(([c])=>c==='memory_retrieval').map(([,a])=>a?.enabled)).toEqual([null,true,false]);
});
it('revokes before disabling registry; respects active agents and foreign MCP',async()=>{
 catalog.registry.servers=[{id:'project-memory',name:'Memory',command:catalog.command,args:['--memory-mcp',catalog.key,'1'],kind:'stdio',enabled:true,url:'',envKeys:[],bearer:false}];
 await connectRetrieval(scope,false);const mutations=vi.mocked(capabilityNative).mock.calls.filter(([,a])=>a?.enabled!==null);expect(mutations.findIndex(([c])=>c==='memory_retrieval')).toBeLessThan(mutations.findIndex(([c])=>c==='shared_save'));
 vi.clearAllMocks();vi.mocked(idle).mockReturnValue(false);await expect(connectRetrieval(scope,true)).rejects.toThrow('Завершите');expect(capabilityNative).not.toHaveBeenCalled();
 vi.mocked(idle).mockReturnValue(true);catalog.registry.servers=[{id:'project-memory',name:'Foreign',command:'/foreign',args:[],kind:'stdio',enabled:true,url:'',envKeys:[],bearer:false}];await expect(connectRetrieval(scope,true)).rejects.toThrow('занято');expect(vi.mocked(capabilityNative).mock.calls).toHaveLength(1);
});

it('can revoke data access even if the registry entry has become foreign',async()=>{
 catalog.registry.servers=[{id:'project-memory',name:'Foreign',command:'/foreign',args:[],kind:'stdio',enabled:true,url:'',envKeys:[],bearer:false}];connection.grant={scope,enabled:true,revision:1};
 await connectRetrieval(scope,false);expect(connection.grant.enabled).toBe(false);expect(capabilityNative).not.toHaveBeenCalledWith('shared_save',expect.anything());expect(catalog.registry.servers[0].enabled).toBe(true);
});
