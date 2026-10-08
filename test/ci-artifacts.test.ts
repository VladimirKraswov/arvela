import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const script=fileURLToPath(new URL('../scripts/ci-artifacts.mjs',import.meta.url));
async function fixture(run:(root:string,dir:string,bytes:Buffer)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'arvela-ci-receipt-'));const dir=join(root,'src-tauri','target','release','bundle','nsis');
 try {await mkdir(dir,{recursive:true});await writeFile(join(root,'package.json'),'{"version":"0.2.33"}');const bytes=Buffer.alloc(1024);bytes.write('MZ');await run(root,dir,bytes);}finally{await rm(root,{recursive:true,force:true});}
}
const invoke=(root:string,platform='windows')=>execFileSync(process.execPath,[script,platform],{cwd:root,timeout:10000,stdio:'pipe'});
it('receipt binds the exact package bytes/version/commit and never claims live acceptance',async()=>fixture(async(root,dir,bytes)=>{
 await writeFile(join(dir,'Arvela_0.2.33_x64-setup.exe'),bytes);invoke(root);
 const receipt=JSON.parse(await readFile(join(root,'.local','ci-artifacts.json'),'utf8'));
 expect(receipt.version).toBe('0.2.33');expect(receipt.bytes).toBe(1024);expect(receipt.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));expect(receipt.liveAcceptance).toBe('not-run');
}));
it('cannot substitute an old package, empty file, or non-PE payload',async()=>fixture(async(root,dir,bytes)=>{
 await writeFile(join(dir,'Arvela_0.2.32_x64-setup.exe'),bytes);expect(()=>invoke(root)).toThrow();
 const file=join(dir,'Arvela_0.2.33_x64-setup.exe');await writeFile(file,'');expect(()=>invoke(root)).toThrow();
 await writeFile(file,Buffer.alloc(1024));expect(()=>invoke(root)).toThrow();
}));
it('refuses ambiguous packages and unsupported platforms instead of publishing a partial receipt',async()=>fixture(async(root,dir,bytes)=>{
 for(const arch of ['x64','arm64'])await writeFile(join(dir,`Arvela_0.2.33_${arch}-setup.exe`),bytes);
 expect(()=>invoke(root)).toThrow();expect(()=>invoke(root,'other')).toThrow();
 await expect(readFile(join(root,'.local','ci-artifacts.json'))).rejects.toThrow();
}));
