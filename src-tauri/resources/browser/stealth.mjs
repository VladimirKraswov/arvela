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
// executable (--version), never from a hard-coded constant. Desktop Chrome
// has sent the reduced "<major>.0.0.0" build token in the user-agent since
// UA-Reduction; the full observed version is only carried in client hints.
const userAgentShells = {
  darwin: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/%s Safari/537.36',
  win32: 'Mozilla/5.0 (Windows NT 10.0; %a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/%s Safari/537.36',
  linux: 'Mozilla/5.0 (X11; %l) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/%s Safari/537.36',
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

// "Chromium 155.0.8059.12" / "Google Chrome 141.0.7390.108" → the full dotted
// build version. Anything unparseable yields null and the launcher keeps the
// stock identity (fail-open, never a guessed version).
export function browserVersionFromVersion(versionLine) {
  // "Google Chrome for Testing 155.0.8059.12", "Chromium 155.0.8059.12" or a
  // full UA line: the build version is the last dotted number in the line.
  const versions = typeof versionLine === 'string' && /Chrome|Chromium/i.test(versionLine)
    ? versionLine.match(/\b\d+\.\d+\.\d+(?:\.\d+)?\b/g)
    : undefined;
  return versions?.at(-1) ?? null;
}

// The reduced ordinary-browser user-agent (UA-Reduction shape): only the
// major build number appears, matching what desktop Chrome really sends.
export function userAgentFromVersion(versionLine, platform = process.platform, arch = process.arch) {
  const shell = userAgentShells[platform];
  // Accepts either the raw "--version" output (brand gate applies) or a bare
  // dotted build version that was already validated once before caching.
  const full = /^\d+\.\d+\.\d+(?:\.\d+)?$/.test(versionLine) ? versionLine : browserVersionFromVersion(versionLine);
  if (!shell || !full) return null;
  const reduced = `${full.split('.')[0]}.0.0.0`;
  return shell
    .replace('%a', arch === 'arm64' ? 'ARM64' : 'Win64; x64')
    .replace('%l', arch === 'arm64' ? 'Linux aarch64' : 'Linux x86_64')
    .replace('%s', reduced);
}

// Resolves the ordinary identity for one engine once per runtime directory.
// The version comes from the same executable Playwright will launch (bundled
// Chromium) or from the system Chrome install. The cache is keyed by the
// executable path plus its size/mtime, so a Chromium upgrade (in-place or a
// new bundle) forces a fresh --version read instead of an eternally stale UA.
// Failures return null and the browser launches with its default identity.
export async function stealthUserAgent({ settings, root, chromium, platform = process.platform, env = process.env, release = os.release(), arch = process.arch }) {
  const cacheFile = path.join(root, 'stealth-ua.json');
  const key = `${settings.engine}:${platform}:${arch}`;
  try {
    let executable;
    if (settings.engine === 'chrome') {
      for (const candidate of chromeExecutableCandidates(platform, env)) {
        try { await fs.access(candidate); executable = candidate; break; } catch {}
      }
    } else executable = chromium.executablePath();
    if (!executable) return null;
    const stamp = await fs.stat(executable);
    try {
      const cached = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
      if (cached.schema === 2 && cached.key === key && cached.executable === executable
        && cached.size === stamp.size && cached.mtimeMs === Math.round(stamp.mtimeMs * 1000) / 1000
        && typeof cached.fullVersion === 'string' && /\d+\.\d+\.\d+\.\d+/.test(cached.fullVersion)) {
        const userAgent = userAgentFromVersion(cached.fullVersion, platform, arch);
        if (userAgent) return { userAgent, fullVersion: cached.fullVersion, metadata: uaClientHintMetadata(cached.fullVersion, settings.engine, platform, release, arch) };
      }
    } catch {}
    const { stdout } = await run(executable, ['--version'], { timeout: 8000 });
    const fullVersion = browserVersionFromVersion(String(stdout || ''));
    const userAgent = userAgentFromVersion(fullVersion ?? '', platform, arch);
    if (!userAgent) return null;
    const temporary = `${cacheFile}.${crypto.randomUUID?.() ?? Date.now()}.tmp`;
    const entry = { schema: 2, key, executable, size: stamp.size, mtimeMs: Math.round(stamp.mtimeMs * 1000) / 1000, fullVersion };
    try { await fs.writeFile(temporary, JSON.stringify(entry), { mode: 0o600 }); await fs.rename(temporary, cacheFile); } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
    return { userAgent, fullVersion, metadata: uaClientHintMetadata(fullVersion, settings.engine, platform, release, arch) };
  } catch { return null; }
}

// Playwright derives platform hints but not the brand list, so the browser's
// own "HeadlessChrome" brand would still leak into Sec-CH-UA and
// navigator.userAgentData. The identity carries an ordinary brand list that
// matches the observed version, and the daemon re-asserts it after Playwright
// applies its own brand-less override.
export function uaClientHintMetadata(fullVersion, engine = 'chromium', platform = process.platform, release = os.release(), arch = process.arch) {
  const full = typeof fullVersion === 'string' ? fullVersion.match(/^(\d+)\.\d+\.\d+\.\d+$/)?.[0] : undefined;
  if (!full) return null;
  const major = full.split('.')[0];
  let platformName = 'Linux';
  let platformVersion = release.split('.').slice(0, 2).join('.') + '.0';
  if (platform === 'darwin') {
    platformName = 'macOS';
    platformVersion = Math.max(Number(release.split('.')[0]) - 9, 1) + '.0.0';
  } else if (platform === 'win32') {
    platformName = 'Windows';
    platformVersion = (Number(release.split('.')[2]) || 0) >= 22000 ? '15.0.0' : '10.0.0';
  }
  const brands = [{ brand: 'Chromium', version: major }, { brand: 'Not(A:Brand', version: '24' }];
  const fullVersionList = [{ brand: 'Chromium', version: full }, { brand: 'Not(A:Brand', version: '24.0.0.0' }];
  if (engine === 'chrome') {
    brands.splice(1, 0, { brand: 'Google Chrome', version: major });
    fullVersionList.splice(1, 0, { brand: 'Google Chrome', version: full });
  }
  return {
    brands, fullVersionList,
    mobile: false, model: '', platform: platformName, platformVersion,
    architecture: arch === 'arm64' ? 'arm' : 'x86', bitness: '64', uaFullVersion: full,
  };
}

// Keeps the override active for every current and future page of the context.
// Chromium reverts Emulation state when its CDP client detaches, so exactly
// one live session is kept per page (Playwright applies its own brand-less
// override at page creation; ours is re-asserted after it and on navigation).
export function applyUserAgentClientHints(context, identity, acceptLanguage) {
  const { userAgent, metadata } = identity ?? {};
  if (!userAgent || !metadata) return;
  const sessions = new WeakMap();
  const creating = new WeakSet();
  const apply = async page => {
    if (page.isClosed() || creating.has(page)) return;
    creating.add(page);
    try {
      let session = sessions.get(page);
      if (!session) {
        session = await context.newCDPSession(page);
        if (page.isClosed()) { await session.detach().catch(() => {}); return; }
        sessions.set(page, session);
        page.once('close', () => { sessions.delete(page); session.detach().catch(() => {}); });
      }
      await session.send('Emulation.setUserAgentOverride', { userAgent, acceptLanguage, userAgentMetadata: metadata });
    } catch {} finally { creating.delete(page); }
  };
  const track = page => {
    void apply(page);
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) void apply(page); });
  };
  for (const page of context.pages()) track(page);
  context.on('page', track);
}

