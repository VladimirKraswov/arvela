import {it,expect,afterEach,vi} from 'vitest';
import {mkdtemp,writeFile,mkdir,symlink,rm,lstat} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {projectMap} from '../src-tauri/resources/shared/project-map-core.mjs';
import {connectMap,ownedMap} from '../src/project/map';
import {emptyRegistry,type Catalog} from '../src/capabilities/registry';
const native=vi.hoisted(()=>vi.fn());
vi.mock('../src/capabilities/integration',()=>({capabilityNative:native,invalidateCapabilities:vi.fn()}));
vi.mock('../src/hub/client',()=>({idle:()=>true}));
const roots:string[]=[];
async function folder(){const root=await mkdtemp(join(tmpdir(),'arvela-map-'));roots.push(root);return root;}
afterEach(async()=>{native.mockReset();await Promise.all(roots.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
it('returns scoped symbols and check names without source bodies or credentials; revision follows edits',async()=>{
 const root=await folder();await mkdir(join(root,'src'));await writeFile(join(root,'src/router.ts'),'export function route(){return "secret literal";}\n');await writeFile(join(root,'package.json'),JSON.stringify({scripts:{test:'curl https://private.example --password SECRET'}}));await writeFile(join(root,'AGENTS.md'),'private instructions');
 const map=await projectMap(root);expect(map.entries.find(e=>e.path==='src/router.ts')?.symbols).toEqual([{name:'route',line:1}]);expect(map.checks).toEqual([{path:'package.json',name:'test'}]);expect(map.entries.find(e=>e.path==='AGENTS.md')?.authority).toBe(true);
 expect(JSON.stringify(map)).not.toMatch(/secret literal|SECRET|private instructions|private.example/);await writeFile(join(root,'src/router.ts'),'export function changed(){}');expect((await projectMap(root)).revision).not.toBe(map.revision);
});
it('honours Git ignores including nested roots, filters tracked secrets and refuses symlink traversal',async()=>{
 const root=await folder(),outside=await folder();execFileSync('git',['init','--quiet',root]);await writeFile(join(root,'.gitignore'),'ignored.ts\n');await mkdir(join(root,'src'));await writeFile(join(root,'src/ignored.ts'),'export const ignored=1;');await writeFile(join(root,'src/auth.json'),'{}');await writeFile(join(root,'src/good.ts'),'export const good=1;');await writeFile(join(outside,'outside.ts'),'export const outside=1;');await symlink(outside,join(root,'src/link'));await symlink(join(outside,'outside.ts'),join(root,'src/linked.ts'));
 execFileSync('git',['-C',root,'add','src/auth.json']);const map=await projectMap(join(root,'src'));expect(map.entries.map(e=>e.path)).toEqual(['good.ts']);expect(map.inventory).toBe('git-ignore-aware');
});
it('enforces full UTF8 JSON budget, input bounds and root/home refusal',async()=>{
 const root=await folder();for(let i=0;i<50;i++)await writeFile(join(root,`длинный-${i}.ts`),'export const символ=1;');const map=await projectMap(root,{budgetBytes:1024,limit:40});expect(Buffer.byteLength(JSON.stringify(map))).toBeLessThanOrEqual(1024);expect(map.limited).toBe(true);expect(JSON.parse(JSON.stringify(map)).entries).toEqual(map.entries);
 for(const args of [{path:'/etc'},{query:'x'.repeat(257)},{limit:41},{budgetBytes:1023}])await expect(projectMap(root,args)).rejects.toThrow();await expect(projectMap('/')).rejects.toThrow();await expect(projectMap(homedir())).rejects.toThrow();
});
it('does not execute repository fsmonitor, hooks or script bodies',async()=>{
 const root=await folder();execFileSync('git',['init','--quiet',root]);execFileSync('git',['-C',root,'config','core.fsmonitor','touch SHOULD_NOT_EXIST']);await writeFile(join(root,'package.json'),' {"scripts":{"test":"touch SHOULD_NOT_EXIST"}}');expect((await projectMap(root)).checks[0].name).toBe('test');await expect(lstat(join(root,'SHOULD_NOT_EXIST'))).rejects.toMatchObject({code:'ENOENT'});
});
it('preserves foreign registrations and uses CAS plus a new grant when reenabled',async()=>{
 const c:Catalog={key:'project-1234567890abcdef',command:'/Applications/Arvela.app/Contents/MacOS/opencode-desktop',content:'original',registry:emptyRegistry(),inherited:emptyRegistry(),skills:[],runtimeReady:true,scopeDirectory:'/project'};
 native.mockImplementation(async cmd=>cmd==='shared_catalog'?c:{});await connectMap('/project',true);const first=native.mock.calls.find(x=>x[0]==='shared_save')![1];expect(first.expected).toBe('original');expect(ownedMap(first.registry.servers[0],c)).toBe(true);
 native.mockClear();await connectMap('/project',true);const second=native.mock.calls.find(x=>x[0]==='shared_save')![1];expect(second.registry.servers[0].args[2]).not.toBe(first.registry.servers[0].args[2]);
 c.registry.servers=[{...first.registry.servers[0],command:'/foreign'}];native.mockClear();await expect(connectMap('/project',false)).rejects.toThrow('занято');expect(native.mock.calls.some(x=>x[0]==='shared_save')).toBe(false);
});
