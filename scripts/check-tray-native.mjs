// macOS desktop acceptance. Starts only a fixture with no Enki runtime, agents,
// owner data, API connections or microphone; quits itself after checking AppKit.
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';import assert from 'node:assert/strict';
if(process.platform!=='darwin')throw Error('This acceptance check requires a macOS desktop');
const root=path.resolve(import.meta.dirname,'..'),source=path.join(root,'scripts/fixtures/tray-native'),temp=await fs.mkdtemp(path.join(os.tmpdir(),'enki-tray-check-'));
try{
 await fs.cp(source,temp,{recursive:true});await fs.mkdir(path.join(temp,'src'));await fs.mkdir(path.join(temp,'icons'));
 await fs.writeFile(path.join(temp,'src/main.rs'),(await fs.readFile(path.join(source,'main.rs'),'utf8')).replace('__TRAY_SOURCE__',JSON.stringify(path.join(root,'src-tauri/src/tray.rs'))));await fs.rm(path.join(temp,'main.rs'));
 await fs.copyFile(path.join(root,'src-tauri/Cargo.lock'),path.join(temp,'Cargo.lock'));await fs.copyFile(path.join(root,'src-tauri/icons/icon.png'),path.join(temp,'icons/icon.png'));
 const target=path.join(root,'src-tauri/target');const build=spawnSync('cargo',['build','--offline','--manifest-path',path.join(temp,'Cargo.toml')],{cwd:root,encoding:'utf8',env:{...process.env,CARGO_BUILD_JOBS:'2',CARGO_TARGET_DIR:target},timeout:180000});
 if(build.status!==0)throw Error('Fixture build failed: '+build.stderr.slice(-4000));
 const run=spawnSync(path.join(target,'debug/enki-tray-fixture'),[],{cwd:temp,encoding:'utf8',env:{...process.env,ENKI_TRAY_FIXTURE_DATA_DIR:path.join(temp,'webview-data')},timeout:30000});
 process.stdout.write(run.stdout);if(run.stderr)process.stderr.write(run.stderr);
 assert.equal(run.status,0,'Native fixture must exit cleanly');assert(run.stdout.includes('TRAY_FIXTURE_PASS'));assert(run.stdout.includes('after-close appHidden=true fullscreen=false'));assert(run.stdout.includes('after-reopen appHidden=false fullscreen=true'));assert(run.stdout.includes('rapid-reopen appHidden=false fullscreen=true'));
}finally{await fs.rm(temp,{recursive:true,force:true});}
