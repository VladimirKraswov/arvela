import { afterEach, expect, it, vi } from "vitest";
import {
  detectPlatform,
  hasOverlayWindowControls,
  modKeyLabel,
  platform,
  resetPlatformCache,
} from "../src/native/platform";

afterEach(() => {
  vi.unstubAllGlobals();
  resetPlatformCache();
});

it("recognizes the WebViews this app actually ships in", () => {
  expect(
    detectPlatform(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
    ),
  ).toBe("macos");
  expect(
    detectPlatform(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
    ),
  ).toBe("linux");
  expect(
    detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/120.0"),
  ).toBe("windows");
});

it("does not mistake Android for a Linux desktop", () => {
  expect(detectPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe(
    "other",
  );
});

it("reserves window-control space only where the controls overlay the content", () => {
  // Regression: GTK and Windows draw a real title bar, so the macOS inset left a
  // dead 27px gap above the sidebar and 90px beside the collapsed top bar.
  expect(hasOverlayWindowControls("macos")).toBe(true);
  expect(hasOverlayWindowControls("linux")).toBe(false);
  expect(hasOverlayWindowControls("windows")).toBe(false);
});

it("labels the shortcut modifier per host", () => {
  expect(modKeyLabel("macos")).toBe("⌘");
  expect(modKeyLabel("linux")).toBe("Ctrl");
  expect(modKeyLabel("windows")).toBe("Ctrl");
});

it("tolerates an environment without a user agent and does not cache that answer", () => {
  vi.stubGlobal("navigator", {});
  expect(platform()).toBe("other");
  vi.stubGlobal("navigator", { userAgent: "X11; Linux x86_64" });
  expect(platform()).toBe("linux");
});

it("falls back to navigator.platform so macOS chrome survives a stripped user agent", () => {
  // Losing macOS detection would drop the traffic-light inset and leave the
  // window controls sitting on top of the sidebar brand.
  vi.stubGlobal("navigator", { userAgent: "CustomShell/1.0", platform: "MacIntel" });
  expect(platform()).toBe("macos");
  resetPlatformCache();
  vi.stubGlobal("navigator", { userAgent: "", platform: "Linux x86_64" });
  expect(platform()).toBe("linux");
  resetPlatformCache();
  // A usable user agent still wins over the deprecated field.
  vi.stubGlobal("navigator", {
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15",
    platform: "MacIntel",
  });
  expect(platform()).toBe("linux");
});
