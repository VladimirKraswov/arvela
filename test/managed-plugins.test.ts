import {expect,it} from 'vitest';
import {managedPlugins,pluginFileUri} from '../src/util/managedPlugins';
import {sharedOpenCodeConfig,emptyRegistry} from '../src/capabilities/registry';
import {browserConfig} from '../src/browser/integration';
const paths={accessPluginPath:'/enki/capabilities/agent-plugins/abc/access-policy.mjs',browserPluginPath:'/enki/capabilities/agent-plugins/abc/opencode-session-plugin.mjs',retiredAccessPluginPaths:['/old/capabilities/access-policy.mjs','/enki/capabilities/access-policy.mjs'],retiredBrowserPluginPaths:['/old/browser-runtime/current/opencode-session-plugin.mjs']};
it('replaces all verified legacy copies once and preserves foreign plugins and order',()=>{
 const input=['owner-plugin',pluginFileUri(paths.retiredAccessPluginPaths[0]),'file:///foreign/access-policy.mjs',pluginFileUri(paths.retiredAccessPluginPaths[1]),pluginFileUri(paths.retiredBrowserPluginPaths[0])];
 const next=managedPlugins(input,paths,{access:true,browser:false});
 expect(next).toEqual(['owner-plugin',pluginFileUri(paths.accessPluginPath),'file:///foreign/access-policy.mjs',pluginFileUri(paths.browserPluginPath)]);
 expect(managedPlugins(next,paths,{access:true,browser:false})).toEqual(next);expect(input).toHaveLength(5);
 expect(managedPlugins([],paths,{access:true,browser:false})).toEqual([pluginFileUri(paths.accessPluginPath)]);
});
it('the browser and shared config writers agree on one immutable graph without altering permissions',()=>{
 const source=JSON.stringify({plugin:paths.retiredAccessPluginPaths.concat(paths.retiredBrowserPluginPaths).map(pluginFileUri),permission:{edit:'ask'},mcp:{foreign:{type:'remote',url:'https://example.test/mcp'}}});
 const catalog={...paths,key:'global',registry:emptyRegistry(),inherited:emptyRegistry(),skills:[],runtimeReady:false,command:'/enki/enki',scopeDirectory:null,content:'{}'};
 const a=sharedOpenCodeConfig(source,catalog).content;
 const status={...paths,supported:true,installed:true,running:true,command:'/enki/enki',nodeProgram:null,skillPath:'/enki/skills',runtimePath:'/enki/browser-runtime/current',profilePath:'/enki/profile',version:'1'};
 const b=browserConfig(a,status,true).content;
 const parsed=JSON.parse(b);expect(parsed.plugin).toEqual([pluginFileUri(paths.accessPluginPath),pluginFileUri(paths.browserPluginPath)]);
 expect(parsed.permission).toEqual({edit:'ask'});expect(parsed.mcp.foreign).toEqual(JSON.parse(source).mcp.foreign);
 expect(sharedOpenCodeConfig(b,catalog).content).toBe(b);
});
