import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
export function nativeFingerprint(root){
  const files=[];
  function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    if(['target','gen','.git','.DS_Store','node_modules'].includes(entry.name))continue;
    const p=path.join(dir,entry.name);if(entry.isSymbolicLink())throw Error('Native input is a symbolic link');
    if(entry.isDirectory())walk(p);else files.push(path.relative(root,p).split(path.sep).join('/'));
  }}walk(root);
  return hash(files.sort().map(name=>{
    let data=fs.readFileSync(path.join(root,name));
    if(name==='tauri.conf.json'){const c=JSON.parse(data);delete c.version;data=Buffer.from(JSON.stringify(sorted(c)));}
    else if(Buffer.from(data.toString('utf8')).equals(data)){
      let text=data.toString('utf8').replaceAll('\r\n','\n');
      if(['Cargo.toml','Cargo.lock'].includes(name)){let own=false;text=text.replace(/\n$/,'').split('\n').filter(line=>{if(line.startsWith('['))own=false;if(line==='name = "arvela"')own=true;return !(own&&line.startsWith('version = '));}).join('\n');}
      data=Buffer.from(text);
    }
    return name+'\0'+hash(data)+'\n';
  }).join(''));
}
export function safePath(name){return typeof name==='string'&&name.length>0&&name.length<=240&&/^[\x21-\x7e]+$/.test(name)&&!/[\\:]/.test(name)&&name.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!/[. ]$/.test(p)&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p));}
export function snapshot(root,names){
  const files={},seen=new Set();let total=0;
  for(const name of names.sort()){
    if(!safePath(name)||name.split('/').some(p=>['.git','.local','.pi','node_modules','target'].includes(p)||p==='.env'||p.startsWith('.env.')))throw Error(`Unsafe release file: ${name}`);
    if(seen.has(name.toLowerCase()))throw Error(`Case collision: ${name}`);seen.add(name.toLowerCase());
    const p=path.join(root,name);if(!fs.lstatSync(p).isFile())throw Error(`Not a regular file: ${name}`);
    const data=fs.readFileSync(p);total+=data.length;if(data.length>12*1048576||total>24*1048576)throw Error('Release exceeds size limit');files[name]=data.toString('base64');
  }return files;
}
export function validateVersions(root,version){
  const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
  const npm=read('package.json'),lock=read('package-lock.json'),config=read('src-tauri/tauri.conf.json');
  const cargo=fs.readFileSync(path.join(root,'src-tauri/Cargo.toml'),'utf8').match(/\[package\][\s\S]*?\nversion = "([^"]+)"/);
  const locked=fs.readFileSync(path.join(root,'src-tauri/Cargo.lock'),'utf8').match(/\[\[package\]\]\nname = "arvela"\nversion = "([^"]+)"/);
  if([npm.version,lock.version,lock.packages?.['']?.version,config.version,cargo?.[1],locked?.[1]].some(v=>v!==version)||config.identifier!=='dev.local.opencodedesktop'||config.productName!=='Arvela')throw Error('Release manifest versions or application identity disagree');
}
