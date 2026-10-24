import { useEffect } from "react";
import { store } from "../state/store";
import { STORAGE_FAILED, taskScheduler } from "./tasks";

/** Desktop-open only: a missed interval is never replayed, and one task runs at a time. */
export function ScheduleRuntime() {
  useEffect(() => {
    const scheduler = taskScheduler();
    const tick = () => void scheduler.tick(store.state.prefs.workspaceKey ?? store.state.prefs.endpoint,
      (task, signal) => store.runScheduledTask(task, signal))
      // Only a storage failure reaches here; the scheduler has already stopped itself.
      .catch(() => store.setUi({ toast: STORAGE_FAILED }));
    tick();
    const timer = setInterval(tick, 5000);
    window.addEventListener("focus",tick);
    return () => {clearInterval(timer);window.removeEventListener("focus",tick);};
  }, []);
  return null;
}
