# Browser profile customization

Source implementation after 0.2.56; the running application has not been replaced.
Settings → Browser → Profile and privacy is shared by OpenCode and Pi. The existing
fast / human interaction selector remains independent of the environment profile.

Three editable presets are available: standard (the existing embedded Chromium),
compatibility (installed Chrome, ordinary window, reduced automation markers and
150 ms additional action pacing), and private (fresh temporary profile, DNT,
restricted direct WebRTC UDP, blocked Service Workers). Selecting/resetting a
preset edits the form; Save applies it. Browser choice does not touch a personal
Chrome profile. Persistent data remains separated by chat and browser engine.

Options include language, timezone, site theme/reduced motion, persistent or
temporary storage, optional automation-marker reduction, Service Workers, DNT and
WebRTC UDP policy. Pacing is a bounded additional pause before agent actions;
observations and manual input do not wait. Stale-frame/mode/permission checks stay
in place after the pause. Emulation still restricts agents to mouse/keyboard tools.

Native Desktop accepts only a bounded settings envelope from its main window.
The daemon validates keys, enums, types, language/timezone and the 0–1000 ms delay.
No arbitrary launch arguments, executable paths, credentials or scripts are
accepted. Valid configuration is atomically replaced with mode 0600. Startup
injects the saved app preferences before attaching shared tools. New contexts
capture a settings snapshot; saving leaves all open contexts and queues intact.
The UI reports how many open browsers still use older settings. To change those,
restart browser management when their work can be interrupted. Hiding a panel or
closing one tab does not close its browser context.

Temporary profiles are removed and cleanup is awaited during normal service
shutdown. Forced OS termination can leave temporary files; this is not secure
erasure. Temporary storage does not delete agent chat history or change Hub
history collection. Persistent profiles are preserved when returning from a
temporary profile. Browser sandboxing, HTTPS validation, workspace permissions,
session isolation and the private authenticated loopback transport remain enabled.
Camera, microphone, location and notification permissions are not auto-granted.

Automation-marker reduction only adjusts the native `navigator.webdriver` feature
and automation banner. It does not replace the UA/OS/hardware or guarantee that a
site treats an automated browser as a human. Chromium's native implementation is
visible in [Navigator source](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/frame/navigator.cc).
Installed Chrome and ordinary windows are supported launch options; compatibility
with a particular Chrome version/site still depends on that browser and site.
See the [Playwright launch/context API](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context).
No CAPTCHA solving, login workaround or access restriction bypass is added.
DNT requests cooperation from a site; it is not a tracker blocker. WebRTC policy
may affect calls, and blocking Service Workers may affect offline applications.

## Acceptance

- Frontend: 839 tests passed, 6 existing skips; production TypeScript/Vite build,
  architecture dependency checks and bundle budgets passed.
- Native: 123 tests passed, 3 existing opt-in skips; strict all-target Clippy passed.
- Isolated real Chromium and installed Chrome (headless): retained open context,
  rejected arbitrary settings without changing the saved configuration, actual
  language/timezone/media/DNT, native webdriver marker reduction, blocked worker
  registration with an allowed-worker control, paced real keyboard input,
  temporary-profile cleanup/non-reuse, persistent-profile recovery and preference
  reload across daemon restart passed. No owner profiles or model calls used.
- Actual Chromium rendering: presets, save, invalid locale, reset and no horizontal
  overflow at 390 and 1100 px passed; fixture IPC never reaches owner services.
- Live headed/native-window acceptance, site-specific login/WAF behavior,
  end-to-end WebRTC ICE leak testing and Windows/Linux OS runs are not claimed.

Reproduce the opt-in daemon check using read-only dependencies/browser binaries
from an installed runtime; the runner creates and removes its own temporary root:

```sh
node src-tauri/resources/browser/test/preferences.mjs /absolute/runtime/current /absolute/browser-cache --chrome
```

Omit `--chrome` if Google Chrome is not installed. Rendering fixture:
`/test/fixtures/browser-settings.html` on a disposable Vite server. Neither test
requires inference or navigates to an external website.
