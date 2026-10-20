import { isAbsoluteLocalPath, pathBasename } from './paths';

/** Recognize moved app wrappers and the two shipped CLI identities. Callers must
 * separately validate the private mode flag and (for shared MCP) scope/server. */
export function sameAppExecutable(previous: string, current: string): boolean {
  if (!isAbsoluteLocalPath(previous) || !isAbsoluteLocalPath(current)) return false;
  const windows = (path: string) => /^(?:[A-Za-z]:[\\/]|[\\/]{2})/u.test(path);
  if (windows(previous) !== windows(current)) return false;
  const fold = (path: string) => windows(current) ? pathBasename(path).toLowerCase() : pathBasename(path);
  const before = fold(previous), after = fold(current);
  if (before === after) return true;
  const family = windows(current) ? ['enki.exe', 'opencode-desktop.exe'] : ['enki', 'opencode-desktop'];
  return family.includes(before) && family.includes(after);
}
