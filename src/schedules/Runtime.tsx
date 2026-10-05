import { useEffect } from "react";
import { store } from "../state/store";
import { taskScheduler } from "./tasks";
export function ScheduleRuntime() {
  useEffect(() => {
    const tick = () => void taskScheduler().tick(store.state.prefs.workspaceKey ?? store.state.prefs.endpoint,
      task => store.runScheduledTask(task)).catch(() => store.setUi({ toast: "Не удалось сохранить расписание. Автоматическая отправка остановлена." }));
    const timer = setInterval(tick, 5000);
    return () => clearInterval(timer);
  }, []);
  return null;
}
