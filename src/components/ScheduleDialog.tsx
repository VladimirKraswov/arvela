import {useEffect,useRef} from "react";
import {createPortal} from "react-dom";
import {store} from "../state/store";
import {taskScheduler} from "../schedules/tasks";
import {ScheduleSection} from "./ScheduleSection";
import {Icon} from "./Icon";
export function ScheduleDialog({onClose}:{onClose:()=>void}) {
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const prior=document.activeElement as HTMLElement|null;ref.current?.showModal();return()=>{ref.current?.close();prior?.focus();};},[]);
 return createPortal(<dialog ref={ref} className="schedule-dialog" aria-labelledby="timers-title" onCancel={onClose}>
  <div className="context-section-title"><h2 id="timers-title">Таймеры и наблюдение</h2><button className="icon-btn" aria-label="Закрыть таймеры" onClick={onClose}><Icon name="close" size={18}/></button></div>
  <p className="context-note">Все таймеры этого устройства. Агент выбирает интервал по вашей просьбе и сохраняет проверку в исходном чате. Пока чат занят или ждёт вашего ответа, запуск откладывается. Полный выход из Enki останавливает пробуждения.</p>
  <ScheduleSection scheduler={taskScheduler()} server={store.state.prefs.workspaceKey??store.state.prefs.endpoint} directory={store.state.directory} sessionID={store.state.activeSessionId} showAll/>
 </dialog>,document.body);
}
