import {expect,it,vi} from 'vitest';
import {parseConfig,updateConfig} from '../src/state/configEditor';
import {assertEngineIdle,refreshGlobalPolicy} from '../src/capabilities/globalPolicy';
const paths={accessPluginPath:'/owned/new/access-policy.mjs',retiredAccessPluginPaths:['/owned/old/access-policy.mjs']};
const setup=()=>{
 let content='{// owner comment\n"permission":{"bash":"ask"},"plugin":["foreign","file:///owned/new/access-policy.mjs"]}\n';
 const apply=vi.fn(async(p:string[])=>{content=updateConfig(content,['plugin'],p);});
 const invoke=vi.fn(async(name:string,args:any)=>{if(name==='read_opencode_config')return{content};expect(name).toBe('write_opencode_config');expect(args.expected).toBe(content);content=args.content;return{};});
 const request=vi.fn(async(_method:string,path:string,opts:any):Promise<unknown>=>{
  if(path==='/global/config')return{plugin:['foreign','file:///owned/old/access-policy.mjs']};
  if(path==='/experimental/session')return[{id:'ses_other',directory:'/other'}];
  if(path==='/api/session/active')return{data:{}};
  if(path==='/session/status'){expect(['/current','/other']).toContain(opts.query.directory);return{};}
  throw Error(path);
 });
 return{apply,invoke,request,read:()=>content};
};
it('refreshes a stale global cache even when disk already migrated, preserving foreign config and forcing one real API invalidation',async()=>{
 const f=setup(),before=parseConfig(f.read());let staged='';
 const apply=async(p:string[])=>{staged=f.read();expect(staged).not.toBe(updateConfig(staged,['plugin'],p));await f.apply(p);};
 await expect(refreshGlobalPolicy({endpoint:'global-fix',directory:'/current',paths,current:()=>true,request:f.request,invoke:f.invoke as any,apply})).resolves.toBe(true);
 expect(f.read()).toContain('// owner comment');expect(parseConfig(f.read())).toEqual(before);expect(f.apply).toHaveBeenCalledOnce();
 expect(new Set(f.request.mock.calls.filter(c=>c[1]==='/session/status').map(c=>c[2].query.directory))).toEqual(new Set(['/current','/other']));
});
it('never mutates settings or reloads while a different legacy project or v2 drain is active',async()=>{
 for(const kind of ['legacy','v2','unknown','full','changed']){
  const f=setup();const original=f.request.getMockImplementation()!;
  f.request.mockImplementation(async(m,p,o)=>{
   if(kind==='legacy'&&p==='/session/status'&&o.query.directory==='/other')return{job:{type:'busy'}};
   if(kind==='v2'&&p==='/api/session/active')return{data:{ses_job:{}}};
   if(kind==='unknown'&&p==='/api/session/active')return{};
   if(kind==='full'&&p==='/experimental/session')return Array(1000).fill({id:'ses',directory:'/other'});
   return original(m,p,o);
  });
  await expect(refreshGlobalPolicy({endpoint:kind,directory:'/current',paths,current:()=>kind!=='changed',request:f.request,invoke:f.invoke as any,apply:f.apply})).rejects.toThrow();
  expect(f.invoke).not.toHaveBeenCalled();expect(f.apply).not.toHaveBeenCalled();
 }
});
it('deduplicates concurrent recovery and leaves an already current global configuration untouched',async()=>{
 const f=setup();const options={endpoint:'parallel',directory:'/current',paths,current:()=>true,request:f.request,invoke:f.invoke as any,apply:f.apply};
 await Promise.all([refreshGlobalPolicy(options),refreshGlobalPolicy(options)]);expect(f.apply).toHaveBeenCalledOnce();
 f.request.mockResolvedValue({plugin:['foreign','file:///owned/new/access-policy.mjs']});
 await expect(refreshGlobalPolicy({...options,endpoint:'fresh'})).resolves.toBe(false);expect(f.apply).toHaveBeenCalledOnce();
});
it('checks active drains again after directory statuses to catch a task that starts during inventory',async()=>{
 let n=0;const request=async(_m:string,p:string)=>p==='/experimental/session'?[]:p==='/api/session/active'?{data:++n===1?{}:{ses_new:{}}}:{};
 await expect(assertEngineIdle(request,'/current',()=>true)).rejects.toThrow('завершения');
});
