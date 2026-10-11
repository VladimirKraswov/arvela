// Session metadata is supplied by agent adapters, not by the selected UI chat.
export function browserSession(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || !['opencode', 'pi'].includes(value.engine)
      || typeof value.sessionID !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value.sessionID))
    throw new Error('Browser call requires a valid agent session');
  return { engine: value.engine, sessionID: value.sessionID };
}
export function stripSession(params) {
  const args = { ...params.arguments };
  const identity = args.__arvelaSession ?? params._meta?.arvelaSession;
  const access = args.__arvelaAccess ?? params._meta?.arvelaAccess;
  delete args.__arvelaSession;
  delete args.__arvelaAccess;
  const clean = { ...params, arguments: args };
  if (clean._meta?.arvelaSession !== undefined || clean._meta?.arvelaAccess !== undefined) {
    clean._meta = { ...clean._meta }; delete clean._meta.arvelaSession;
    delete clean._meta.arvelaAccess;
    if (!Object.keys(clean._meta).length) delete clean._meta;
  }
  return { session: identity === undefined ? undefined : browserSession(identity), params: clean,
    ...(access === 'full' ? { access: 'full' } : {}) };
}
export function sessionKey(directory, value) {
  const identity = browserSession(value);
  return JSON.stringify([directory, identity.engine, identity.sessionID]);
}
