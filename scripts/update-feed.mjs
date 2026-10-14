import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
// Only an already-built, signed release may enter the feed. Never contains keys.
export function manifest({version,channel,platform,artifact,signature,notes}){
 assert(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/.test(version),'Invalid release version');
 assert(['stable','preview'].includes(channel));
 assert(channel!=='stable'||!version.includes('-'),'Preview cannot enter the stable channel');
 assert(['darwin-aarch64','darwin-x86_64','windows-x86_64','linux-x86_64'].includes(platform));
 assert(path.basename(artifact)===artifact&&/^[a-zA-Z0-9_.-]+$/.test(artifact));
 const decoded=Buffer.from(signature.trim(),'base64').toString('utf8');
 assert(decoded.split('\n').some(l=>l.startsWith('trusted comment: ')&&l.split('\t').includes(`version:${version}`)),'Signature must bind the announced version');
 return {version,notes:notes??'',pub_date:new Date().toISOString(),platforms:{[platform]:{signature:signature.trim(),url:`https://github.com/VladimirKraswov/arvela/releases/download/v${version}/${artifact}`}}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename)){
 const [channel,platform,file]=process.argv.slice(2);
 const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
 if(!file||fs.statSync(file).size<1)throw Error('Usage: node scripts/update-feed.mjs stable|preview platform /path/to/signed-artifact');
 const signature=fs.readFileSync(`${file}.sig`,'utf8');
 const output=manifest({version,channel,platform,artifact:path.basename(file),signature,notes:`Arvela ${version}`});
 fs.mkdirSync('updates',{recursive:true});fs.writeFileSync(`updates/${channel}.json`,JSON.stringify(output,null,2)+'\n');
 console.log(`Prepared updates/${channel}.json. Publish the matching signed artifact before pushing this feed.`);
}
