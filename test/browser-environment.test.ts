import { expect, it } from "vitest";
import { browserEnvironment, browserEnvironmentDefaults } from "../src/browser/environment";
// @ts-expect-error The exact runtime implementation is exercised at the boundary.
import { environmentDefaults, normalizeEnvironment, environmentOptions, stealthLaunchOptions, stealthScreenMetrics } from "../src-tauri/resources/browser/preferences.mjs";
// @ts-expect-error The exact runtime implementation is exercised at the boundary.
import { chromeExecutableCandidates, patchHeadlessUserAgent, stealthInitScript, uaClientHintMetadata, userAgentFromVersion } from "../src-tauri/resources/browser/stealth.mjs";

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
  expect(options.args).toEqual([]);
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
it("builds the ordinary user-agent only from an observed executable version", () => {
  expect(userAgentFromVersion("Chromium 155.0.8059.12", "darwin"))
    .toBe("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.8059.12 Safari/537.36");
  expect(userAgentFromVersion("Google Chrome 141.0.7390.108", "win32")).toContain("(Windows NT 10.0; Win64; x64)");
  expect(userAgentFromVersion("Google Chrome 141.0.7390.108", "win32")).toContain("Chrome/141.0.7390.108");
  expect(userAgentFromVersion("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chromium 155.0.8059.12", "linux")).toContain("Chrome/155.0.8059.12");
  expect(userAgentFromVersion("dev build", "darwin")).toBeNull();
  expect(userAgentFromVersion(undefined, "linux")).toBeNull();
  expect(patchHeadlessUserAgent("Mozilla/5.0 (Macintosh) HeadlessChrome/155.0.8059.12 Safari/537.36"))
    .toBe("Mozilla/5.0 (Macintosh) Chrome/155.0.8059.12 Safari/537.36");
  expect(chromeExecutableCandidates("darwin", {})[0]).toContain("Google Chrome");
});
it("derives Sec-CH-UA brand hints from the ordinary user-agent, never from the headless build", () => {
  const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.8059.12 Safari/537.36";
  const metadata = uaClientHintMetadata(ua, "darwin", "25.3.0", "arm64");
  expect(metadata.brands).toEqual([{ brand: "Chromium", version: "155" }, { brand: "Not(A:Brand", version: "24" }]);
  expect(metadata.fullVersionList[0].version).toBe("155.0.8059.12");
  expect(metadata.platform).toBe("macOS");
  expect(metadata.platformVersion).toBe("16.0.0");
  expect(metadata.architecture).toBe("arm");
  expect(metadata.mobile).toBe(false);
  expect(uaClientHintMetadata(ua, "win32", "10.0.26100", "x64").platform).toBe("Windows");
  expect(uaClientHintMetadata(ua, "win32", "10.0.26100", "x64").platformVersion).toBe("15.0.0");
  expect(uaClientHintMetadata("Mozilla/5.0 Safari/537.36", "linux")).toBeNull();
});
it("injects an ordinary-browser presentation before site scripts only into the hidden surface", async () => {
  const hidden = stealthInitScript({ headless: true, platform: "darwin" });
  expect(hidden).toContain("PDF Viewer");
  expect(hidden).toContain("window.chrome");
  expect(hidden).toContain("outerHeight");
  expect(hidden).toContain("1512"); // plausible macOS screen instead of the viewport
  const visible = stealthInitScript({ headless: false, platform: "darwin" });
  expect(visible).not.toContain("availWidth"); // the real window keeps its real metrics
  // The generated scripts must be syntactically valid and never throw.
  const run = (source: string) => new Function(`globalThis.navigator = globalThis.navigator || {}; globalThis.window = globalThis; globalThis.screen = globalThis.screen || {}; ${source}`);
  expect(() => run(hidden)()).not.toThrow();
  expect(() => run(visible)()).not.toThrow();
});
