// Guards the split between the platform-neutral Tauri config and the two
// reviewed platform variants. Tauri 2 merges `tauri.<platform>.conf.json` into
// `tauri.conf.json`; object keys are merged, but arrays are *replaced*, which is
// exactly where a silent drift (or a macOS-only key reaching Linux) would hide.

import { readFileSync, existsSync } from "node:fs";
import { expect, it } from "vitest";

const read = (name: string) =>
  JSON.parse(readFileSync(new URL(`../src-tauri/${name}`, import.meta.url), "utf8"));

const base = read("tauri.conf.json");
const macos = read("tauri.macos.conf.json");
const linux = read("tauri.linux.conf.json");
const windows = read("tauri.windows.conf.json");
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const cargo = readFileSync(
  new URL("../src-tauri/Cargo.toml", import.meta.url),
  "utf8",
);

/** macOS-only keys, allowed in the macOS overlay and nowhere else. */
const MAC_ONLY_WINDOW_KEYS = ["titleBarStyle", "hiddenTitle"];

it("keeps macOS window chrome and entitlements out of the shared config", () => {
  const window = base.app.windows[0];
  for (const key of MAC_ONLY_WINDOW_KEYS) expect(window[key]).toBeUndefined();
  expect(base.bundle.macOS).toBeUndefined();
  // The Linux overlay must not reintroduce either of them.
  expect(linux.app).toBeUndefined();
  expect(linux.bundle.macOS).toBeUndefined();
});

it("preserves the Hardened Runtime microphone entitlement on the macOS variant", () => {
  expect(macos.bundle.macOS.entitlements).toBe("Entitlements.plist");
  expect(
    existsSync(new URL("../src-tauri/Entitlements.plist", import.meta.url)),
  ).toBe(true);
  const entitlements = readFileSync(
    new URL("../src-tauri/Entitlements.plist", import.meta.url),
    "utf8",
  );
  expect(entitlements).toContain("com.apple.security.device.audio-input");
});

it("re-declares the whole window object in the macOS overlay, since arrays are replaced", () => {
  // Without this, moving a shared window field would silently drop it on macOS.
  const shared = base.app.windows[0];
  const mac = macos.app.windows[0];
  for (const [key, value] of Object.entries(shared))
    expect(mac[key], `macOS overlay lost ${key}`).toEqual(value);
  expect(Object.keys(mac).sort()).toEqual(
    [...Object.keys(shared), ...MAC_ONLY_WINDOW_KEYS].sort(),
  );
});

it("gives each reviewed variant exactly one bundle target set", () => {
  expect(linux.bundle.targets).toEqual(["deb"]);
  expect(macos.bundle.targets).toEqual(["app", "dmg"]);
  expect(windows.bundle.targets).toEqual(["nsis"]);
});

it("ships the reviewed Windows variant as a per-user NSIS installer", () => {
  expect(windows.bundle.windows.nsis.installMode).toBe("currentUser");
  expect(pkg.scripts["build:windows"]).toBe("tauri build --bundles nsis");
});

it("keeps one product version across package, Cargo and Tauri", () => {
  expect(base.version).toBe(pkg.version);
  expect(cargo).toContain(`version = "${pkg.version}"`);
});
