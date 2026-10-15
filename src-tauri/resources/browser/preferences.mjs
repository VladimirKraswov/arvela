// Only explicit, bounded browser options cross this boundary. No arbitrary
// flags, scripts, proxy credentials or disabled browser security.
export const environmentDefaults = Object.freeze({
  engine: 'chromium', display: 'embedded', storage: 'persistent', locale: '', timezone: '',
  colorScheme: 'system', reducedMotion: 'no-preference', serviceWorkers: 'allow',
  doNotTrack: false, protectWebRTC: false, reduceAutomationSignals: false, actionDelayMs: 0,
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
export function environmentOptions(input) {
  const v = normalizeEnvironment(input);
  return {
    headless: v.display === 'embedded', chromiumSandbox: true,
    ...(v.engine === 'chrome' ? {channel:'chrome'} : {}),
    ...(v.locale ? {locale:v.locale} : {}), ...(v.timezone ? {timezoneId:v.timezone} : {}),
    colorScheme: v.colorScheme === 'system' ? null : v.colorScheme,
    reducedMotion:v.reducedMotion, serviceWorkers:v.serviceWorkers,
    permissions: [], // Sites must not inherit desktop/agent Full access.
    extraHTTPHeaders: v.doNotTrack ? {DNT:'1'} : {},
    ...(v.reduceAutomationSignals ? {ignoreDefaultArgs:['--enable-automation']} : {}),
    args: [
      ...(v.protectWebRTC ? ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] : []),
      ...(v.reduceAutomationSignals ? ['--disable-blink-features=AutomationControlled'] : []),
    ],
  };
}
