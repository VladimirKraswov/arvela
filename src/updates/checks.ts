export const UPDATE_CHECK_INTERVAL = 5 * 60_000;
const EVENT_THROTTLE = 60_000;
/** Checks metadata only. Never downloads/installs, even when a window regains focus. */
export function watchUpdateChecks(check: () => Promise<unknown>, allowed: () => boolean, target: EventTarget = window, visibility: Document = document) {
  let alive = true, pending = false, last = -Infinity;
  const run = (force = false) => {
    if (!alive || pending || !allowed() || (!force && Date.now() - last < EVENT_THROTTLE)) return;
    last = Date.now(); pending = true;
    void Promise.resolve().then(() => { if (alive) return check(); }).catch(() => {}).finally(() => { pending = false; });
  };
  const changed = () => run(true), resumed = () => run();
  const visible = () => { if (visibility.visibilityState === "visible") run(); };
  const timer = setInterval(resumed, UPDATE_CHECK_INTERVAL);
  for (const event of ["focus", "online"]) target.addEventListener(event, resumed);
  target.addEventListener("arvela-hub-config-changed", changed);
  visibility.addEventListener("visibilitychange", visible);
  return { check: run, stop() {
    alive = false; clearInterval(timer);
    for (const event of ["focus", "online"]) target.removeEventListener(event, resumed);
    target.removeEventListener("arvela-hub-config-changed", changed);
    visibility.removeEventListener("visibilitychange", visible);
  } };
}
