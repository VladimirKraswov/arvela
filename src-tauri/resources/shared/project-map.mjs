import fs from 'node:fs/promises';
import path from 'node:path';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {readRegistry,validKey} from './registry.mjs';
import {projectMap,mapTool} from './project-map-core.mjs';
const [root,key,token]=process.argv.slice(2);let calls=0,bytes=0,fingerprint;
async function check(){
  if(!path.isAbsolute(root)||!validKey(key)||key==='global'||!/^[a-f0-9-]{36}$/.test(token))throw Error('Invalid project grant');
  if((await fs.lstat(root)).isSymbolicLink())throw Error('Invalid registry');
  const registry=await readRegistry(root,key),spec=registry.servers.find(s=>s.id==='project-map');
  if(!spec?.enabled||spec.kind!=='stdio'||spec.bearer||spec.envKeys.length||JSON.stringify(spec.args)!==JSON.stringify(['--project-map-mcp',key,token])||await fs.realpath(process.cwd())!==await fs.realpath(registry.directory))throw Error('Project map disabled or changed; reconnect');
  const current=JSON.stringify(spec);if(fingerprint&&current!==fingerprint)throw Error('Project map registration changed; reconnect');fingerprint=current;
}
try{
  await check();const server=new Server({name:'arvela-project-map',version:'1.0.0'},{capabilities:{tools:{}}});
  server.setRequestHandler(ListToolsRequestSchema,async()=>{await check();return{tools:[mapTool]};});
  server.setRequestHandler(CallToolRequestSchema,async request=>{try{await check();if(request.params.name!==mapTool.name||++calls>20||bytes>=65536)throw Error('Project map query budget exhausted');const result=await projectMap(process.cwd(),request.params.arguments);await check();const text=JSON.stringify(result);if(bytes+Buffer.byteLength(text)>65536)throw Error('Project map output budget exhausted');bytes+=Buffer.byteLength(text);return{content:[{type:'text',text}]};}catch{return{isError:true,content:[{type:'text',text:'Project map unavailable: grant, query or bounded scan failed. Reconnect or refresh; nothing was executed.'}]};}});
  process.stdin.on('end',()=>void server.close());await server.connect(new StdioServerTransport());
}catch{process.stderr.write('Project map unavailable. Verify explicit project grant and dependencies.\n');process.exitCode=1;}
