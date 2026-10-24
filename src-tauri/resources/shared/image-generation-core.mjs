import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {isIP} from 'node:net';
export function validateConfig(c){
 if(!c||typeof c.enabled!=='boolean'||!['enki','openai'].includes(c.provider)||typeof c.model!=='string'||!c.model.trim()||c.model.length>200)throw Error('Некорректные настройки генератора');
 const u=new URL(c.endpoint);const ip=isIP(u.hostname)===4?u.hostname.split('.').map(Number):[];const local=u.hostname==='localhost'||ip.length===4&&(ip[0]===127||ip[0]===10||ip[0]===192&&ip[1]===168||ip[0]===172&&ip[1]>=16&&ip[1]<=31);
 if(u.username||u.password||u.search||u.hash||!(u.protocol==='https:'||u.protocol==='http:'&&local))throw Error('Используйте HTTPS либо HTTP локальной сети, без ключа в URL');
 return {...c,endpoint:u.href.replace(/\/$/,'')};
}
export async function bounded(response,max=12*1024*1024){
 if(!response.ok){await response.body?.cancel();throw Error(`Генератор HTTP ${response.status}: ${[401,403].includes(response.status)?'проверьте API-ключ':response.status===429?'очередь занята':response.status===503?'модель загружается или сервис недоступен':[400,422].includes(response.status)?'параметры не поддерживаются; проверьте размеры, модель и material':'проверьте настройки и статус задания'}`)}
 const chunks=[];let size=0;
 for await(const chunk of response.body){size+=chunk.length;if(size>max){await response.body?.cancel().catch(()=>{});throw Error('Слишком большой ответ генератора')}chunks.push(chunk)}
 return Buffer.concat(chunks);
}
export function createImages({configFile,cwd=process.cwd(),fetcher=fetch,token=()=>process.env.ENKI_IMAGE_API_KEY||''}){
 const config=async()=>{const stat=await fs.lstat(configFile).catch(()=>{throw Error('Сначала сохраните настройки генератора в Enki → Изображения')});if(stat.isSymbolicLink()||stat.size>16384)throw Error('Конфигурация генератора недоступна');const c=validateConfig(JSON.parse(await fs.readFile(configFile,'utf8')));if(!c.enabled)throw Error('Включите генерацию изображений в настройках Enki');return c;};
 const wait=(ms,signal)=>new Promise((resolve,reject)=>{if(signal?.aborted){reject(Error('Ожидание отменено'));return}const finish=()=>{signal?.removeEventListener('abort',abort);resolve()};const timer=setTimeout(finish,ms);const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(Error('Ожидание отменено'))};signal?.addEventListener('abort',abort,{once:true})});
 const request=async(c,route,method='GET',body,signal,key)=>{
  const ac=AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(c.provider==='openai'&&method==='POST'?75000:30000)]);
  for(let attempt=0;;attempt++){
   let response;
   try{response=await fetcher(c.endpoint+route,{method,signal:ac,redirect:'error',headers:{...(token()?{Authorization:'Bearer '+token()}:{}),...(body?{'Content-Type':'application/json'}:{}),...(key?{'Idempotency-Key':key}:{})},body:body?JSON.stringify(body):undefined});}
   catch(error){if(method!=='GET'||attempt>=2||ac.aborted)throw error;await wait(600*(attempt+1),ac);continue}
   if(method==='GET'&&[502,503,504].includes(response.status)&&attempt<2){await response.body?.cancel();await wait(600*(attempt+1),ac);continue}
   return bounded(response);
  }
 };
 const save=async(jid,name,bytes)=>{
  if(!/^[a-f0-9-]{36}$/.test(jid)||!/^(?:(?:image|preview)-\d{2}|(?:preview-)?(?:normal|height|roughness|metallic|relight|relight-right|tile-preview))\.png$|^images\.zip$|^manifest\.json$/.test(name))throw Error('Некорректный файл результата');
  if(name.endsWith('.png')&&bytes.length>4*1048576)throw Error('PNG больше 4 МБ; запросите меньший размер');
  if(name.endsWith('.png')&&(bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))||bytes.toString('ascii',12,16)!=='IHDR'||bytes.readUInt32BE(16)<1||bytes.readUInt32BE(20)<1||bytes.readUInt32BE(16)>2048||bytes.readUInt32BE(20)>2048))throw Error('Сервис вернул повреждённый или слишком большой PNG');
  const base=await fs.realpath(cwd);const dir=path.join(base,'.enki','generated-images',jid);
  let current=base;for(const segment of ['.enki','generated-images',jid]){current=path.join(current,segment);await fs.mkdir(current,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e});const stat=await fs.lstat(current);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('Папка результата не должна быть ссылкой')}
  const dest=path.join(dir,name);
  try{await fs.writeFile(dest,bytes,{flag:'wx',mode:0o600})}catch(e){if(e.code!=='EEXIST')throw e;const st=await fs.lstat(dest);if(st.isSymbolicLink()||st.size!==bytes.length||!crypto.timingSafeEqual(crypto.createHash('sha256').update(await fs.readFile(dest)).digest(),crypto.createHash('sha256').update(bytes).digest()))throw Error('Существующий результат отличается; файл сохранён без перезаписи')}
  return pathToFileURL(dest).href;
 };
 return async(name,args={},signal)=>{
  const c=await config();
  if(name==='image_status'){
   if(!args.job_id)return JSON.parse(await request(c,c.provider==='enki'?'/health':'/models','GET',undefined,signal));
   if(c.provider!=='enki'||!/^[a-f0-9-]{36}$/.test(args.job_id))throw Error('Некорректный идентификатор задания');
   const end=Date.now()+Math.max(0,Math.min(20,Number(args.wait_seconds??20)))*1000;
   let state;
   do {state=JSON.parse(await request(c,'/jobs/'+args.job_id,'GET',undefined,signal));if(!['queued','running'].includes(state.status)||Date.now()>=end)break;await wait(1000,signal);}while(Date.now()<=end);
   return state;
  }
  if(name==='cancel_image'){
   if(c.provider!=='enki'||!/^[a-f0-9-]{36}$/.test(args.job_id))throw Error('Этот провайдер не поддерживает отмену задания');
   return JSON.parse(await request(c,'/jobs/'+args.job_id,'DELETE',undefined,signal));
  }
  if(name==='generate_image'||name==='generate_icon_pack'||name==='generate_material'){
   if(typeof args.prompt!=='string'||!args.prompt.trim()||args.prompt.length>2000||typeof args.request_key!=='string'||!args.request_key||args.request_key.length>160)throw Error('Нужны короткий prompt и стабильный request_key');
   const items=name==='generate_icon_pack'?args.items:[];
   if(!Array.isArray(items)||items.length>8||name==='generate_icon_pack'&&!items.length||items.some(s=>typeof s!=='string'||!s.trim()||s.length>160))throw Error('В наборе должно быть от 1 до 8 кратких описаний');
   const width=args.width??(c.provider==='enki'&&c.model==='lcm-dreamshaper-v7'?512:1024),height=args.height??(c.provider==='enki'&&c.model==='lcm-dreamshaper-v7'?512:1024),steps=args.steps??4,seed=args.seed??42;
   if(![width,height,steps,seed].every(Number.isInteger)||width<256||height<256||width>2048||height>2048||width%8||height%8||c.provider==='enki'&&(width>1536||height>1536||width*height>1048576||c.model==='lcm-dreamshaper-v7'&&width*height>640000)||steps<2||steps>8||seed<0||seed>2147483647)throw Error('Некорректные размеры, число шагов или seed');
   if(c.provider==='openai'){
    if(name==='generate_material')throw Error('Материалы с normal/height-картами требуют провайдера Enki CPU');
    if(items.length)throw Error('Пакеты иконок требуют провайдера Enki; для другого API вызывайте generate_image по одному');
    const result=JSON.parse(await request(c,'/images/generations','POST',{model:c.model,prompt:args.prompt,size:`${width}x${height}`,n:1,response_format:'b64_json'},signal,args.request_key));
    const b64=result.data?.[0]?.b64_json;
    if(typeof b64!=='string'||b64.length>12*1048576)throw Error('API должен вернуть data[0].b64_json; загрузка произвольных URL отключена');
    const jid=crypto.randomUUID();const url=await save(jid,'image-01.png',Buffer.from(b64,'base64'));
    return {enkiImages:1,status:'completed',images:[{name:'image-01.png',url}],vision:[b64],note:'Проверьте результат. Повторный POST не выполняется автоматически.'};
   }
   const readyBy=Date.now()+20000;
   while(true){const health=JSON.parse(await request(c,'/health','GET',undefined,signal));if(health.status==='ready')break;if(health.status==='error')throw Error('Модель генератора не загрузилась. Проверьте журнал сервиса; генерация не запускалась.');if(Date.now()>=readyBy)throw Error('Модель ещё загружается; генерация не запускалась. Проверьте image_status и используйте тот же request_key.');await wait(1000,signal)}
   return JSON.parse(await request(c,'/jobs','POST',{model:c.model,prompt:name==='generate_material'?'seamless texture swatch, PBR albedo material scan, full frame closeup, perpendicular flat view, even diffuse lighting, '+args.prompt+', no scene, no perspective, no objects, no text':args.prompt,width,height,steps,seed,items,...(name==='generate_material'?{material:args.material??{}}:{})},signal,args.request_key));
  }
  if(name==='get_images'){
   if(c.provider!=='enki'||!/^[a-f0-9-]{36}$/.test(args.job_id))throw Error('Некорректное задание');
   const route='/jobs/'+args.job_id;const state=JSON.parse(await request(c,route,'GET',undefined,signal));
   if(!['completed','cancelled','error','interrupted'].includes(state.status))return state;
   if(!Array.isArray(state.files)||state.files.length>8)throw Error('Некорректный список файлов');
   const images=[],vision=[];
   for(const file of state.files){
    if(!/^(?:image-\d{2}|normal|height|roughness|metallic|relight|relight-right|tile-preview)\.png$/.test(file.name))throw Error('Некорректное имя');
    const raw=await request(c,route+'/files/'+file.name,'GET',undefined,signal);
    const url=await save(args.job_id,file.name,raw);
    const preview=await request(c,route+'/preview/'+file.name,'GET',undefined,signal);
    const previewUrl=await save(args.job_id,(file.name.startsWith('image-')?file.name.replace('image-','preview-'):'preview-'+file.name),preview);
    images.push({name:file.name,url,previewUrl});vision.push(preview.toString('base64'));
   }
   if(state.status==='completed')await save(args.job_id,'manifest.json',await request(c,route+'/files/manifest.json','GET',undefined,signal));
   const archive=state.status==='completed'?await save(args.job_id,'images.zip',await request(c,route+'/files/images.zip','GET',undefined,signal)):undefined;
   return {enkiImages:1,status:state.status,images,archive,vision,model:state.model??c.model,inference:state.inference,note:'PNG и ZIP сохранены в .enki/generated-images. Растровые изображения. Для материала: источник высоты и метод указаны в manifest.json (процедурный рельеф или приближение по яркости); normal/height/roughness/metallic импортировать как linear/non-color; соглашение normal указано в manifest.json. relight — проверочное освещение; прозрачность, точная геометрия и отсутствие видимого повтора не гарантируются. Проверьте результат.'};
  }
  throw Error('Неизвестный инструмент');
 };
}
