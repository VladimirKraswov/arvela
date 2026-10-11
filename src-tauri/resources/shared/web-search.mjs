import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {createSearch} from './web-search-core.mjs';
const search=createSearch();
const server=new Server({name:'arvela-web-search',version:'1.0.0'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[
 {name:'search',description:'Preferred shared web search for OpenCode and Pi. Automatic independent-provider fallback and cooldown on HTTP403/429/timeouts. Use before builtin websearch. Returns real source links or explicit failure; never retry blocked providers in a loop.',inputSchema:{type:'object',properties:{query:{type:'string',maxLength:2000},numResults:{type:'integer',minimum:1,maximum:10}},required:['query'],additionalProperties:false}},
 {name:'status',description:'Read search provider availability and retry timestamps without making network requests.',inputSchema:{type:'object',properties:{},additionalProperties:false}}
]}));
server.setRequestHandler(CallToolRequestSchema,async(request,extra)=>{try{
 const result=request.params.name==='status'?{providers:search.status()}:request.params.name==='search'?await search.search(request.params.arguments,extra.signal):(()=>{throw Error('Unknown tool');})();
 return {isError:!!result.isError,content:[{type:'text',text:JSON.stringify(result)}]};
}catch{return{isError:true,content:[{type:'text',text:'Search cancelled or invalid arguments. No automatic retry.'}]};}});
process.stdin.on('end',()=>void server.close());
await server.connect(new StdioServerTransport());
