// Ordinary-browser presentation for the hidden managed surface. Every value
// here is either observed from the real executable or a fixed plausible
// desktop default; nothing is inferred from page content, and no insecure
// flag is introduced. The daemon applies this only when the user enables
// "reduce automation signals".
import { execFile } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { stealthScreenMetrics } from './preferences.mjs';

const run = promisify(execFile);

// Chrome-family user-agent shells. The version always comes from the actual
// executable (--version), never from a hard-coded constant.
const userAgentShells = {
  darwin: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/%s Safari/537.36',
  win32: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/%s Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/%s Safari/537.36',
};

export function chromeExecutableCandidates(platform = process.platform, env = process.env) {
  if (platform === 'darwin') return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  if (platform === 'win32') return [
    env['PROGRAMFILES'] ? path.join(env['PROGRAMFILES'], 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
    env['PROGRAMFILES(X86)'] ? path.join(env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
  ].filter(Boolean);
  return ['/usr/bin/google-chrome', '/opt/google/chrome/chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
}

// "Chromium 155.0.8059.12" / "Google Chrome 141.0.7390.108" → the matching
// ordinary browser user-agent. Anything unparseable yields null and the
// launcher keeps the stock identity (fail-open, never a guessed version).
export function userAgentFromVersion(versionLine, platform = process.platform) {
  const shell = userAgentShells[platform];
  // "Google Chrome for Testing 155.0.8059.12", "Chromium 155.0.8059.12" or a
  // full UA line: the build version is the last dotted number in the line.
  const versions = typeof versionLine === 'string' && /Chrome|Chromium/i.test(versionLine)
    ? versionLine.match(/\b\d+\.\d+\.\d+(?:\.\d+)?\b/g)
    : undefined;
  const version = versions?.at(-1);
  if (!shell || !version) return null;
  return shell.replace('%s', version);
}

// Fallback helper when the default user-agent is already known: only the
// "Headless" token is replaced; the observed version is preserved.
export function patchHeadlessUserAgent(userAgent) {
  return typeof userAgent === 'string' ? userAgent.replace('HeadlessChrome/', 'Chrome/') : null;
}

// Resolves the ordinary user-agent for one engine once per runtime directory.
// The version comes from the same executable Playwright will launch (bundled
// Chromium) or from the system Chrome install; failures return null and the
// browser launches with its default identity.
export async function stealthUserAgent({ settings, root, chromium, platform = process.platform, env = process.env }) {
  const cacheFile = path.join(root, 'stealth-ua.json');
  const key = `${settings.engine}:${platform}`;
  try {
    const cached = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
    if (cached.key === key && typeof cached.userAgent === 'string' && cached.userAgent.includes('Chrome/')) return cached.userAgent;
  } catch {}
  try {
    let executable;
    if (settings.engine === 'chrome') {
      for (const candidate of chromeExecutableCandidates(platform, env)) {
        try { await fs.access(candidate); executable = candidate; break; } catch {}
      }
    } else executable = chromium.executablePath();
    if (!executable) return null;
    const { stdout } = await run(executable, ['--version'], { timeout: 8000 });
    const userAgent = userAgentFromVersion(String(stdout || ''), platform);
    if (!userAgent) return null;
    const temporary = `${cacheFile}.${crypto.randomUUID?.() ?? Date.now()}.tmp`;
    try { await fs.writeFile(temporary, JSON.stringify({ key, userAgent }), { mode: 0o600 }); await fs.rename(temporary, cacheFile); } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
    return userAgent;
  } catch { return null; }
}

// Playwright derives platform hints but not the brand list, so the browser's
// own "HeadlessChrome" brand would still leak into Sec-CH-UA and
// navigator.userAgentData. The daemon re-applies the override with the brand
// list matching the ordinary user-agent it verified above.
export function uaClientHintMetadata(userAgent, platform = process.platform, release = os.release(), arch = process.arch) {
  const major = userAgent.match(/Chrome\/(\d+)/)?.[1];
  const full = userAgent.match(/Chrome\/([\d.]+)/)?.[1];
  if (!major || !full) return null;
  let platformName = 'Linux';
  let platformVersion = release.split('.').slice(0, 2).join('.') + '.0';
  if (platform === 'darwin') {
    platformName = 'macOS';
    platformVersion = Math.max(Number(release.split('.')[0]) - 9, 1) + '.0.0';
  } else if (platform === 'win32') {
    platformName = 'Windows';
    platformVersion = (Number(release.split('.')[2]) || 0) >= 22000 ? '15.0.0' : '10.0.0';
  }
  return {
    brands: [{ brand: 'Chromium', version: major }, { brand: 'Not(A:Brand', version: '24' }],
    fullVersionList: [{ brand: 'Chromium', version: full }, { brand: 'Not(A:Brand', version: '24.0.0.0' }],
    mobile: false, model: '', platform: platformName, platformVersion,
    architecture: arch === 'arm64' ? 'arm' : 'x86', bitness: '64',
  };
}

// Keeps the override active for every current and future page of the context.
// Chromium reverts Emulation state when its CDP client detaches, so exactly
// one live session is kept per page (Playwright applies its own brand-less
// override at page creation; ours is re-asserted after it and on navigation).
export function applyUserAgentClientHints(context, userAgent, acceptLanguage, platform = process.platform) {
  const metadata = uaClientHintMetadata(userAgent, platform);
  if (!metadata) return;
  const sessions = new WeakMap();
  const apply = async page => {
    if (page.isClosed()) return;
    try {
      let session = sessions.get(page);
      if (!session) {
        session = await context.newCDPSession(page);
        sessions.set(page, session);
        page.once('close', () => { sessions.delete(page); session.detach().catch(() => {}); });
      }
      await session.send('Emulation.setUserAgentOverride', { userAgent, acceptLanguage, userAgentMetadata: metadata });
    } catch {}
  };
  const track = page => {
    void apply(page);
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) void apply(page); });
  };
  for (const page of context.pages()) track(page);
  context.on('page', track);
}

