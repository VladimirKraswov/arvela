import {it,expect} from 'vitest';
import {mkdtemp,writeFile,symlink,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
// @ts-expect-error Shared runtime module exercised directly.
import {nodeScriptArgs} from '../src-tauri/resources/shared/stdio-command.mjs';
it.skipIf(process.platform==='win32')('launches a guarded Node entrypoint through a migrated root alias',async()=>{
 const base=await mkdtemp(path.join(tmpdir(),'enki-stdio-alias-'));
 try{
  const real=path.join(base,'enki'),old=path.join(base,'opencode-desktop');
  const {mkdir}=await import('node:fs/promises');await mkdir(real);
  const file=path.join(real,'cli.mjs');
  await writeFile(file,"import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';if(import.meta.url===pathToFileURL(resolve(process.argv[1])).href)process.stdout.write('READY');");
  await symlink(real,old);
  const args=[path.join(old,'cli.mjs'),'--config',path.join(old,'private.json')];
  expect(execFileSync(process.execPath,args,{encoding:'utf8'})).toBe('');
  const actual=await nodeScriptArgs(process.execPath,args);
  expect(actual).toEqual([await realpath(file),'--config',args[2]]);
  expect(execFileSync(process.execPath,actual,{encoding:'utf8'})).toBe('READY');
  expect(args[0]).toBe(path.join(old,'cli.mjs'));
  expect(await nodeScriptArgs('/usr/bin/another-program',args)).toEqual(args);
  expect(await nodeScriptArgs(process.execPath,['--preserve-symlinks-main',...args])).toEqual(['--preserve-symlinks-main',...args]);
  expect(await nodeScriptArgs(process.execPath,[path.join(old,'missing.mjs')])).toEqual([path.join(old,'missing.mjs')]);
 }finally{await rm(base,{recursive:true,force:true});}
});