// Applied before any site script runs, on every frame of the context. The
// hidden surface reports the same window.chrome/PDF-plugin/screen/UA-CH
// values an ordinary Chrome profile has; the visible window mode keeps its
// real ones. Without a resolved identity the hidden surface gets no script
// at all — the stock (honest) presentation is safer than a half-faked one.
export function stealthInitScript({ headless, platform = process.platform, identity } = {}) {
  if (!headless) return `(() => {
  try {
    if (!window.chrome || !window.chrome.runtime) window.chrome = Object.assign({ runtime: {}, app: { isInstalled: false } }, window.chrome || {});
  } catch {}
})()`;
  if (!identity?.metadata) return null;
  const screen = stealthScreenMetrics(platform);
  const hints = JSON.stringify(identity.metadata);
  return `(() => {
  try {
    if (!window.chrome || !window.chrome.runtime) window.chrome = Object.assign({ runtime: {}, loadTimes: () => ({}), csi: () => ({}), app: { isInstalled: false } }, window.chrome || {});
    const hints = ${hints};
    const highEntropy = { architecture: hints.architecture, bitness: hints.bitness, model: hints.model, platformVersion: hints.platformVersion, uaFullVersion: hints.uaFullVersion, fullVersionList: hints.fullVersionList };
    const uaData = {
      brands: hints.brands, mobile: hints.mobile, platform: hints.platform,
      getHighEntropyValues: requested => Promise.resolve(Object.fromEntries((Array.isArray(requested) ? requested : []).filter(hint => hint in highEntropy).map(hint => [hint, highEntropy[hint]]))),
    };
    Object.defineProperty(navigator, 'userAgentData', { get: () => uaData, configurable: true });
    const mimeList = [
      { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
      { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
    ];
    const pluginNames = [['PDF Viewer', 'Portable Document Format'], ['Chrome PDF Viewer', 'Portable Document Format'], ['Chromium PDF Viewer', 'Portable Document Format'], ['Microsoft Edge PDF Viewer', 'Portable Document Format'], ['WebKit built-in PDF', 'Portable Document Format']];
    const list = pluginNames.map(([name, description], index) => Object.defineProperty({ name, description, filename: 'internal-pdf-viewer', length: 1, 0: mimeList[Math.min(index, mimeList.length - 1)] }, Symbol.toStringTag, { value: 'Plugin' }));
    mimeList.forEach(mime => { mime.enabledPlugin = list[0]; });
    const plugins = list.slice();
    list.forEach(plugin => { plugins[plugin.name] = plugin; });
    Object.defineProperties(plugins, {
      item: { value: index => list[index] ?? null },
      namedItem: { value: name => list.find(plugin => plugin.name === name) ?? null },
      refresh: { value: () => {} },
      [Symbol.toStringTag]: { value: 'PluginArray' },
    });
    Object.defineProperty(navigator, 'plugins', { get: () => plugins, configurable: true });
    const mimeTypes = mimeList.slice();
    mimeList.forEach(mime => { mimeTypes[mime.type] = mime; });
    Object.defineProperties(mimeTypes, {
      item: { value: index => mimeList[index] ?? null },
      namedItem: { value: type => mimeList.find(mime => mime.type === type) ?? null },
      [Symbol.toStringTag]: { value: 'MimeTypeArray' },
    });
    Object.defineProperty(navigator, 'mimeTypes', { get: () => mimeTypes, configurable: true });
    // Headless Chromium denies notifications outright; a real desktop profile
    // waits for the user. The denied/denied pair is a headless tell detectors
    // cross-check, so present the ordinary prompt state consistently instead.
    if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
      Object.defineProperty(Notification, 'permission', { get: () => 'default', configurable: true });
      const queryPermission = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = parameters => parameters && parameters.name === 'notifications'
        ? Promise.resolve({ state: 'prompt', onchange: null })
        : queryPermission(parameters);
    }
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
