import {isAbsoluteLocalPath} from './paths';
export interface ManagedPluginPaths {
  accessPluginPath?: string; browserPluginPath?: string;
  retiredAccessPluginPaths?: string[]; retiredBrowserPluginPaths?: string[];
}
export function pluginFileUri(path: string) {
  if (!isAbsoluteLocalPath(path)) throw new Error('Путь расширения должен быть абсолютным.');
  const normalized = path.replace(/\\/g, '/');
  const encoded = encodeURI(normalized).replace(/#/g, '%23').replace(/\?/g, '%3F');
  return normalized.startsWith('//') ? `file:${encoded}` : `file://${normalized.startsWith('/') ? '' : '/'}${encoded}`;
}
/** Native supplies only verified managed paths. Never filter arbitrary plugin names/prefixes. */
export function managedPlugins(plugins: string[], paths: ManagedPluginPaths, install: {access:boolean;browser:boolean}) {
  let result = plugins;
  for (const [desired, retired, add] of [
    [paths.accessPluginPath, paths.retiredAccessPluginPaths, install.access],
    [paths.browserPluginPath, paths.retiredBrowserPluginPaths, install.browser],
  ] as const) {
    if (!desired) continue;
    const uri = pluginFileUri(desired);
    const own = new Set([uri, ...(retired ?? []).map(pluginFileUri)]);
    let found = false;
    result = result.flatMap(value => {
      if (!own.has(value)) return [value];
      if (found) return [];
      found = true; return [uri];
    });
    if (!found && add) result = [...result, uri];
  }
  return result;
}
