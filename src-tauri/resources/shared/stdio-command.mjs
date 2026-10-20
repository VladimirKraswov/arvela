import path from 'node:path';
import {realpath, stat} from 'node:fs/promises';

// Node resolves the main module's import.meta.url through aliases. Match argv[1]
// so guarded entrypoints do not silently exit after an app-data root migration.
// Preserve flags, config/output arguments, cwd and non-Node commands verbatim.
export async function nodeScriptArgs(command, args = []) {
  const name = process.platform === 'win32' ? path.basename(command).toLowerCase() : path.basename(command);
  if (!['node', 'node.exe'].includes(name) || typeof args[0] !== 'string' ||
      !path.isAbsolute(args[0]) || !/\.[cm]?js$/i.test(args[0])) return args;
  try {
    const target = await realpath(args[0]);
    if (target !== args[0] && (await stat(target)).isFile()) return [target, ...args.slice(1)];
  } catch { /* Keep the original startup error; never guess a replacement script. */ }
  return args;
}
