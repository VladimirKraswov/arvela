import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import accessPolicy, { fullRules, sessionAccess } from '../src-tauri/resources/browser/access-policy.mjs';
import browserPlugin from '../src-tauri/resources/browser/opencode-session-plugin.mjs';
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(p => rm(p, {recursive:true,force:true}))); });
async function fixture() {
  const base = await mkdtemp(path.join(os.tmpdir(), 'enki-access-alias-')); temporary.push(base);
  const directory = path.join(base, 'enki', 'chats', 'chat');
  await mkdir(directory, {recursive:true});
  await symlink(path.join(base, 'enki'), path.join(base, 'opencode-desktop'), process.platform === 'win32' ? 'junction' : 'dir');
  const legacy = path.join(base, 'opencode-desktop', 'chats', 'chat');
  const sessions: Record<string, any> = {
    root: {id:'root',directory:legacy,permission:fullRules()},
    child: {id:'child',directory,parentID:'root',permission:[]},
  };
  const get = vi.fn(async ({path:p,query}:any) => { expect(query.directory).toBe(directory); return {data:sessions[p.id]}; });
  const update = vi.fn(async ({path:p,query,body}:any) => {
    expect(query.directory).toBe(directory);
    sessions[p.id] = {...sessions[p.id],permission:body.permission};
    return {data:sessions[p.id]};
  });
  return {base,directory,legacy,sessions,client:{session:{get,update}},update};
}
it('accepts a retained migration alias for root and mixed-path child ancestry', async () => {
  const f = await fixture();
  expect((await sessionAccess(f.client,f.directory,'root')).full).toBe(true);
  const hooks = await accessPolicy({client:f.client,directory:f.directory});
  await hooks['chat.message']({sessionID:'child'});
  expect(f.sessions.child.permission).toEqual(fullRules());
  await hooks['chat.message']({sessionID:'child'});
  expect(f.update).toHaveBeenCalledTimes(1);
  expect(f.sessions.root.directory).toBe(f.legacy);
});
it('browser derives full access through the same alias-aware policy, not model metadata', async () => {
  const f = await fixture(); const args = {__arvelaAccess:'project'};
  const hooks = await browserPlugin({client:f.client,directory:f.directory});
  await hooks['tool.execute.before']({tool:'desktop_browser_browser_file_upload',sessionID:'root'},{args});
  expect(args.__arvelaAccess).toBe('full');
});
it('does not trust a matching suffix, missing alias or alias redirected to another directory', async () => {
  const f = await fixture();
  const foreign = path.join(f.base,'foreign','chats','chat'); await mkdir(foreign,{recursive:true});
  f.sessions.root.directory = foreign;
  await expect(sessionAccess(f.client,f.directory,'root')).rejects.toThrow('context');
  f.sessions.root.directory = path.join(f.base,'missing','chats','chat');
  await expect(sessionAccess(f.client,f.directory,'root')).rejects.toThrow('context');
  f.sessions.root.directory = f.legacy;
  await rm(path.join(f.base,'opencode-desktop'));
  await symlink(path.join(f.base,'foreign'),path.join(f.base,'opencode-desktop'),process.platform === 'win32' ? 'junction' : 'dir');
  await expect(sessionAccess(f.client,f.directory,'root')).rejects.toThrow('context');
  expect(f.update).not.toHaveBeenCalled();
});
it('retains session ID and ancestry checks even for a valid alias', async () => {
  const f = await fixture(); f.sessions.root.id = 'different';
  await expect(sessionAccess(f.client,f.directory,'root')).rejects.toThrow('context');
  f.sessions.root.id = 'root'; f.sessions.root.parentID = 'child';
  await expect(sessionAccess(f.client,f.directory,'child')).rejects.toThrow('Cyclic');
});
it('read-only parent remains read-only through an alias and revokes inherited full access', async () => {
  const f = await fixture(); f.sessions.child.permission = fullRules();
  f.sessions.root.permission = [{permission:'*',pattern:'*',action:'deny'}];
  const hooks = await accessPolicy({client:f.client,directory:f.directory});
  await hooks['chat.message']({sessionID:'child'});
  expect(f.sessions.child.permission).toEqual(f.sessions.root.permission);
});
it.skipIf(process.platform === 'win32')('rejects a symlink to a file as a directory context', async () => {
  const f = await fixture(); const file = path.join(f.base,'file'); await writeFile(file,'x');
  const link = path.join(f.base,'file-link'); await symlink(file,link);
  f.sessions.root.directory = file;
  const client = {session:{get:async () => ({data:f.sessions.root})}};
  await expect(sessionAccess(client,link,'root')).rejects.toThrow('context');
});
it('rejects an update acknowledgement for another session or directory', async () => {
  for (const wrong of ['id','directory']) {
    const f = await fixture();
    f.client.session.update.mockImplementationOnce(async () => ({data:{
      id:wrong === 'id' ? 'other' : 'child', directory:wrong === 'directory' ? f.base : f.legacy, permission:fullRules(),
    }}));
    const hooks = await accessPolicy({client:f.client,directory:f.directory});
    await expect(hooks['chat.message']({sessionID:'child'})).rejects.toThrow('did not apply');
  }
});