// Applied before any site script runs, on every frame of the context. The
// hidden surface reports the same window.chrome/PDF-plugin/screen values an
// ordinary Chrome profile has; the visible window mode keeps its real ones.
export function stealthInitScript({ headless, platform = process.platform }) {
  if (!headless) return `(() => {
  try {
    if (!window.chrome || !window.chrome.runtime) window.chrome = Object.assign({ runtime: {}, app: { isInstalled: false } }, window.chrome || {});
  } catch {}
})()`;
  const screen = stealthScreenMetrics(platform);
  return `(() => {
  try {
    if (!window.chrome || !window.chrome.runtime) window.chrome = Object.assign({ runtime: {}, loadTimes: () => ({}), csi: () => ({}), app: { isInstalled: false } }, window.chrome || {});
    const pluginNames = [['PDF Viewer', 'Portable Document Format'], ['Chrome PDF Viewer', 'Portable Document Format'], ['Chromium PDF Viewer', 'Portable Document Format'], ['Microsoft Edge PDF Viewer', 'Portable Document Format'], ['WebKit built-in PDF', 'Portable Document Format']];
    const list = pluginNames.map(([name, description]) => ({ name, description, filename: 'internal-pdf-viewer', length: 1, 0: null }));
    const plugins = list.slice();
    list.forEach(plugin => { plugins[plugin.name] = plugin; });
    Object.defineProperties(plugins, {
      item: { value: index => list[index] ?? null },
      namedItem: { value: name => list.find(plugin => plugin.name === name) ?? null },
      refresh: { value: () => {} },
    });
    Object.defineProperty(navigator, 'plugins', { get: () => plugins, configurable: true });
    const mimeList = [{ type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: list[0] }, { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: list[0] }];
    const mimeTypes = mimeList.slice();
    mimeList.forEach(mime => { mimeTypes[mime.type] = mime; });
    Object.defineProperties(mimeTypes, {
      item: { value: index => mimeList[index] ?? null },
      namedItem: { value: type => mimeList.find(mime => mime.type === type) ?? null },
    });
    Object.defineProperty(navigator, 'mimeTypes', { get: () => mimeTypes, configurable: true });
    Object.defineProperties(window, {
      outerWidth: { get: () => window.innerWidth, configurable: true },
      outerHeight: { get: () => window.innerHeight + ${screen.chromeHeight}, configurable: true },
    });
    Object.defineProperties(window.screen, Object.fromEntries(Object.entries({
      width: ${screen.width}, height: ${screen.height}, availLeft: ${screen.availLeft}, availTop: ${screen.availTop}, availWidth: ${screen.availWidth}, availHeight: ${screen.availHeight}, colorDepth: 24, pixelDepth: 24,
    }).map(([key, value]) => [key, { get: () => value, configurable: true }])));
  } catch {}
})()`;
}
