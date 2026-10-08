import { capabilityNative, invalidateCapabilities } from '../capabilities/integration';
import type { Catalog, SharedServer } from '../capabilities/registry';
import { idle } from '../hub/client';
export interface ProjectMap { version:1; observedAt:string; revision:string; nonAtomic:true; inventory:string; limited:boolean; coverage:{indexedFiles:number;sampleBytes:number;skipped:number}; checks:{path:string;name:string}[]; entries:{path:string;symbols:{name:string;line:number}[];authority:boolean;sampleSha256:string;sampleBytes:number;totalBytes:number;truncated:boolean}[] }
const id='project-map';
export function ownedMap(s:SharedServer,c:Catalog){return s.kind==='stdio'&&s.command===c.command&&s.args.length===3&&s.args[0]==='--project-map-mcp'&&s.args[1]===c.key&&/^[a-f0-9-]{36}$/.test(s.args[2])&&!s.bearer&&!s.envKeys.length;}
export async function readMapConnection(directory:string){const c=await capabilityNative<Catalog>('shared_catalog',{scope:'project',directory});const spec=c.registry.servers.find(s=>s.id===id);return{ready:c.runtimeReady,enabled:!!spec?.enabled&&ownedMap(spec,c)};}
export async function connectMap(directory:string,enabled:boolean){
  if(!idle())throw Error('Завершите работу агентов перед изменением инструмента.');
  const c=await capabilityNative<Catalog>('shared_catalog',{scope:'project',directory});const prior=c.registry.servers.find(s=>s.id===id);
  if(prior&&!ownedMap(prior,c)||c.inherited.servers.some(s=>s.id===id))throw Error('Имя project-map занято другим инструментом. Он сохранён.');
  if(enabled&&!c.runtimeReady)throw Error('Установите общие MCP-инструменты в настройках.');
  const spec:SharedServer={id,name:'Карта проекта',kind:'stdio',command:c.command,args:['--project-map-mcp',c.key,crypto.randomUUID()],enabled,url:'',envKeys:[],bearer:false};
  if(!idle())throw Error('Агент начал работу; подключение отменено.');
  await capabilityNative('shared_save',{scope:'project',directory,expected:c.content,registry:{...c.registry,servers:[...c.registry.servers.filter(s=>s.id!==id),spec]}});invalidateCapabilities();return{ready:c.runtimeReady,enabled};
}
export const previewMap=(directory:string,query:string)=>capabilityNative<ProjectMap>('project_map_preview',{directory,query});
