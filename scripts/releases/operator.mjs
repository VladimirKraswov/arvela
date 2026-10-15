// Local operator convenience only. Secrets never enter source, prompts or tests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export function privateFile(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw Error('Operator credential path must be absolute');
  const s=fs.lstatSync(file);
  if(!s.isFile()||s.isSymbolicLink()||s.size>65536||process.platform!=='win32'&&(s.mode&0o077)!==0)
    throw Error('Operator credential must be a small private regular file (0600 on Unix)');
  return fs.readFileSync(file,'utf8');
}
export function operatorEnvironment(file=path.join(os.homedir(),'.config','arvela-release','operator.json')) {
  const config=JSON.parse(privateFile(file));
  const url=new URL(config.hubUrl);
  if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw Error('Operator Hub must be an HTTPS origin');
  if(!path.isAbsolute(config.caFile)||!fs.lstatSync(config.caFile).isFile())throw Error('Operator requires a trusted CA file');
  const token=privateFile(config.adminTokenFile).trim();
  if(!token||/[\r\n]/.test(token))throw Error('Operator admin token is invalid');
  privateFile(config.signingKeyFile);
  return {ARVELA_HUB_URL:url.origin,ARVELA_HUB_CA_FILE:config.caFile,ARVELA_HUB_ADMIN_TOKEN:token,
    TAURI_SIGNING_PRIVATE_KEY_PATH:config.signingKeyFile,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD:config.signingPasswordFile?privateFile(config.signingPasswordFile).trimEnd():''};
}
export function releaseWithOperator(channel,run,credentials) {
  if(!['stable','preview'].includes(channel))throw Error('Use stable or preview');
  run('git',['diff','--exit-code']);
  for(const args of [['test'],['run','build'],['run','check:architecture'],['run','check:bundle'],['run','test:releases']])run('npm',args);
  run(process.platform==='win32'?'py':'python3', [...(process.platform==='win32'?['-3']:[]),'-m','unittest','discover','-s','services/hub/tests']);
  for(const args of [['fmt','--check'],['test'],['clippy','--all-targets','--','-D','warnings']])
    run('cargo',[...args.slice(0,1),'--manifest-path','src-tauri/Cargo.toml',...args.slice(1)]);
  // Only the publisher receives credentials, and only after all gates passed.
  run('node',['scripts/releases/publish.mjs',channel],credentials());
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=path.resolve(import.meta.dirname,'../..');
  const file=process.env.ARVELA_RELEASE_OPERATOR||undefined;
  try {
    if(process.argv[2]==='--check') { operatorEnvironment(file); console.log('Local release operator configured; credentials withheld.'); }
    else {
      const npm=process.env.npm_execpath;
      const run=(program,args,secretEnv)=>{
        console.log(`Release check: ${program} ${args.join(' ')}`);
        let executable=program, argv=args;
        if(program==='npm') {if(!npm)throw Error('Run through npm run release:local');executable=process.execPath;argv=[npm,...args];}
        if(program==='node')executable=process.execPath;
        const result=spawnSync(executable,argv,{cwd:root,stdio:'inherit',env:{...process.env,...secretEnv},timeout:40*60_000});
        if(result.error||result.status!==0)throw Error(`Release gate failed: ${program} ${args[0]}`);
      };
      const clean=spawnSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'});
      if(clean.status!==0||clean.stdout.trim())throw Error('Commit reviewed changes before release:local');
      releaseWithOperator(process.argv[2]??'stable',run,()=>operatorEnvironment(file));
    }
  } catch { console.error('Release stopped. Check failed gate output or private operator.json/credential permissions; no publication is claimed.');process.exitCode=1; }
}
