import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { browserEnvironment, browserEnvironmentDefaults } from "../src/browser/environment";
// @ts-expect-error The exact runtime implementation is exercised at the boundary.
import { environmentDefaults, normalizeEnvironment, environmentOptions, stealthLaunchOptions, stealthScreenMetrics } from "../src-tauri/resources/browser/preferences.mjs";
// @ts-expect-error The exact runtime implementation is exercised at the boundary.
import { browserVersionFromVersion, chromeExecutableCandidates, stealthInitScript, uaClientHintMetadata, userAgentFromVersion } from "../src-tauri/resources/browser/stealth.mjs";

it("shares defaults with the native runtime and keeps sessions isolated", () => {
  expect(browserEnvironmentDefaults).toEqual(environmentDefaults);
  expect(normalizeEnvironment()).toEqual(browserEnvironment());
  expect(environmentOptions({})).toMatchObject({headless:true, chromiumSandbox:true, permissions:[], extraHTTPHeaders:{}});
  expect(environmentOptions({})).not.toHaveProperty("userAgent");
});
it.each([
  {engine:"firefox"}, {display:"unsafe"}, {storage:"shared"}, {locale:"en-US\r\nAuthorization: x"},
  {timezone:"Mars/Unknown"}, {actionDelayMs:-1}, {actionDelayMs:1001}, {actionDelayMs:1.5},
  {doNotTrack:"false"}, {protectWebRTC:1}, {args:["--no-sandbox"]}, {executablePath:"/bin/sh"},
  {locale:null}, {colorScheme:"invalid"}, {serviceWorkers:"invalid"},
])("rejects invalid or arbitrary browser options: %j", value => {
  expect(() => normalizeEnvironment(value)).toThrow();
});
it("maps compatibility/privacy to real Chromium options without insecure launch flags", () => {
  expect(environmentOptions({engine:"chrome", display:"window", locale:"en-us", timezone:"Europe/Moscow", protectWebRTC:true, doNotTrack:true, serviceWorkers:"block", colorScheme:"dark", reducedMotion:"reduce"})).toEqual({
    headless:false, chromiumSandbox:true, channel:"chrome", locale:"en-US", timezoneId:"Europe/Moscow",
    colorScheme:"dark", reducedMotion:"reduce", serviceWorkers:"block", permissions:[],
    extraHTTPHeaders:{DNT:"1"}, args:["--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
  });
});

it("hides automation signals without disabling security", () => {
  const options = environmentOptions({reduceAutomationSignals:true});
  expect(options.ignoreDefaultArgs).toEqual(["--enable-automation"]);
  // The hidden surface launches the full Chromium (--headless=new), not the
  // stripped headless shell whose missing features detectors probe.
  expect(options.channel).toBe("chromium");
  expect(options.headless).toBe(true);
  expect(options.args).toEqual(stealthLaunchOptions(process.platform).args);
  expect(options.args).toContain("--disable-blink-features=AutomationControlled");
  expect(options.deviceScaleFactor).toBe(stealthLaunchOptions(process.platform).deviceScaleFactor);
  expect(options.chromiumSandbox).toBe(true);
  // The user-agent is only replaced in the daemon from the observed executable
  // version, never from a constant, so it is absent from the pure options.
  expect(options).not.toHaveProperty("userAgent");
  expect(options).not.toHaveProperty("ignoreHTTPSErrors");
  for (const unsafe of ["--no-sandbox", "--disable-web-security", "--disable-extensions"]) expect(options.args).not.toContain(unsafe);
});
it("keeps the stock launch when the automation-signal reduction is off", () => {
  const options = environmentOptions({});
  expect(options).not.toHaveProperty("ignoreDefaultArgs");
  expect(options).not.toHaveProperty("deviceScaleFactor");
  expect(options).not.toHaveProperty("channel");
  expect(options.args).toEqual([]);
});
it("never overrides an installed Chrome or a visible window with the chromium channel", () => {
  expect(environmentOptions({reduceAutomationSignals:true, engine:"chrome"}).channel).toBe("chrome");
  expect(environmentOptions({reduceAutomationSignals:true, display:"window"})).not.toHaveProperty("channel");
});
it("plans ordinary-platform presentation per operating system", () => {
  expect(stealthLaunchOptions("darwin").deviceScaleFactor).toBe(2);
  expect(stealthLaunchOptions("darwin").args).toContain("--use-angle=metal");
  expect(stealthLaunchOptions("win32").deviceScaleFactor).toBe(1);
  expect(stealthLaunchOptions("win32").args).not.toContain("--use-angle=metal");
  expect(stealthLaunchOptions("linux").args).not.toContain("--use-angle=metal");
  expect(stealthScreenMetrics("darwin").width).toBeGreaterThan(1400);
  expect(stealthScreenMetrics("win32").availHeight).toBeLessThan(stealthScreenMetrics("win32").height);
});
it("builds the reduced ordinary user-agent only from an observed executable version", () => {
  // Desktop Chrome sends the UA-Reduction token: only the major build number.
  expect(browserVersionFromVersion("Chromium 155.0.8059.12")).toBe("155.0.8059.12");
  expect(browserVersionFromVersion("Google Chrome for Testing 155.0.8059.12")).toBe("155.0.8059.12");
  expect(browserVersionFromVersion("dev build")).toBeNull();
  expect(userAgentFromVersion("Chromium 155.0.8059.12", "darwin"))
    .toBe("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36");
  expect(userAgentFromVersion("Google Chrome 141.0.7390.108", "win32", "x64")).toContain("(Windows NT 10.0; Win64; x64)");
  expect(userAgentFromVersion("Google Chrome 141.0.7390.108", "win32", "x64")).toContain("Chrome/141.0.0.0");
  expect(userAgentFromVersion("Google Chrome 141.0.7390.108", "win32", "arm64")).toContain("(Windows NT 10.0; ARM64)");
  expect(userAgentFromVersion("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chromium 155.0.8059.12", "linux")).toContain("Chrome/155.0.0.0");
  expect(userAgentFromVersion("Chromium 155.0.8059.12", "linux", "arm64")).toContain("X11; Linux aarch64");
  expect(userAgentFromVersion("dev build", "darwin")).toBeNull();
  expect(userAgentFromVersion(undefined, "linux")).toBeNull();
  expect(chromeExecutableCandidates("darwin", {})[0]).toContain("Google Chrome");
});
it("derives Sec-CH-UA brand hints from the observed full version, never from the headless build", () => {
  const metadata = uaClientHintMetadata("155.0.8059.12", "chromium", "darwin", "25.3.0", "arm64");
  expect(metadata.brands).toEqual([{ brand: "Chromium", version: "155" }, { brand: "Not(A:Brand", version: "24" }]);
  expect(metadata.fullVersionList[0].version).toBe("155.0.8059.12");
  expect(metadata.uaFullVersion).toBe("155.0.8059.12");
  expect(metadata.platform).toBe("macOS");
  expect(metadata.platformVersion).toBe("16.0.0");
  expect(metadata.architecture).toBe("arm");
  expect(metadata.mobile).toBe(false);
  // Installed Google Chrome also carries its own brand in both lists.
  const chrome = uaClientHintMetadata("141.0.7390.108", "chrome", "win32", "10.0.26100", "x64");
  expect(chrome.brands.map(b => b.brand)).toEqual(["Chromium", "Google Chrome", "Not(A:Brand"]);
  expect(chrome.platform).toBe("Windows");
  expect(chrome.platformVersion).toBe("15.0.0");
  expect(uaClientHintMetadata("155.0", "chromium", "linux")).toBeNull();
  expect(uaClientHintMetadata(undefined, "chromium", "linux")).toBeNull();
});
it("injects an ordinary-browser presentation before site scripts only into the hidden surface", async () => {
  const metadata = uaClientHintMetadata("155.0.8059.12", "chromium", "darwin", "25.3.0", "arm64");
  const identity = { userAgent: userAgentFromVersion("155.0.8059.12", "darwin"), fullVersion: "155.0.8059.12", metadata };
  const hidden = stealthInitScript({ headless: true, platform: "darwin", identity });
  expect(hidden).toContain("PDF Viewer");
  expect(hidden).toContain("window.chrome");
  expect(hidden).toContain("outerHeight");
  expect(hidden).toContain("1512"); // plausible macOS screen instead of the viewport
  // UA-CH is answered before any site script runs, closing the pre-CDP race.
  expect(hidden).toContain("userAgentData");
  expect(hidden).toContain("getHighEntropyValues");
  expect(stealthInitScript({ headless: true, platform: "darwin" })).toBeNull(); // no identity → honest stock presentation
  const visible = stealthInitScript({ headless: false, platform: "darwin" });
  expect(visible).not.toContain("availWidth"); // the real window keeps its real metrics
  // The generated scripts must be syntactically valid and never throw.
  const run = (source: string) => new Function(`globalThis.navigator = globalThis.navigator || {}; globalThis.window = globalThis; globalThis.screen = globalThis.screen || {}; ${source}; return navigator;`);
  expect(() => run(hidden)()).not.toThrow();
  expect(() => run(visible)()).not.toThrow();
  const navigator1 = run(hidden)();
  expect(navigator1.userAgentData.brands[0].brand).toBe("Chromium");
  const high = await navigator1.userAgentData.getHighEntropyValues(["platformVersion", "uaFullVersion"]);
  expect(high.uaFullVersion).toBe("155.0.8059.12");
});
it("aligns the headless notification denial with the ordinary prompt state", async () => {
  const metadata = uaClientHintMetadata("155.0.8059.12", "chromium", "darwin", "25.3.0", "arm64");
  const hidden = stealthInitScript({ headless: true, platform: "darwin", identity: { userAgent: "ua", fullVersion: "155.0.8059.12", metadata } });
  expect(hidden).toContain("Notification.permission === 'denied'");
  const source = `Object.defineProperty(globalThis.navigator, 'permissions', { value: { query: p => Promise.resolve({ state: p.name === 'notifications' ? 'denied' : 'granted' }) }, configurable: true });
    globalThis.window = globalThis; globalThis.screen = {};
    globalThis.Notification = { permission: 'denied' };
    ${hidden};
    return { permission: Notification.permission, notifications: navigator.permissions.query({ name: 'notifications' }), geolocation: navigator.permissions.query({ name: 'geolocation' }) };`;
  const result = await new Function(source)();
  expect(result.permission).toBe("default");
  expect((await result.notifications).state).toBe("prompt");
  expect((await result.geolocation).state).toBe("granted"); // other permissions keep their truth
});
it("keeps the stealth layer on the narrowest CDP surface (no Runtime/Console/Log enabling)", () => {
  // Runtime.enable/Console serialization is the leak advanced anti-bot probes
  // time; the daemon must never subscribe to page events that force it on.
  const stealth = readFileSync(new URL("../src-tauri/resources/browser/stealth.mjs", import.meta.url), "utf8");
  const daemon = readFileSync(new URL("../src-tauri/resources/browser/daemon.mjs", import.meta.url), "utf8");
  expect(stealth).toContain("Emulation.setUserAgentOverride");
  for (const source of [stealth, daemon]) for (const leak of ["Runtime.enable", "Console.enable", "Log.enable", "Page.enable"]) expect(source).not.toContain(leak);
  for (const leak of [".on('console'", ".on('pageerror'", ".route(", "exposeBinding"]) expect(daemon).not.toContain(leak);
});
