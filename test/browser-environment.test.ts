import { expect, it } from "vitest";
import { browserEnvironment, browserEnvironmentDefaults } from "../src/browser/environment";
// @ts-expect-error The exact runtime implementation is exercised at the boundary.
import { environmentDefaults, normalizeEnvironment, environmentOptions } from "../src-tauri/resources/browser/preferences.mjs";

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

it("reduces only explicit automation markers without disabling security or replacing identity", () => {
  const options = environmentOptions({reduceAutomationSignals:true});
  expect(options.ignoreDefaultArgs).toEqual(["--enable-automation"]);
  expect(options.args).toEqual(["--disable-blink-features=AutomationControlled"]);
  expect(options.chromiumSandbox).toBe(true);
  expect(options).not.toHaveProperty("userAgent");
  expect(options).not.toHaveProperty("ignoreHTTPSErrors");
});
