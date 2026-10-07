import {beforeEach,describe,it,expect,vi} from 'vitest';
const invoke=vi.hoisted(()=>vi.fn());
const state=vi.hoisted(()=>({chat:{sessions:{}},ui:{sending:false}}));
vi.mock('../src/capabilities/integration',()=>({capabilityNative:invoke,invalidateCapabilities:vi.fn()}));
vi.mock('../src/state/store',()=>({store:{state}}));
import {install,sourceId,drain,disable,type HubItem} from '../src/hub/client';
import {emptyRegistry} from '../src/capabilities/registry';
const item:HubItem={id:'skill-abc',kind:'skill',revision:'a'.repeat(64),title:'Example',description:'',enabled:true};
let registry=emptyRegistry();const c={endpoint:'https://host',certificate:'',enabled:true,shareText:true,label:'Mac',installed:{}};
beforeEach(()=>{invoke.mockReset();registry=emptyRegistry();invoke.mockImplementation(async(cmd,args)=>{
 if(cmd==='hub_package')return {path:'/data/hub/packages/skill-abc/rev',sourcePath:'/data/hub/packages/skill-abc/rev',manifest:{files:{'tool.json':'{"kind":"http","url":"https://example.com/mcp"}'}}};
 if(cmd==='shared_catalog')return {registry,content:'original'};
 if(cmd==='hub_config')return args.config??c;
 if(cmd==='shared_save'){registry=args.registry;return {};}
 if(cmd==='hub_spool')return {records:[{id:'a'}],hashes:['hash'],origin:'origin-bound',pending:1};
 return {};
});});
describe('shared Hub adapters',()=>{
 it('preserves unrelated sources and installs through CAS',async()=>{registry.sources=[{id:'foreign',path:'/owned',enabled:true}];await install(item);expect(registry.sources[0].id).toBe('foreign');expect(registry.sources[1].id).toBe(sourceId(item.id));expect(invoke).toHaveBeenCalledWith('shared_save',expect.objectContaining({expected:'original'}));});
 it('background update preserves owner disabling a source',async()=>{registry.sources=[{id:sourceId(item.id),path:'/data/hub/packages/skill-abc/old',enabled:false}];await install(item,true);expect(registry.sources[0].enabled).toBe(false);});
 it('cannot take over a foreign source with a colliding id',async()=>{registry.sources=[{id:sourceId(item.id),path:'/owned',enabled:true}];await expect(install(item)).rejects.toThrow('занято');expect(invoke.mock.calls.some(c=>c[0]==='shared_save')).toBe(false);});
 it('MCP is imported disabled and cannot overwrite an existing configured server',async()=>{await install({...item,kind:'tool'});expect(registry.servers[0].enabled).toBe(false);registry.servers[0].enabled=true;registry.servers[0].authRevision='private-vault-marker';await install({...item,kind:'tool'});expect(registry.servers[0].enabled).toBe(true);expect(registry.servers[0].authRevision).toBe('private-vault-marker');});
 it('acks only after successful ingest and binds upload/ack to profile',async()=>{await drain();expect(invoke).toHaveBeenCalledWith('hub_request',expect.objectContaining({expected:'origin-bound',path:'ingest'}));expect(invoke).toHaveBeenCalledWith('hub_spool',expect.objectContaining({action:'ack',expected:'origin-bound'}));invoke.mockImplementation(async(cmd,args)=>{if(cmd==='hub_request')throw Error('offline');return {records:[{}],hashes:['h'],origin:'x'};});invoke.mockClear();await expect(drain()).rejects.toThrow('offline');expect(invoke.mock.calls.some(c=>c[0]==='hub_spool'&&c[1].action==='ack')).toBe(false);});
 it('revocation preserves unrelated owner source',async()=>{registry.sources=[{id:'foreign',path:'/owned',enabled:true},{id:sourceId(item.id),path:'/data/hub/packages/skill-abc/rev',enabled:true}];await disable(item);expect(registry.sources[0].enabled).toBe(true);expect(registry.sources[1].enabled).toBe(false);});
});
