import { expect, it, vi } from 'vitest';
import accessPolicy, { fullRules, sessionAccess } from '../src-tauri/resources/browser/access-policy.mjs';
import { accessMode, accessRules } from '../src/state/access';
function fixture(rootPermission = accessRules('full')) {
  const sessions: Record<string, any> = {
    root: { id:'root', directory:'/project', permission: rootPermission },
    child: { id:'child', directory:'/project', parentID:'root', permission:[{permission:'edit',pattern:'*',action:'deny'}] },
    sibling: {id:'sibling',directory:'/other',permission:accessRules('read')},
  };
  const get = vi.fn(async ({path,query}:any) => {
    expect(query.directory).toBe('/project'); return {data:sessions[path.id]};
  });
  const update = vi.fn(async ({path,body,query}:any) => {
    expect(query.directory).toBe('/project'); sessions[path.id].permission=[...(sessions[path.id].permission??[]),...body.permission]; return {data:sessions[path.id]};
  });
  return {sessions,client:{session:{get,update}},update};
}
it('inherits full access before the child prompt and leaves other sessions intact',async()=>{
  const f=fixture(), hook=(await accessPolicy({client:f.client,directory:'/project'}))['chat.message'];
  await hook({sessionID:'child'});
  expect(f.sessions.child.permission.slice(-2)).toEqual(fullRules());
  expect(f.sessions.sibling.permission).toEqual(accessRules('read'));
  await hook({sessionID:'child'}); expect(f.update).toHaveBeenCalledTimes(1);
});
it('keeps ask/read/custom policies and rejects foreign/cyclic ancestry',async()=>{
  for (const permission of [accessRules('ask'),accessRules('read'),[{permission:'*',pattern:'*',action:'allow'},{permission:'edit',pattern:'*',action:'deny'}]]) {
    const f=fixture(permission), hook=(await accessPolicy({client:f.client,directory:'/project'}))['chat.message'];
    await hook({sessionID:'child'});expect(f.update).not.toHaveBeenCalled();
  }
  const f=fixture();await expect(sessionAccess(f.client,'/project','sibling')).rejects.toThrow('context');
  f.sessions.root.parentID='child';await expect(sessionAccess(f.client,'/project','child')).rejects.toThrow('Cyclic');
});
it('recognizes existing full chats and carries an explicit external grant',()=>{
  expect(accessMode([{permission:'*',pattern:'*',action:'allow'},{permission:'doom_loop',pattern:'*',action:'ask'}])).toBe('full');
  expect(accessRules('full')).toEqual(fullRules());
  expect(accessRules('full').filter(r=>r.permission==='external_directory')).toEqual([{permission:'external_directory',pattern:'*',action:'allow'}]);
});
it('revokes inherited full access when the parent switches to read',async()=>{
 const f=fixture(),hook=(await accessPolicy({client:f.client,directory:'/project'}))['chat.message'];
 await hook({sessionID:'child'});f.sessions.root.permission=accessRules('read');
 await hook({sessionID:'child'});expect(accessMode(f.sessions.child.permission)).toBe('read');
});
