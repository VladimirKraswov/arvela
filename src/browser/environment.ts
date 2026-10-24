export interface BrowserEnvironment {
  engine: "chromium" | "chrome";
  display: "embedded" | "window";
  storage: "persistent" | "temporary";
  locale: string;
  timezone: string;
  colorScheme: "system" | "light" | "dark";
  reducedMotion: "no-preference" | "reduce";
  serviceWorkers: "allow" | "block";
  doNotTrack: boolean;
  protectWebRTC: boolean;
  reduceAutomationSignals: boolean;
  actionDelayMs: number;
}
export const browserEnvironmentDefaults: BrowserEnvironment = {
  engine: "chromium", display: "embedded", storage: "persistent", locale: "", timezone: "",
  colorScheme: "system", reducedMotion: "no-preference", serviceWorkers: "allow",
  doNotTrack: false, protectWebRTC: false, reduceAutomationSignals: true, actionDelayMs: 0,
};
export function browserEnvironment(value?: Partial<BrowserEnvironment>): BrowserEnvironment {
  return { ...browserEnvironmentDefaults, ...value };
}
