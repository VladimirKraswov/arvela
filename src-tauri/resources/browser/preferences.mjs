// Only explicit, bounded browser options cross this boundary. No arbitrary
// flags, scripts, proxy credentials or disabled browser security.
export const environmentDefaults = Object.freeze({
  engine: 'chromium', display: 'embedded', storage: 'persistent', locale: '', timezone: '',
  colorScheme: 'system', reducedMotion: 'no-preference', serviceWorkers: 'allow',
  doNotTrack: false, protectWebRTC: false, reduceAutomationSignals: true, actionDelayMs: 0,
});
export function normalizeEnvironment(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid browser preferences');
  if (Object.keys(input).some(key => !(key in environmentDefaults) || !Object.hasOwn(environmentDefaults, key))) throw new Error('Unknown browser preference');
  const value = { ...environmentDefaults, ...input };
  for (const [key, allowed] of Object.entries({engine:['chromium','chrome'], display:['embedded','window'], storage:['persistent','temporary'], colorScheme:['system','light','dark'], reducedMotion:['no-preference','reduce'], serviceWorkers:['allow','block']}))
    if (!allowed.includes(value[key])) throw new Error(`Invalid browser preference: ${key}`);
  for (const key of ['doNotTrack','protectWebRTC','reduceAutomationSignals']) if (typeof value[key] !== 'boolean') throw new Error(`Invalid browser preference: ${key}`);
  if (!Number.isInteger(value.actionDelayMs) || value.actionDelayMs < 0 || value.actionDelayMs > 1000) throw new Error('Invalid action delay');
  for (const key of ['locale','timezone']) if (typeof value[key] !== 'string' || value[key].length > 100) throw new Error(`Invalid browser preference: ${key}`);
  value.locale = value.locale.trim(); value.timezone = value.timezone.trim();
  if (value.locale) { try { value.locale = Intl.getCanonicalLocales(value.locale)[0]; } catch { throw new Error('Invalid browser locale'); } }
  if (value.timezone) { try { new Intl.DateTimeFormat('en', {timeZone:value.timezone}); } catch { throw new Error('Invalid browser timezone'); } }
  return value;
}
// One ordinary desktop Chrome on macOS renders at 2x and reports Metal WebGL;
// headless Chromium defaults differ in exactly the ways bot detectors read.
// The angle-metal switches keep real GPU rendering on Apple Silicon; other
// platforms keep the browser's own GL default. The user-agent is replaced in
// the daemon only after the real executable version is verified, so this
// object never claims a version that was not observed.
export function stealthLaunchOptions(platform = process.platform) {
  return {
    ignoreDefaultArgs: ['--enable-automation'],
    deviceScaleFactor: platform === 'darwin' ? 2 : 1,
    args: [
      '--disable-blink-features=AutomationControlled',
      ...(platform === 'darwin' ? ['--use-gl=angle', '--use-angle=metal'] : []),
    ],
  };
}
// Plausible physical display metrics for the hidden embedded surface; a real
// browser never reports its screen as exactly its viewport.
export function stealthScreenMetrics(platform = process.platform) {
  if (platform === 'darwin') return { width: 1512, height: 982, availLeft: 0, availTop: 37, availWidth: 1512, availHeight: 873, chromeHeight: 83 };
  if (platform === 'win32') return { width: 1920, height: 1080, availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1032, chromeHeight: 88 };
  return { width: 1920, height: 1080, availLeft: 0, availTop: 27, availWidth: 1920, availHeight: 1010, chromeHeight: 116 };
}
export function environmentOptions(input) {
  const v = normalizeEnvironment(input);
  const stealth = v.reduceAutomationSignals ? stealthLaunchOptions() : { args: [], ignoreDefaultArgs: undefined, deviceScaleFactor: undefined };
  return {
    headless: v.display === 'embedded', chromiumSandbox: true,
    // Installed Chrome keeps its channel. With automation-signal reduction the
    // hidden surface launches the full Chromium binary (--headless=new) rather
    // than the stripped headless-shell whose missing features detectors probe.
    ...(v.engine === 'chrome' ? {channel:'chrome'}
      : (v.reduceAutomationSignals && v.display === 'embedded' ? {channel:'chromium'} : {})),
    ...(v.locale ? {locale:v.locale} : {}), ...(v.timezone ? {timezoneId:v.timezone} : {}),
    colorScheme: v.colorScheme === 'system' ? null : v.colorScheme,
    reducedMotion:v.reducedMotion, serviceWorkers:v.serviceWorkers,
    permissions: [], // Sites must not inherit desktop/agent Full access.
    extraHTTPHeaders: v.doNotTrack ? {DNT:'1'} : {},
    ...(stealth.deviceScaleFactor !== undefined ? {deviceScaleFactor:stealth.deviceScaleFactor} : {}),
    ...(stealth.ignoreDefaultArgs ? {ignoreDefaultArgs:stealth.ignoreDefaultArgs} : {}),
    args: [
      ...stealth.args,
      ...(v.protectWebRTC ? ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] : []),
    ],
  };
}
