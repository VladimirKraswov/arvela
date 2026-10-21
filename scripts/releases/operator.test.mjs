import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseWithOperator,operatorEnvironment,privateFile,operatorFile} from './operator.mjs';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
test('all gates precede credentials and canonical publication; failed tests cannot publish',()=>{
 const calls=[];let secrets=0;
 releaseWithOperator('stable',(program,args,env)=>calls.push({program,args,env}),()=>{secrets++;return {ONLY:'publisher'};});
 assert.equal(secrets,1);assert.ok(calls.some(c=>c.args.includes('services/asr/tests')));assert.ok(calls.some(c=>c.program==='cargo'&&c.args[0]==='test'));
 assert.deepEqual(calls.at(-1),{program:'node',args:['scripts/releases/publish.mjs','stable'],env:{ONLY:'publisher'}});
 assert.ok(calls.slice(0,-1).every(c=>c.env===undefined));
 secrets=0;assert.throws(()=>releaseWithOperator('stable',(p,a)=>{if(p==='npm'&&a[0]==='test')throw Error('regression');},()=>{secrets++;return{};}));assert.equal(secrets,0);
 assert.throws(()=>releaseWithOperator('arbitrary',()=>{},()=>{}));
});
test('operator reads only private files and does not turn metadata into shell commands',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arvela-operator-'));
 const file=(name,text)=>{const p=path.join(root,name);fs.writeFileSync(p,text,{mode:0o600});return p;};
 try {
  const config=file('operator.json',JSON.stringify({hubUrl:'https://localhost:8443',caFile:file('ca.pem','public'),adminTokenFile:file('token','fixture-secret'),signingKeyFile:file('key','fixture-key')}));
  assert.equal(operatorEnvironment(config).ARVELA_HUB_ADMIN_TOKEN,'fixture-secret');
  assert.throws(()=>privateFile('relative'));
  if(process.platform!=='win32'){fs.chmodSync(config,0o644);assert.throws(()=>operatorEnvironment(config));}
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('operator migration preserves private bytes and old absolute credential paths, and refuses split stores',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'enki-operator-migration-'));
 try{
  const old=path.join(root,'arvela-release');fs.mkdirSync(old,{mode:0o700});
  fs.writeFileSync(path.join(old,'operator.json'),'fixture',{mode:0o600});
  const current=operatorFile(root);assert.equal(fs.readFileSync(current,'utf8'),'fixture');
  assert.equal(fs.realpathSync(old),fs.realpathSync(path.join(root,'enki-release')));assert.equal(operatorFile(root),current);
  fs.unlinkSync(old);fs.mkdirSync(old);fs.writeFileSync(path.join(old,'operator.json'),'other');
  assert.throws(()=>operatorFile(root));assert.equal(fs.readFileSync(current,'utf8'),'fixture');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
