import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {nativeFingerprint,safePath,snapshot} from './packet.mjs';
for(const packageName of ['arvela','enki'])test(`native compatibility ignores version for ${packageName}, catches code/config/dependency changes`,()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arvela-fingerprint-'));
 try{
 const write=(name,text)=>fs.writeFileSync(path.join(root,name),text);
 write('Cargo.toml',`[package]\nname = "${packageName}"\nversion = "1.0.0"\n[dependencies]\nx = "1"\n`);
 write('Cargo.lock',`[[package]]\nname = "${packageName}"\nversion = "1.0.0"\n[[package]]\nname = "other"\nversion = "1.0.0"\n`);
 write('tauri.conf.json',JSON.stringify({identifier:'dev.local.opencodedesktop',version:'1.0.0',app:{security:{csp:"'self'"}}}));
 const initial=nativeFingerprint(root);
 for(const name of ['Cargo.toml','Cargo.lock','tauri.conf.json'])write(name,fs.readFileSync(path.join(root,name),'utf8').replace('1.0.0','1.0.1'));
 assert.equal(initial,nativeFingerprint(root));
 write('code.rs','fn main() {}');assert.notEqual(initial,nativeFingerprint(root));fs.unlinkSync(path.join(root,'code.rs'));
 write('tauri.conf.json',JSON.stringify({identifier:'other',version:'1.0.1',app:{security:{csp:"'self'"}}}));assert.notEqual(initial,nativeFingerprint(root));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('publisher refuses traversal, credential files, symlinks and Windows aliases',()=>{
 for(const name of ['../x','/x','a\\b','a:stream','NUL','x/COM9.txt','x.'])assert.equal(safePath(name),false,name);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arvela-snapshot-'));
 try{fs.writeFileSync(path.join(root,'.env'), 'secret');assert.throws(()=>snapshot(root,['.env']));fs.symlinkSync('.env',path.join(root,'alias'));assert.throws(()=>snapshot(root,['alias']));}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('release manifest versions agree before publishing',async()=>{
 const {validateVersions}=await import('./packet.mjs');const root=path.resolve(import.meta.dirname,'../..');const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version;validateVersions(root,version);assert.throws(()=>validateVersions(root,'99.0.0'));
});
